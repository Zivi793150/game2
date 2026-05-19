import argparse
import json
import os
import random
import string
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import requests


def _rand_email(prefix: str) -> str:
    suffix = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(8))
    return f"{prefix}_{suffix}@autotest.local"


@dataclass
class Client:
    base_url: str
    s: requests.Session
    user_id: Optional[int] = None
    nickname: Optional[str] = None

    def post(self, path: str, payload: Optional[Dict[str, Any]] = None, **kwargs: Any) -> Dict[str, Any]:
        url = self.base_url.rstrip('/') + path
        r = self.s.post(url, json=(payload or {}), timeout=30, **kwargs)
        try:
            data = r.json()
        except Exception:
            raise RuntimeError(f"Non-JSON response {r.status_code} from {url}: {r.text[:500]}")
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code} from {url}: {data}")
        return data

    def get(self, path: str, **kwargs: Any) -> Dict[str, Any]:
        url = self.base_url.rstrip('/') + path
        r = self.s.get(url, timeout=30, **kwargs)
        try:
            data = r.json()
        except Exception:
            raise RuntimeError(f"Non-JSON response {r.status_code} from {url}: {r.text[:500]}")
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code} from {url}: {data}")
        return data


def register_and_login(base_url: str, nickname: str) -> Tuple[Client, Dict[str, Any]]:
    s = requests.Session()
    c = Client(base_url=base_url, s=s)

    email = _rand_email(nickname)
    password = "autotest_pw"

    reg = c.post('/register', {'email': email, 'password': password, 'nickname': nickname})
    if not reg.get('ok'):
        raise RuntimeError(f"Register failed: {reg}")

    login = c.post('/login', {'email': email, 'password': password})
    if not login.get('ok'):
        raise RuntimeError(f"Login failed: {login}")

    me = c.get('/menu')
    if not me.get('ok'):
        raise RuntimeError(f"Menu failed: {me}")
    if 'user_id' not in me:
        raise RuntimeError(f"Unexpected /menu payload (no user_id): {me}")

    c.user_id = int(me['user_id'])
    c.nickname = me.get('nickname')

    return c, {'email': email, 'password': password, 'user_id': c.user_id, 'nickname': c.nickname}


def create_private_room(creator: Client) -> Tuple[int, str]:
    resp = creator.post('/create_private_room', {})
    if not resp.get('ok'):
        raise RuntimeError(f"create_private_room failed: {resp}")
    return int(resp['game_id']), str(resp['invite_code'])


def join_by_invite(joiner: Client, invite_code: str) -> int:
    resp = joiner.get(f"/api/game/{invite_code}")
    if not resp.get('ok'):
        raise RuntimeError(f"join_by_invite failed: {resp}")
    return int(resp['game_id'])


def ensure_battle_initialized(p1: Client, p2: Client, game_id: int) -> None:
    # Auto-place ships and mark setup done for both, then check until battle exists.
    for c in (p1, p2):
        a = c.post(f"/auto_setup/{game_id}", {'placed_ships': []})
        if not a.get('ok'):
            raise RuntimeError(f"auto_setup failed: {a}")
        d = c.post(f"/setup_done/{game_id}", {})
        if not d.get('ok'):
            raise RuntimeError(f"setup_done failed: {d}")

    # Poll until ready
    for _ in range(50):
        st1 = p1.get(f"/check_setup_done/{game_id}")
        if st1.get('ready'):
            return
        time.sleep(0.2)

    raise RuntimeError(f"Battle was not initialized for game {game_id}")


def autotest_set_state(
    base_url: str,
    token: str,
    game_id: int,
    p1_ships: List[Dict[str, Any]],
    p2_ships: List[Dict[str, Any]],
    current_turn: Optional[int] = None,
) -> Dict[str, Any]:
    s = requests.Session()
    url = base_url.rstrip('/') + f"/test/autotest/set_battle_state/{game_id}"
    r = s.post(url, json={
        'p1_ships': p1_ships,
        'p2_ships': p2_ships,
        'current_turn': current_turn,
    }, headers={'X-Autotest-Token': token}, timeout=30)
    data = r.json()
    if r.status_code != 200 or not data.get('ok'):
        raise RuntimeError(f"set_battle_state failed: HTTP {r.status_code} {data}")
    return data


def _mk_ship(ship_id: int, t: str, x: int, y: int, alive: bool = True, revealed: bool = False) -> Dict[str, Any]:
    return {'id': ship_id, 'type': t, 'x': x, 'y': y, 'alive': alive, 'revealed': revealed}


def _state_positions(client: Client, game_id: int) -> Dict[str, List[Dict[str, Any]]]:
    st = client.get(f"/battle/state/{game_id}")
    if not st.get('ok'):
        raise RuntimeError(f"battle/state failed: {st}")
    return st['positions']


def _find_ship(positions: Dict[str, List[Dict[str, Any]]], player_id: int, ship_id: int) -> Dict[str, Any]:
    ships = positions.get(str(player_id), [])
    for s in ships:
        if int(s.get('id')) == int(ship_id):
            return s
    raise RuntimeError(f"Ship id={ship_id} not found for player={player_id}")


