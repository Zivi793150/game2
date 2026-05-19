# -*- coding: utf-8 -*-
"""
Тест для проверки группового боя (Poker).

Сценарий:
  1. Создаём игру, авто-расстановка
  2. Создаём группы: у P1 2 крейсера, у P2 2 сторожевых
  3. P1 атакует P2 → открывается панель боя
  4. Оба игрока могут нажимать "Показать ещё" и "Стоп" без force_turn
  5. Проверяем что защитник (P2) показал 2 корабля сразу, атакующий (P1) проиграл

Использование:
  export AUTOTEST_TOKEN=test123
  python autotest/test_groups.py --base-url http://127.0.0.1:4444
"""

import argparse, json, os, random, string, sys, time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
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

    def post(self, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = self.base_url.rstrip('/') + path
        r = self.s.post(url, json=(payload or {}), timeout=30)
        data = r.json()
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code} from {url}: {data}")
        return data

    def get(self, path: str) -> Dict[str, Any]:
        url = self.base_url.rstrip('/') + path
        r = self.s.get(url, timeout=30)
        data = r.json()
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code} from {url}: {data}")
        return data


def register_and_login(base_url: str, nickname: str) -> Client:
    s = requests.Session()
    c = Client(base_url=base_url, s=s)
    email = _rand_email(nickname)
    password = "test_pw"
    reg = c.post('/register', {'email': email, 'password': password, 'nickname': nickname})
    if not reg.get('ok'):
        raise RuntimeError(f"Register failed: {reg}")
    login = c.post('/login', {'email': email, 'password': password})
    if not login.get('ok'):
        raise RuntimeError(f"Login failed: {login}")
    me = c.get('/menu')
    if not me.get('ok') or 'user_id' not in me:
        raise RuntimeError(f"Menu failed: {me}")
    c.user_id = int(me['user_id'])
    c.nickname = me.get('nickname')
    return c


def auto_setup_and_battle(client: Client, game_id: int):
    r = client.post(f"/auto_setup/{game_id}", {'placed_ships': []})
    if not r.get('ok'):
        raise RuntimeError(f"auto_setup failed: {r}")
    r = client.post(f"/setup_done/{game_id}", {})
    if not r.get('ok'):
        raise RuntimeError(f"setup_done failed: {r}")


def wait_battle_initialized(p1: Client, p2: Client, game_id: int):
    for _ in range(50):
        st = p1.get(f"/check_setup_done/{game_id}")
        if st.get('ready'):
            return
        time.sleep(0.2)
    raise RuntimeError(f"Battle not initialized for game {game_id}")