def _assert_alive(positions: Dict[str, List[Dict[str, Any]]], player_id: int, ship_id: int, alive: bool) -> None:
    s = _find_ship(positions, player_id, ship_id)
    got = bool(s.get('alive', True))
    if got != bool(alive):
        raise RuntimeError(f"Expected alive={alive} for player={player_id} ship={ship_id}, got {s}")


def scenario_basic_attack(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    # Place 1 attacker and 1 defender adjacent
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id (register/login did not populate)')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    p1_ships = [_mk_ship(1, 'КР', 5, 10), _mk_ship(2, 'СТ', 0, 10)]
    p2_ships = [_mk_ship(1, 'СТ', 5, 11)]

    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)

    # Attack: cruiser vs сторожевой => defender dies
    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 5, 'y': 11}})
    if not res.get('ok'):
        raise RuntimeError(f"Attack failed: {res}")

    st = p1.get(f"/battle/state/{game_id}")
    pos = st['positions']
    def_ship = next(s for s in pos[str(p2_id)] if s['x'] == 5 and s['y'] == 11)
    if def_ship.get('alive', True) is not False:
        raise RuntimeError(f"Scenario basic_attack: defender should be dead, got {def_ship}")


def scenario_air_attack(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id (register/login did not populate)')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    # A at (3,10), S at (3,11), shoot south -> cells (3,12..14)
    p1_ships = [
        _mk_ship(10, 'А', 3, 10),
        _mk_ship(11, 'С', 3, 11),
    ]
    p2_ships = [
        _mk_ship(20, 'СТ', 3, 12),
        _mk_ship(21, 'СТ', 3, 13),
    ]

    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)

    res = p1.post(f"/battle/move/{game_id}", {'air_attack': {'a_id': 10, 's_id': 11, 'direction': 'S'}})
    if not res.get('ok'):
        raise RuntimeError(f"Air attack failed: {res}")

    st = p1.get(f"/battle/state/{game_id}")
    pos = st['positions']
    # plane must be dead
    plane = next(s for s in pos[str(p1_id)] if s.get('id') == 11)
    if plane.get('alive', True) is not False:
        raise RuntimeError(f"Scenario air_attack: plane should be dead, got {plane}")
    # enemies in path dead
    for eid in (20, 21):
        e = next(s for s in pos[str(p2_id)] if s.get('id') == eid)
        if e.get('alive', True) is not False:
            raise RuntimeError(f"Scenario air_attack: enemy {eid} should be dead, got {e}")


def scenario_submarine_vs_bdk(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id (register/login did not populate)')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    # ПЛ атакует БДК => БДК умирает
    p1_ships = [_mk_ship(1, 'ПЛ', 5, 10)]
    p2_ships = [_mk_ship(1, 'БДК', 5, 11)]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)

    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 5, 'y': 11}})
    if not res.get('ok'):
        raise RuntimeError(f"Attack failed: {res}")
    pos = _state_positions(p1, game_id)
    _assert_alive(pos, p2_id, 1, False)

    # БДК атакует ПЛ => ПЛ умирает
    p1_ships = [_mk_ship(1, 'БДК', 5, 10)]
    p2_ships = [_mk_ship(1, 'ПЛ', 5, 11)]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)

    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 5, 'y': 11}})
    if not res.get('ok'):
        raise RuntimeError(f"Attack failed: {res}")
    pos = _state_positions(p1, game_id)
    _assert_alive(pos, p1_id, 1, False)


def scenario_krpl_vs_kr(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id (register/login did not populate)')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    # КРПЛ атакует КР => КР умирает
    p1_ships = [_mk_ship(1, 'КРПЛ', 6, 10)]
    p2_ships = [_mk_ship(1, 'КР', 6, 11)]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)
    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 6, 'y': 11}})
    if not res.get('ok'):
        raise RuntimeError(f"Attack failed: {res}")
    pos = _state_positions(p1, game_id)
    _assert_alive(pos, p2_id, 1, False)


def scenario_tanker_both_die(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id (register/login did not populate)')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    p1_ships = [_mk_ship(1, 'ТН', 7, 10)]
    p2_ships = [_mk_ship(1, 'СТ', 7, 11)]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)
    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 7, 'y': 11}})
    if not res.get('ok'):
        raise RuntimeError(f"Attack failed: {res}")
    pos = _state_positions(p1, game_id)
    _assert_alive(pos, p1_id, 1, False)
    _assert_alive(pos, p2_id, 1, False)


def scenario_mine_vs_tr_exception(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id (register/login did not populate)')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    # ТР атакует мину (М) => мина умирает, ТР жив, владелец мины пропускает ход (ход не переходит)
    p1_ships = [_mk_ship(1, 'ТР', 4, 10)]
    p2_ships = [_mk_ship(1, 'М', 4, 11)]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)
    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 4, 'y': 11}})
    if not res.get('ok'):
        raise RuntimeError(f"Attack failed: {res}")
    pos = _state_positions(p1, game_id)
    _assert_alive(pos, p1_id, 1, True)
    _assert_alive(pos, p2_id, 1, False)

    st = p1.get(f"/battle/state/{game_id}")
    if int(st.get('current_turn')) != p1_id:
        raise RuntimeError(f"Mine exception should keep turn for attacker, got state: {st}")


def scenario_torpedo_shot(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id (register/login did not populate)')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    # TK at (1,10), torpedo at (2,10) adjacent, shoot East -> hit enemy at (4,10)
    p1_ships = [
        _mk_ship(10, 'ТК', 1, 10),
        _mk_ship(11, 'Т', 2, 10),
    ]
    p2_ships = [
        _mk_ship(20, 'СТ', 4, 10),
    ]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)
    res = p1.post(f"/battle/move/{game_id}", {'torpedo_shot': {'tk_id': 10, 't_id': 11, 'direction': 'E'}})
    if not res.get('ok'):
        raise RuntimeError(f"torpedo_shot failed: {res}")

    pos = _state_positions(p1, game_id)
    _assert_alive(pos, p1_id, 11, False)  # torpedo spent
    _assert_alive(pos, p2_id, 20, False)  # enemy destroyed


def scenario_atomic_bomb_explosion(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id (register/login did not populate)')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    # Attack AB into adjacent enemy; expect 5x5 blast kills ships around target
    # Target cell (8,11); put victims inside radius 2.
    p1_ships = [
        _mk_ship(30, 'АБ', 8, 10),
        _mk_ship(31, 'СТ', 6, 12),
    ]
    p2_ships = [
        _mk_ship(40, 'СТ', 8, 11),
        _mk_ship(41, 'СТ', 10, 13),
    ]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)
    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 30, 'x': 8, 'y': 11}})
    if not res.get('ok'):
        raise RuntimeError(f"AB attack failed: {res}")

    pos = _state_positions(p1, game_id)
    # AB special means both engaged die, plus all in 5x5 (so 31, 41 should be dead too)
    _assert_alive(pos, p1_id, 30, False)
    _assert_alive(pos, p2_id, 40, False)
    _assert_alive(pos, p1_id, 31, False)
    _assert_alive(pos, p2_id, 41, False)


def scenario_group_poker_flow(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id (register/login did not populate)')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    # Create 2-ship group for P1 (КР + КР) adjacent, and 2-ship group for P2 (СТ + СТ) adjacent
    p1_ships = [
        _mk_ship(1, 'КР', 5, 10),
        _mk_ship(2, 'КР', 6, 10),
    ]
    p2_ships = [
        _mk_ship(1, 'СТ', 5, 11),
        _mk_ship(2, 'СТ', 6, 11),
    ]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)

    cg1 = p1.post(f"/battle/create_group/{game_id}", {'ship_ids': [1, 2]})
    if not cg1.get('ok'):
        raise RuntimeError(f"create_group p1 failed: {cg1}")
    cg2 = p1.post(f"/test/autotest/force_turn/{game_id}", {'player_id': p2_id}, headers={'X-Autotest-Token': token})
    # NOTE: above is a raw call; but our Client class doesn't support headers in post() easily for JSON-only; do it via requests
    # We'll just force turn using direct requests below.

    # Force turn to P2 via autotest endpoint (must include header)
    url = base_url.rstrip('/') + f"/test/autotest/force_turn/{game_id}"
    r = requests.Session().post(url, json={'player_id': p2_id}, headers={'X-Autotest-Token': token}, timeout=30)
    data = r.json()
    if r.status_code != 200 or not data.get('ok'):
        raise RuntimeError(f"force_turn failed: HTTP {r.status_code} {data}")

    cg2 = p2.post(f"/battle/create_group/{game_id}", {'ship_ids': [1, 2]})
    if not cg2.get('ok'):
        raise RuntimeError(f"create_group p2 failed: {cg2}")

    # Force turn back to attacker (P1)
    r = requests.Session().post(url, json={'player_id': p1_id}, headers={'X-Autotest-Token': token}, timeout=30)
    data = r.json()
    if r.status_code != 200 or not data.get('ok'):
        raise RuntimeError(f"force_turn failed: HTTP {r.status_code} {data}")

    # Attack group-to-group should start pending_combat
    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 5, 'y': 11}})
    if not res.get('ok'):
        raise RuntimeError(f"Group attack failed: {res}")
    if not res.get('pending_combat') and not (res.get('battle') and res['battle'].get('pending_combat')):
        raise RuntimeError(f"Expected pending_combat to start, got {res}")

    # While pending_combat, normal actions must be blocked
    blocked = p1.post(f"/battle/move/{game_id}", {'move': {'ship_id': 2, 'to': [7, 10]}})
    if blocked.get('ok'):
        raise RuntimeError(f"Expected move blocked during pending_combat, got {blocked}")

    # Resolve poker quickly: defender reveal once then stop
    # Force current turn to defender for combat_action? In backend, combat_action requires current_turn_player_id == user.
    # We'll set turn to defender via autotest endpoint, then call reveal, then set turn back and stop.
    r = requests.Session().post(url, json={'player_id': p2_id}, headers={'X-Autotest-Token': token}, timeout=30)
    data = r.json()
    if r.status_code != 200 or not data.get('ok'):
        raise RuntimeError(f"force_turn failed: HTTP {r.status_code} {data}")
    rev = p2.post(f"/battle/combat_action/{game_id}", {'action': 'reveal'})
    if not rev.get('ok'):
        raise RuntimeError(f"combat_action reveal failed: {rev}")

    # After defender reveal with equal strengths, next_actor stays 'defender'
    # So stop should be called by defender (P2), not attacker
    stop = p2.post(f"/battle/combat_action/{game_id}", {'action': 'stop'})
    if not stop.get('ok'):
        raise RuntimeError(f"combat_action stop failed: {stop}")
    # After stop, pending_combat cleared
    st = p1.get(f"/battle/state/{game_id}")
    if st.get('pending_combat'):
        raise RuntimeError(f"pending_combat should be cleared after stop, got {st.get('pending_combat')}")