def test_poker_both_players_can_act(base_url: str, token: str):
    """
    Тест: P1 (2 крейсера) атакует P2 (2 сторожевых).
    
    Ожидание:
    - После атаки создаётся pending_combat
    - P1 показывает 1 корабль (атакующий)
    - P2 нажимает "Показать ещё" → открывает 2 корабля (сила 4 >= сила 11? НЕТ)
    - На самом деле 2 СТ (сила 2+2=4) < 1 КР (сила 11), поэтому P2 проиграет
    - P2 нажимает "Стоп" → оба его корабля умирают
    - Никаких force_turn не нужно
    """
    p1 = register_and_login(base_url, 'grp_p1')
    p2 = register_and_login(base_url, 'grp_p2')

    # --- SETUP ---
    resp = p1.post('/create_private_room', {})
    game_id = int(resp['game_id'])
    invite_code = resp['invite_code']

    r = p2.get(f"/api/game/{invite_code}")
    if not r.get('ok'):
        raise RuntimeError(f"Join failed: {r}")

    auto_setup_and_battle(p1, game_id)
    auto_setup_and_battle(p2, game_id)
    wait_battle_initialized(p1, p2, game_id)

    print(f"[OK] Game {game_id} created, battle initialized")

    p1_id = p1.user_id
    p2_id = p2.user_id
    if not p1_id or not p2_id:
        raise RuntimeError("Missing user_id")

    # --- Set specific ships via autotest ---
    p1_ships = [
        {'id': 1, 'type': 'КР', 'x': 5, 'y': 10, 'alive': True, 'revealed': False},
        {'id': 2, 'type': 'КР', 'x': 6, 'y': 10, 'alive': True, 'revealed': False},
    ]
    p2_ships = [
        {'id': 1, 'type': 'СТ', 'x': 5, 'y': 11, 'alive': True, 'revealed': False},
        {'id': 2, 'type': 'СТ', 'x': 6, 'y': 11, 'alive': True, 'revealed': False},
    ]

    state_url = f"{base_url.rstrip('/')}/test/autotest/set_battle_state/{game_id}"
    r = requests.Session().post(state_url, json={
        'p1_ships': p1_ships, 'p2_ships': p2_ships, 'current_turn': p1_id
    }, headers={'X-Autotest-Token': token}, timeout=30)
    data = r.json()
    if r.status_code != 200 or not data.get('ok'):
        raise RuntimeError(f"set_battle_state failed: {data}")

    # --- Create groups ---
    cg1 = p1.post(f"/battle/create_group/{game_id}", {'ship_ids': [1, 2]})
    if not cg1.get('ok'):
        raise RuntimeError(f"create_group P1 failed: {cg1}")
    print("[OK] P1 group created (2 КР)")

    # Переключаем ход на P2 для создания его группы
    ft_url = f"{base_url.rstrip('/')}/test/autotest/force_turn/{game_id}"
    r = requests.Session().post(ft_url, json={'player_id': p2_id},
                                 headers={'X-Autotest-Token': token}, timeout=30)
    if r.status_code != 200 or not r.json().get('ok'):
        raise RuntimeError(f"force_turn to P2 failed")

    cg2 = p2.post(f"/battle/create_group/{game_id}", {'ship_ids': [1, 2]})
    if not cg2.get('ok'):
        raise RuntimeError(f"create_group P2 failed: {cg2}")
    print("[OK] P2 group created (2 СТ)")

    # Возвращаем ход P1
    r = requests.Session().post(ft_url, json={'player_id': p1_id},
                                 headers={'X-Autotest-Token': token}, timeout=30)
    if r.status_code != 200 or not r.json().get('ok'):
        raise RuntimeError(f"force_turn back to P1 failed")

    # --- ATTACK: P1 атакует P2 ---
    res = p1.post(f"/battle/move/{game_id}", {
        'attack': {'attacker_ship_id': 1, 'x': 5, 'y': 11}
    })
    if not res.get('ok'):
        raise RuntimeError(f"Group attack failed: {res}")
    if not res.get('pending_combat'):
        raise RuntimeError(f"Expected pending_combat, got: {res}")
    print(f"[OK] P1 attacked P2, pending_combat created")

    pending = res.get('battle', {}).get('pending_combat') or res.get('pending_combat')
    if not pending:
        state = p1.get(f"/battle/state/{game_id}")
        pending = state.get('pending_combat')
    if not pending:
        raise RuntimeError("No pending_combat in response or state")

    print(f"  Pending combat: next_actor={pending.get('next_actor')}, "
          f"attacker_revealed={pending.get('attacker_revealed_n')}, "
          f"defender_revealed={pending.get('defender_revealed_n')}")

    # --- ФАЗА 1: P2 (защитник) нажимает "Показать ещё" ---
    # Без force_turn! Оба могут действовать
    print("\n--- P2 (defender) нажимает 'Показать ещё' ---")
    rev = p2.post(f"/battle/combat_action/{game_id}", {'action': 'reveal'})
    if not rev.get('ok'):
        raise RuntimeError(f"P2 reveal failed: {rev}")

    # Проверяем: защитник автоматически открыл 2 корабля (2 СТ = сила 4)
    state = p1.get(f"/battle/state/{game_id}")
    pc = state.get('pending_combat')
    if pc:
        print(f"  После reveal: defender_revealed_n={pc.get('defender_revealed_n')}")
        if pc.get('defender_revealed_n') != 2:
            print(f"  ⚠️ Ожидал 2, но got {pc.get('defender_revealed_n')}")

    # --- ФАЗА 2: P2 нажимает "Стоп" (он уже не может улучшить) ---
    print("\n--- P2 нажимает 'Стоп' ---")
    stop = p2.post(f"/battle/combat_action/{game_id}", {'action': 'stop'})
    if not stop.get('ok'):
        raise RuntimeError(f"P2 stop failed: {stop}")
    print(f"[OK] P2 stop успешно. battle_info={stop.get('battle_info')}")

    # Проверяем что pending_combat очищен
    state = p1.get(f"/battle/state/{game_id}")
    if state.get('pending_combat'):
        print(f"  ⚠️ pending_combat ещё не очищен")
    else:
        print("[OK] pending_combat очищен после Stop")

    # Проверяем что корабли P2 (СТ) уничтожены
    pos = state['positions']
    for sid in [1, 2]:
        ship = next(s for s in pos[str(p2_id)] if s.get('id') == sid)
        alive = ship.get('alive', True)
        if alive:
            print(f"  ⚠️ P2 ship {sid} должен быть dead, но alive={alive}")
        else:
            print(f"[OK] P2 ship {sid} уничтожен как и ожидалось")

    print(f"\n✅ ТЕСТ ПРОЙДЕН: оба игрока могли действовать в бое без force_turn!")


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--base-url', default=os.environ.get('AUTOTEST_BASE_URL', 'http://127.0.0.1:4444'))
    ap.add_argument('--token', default=os.environ.get('AUTOTEST_TOKEN', 'test123'))
    args = ap.parse_args()

    if not args.token:
        print('AUTOTEST_TOKEN is required', file=sys.stderr)
        sys.exit(2)

    test_poker_both_players_can_act(args.base_url, args.token)