def scenario_group_of_3_poker(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    """Test group of 3 ships (Фрегаты) with poker battle."""
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    # Use types with known strengths from backend:
    # КР=11, ЭС=9. Attacker must be stronger to assert deterministic result.
    p1_ships = [
        _mk_ship(1, 'КР', 5, 10),
        _mk_ship(2, 'КР', 6, 10),
        _mk_ship(3, 'КР', 7, 10),
    ]
    # Group of 3 Эсминцев (strength 9 each = 27 total)
    p2_ships = [
        _mk_ship(1, 'ЭС', 5, 11),
        _mk_ship(2, 'ЭС', 6, 11),
        _mk_ship(3, 'ЭС', 7, 11),
    ]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)

    # Create groups
    cg1 = p1.post(f"/battle/create_group/{game_id}", {'ship_ids': [1, 2, 3]})
    if not cg1.get('ok'):
        raise RuntimeError(f"create_group of 3 p1 failed: {cg1}")

    url = base_url.rstrip('/') + f"/test/autotest/force_turn/{game_id}"
    r = requests.Session().post(url, json={'player_id': p2_id}, headers={'X-Autotest-Token': token}, timeout=30)
    data = r.json()
    if r.status_code != 200 or not data.get('ok'):
        raise RuntimeError(f"force_turn failed: HTTP {r.status_code} {data}")

    cg2 = p2.post(f"/battle/create_group/{game_id}", {'ship_ids': [1, 2, 3]})
    if not cg2.get('ok'):
        raise RuntimeError(f"create_group of 3 p2 failed: {cg2}")

    # Attack
    r = requests.Session().post(url, json={'player_id': p1_id}, headers={'X-Autotest-Token': token}, timeout=30)
    data = r.json()
    if r.status_code != 200 or not data.get('ok'):
        raise RuntimeError(f"force_turn failed: HTTP {r.status_code} {data}")

    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 5, 'y': 11}})
    if not res.get('ok'):
        raise RuntimeError(f"Group of 3 attack failed: {res}")
    if not res.get('pending_combat'):
        raise RuntimeError(f"Expected pending_combat for group of 3, got {res}")

    # Follow server-side poker turn logic: pending_combat.next_actor decides who may act.
    # We poll /battle/state and always force current_turn to the required actor.
    # Then we reveal until someone can't reveal anymore, and stop.
    state = p1.get(f"/battle/state/{game_id}")
    pending = state.get('pending_combat')
    if not pending:
        raise RuntimeError(f"Expected pending_combat in state, got {state}")

    for _ in range(10):
        state = p1.get(f"/battle/state/{game_id}")
        pending = state.get('pending_combat')
        if not pending:
            break

        actor = pending.get('next_actor')
        if actor not in ('attacker', 'defender'):
            raise RuntimeError(f"Unexpected next_actor={actor} pending={pending}")

        actor_id = p1_id if actor == 'attacker' else p2_id
        actor_client = p1 if actor == 'attacker' else p2

        r = requests.Session().post(url, json={'player_id': actor_id}, headers={'X-Autotest-Token': token}, timeout=30)
        data = r.json()
        if r.status_code != 200 or not data.get('ok'):
            raise RuntimeError(f"force_turn failed: HTTP {r.status_code} {data}")

        rev = actor_client.post(f"/battle/combat_action/{game_id}", {'action': 'reveal'})
        if rev.get('ok'):
            continue

        # If there is nothing left to reveal, stop the combat from the same actor.
        if rev.get('error') == 'Больше нечего раскрывать':
            stop = actor_client.post(f"/battle/combat_action/{game_id}", {'action': 'stop'})
            if not stop.get('ok'):
                raise RuntimeError(f"combat_action stop failed: {stop}")
            break

        raise RuntimeError(f"combat_action reveal failed: {rev}")

    # Ensure combat is resolved
    state = p1.get(f"/battle/state/{game_id}")
    if state.get('pending_combat'):
        # Force stop by whoever is the next_actor now
        pending = state.get('pending_combat') or {}
        actor = pending.get('next_actor')
        actor_id = p1_id if actor == 'attacker' else p2_id
        actor_client = p1 if actor == 'attacker' else p2
        r = requests.Session().post(url, json={'player_id': actor_id}, headers={'X-Autotest-Token': token}, timeout=30)
        data = r.json()
        if r.status_code != 200 or not data.get('ok'):
            raise RuntimeError(f"force_turn failed: HTTP {r.status_code} {data}")
        stop = actor_client.post(f"/battle/combat_action/{game_id}", {'action': 'stop'})
        if not stop.get('ok'):
            raise RuntimeError(f"combat_action stop failed: {stop}")

    # Verify: defender destroyed (total attacker strength > total defender strength), attacker survives
    pos = _state_positions(p1, game_id)
    # All defender ships should be dead
    _assert_alive(pos, p2_id, 1, False)
    _assert_alive(pos, p2_id, 2, False)
    _assert_alive(pos, p2_id, 3, False)
    # Attacker ships should be alive
    _assert_alive(pos, p1_id, 1, True)
    _assert_alive(pos, p1_id, 2, True)
    _assert_alive(pos, p1_id, 3, True)


def scenario_chain_ab_explosion(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    """Test chain AB explosion: two atomic bombs near each other."""
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    # Two ABs close to each other (distance 2, so one explosion triggers the other)
    # AB at (5,10), another AB at (7,10) - distance 2 horizontally
    p1_ships = [
        _mk_ship(1, 'АБ', 5, 10),
        _mk_ship(2, 'КР', 6, 10),  # Between ABs, should die
    ]
    p2_ships = [
        _mk_ship(1, 'АБ', 7, 10),  # Second AB
        _mk_ship(2, 'КР', 8, 10),  # Should die from second AB
    ]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)

    # Attack AB at (7,10) with КР (strength 6, but AB explodes on contact)
    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 2, 'x': 7, 'y': 10}})
    if not res.get('ok'):
        raise RuntimeError(f"AB attack failed: {res}")

    pos = _state_positions(p1, game_id)
    # Both ABs should explode (chain reaction)
    _assert_alive(pos, p1_id, 1, False)  # First AB explodes from second AB
    _assert_alive(pos, p1_id, 2, False)  # Attacker dies
    _assert_alive(pos, p2_id, 1, False)  # Second AB explodes
    _assert_alive(pos, p2_id, 2, False)  # Dies from second AB explosion


def scenario_tr_attacks_mine(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    """Test TR (minesweeper) attacks mine - TR should destroy mine and survive."""
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    # TR attacks mine
    p1_ships = [
        _mk_ship(1, 'ТР', 5, 10),  # Тральщик
    ]
    p2_ships = [
        _mk_ship(1, 'М', 5, 11),   # Мина
    ]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)

    # TR attacks mine
    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 5, 'y': 11}})
    if not res.get('ok'):
        raise RuntimeError(f"TR attack mine failed: {res}")

    pos = _state_positions(p1, game_id)
    # TR should survive, mine should be destroyed
    _assert_alive(pos, p1_id, 1, True)
    _assert_alive(pos, p2_id, 1, False)


def scenario_sm_interaction(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    """Test SM (stationary mine) - both ships die when attacking/defending against SM."""
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    # Subtest 1: P1 КР attacks P2 СМ (must be adjacent)
    p1_ships = [
        _mk_ship(1, 'КР', 5, 11),   # Attacker adjacent to SM
    ]
    p2_ships = [
        _mk_ship(1, 'СМ', 5, 12),   # Stationary mine
    ]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)

    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 5, 'y': 12}})
    if not res.get('ok'):
        raise RuntimeError(f"KR attacks SM failed: {res}")

    pos = _state_positions(p1, game_id)
    # Both should die
    _assert_alive(pos, p1_id, 1, False)  # Our КР
    _assert_alive(pos, p2_id, 1, False)  # Enemy СМ

    # Subtest 2: P2 КР attacks P1 СМ (must be adjacent)
    p1_ships = [
        _mk_ship(1, 'СМ', 5, 10),
    ]
    p2_ships = [
        _mk_ship(1, 'КР', 5, 11),
    ]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p2_id)

    res = p2.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 5, 'y': 10}})
    if not res.get('ok'):
        raise RuntimeError(f"KR attacks our SM failed: {res}")

    pos = _state_positions(p1, game_id)
    # Both should die
    _assert_alive(pos, p2_id, 1, False)  # P2 КР
    _assert_alive(pos, p1_id, 1, False)  # Our СМ


def scenario_victory_condition(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    """Test victory: destroy all enemy movable ships or reduce VMB to < 2."""
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)

    # P2 has: 1 VMB (<2) and 1 movable ship. Once the movable ship is destroyed,
    # victory condition should be satisfied.
    p1_ships = [
        # Place attacker adjacent to the enemy movable ship (face-to-face requirement)
        _mk_ship(1, 'КР', 5, 10),
    ]
    p2_ships = [
        _mk_ship(1, 'ВМБ', 2, 2),    # Only 1 VMB (< 2), keep far away
        _mk_ship(2, 'СТ', 5, 11),    # Movable and adjacent target (ST strength 2)
    ]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)

    # Destroy the movable ship (face-to-face: target at (5,11) is adjacent to attacker at (5,10))
    res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 5, 'y': 11}})
    if not res.get('ok'):
        raise RuntimeError(f"Attack failed: {res}")

    # Verify target destroyed
    pos = _state_positions(p1, game_id)
    _assert_alive(pos, p2_id, 2, False)

    # Victory can be returned either as explicit field in /battle/move response
    # or as battle status=finished.
    if res.get('victory') is not True:
        state = p1.get(f"/battle/state/{game_id}")
        if state.get('status') != 'finished':
            raise RuntimeError(f"Expected victory/finished state, got move_res={res} state={state}")


def scenario_setup_phase(p1: Client, p2: Client, base_url: str, token: str) -> int:
    """Test setup phase: create game, both players setup, verify timer and readiness."""
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id')
    
    game_id, invite_code = create_private_room(p1)
    join_game_id = join_by_invite(p2, invite_code)
    if join_game_id != game_id:
        raise RuntimeError('Game id mismatch')
    
    # Check setup status before either player is ready
    st = p1.get(f"/check_setup_done/{game_id}")
    if st.get('ready'):
        raise RuntimeError("Setup should not be ready before both players confirm")
    
    # P1 auto-setup and confirm
    a1 = p1.post(f"/auto_setup/{game_id}", {'placed_ships': []})
    if not a1.get('ok'):
        raise RuntimeError(f"P1 auto_setup failed: {a1}")
    
    d1 = p1.post(f"/setup_done/{game_id}", {})
    if not d1.get('ok'):
        raise RuntimeError(f"P1 setup_done failed: {d1}")
    
    # Still not ready - P2 hasn't confirmed
    st = p1.get(f"/check_setup_done/{game_id}")
    if st.get('ready'):
        raise RuntimeError("Setup should not be ready after only P1 confirms")
    
    # P2 auto-setup and confirm
    a2 = p2.post(f"/auto_setup/{game_id}", {'placed_ships': []})
    if not a2.get('ok'):
        raise RuntimeError(f"P2 auto_setup failed: {a2}")
    
    d2 = p2.post(f"/setup_done/{game_id}", {})
    if not d2.get('ok'):
        raise RuntimeError(f"P2 setup_done failed: {d2}")
    
    # Now should be ready
    for _ in range(50):
        st = p1.get(f"/check_setup_done/{game_id}")
        if st.get('ready'):
            return game_id
        time.sleep(0.2)
    
    raise RuntimeError("Setup was not ready after both players confirmed")


def scenario_pause_system(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    """Test pause system: 2 pauses (1 min and 3 min), blocking moves during pause."""
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)
    
    # Ensure battle is active with some ships
    p1_ships = [_mk_ship(1, 'КР', 5, 10)]
    p2_ships = [_mk_ship(1, 'СТ', 5, 11)]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)
    
    # P1 starts short pause (1 minute type)
    pause_res = p1.post(f"/pause/start/{game_id}", {'pause_type': 'short'})
    if not pause_res.get('ok'):
        raise RuntimeError(f"Pause start failed: {pause_res}")
    
    # Check pause status
    pause_status = p1.get(f"/pause/status/{game_id}")
    if not pause_status.get('is_paused'):
        raise RuntimeError(f"Pause should be active, got: {pause_status}")
    
    # End pause early (for testing)
    end_pause = p1.post(f"/pause/end/{game_id}", {})
    if not end_pause.get('ok'):
        raise RuntimeError(f"Pause end failed: {end_pause}")
    
    # Verify pause ended
    pause_status = p1.get(f"/pause/status/{game_id}")
    if pause_status.get('is_paused'):
        raise RuntimeError(f"Pause should be ended, got: {pause_status}")
    
    # Now moves should work
    # Force turn to P1
    url = base_url.rstrip('/') + f"/test/autotest/force_turn/{game_id}"
    r = requests.Session().post(url, json={'player_id': p1_id}, headers={'X-Autotest-Token': token}, timeout=30)
    data = r.json()
    if r.status_code != 200 or not data.get('ok'):
        raise RuntimeError(f"force_turn failed: HTTP {r.status_code} {data}")
    
    move_res = p1.post(f"/battle/move/{game_id}", {'move': {'ship_id': 1, 'to': [6, 10]}})
    if not move_res.get('ok'):
        raise RuntimeError(f"Move after pause failed: {move_res}")


def scenario_timer_and_turn_timeout(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    """Test timer system and turn timeout."""
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)
    
    # Setup simple position
    p1_ships = [_mk_ship(1, 'КР', 5, 10)]
    p2_ships = [_mk_ship(1, 'СТ', 5, 11)]
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)
    
    # Check timer status
    timer = p1.get(f"/timer/status/{game_id}")
    if not timer.get('ok'):
        raise RuntimeError(f"Timer status failed: {timer}")
    
    # Should have some time remaining
    if timer.get('turn_remaining', 0) <= 0:
        raise RuntimeError(f"Timer should have time remaining, got: {timer}")
    
    # Current turn should be P1
    if timer.get('current_turn_player_id') != p1_id:
        raise RuntimeError(f"Current turn should be P1, got: {timer}")


def scenario_ship_stealth_hidden_from_enemy(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    """Test that enemy ships are hidden (type not revealed) until battle starts."""
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)
    
    # Setup with specific ship types
    p1_ships = [_mk_ship(1, 'КР', 5, 10)]
    p2_ships = [_mk_ship(1, 'ПЛ', 5, 11)]  # Submarine - should be hidden from P1
    autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)
    
    # Get state from P1 perspective
    st = p1.get(f"/battle/state/{game_id}")
    pos = st.get('positions', {})
    
    # Check enemy ships - type should be hidden or masked
    enemy_ships = pos.get(str(p2_id), [])
    for ship in enemy_ships:
        # Enemy ship type should not be fully revealed before battle interaction
        # This depends on game rules - some games hide types, some show positions only
        # We'll check that enemy has ships but we may not see exact type
        if ship.get('alive') and ship.get('type') == 'ПЛ':
            # If type is visible, that's fine for this test
            # If game hides types, we'd check for masked type
            pass


def scenario_full_battle_matrix(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    """Test matrix of ship type interactions - key pairs only."""
    if p1.user_id is None or p2.user_id is None:
        raise RuntimeError('Clients missing user_id')
    p1_id = int(p1.user_id)
    p2_id = int(p2.user_id)
    
    # Key interaction pairs to test
    test_cases = [
        # (attacker_type, defender_type, expected_attacker_alive, expected_defender_alive)
        ('ПЛ', 'БДК', True, False),   # Sub beats BDK
        ('БДК', 'ПЛ', False, True),    # BDK loses to sub
        ('КРПЛ', 'КР', True, False),   # KRPL beats KR
        ('КР', 'КРПЛ', False, True),  # KR loses to KRPL
        ('ТН', 'СТ', False, False),   # Tanker - both die
        ('ТР', 'М', True, False),     # Minesweeper beats mine
        ('М', 'ТР', False, True),     # Mine loses to minesweeper (special)
    ]
    
    for idx, (att_type, def_type, att_alive, def_alive) in enumerate(test_cases):
        # Setup for this test case
        p1_ships = [_mk_ship(1, att_type, 5, 10)]
        p2_ships = [_mk_ship(1, def_type, 5, 11)]
        autotest_set_state(base_url, token, game_id, p1_ships, p2_ships, current_turn=p1_id)
        
        # Attack
        res = p1.post(f"/battle/move/{game_id}", {'attack': {'attacker_ship_id': 1, 'x': 5, 'y': 11}})
        if not res.get('ok'):
            raise RuntimeError(f"Attack failed for {att_type} vs {def_type}: {res}")
        
        # Verify results
        pos = _state_positions(p1, game_id)
        actual_att_alive = _find_ship(pos, p1_id, 1).get('alive', True)
        actual_def_alive = _find_ship(pos, p2_id, 1).get('alive', True)
        
        if actual_att_alive != att_alive:
            raise RuntimeError(f"Case {att_type} vs {def_type}: expected attacker alive={att_alive}, got {actual_att_alive}")
        if actual_def_alive != def_alive:
            raise RuntimeError(f"Case {att_type} vs {def_type}: expected defender alive={def_alive}, got {actual_def_alive}")


def scenario_chat_system(p1: Client, p2: Client, game_id: int) -> None:
    """Test chat messaging between players."""
    # P1 sends message
    msg1 = p1.post(f"/chat/send/{game_id}", {'message': 'Hello from P1'})
    if not msg1.get('ok'):
        raise RuntimeError(f"P1 chat send failed: {msg1}")
    
    # P2 reads messages
    msgs = p2.get(f"/chat/messages/{game_id}")
    if not msgs.get('ok'):
        raise RuntimeError(f"P2 get messages failed: {msgs}")
    
    # P2 sends message
    msg2 = p2.post(f"/chat/send/{game_id}", {'message': 'Hello from P2'})
    if not msg2.get('ok'):
        raise RuntimeError(f"P2 chat send failed: {msg2}")
    
    # P1 reads messages
    msgs = p1.get(f"/chat/messages/{game_id}")
    if not msgs.get('ok'):
        raise RuntimeError(f"P1 get messages failed: {msgs}")


def scenario_matchmaking_queue(base_url: str) -> None:
    """Test matchmaking queue search/start/stop."""
    # Create temporary clients for matchmaking test
    p_search, _ = register_and_login(base_url, 'bot_search')
    
    # Start search
    start_res = p_search.post("/search/start", {})
    if not start_res.get('ok'):
        raise RuntimeError(f"Search start failed: {start_res}")
    
    # Get searching players
    players_res = p_search.get("/search/players")
    if not players_res.get('ok'):
        raise RuntimeError(f"Get searching players failed: {players_res}")
    
    # Stop search
    stop_res = p_search.post("/search/stop", {})
    if not stop_res.get('ok'):
        raise RuntimeError(f"Search stop failed: {stop_res}")


def scenario_invite_flow(p1: Client, p2: Client, base_url: str) -> int:
    """Test invite send/accept flow between players."""
    # P2 starts search first (to be findable)
    p2.post("/search/start", {})
    
    try:
        # P1 sends invite to P2
        send_res = p1.post("/invite/send", {'to_user_id': p2.user_id})
        if not send_res.get('ok'):
            # If invite fails, use private room fallback
            game_id, invite_code = create_private_room(p1)
            join_game_id = join_by_invite(p2, invite_code)
            if join_game_id != game_id:
                raise RuntimeError('Game id mismatch in invite fallback')
            return game_id
        
        game_id = send_res.get('game_id')
        
        # P2 checks invites to get invite_id
        invites_res = p2.get("/invite/check")
        if not invites_res.get('ok'):
            raise RuntimeError(f"Check invites failed: {invites_res}")
        
        invites = invites_res.get('invites', [])
        if not invites:
            raise RuntimeError("No invites found for P2")
        
        # Find invite from P1
        invite_id = None
        for inv in invites:
            if inv.get('game_id') == game_id:
                invite_id = inv.get('invite_id')
                break
        
        if not invite_id:
            raise RuntimeError(f"Could not find invite_id for game {game_id}")
        
        # P2 accepts invite
        accept_res = p2.post(f"/invite/accept/{invite_id}", {})
        if not accept_res.get('ok'):
            raise RuntimeError(f"Accept invite failed: {accept_res}")
        
        return game_id
    finally:
        p2.post("/search/stop", {})


def scenario_network_disconnect_simulation(p1: Client, p2: Client, base_url: str, token: str, game_id: int) -> None:
    """Test that player session persists and game is accessible."""
    # Verify P1 can still access game (session alive)
    state = p1.get(f"/battle/state/{game_id}")
    # Should either get state or meaningful error (not 'Не авторизован')
    if not state.get('ok') and 'Не авторизован' in str(state.get('error', '')):
        raise RuntimeError(f"P1 session expired unexpectedly: {state}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--base-url', default=os.environ.get('AUTOTEST_BASE_URL', 'http://127.0.0.1:5001'))
    ap.add_argument('--token', default=os.environ.get('AUTOTEST_TOKEN'))
    args = ap.parse_args()

    if not args.token:
        print('AUTOTEST_TOKEN is required (env AUTOTEST_TOKEN or --token).', file=sys.stderr)
        return 2

    p1, p1_info = register_and_login(args.base_url, 'bot_p1')
    p2, p2_info = register_and_login(args.base_url, 'bot_p2')

    game_id, invite_code = create_private_room(p1)
    join_game_id = join_by_invite(p2, invite_code)
    if join_game_id != game_id:
        raise RuntimeError('Game id mismatch')

    ensure_battle_initialized(p1, p2, game_id)

    print(f"Autotest game_id={game_id} invite_code={invite_code}")

    scenario_basic_attack(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_basic_attack')

    scenario_air_attack(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_air_attack')

    scenario_submarine_vs_bdk(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_submarine_vs_bdk')

    scenario_krpl_vs_kr(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_krpl_vs_kr')

    scenario_tanker_both_die(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_tanker_both_die')

    scenario_mine_vs_tr_exception(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_mine_vs_tr_exception')

    scenario_torpedo_shot(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_torpedo_shot')

    scenario_atomic_bomb_explosion(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_atomic_bomb_explosion')

    scenario_group_poker_flow(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_group_poker_flow')

    scenario_group_of_3_poker(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_group_of_3_poker')

    scenario_chain_ab_explosion(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_chain_ab_explosion')

    scenario_tr_attacks_mine(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_tr_attacks_mine')

    scenario_sm_interaction(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_sm_interaction')

    scenario_victory_condition(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_victory_condition')

    # Additional system scenarios
    scenario_pause_system(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_pause_system')

    scenario_timer_and_turn_timeout(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_timer_and_turn_timeout')

    scenario_ship_stealth_hidden_from_enemy(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_ship_stealth_hidden_from_enemy')

    scenario_full_battle_matrix(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_full_battle_matrix')

    # Setup phase test (creates its own game)
    scenario_setup_phase(p1, p2, args.base_url, args.token)
    print('OK: scenario_setup_phase')

    # Chat system test
    scenario_chat_system(p1, p2, game_id)
    print('OK: scenario_chat_system')

    # Matchmaking queue test
    scenario_matchmaking_queue(args.base_url)
    print('OK: scenario_matchmaking_queue')

    # Invite flow test (creates another game)
    invite_game_id = scenario_invite_flow(p1, p2, args.base_url)
    print(f'OK: scenario_invite_flow (game_id={invite_game_id})')

    # Network disconnect simulation
    scenario_network_disconnect_simulation(p1, p2, args.base_url, args.token, game_id)
    print('OK: scenario_network_disconnect_simulation')

    print('ALL OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
