# -*- coding: utf-8 -*-
import json
import logging
import os
import random
import sys
import time
from datetime import datetime
from logging.handlers import RotatingFileHandler
from typing import Optional, List, Dict, Any, Tuple

from flask import Flask, request, jsonify, session, send_from_directory
from flask_cors import CORS
from peewee import (
    SqliteDatabase, Model, CharField, IntegerField, TextField,
    DateTimeField, ForeignKeyField, CompositeKey
)
from werkzeug.security import generate_password_hash, check_password_hash

# =============================================================================
# КОНСТАНТЫ И КОНФИГУРАЦИЯ
# =============================================================================

COLS: int = 14
ROWS: int = 15
DATABASE: str = 'users.db'
LOG_FILE: str = 'logs/gamekw.log'
MAX_LOG_SIZE: int = 10 * 1024 * 1024
LOG_BACKUP_COUNT: int = 5

SHIP_TYPES_CONFIG: List[Dict[str, Any]] = [
    {'code': 'БДК', 'count': 2}, {'code': 'КР', 'count': 6},
    {'code': 'А', 'count': 1}, {'code': 'С', 'count': 1},
    {'code': 'ТН', 'count': 1}, {'code': 'Л', 'count': 2},
    {'code': 'ЭС', 'count': 6}, {'code': 'М', 'count': 6},
    {'code': 'СМ', 'count': 1}, {'code': 'Ф', 'count': 6},
    {'code': 'ТК', 'count': 6}, {'code': 'Т', 'count': 6},
    {'code': 'ТР', 'count': 6}, {'code': 'СТ', 'count': 6},
    {'code': 'ПЛ', 'count': 1}, {'code': 'КРПЛ', 'count': 1},
    {'code': 'АБ', 'count': 1}, {'code': 'ВМБ', 'count': 2},
]

SHIP_STRENGTH_MAP: Dict[str, int] = {
    'БДК': 15, 'Л': 14, 'АБ': 13, 'КРПЛ': 12, 'КР': 11,
    'А': 10, 'ЭС': 9, 'ПЛ': 8, 'Ф': 7, 'ТК': 6,
    'ТР': 5, 'ТН': 4, 'С': 3, 'СТ': 2, 'Т': 1,
    'М': 1, 'СМ': 0, 'ВМБ': 0,
}

GROUPABLE_TYPES: set = {'КР', 'Л', 'ЭС', 'Ф', 'ТК', 'ТР', 'СТ'}
INDIVIDUAL_TYPES: set = {'БДК', 'А', 'С', 'ТН', 'М', 'СМ', 'Т', 'ПЛ', 'КРПЛ', 'АБ', 'ВМБ'}

# =============================================================================
# ЛОГИРОВАНИЕ
# =============================================================================

def configure_logging() -> logging.Logger:
    log_level = logging.INFO if os.environ.get('FLASK_ENV') == 'production' else logging.DEBUG
    log_format = '%(asctime)s [%(levelname)s] %(name)s:%(funcName)s:%(lineno)d - %(message)s'
    is_production = os.environ.get('FLASK_ENV') == 'production'

    root_logger = logging.getLogger()
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_formatter = logging.Formatter(log_format, datefmt='%Y-%m-%d %H:%M:%S')
    console_handler.setFormatter(console_formatter)

    file_handler = None
    try:
        os.makedirs('logs', exist_ok=True)
        # На Windows ротация логов (RotatingFileHandler) может падать с WinError 32,
        # особенно при Flask debug reloader (два процесса держат один файл).
        # В dev-режиме пишем без ротации, а ротацию оставляем только для production.
        if is_production:
            file_handler = RotatingFileHandler(
                LOG_FILE,
                maxBytes=MAX_LOG_SIZE,
                backupCount=LOG_BACKUP_COUNT,
                encoding='utf-8'
            )
        else:
            file_handler = logging.FileHandler(LOG_FILE, encoding='utf-8')

        file_handler.setLevel(logging.INFO if is_production else logging.DEBUG)
        file_formatter = logging.Formatter(log_format, datefmt='%Y-%m-%d %H:%M:%S')
        file_handler.setFormatter(file_formatter)
    except Exception as e:
        print(f'Warning: Could not setup file logging: {e}')

    root_logger.setLevel(log_level)
    root_logger.addHandler(console_handler)
    if file_handler:
        root_logger.addHandler(file_handler)

    logging.getLogger('werkzeug').setLevel(logging.WARNING if is_production else logging.INFO)
    logging.getLogger('urllib3').setLevel(logging.WARNING)
    logging.getLogger('peewee').setLevel(logging.WARNING)

    return logging.getLogger(__name__)


logger = configure_logging()

# =============================================================================
# ПОДКЛЮЧЕНИЕ К БД И МОДЕЛИ PEEWEE
# =============================================================================

db = SqliteDatabase(DATABASE, pragmas={'foreign_keys': 1})


class BaseModel(Model):
    class Meta:
        database = db


class User(BaseModel):
    email = CharField(unique=True)
    password = CharField()
    nickname = CharField()


class Queue(BaseModel):
    user = ForeignKeyField(User, unique=True, backref='queue_entry')
    timestamp = DateTimeField(default=datetime.now)


class Game(BaseModel):
    player1 = ForeignKeyField(User, null=True, backref='games_as_player1')
    player2 = ForeignKeyField(User, null=True, backref='games_as_player2')
    status = CharField()  # 'waiting', 'active', 'finished'
    invite_code = CharField(null=True, unique=True)
    created_at = DateTimeField(default=datetime.now)


class Stats(BaseModel):
    user = ForeignKeyField(User, primary_key=True, backref='stats')
    games_played = IntegerField(default=0)
    games_won = IntegerField(default=0)
    total_time_played = IntegerField(default=0)
    games_vs_friends = IntegerField(default=0)
    games_vs_random = IntegerField(default=0)
    wins_vs_friends = IntegerField(default=0)
    wins_vs_random = IntegerField(default=0)


class SetupStatus(BaseModel):
    game = ForeignKeyField(Game, backref='setup_statuses')
    user = ForeignKeyField(User)
    done = IntegerField(default=0)  # 0/1

    class Meta:
        primary_key = CompositeKey('game', 'user')


class BattleState(BaseModel):
    game = ForeignKeyField(Game, primary_key=True, backref='battle_state')
    positions = TextField()  # JSON
    current_turn_player = ForeignKeyField(User, null=True)
    move_start_time = IntegerField(default=0)
    total_time_p1 = IntegerField(default=900)
    total_time_p2 = IntegerField(default=900)
    status = CharField(default='TURN_P1')  # 'TURN_P1', 'TURN_P2', 'finished'


class PlayerShips(BaseModel):
    game = ForeignKeyField(Game)
    user = ForeignKeyField(User)
    ships = TextField()  # JSON

    class Meta:
        primary_key = CompositeKey('game', 'user')


class ChatMessage(BaseModel):
    game = ForeignKeyField(Game, backref='messages')
    user = ForeignKeyField(User)
    message = TextField()
    timestamp = DateTimeField(default=datetime.now)


class PlayerSearch(BaseModel):
    user = ForeignKeyField(User, primary_key=True, backref='search')
    nickname = CharField()
    status = CharField(default='searching')
    created_at = DateTimeField(default=datetime.now)


class OnlineUser(BaseModel):
    user = ForeignKeyField(User, primary_key=True, backref='online')
    nickname = CharField()
    last_activity = DateTimeField(default=datetime.now)
    is_searching = IntegerField(default=0)


class GameInvite(BaseModel):
    from_user = ForeignKeyField(User, backref='sent_invites')
    to_user = ForeignKeyField(User, backref='received_invites')
    game = ForeignKeyField(Game)
    status = CharField(default='pending')
    created_at = DateTimeField(default=datetime.now)


class GameTimer(BaseModel):
    game = ForeignKeyField(Game, primary_key=True, backref='timer')
    setup_start_time = IntegerField(default=0)
    setup_time_limit = IntegerField(default=900)
    turn_time_limit = IntegerField(default=30)
    total_time_p1 = IntegerField(default=900)
    total_time_p2 = IntegerField(default=900)
    current_turn_start_time = IntegerField(default=0)
    current_turn_player = ForeignKeyField(User, null=True)
    game_phase = CharField(default='setup')  # 'setup', 'battle'


class GamePause(BaseModel):
    game = ForeignKeyField(Game, backref='pauses')
    user = ForeignKeyField(User)
    pause_type = CharField()  # 'long', 'short'
    pause_start_time = IntegerField()
    pause_duration = IntegerField()
    is_active = IntegerField(default=1)


# =============================================================================
# УТИЛИТЫ (логирование, игровая логика) - без изменений
# =============================================================================

def log_request(endpoint: str, user_id: Optional[int] = None, extra_data: Optional[Dict[str, Any]] = None) -> None:
    context = {
        'endpoint': endpoint,
        'method': request.method,
        'user_id': user_id or session.get('user_id'),
        'ip': request.remote_addr,
        'user_agent': request.user_agent.string[:100] if request.user_agent else 'Unknown'
    }
    if extra_data:
        context.update(extra_data)
    logger.info(f"🌐 API Request: {endpoint}", extra={'context': context})


def log_user_action(action: str, user_id: int, details: Optional[Dict[str, Any]] = None) -> None:
    context = {'action': action, 'user_id': user_id, 'timestamp': int(time.time())}
    if details:
        context.update(details)
    logger.info(f"👤 User Action: {action} (User: {user_id})", extra={'context': context})


def log_game_event(event: str, game_id: int, user_id: Optional[int] = None,
                   details: Optional[Dict[str, Any]] = None) -> None:
    context = {'event': event, 'game_id': game_id, 'user_id': user_id, 'timestamp': int(time.time())}
    if details:
        context.update(details)
    logger.info(f"🎮 Game Event: {event} (Game: {game_id})", extra={'context': context})


def get_ship_strength(ship_type: str) -> int:
    return SHIP_STRENGTH_MAP.get(ship_type, 1)


def is_movable(ship: Dict[str, Any], battle_data: Optional[Dict[str, Any]] = None, user_id: Optional[int] = None) -> bool:
    """Проверяет, может ли корабль двигаться.
    
    Особые правила:
    - ВМБ, СМ - неподвижны
    - Т (торпеда) - неподвижна, но может двигаться когда рядом торпедный катер (ТК)
    - С (самолет) - неподвижен, но может двигаться когда рядом авианосец (А)
    """
    if not ship.get('alive', True):
        return False
    ship_type = ship['type']
    if ship_type in ('ВМБ', 'СМ'):
        return False
    
    # Специальные юниты могут двигаться только когда рядом их носитель
    if ship_type == 'Т':  # Торпеда - может двигаться рядом с торпедным катером
        if battle_data and user_id is not None:
            return _is_near_carrier(battle_data, user_id, ship, 'ТК')
        return False
    elif ship_type == 'С':  # Самолет - может двигаться рядом с авианосцем
        if battle_data and user_id is not None:
            return _is_near_carrier(battle_data, user_id, ship, 'А')
        return False
    elif ship_type == 'М':  # Мина - может двигаться рядом с эсминцем
        if battle_data and user_id is not None:
            return _is_near_carrier(battle_data, user_id, ship, 'ЭС')
        return False
    
    return True


def _is_near_carrier(battle_data: Dict[str, Any], user_id: int, ship: Dict[str, Any], carrier_type: str) -> bool:
    """Проверяет, находится ли корабль рядом с носителем указанного типа."""
    my_ships = battle_data.get('positions', {}).get(str(user_id), [])
    ship_x, ship_y = ship.get('x'), ship.get('y')
    
    for other_ship in my_ships:
        if other_ship.get('alive') and other_ship.get('type') == carrier_type:
            other_x, other_y = other_ship.get('x'), other_ship.get('y')
            dx = abs(ship_x - other_x)
            dy = abs(ship_y - other_y)
            # Рядом (в одной из 8 соседних клеток, включая диагональ)
            if max(dx, dy) == 1 and not (dx == 0 and dy == 0):
                return True
    return False


def get_movement_range(ship_type: str) -> int:
    return 2 if ship_type == 'ТК' else 1


def get_attack_range(ship: Dict[str, Any]) -> int:
    return 1


def resolve_special_interaction(attacker_type: str, defender_type: str) -> str:
    if attacker_type == 'ПЛ' and defender_type in ('БДК', 'А'):
        return 'attacker'
    if attacker_type in ('БДК', 'А') and defender_type == 'ПЛ':
        return 'defender'
    if attacker_type == 'КРПЛ' and defender_type == 'КР':
        return 'attacker'
    if attacker_type == 'КР' and defender_type == 'КРПЛ':
        return 'defender'
    if attacker_type == 'ТН' or defender_type == 'ТН':
        return 'both'
    if defender_type == 'М':
        return 'attacker_mines_owner_loses_turn' if attacker_type == 'ТР' else 'both'
    if attacker_type == 'М':
        return 'defender_attacker_loses_turn' if defender_type == 'ТР' else 'both'
    if defender_type == 'СМ' or attacker_type == 'СМ':
        return 'both'
    if attacker_type == 'Т' or defender_type == 'Т':
        return 'both'
    if attacker_type == 'АБ' or defender_type == 'АБ':
        return 'special_explosion'
    return 'none'


def resolve_battle(attacker_type: str, defender_type: str) -> Dict[str, bool]:
    if attacker_type in ('СМ', 'ВМБ'):
        return {'attacker_destroyed': False, 'defender_destroyed': False, 'attacker_loses_turn': False}

    special_result = resolve_special_interaction(attacker_type, defender_type)

    if special_result == 'attacker':
        return {'attacker_destroyed': False, 'defender_destroyed': True, 'attacker_loses_turn': False}
    elif special_result == 'defender':
        return {'attacker_destroyed': True, 'defender_destroyed': False, 'attacker_loses_turn': False}
    elif special_result == 'both':
        return {'attacker_destroyed': True, 'defender_destroyed': True, 'attacker_loses_turn': False}
    elif special_result == 'attacker_mines_owner_loses_turn':
        return {'attacker_destroyed': False, 'defender_destroyed': True,
                'attacker_loses_turn': False, 'defender_loses_turn': True}
    elif special_result == 'defender_attacker_loses_turn':
        return {'attacker_destroyed': True, 'defender_destroyed': False, 'attacker_loses_turn': True}
    elif special_result == 'special_explosion':
        return {'attacker_destroyed': True, 'defender_destroyed': True,
                'special_explosion': True, 'attacker_loses_turn': False}

    attacker_strength = get_ship_strength(attacker_type)
    defender_strength = get_ship_strength(defender_type)

    if attacker_strength > defender_strength:
        return {'attacker_destroyed': False, 'defender_destroyed': True, 'attacker_loses_turn': False}
    elif defender_strength > attacker_strength:
        return {'attacker_destroyed': True, 'defender_destroyed': False, 'attacker_loses_turn': False}
    else:
        return {'attacker_destroyed': True, 'defender_destroyed': True, 'attacker_loses_turn': False}


def generate_battleship_field(player_zone: str = 'bottom') -> List[Dict[str, Any]]:
    field = [[0 for _ in range(COLS)] for _ in range(ROWS)]
    ships = []
    ship_id = 1

    min_y, max_y = (0, 4) if player_zone == 'top' else (10, 14)

    for ship_type in SHIP_TYPES_CONFIG:
        for _ in range(ship_type['count']):
            placed = False
            attempts = 0
            while not placed and attempts < 1000:
                x = random.randint(0, COLS - 1)
                y = random.randint(min_y, max_y)
                if field[y][x] == 0:
                    field[y][x] = ship_id
                    ships.append({
                        'id': ship_id, 'type': ship_type['code'],
                        'x': x, 'y': y, 'alive': True, 'placed': True
                    })
                    ship_id += 1
                    placed = True
                attempts += 1

    return ships


def ensure_61_ships(original_ships: List[Dict[str, Any]], player_zone: str = 'bottom') -> List[Dict[str, Any]]:
    valid_rows = set(range(0, 5)) if player_zone == 'top' else set(range(10, ROWS))

    filtered = []
    seen_positions = set()
    for s in original_ships or []:
        x, y = s.get('x'), s.get('y')
        if isinstance(x, int) and isinstance(y, int) and 0 <= x < COLS and y in valid_rows:
            if (x, y) not in seen_positions:
                seen_positions.add((x, y))
                s2 = dict(s)
                s2['alive'] = s2.get('alive', True)
                s2['placed'] = True
                filtered.append(s2)

    type_to_ships: Dict[str, List[Dict[str, Any]]] = {}
    for s in filtered:
        type_to_ships.setdefault(s['type'], []).append(s)

    available_positions = [(x, y) for y in valid_rows for x in range(COLS) if (x, y) not in seen_positions]
    random.shuffle(available_positions)

    result = []
    next_id = 1
    for t in SHIP_TYPES_CONFIG:
        code, need = t['code'], t['count']
        have_list = type_to_ships.get(code, [])
        for s in have_list[:need]:
            s_out = {k: s[k] for k in ['type', 'x', 'y'] if k in s}
            s_out['id'] = next_id
            next_id += 1
            s_out['alive'] = True
            s_out['placed'] = True
            result.append(s_out)
        missing = need - len(have_list[:need])
        for _ in range(max(0, missing)):
            if not available_positions:
                break
            x, y = available_positions.pop()
            result.append({'id': next_id, 'type': code, 'x': x, 'y': y, 'alive': True, 'placed': True})
            next_id += 1

    while len(result) < 61:
        for t in SHIP_TYPES_CONFIG:
            code = t['code']
            count_now = sum(1 for s in result if s['type'] == code)
            if count_now < t['count']:
                if not available_positions:
                    used = {(s['x'], s['y']) for s in result}
                    available_positions = [(x, y) for y in valid_rows for x in range(COLS) if (x, y) not in used]
                    random.shuffle(available_positions)
                    if not available_positions:
                        break
                x, y = available_positions.pop()
                result.append({'id': next_id, 'type': code, 'x': x, 'y': y, 'alive': True, 'placed': True})
                next_id += 1
                break

    return result[:61]


def can_ships_be_grouped(ship_types: List[str]) -> Tuple[bool, str]:
    for ship_type in ship_types:
        if ship_type in INDIVIDUAL_TYPES:
            return False, f'Корабль типа {ship_type} не может быть объединен в группу'
        if ship_type not in GROUPABLE_TYPES:
            return False, f'Неизвестный тип корабля: {ship_type}'

    if len(ship_types) > 3:
        return False, f'Группа может состоять максимум из 3 кораблей'

    return True, 'OK'


def are_ships_adjacent(ships: List[Dict[str, Any]]) -> bool:
    if len(ships) < 2:
        return True
    for i, ship1 in enumerate(ships):
        has_neighbor = False
        for j, ship2 in enumerate(ships):
            if i != j:
                distance = abs(ship1['x'] - ship2['x']) + abs(ship1['y'] - ship2['y'])
                if distance == 1:
                    has_neighbor = True
                    break
        if not has_neighbor:
            return False
    return True


def check_victory(battle_data: Dict[str, Any], game: Any) -> Optional[int]:
    """Проверяет условия победы. Возвращает user_id победителя или -1 при ничьей."""
    p1_id = game.player1_id
    p2_id = game.player2_id
    
    p1_ships = battle_data['positions'].get(str(p1_id), [])
    p2_ships = battle_data['positions'].get(str(p2_id), [])
    
    p1_vmb = [s for s in p1_ships if s.get('alive', True) and s.get('type') == 'ВМБ']
    p2_vmb = [s for s in p2_ships if s.get('alive', True) and s.get('type') == 'ВМБ']
    
    p1_movable = any(is_movable(s, battle_data, p1_id) for s in p1_ships if s.get('alive', True))
    p2_movable = any(is_movable(s, battle_data, p2_id) for s in p2_ships if s.get('alive', True))
    
    logger.info(f"Victory Check: P1({p1_id}) VMB={len(p1_vmb)} movable={p1_movable} | P2({p2_id}) VMB={len(p2_vmb)} movable={p2_movable}")

    p1_lost = len(p1_vmb) == 0 or not p1_movable
    p2_lost = len(p2_vmb) == 0 or not p2_movable
    
    if p1_lost and p2_lost:
        logger.info("Game Over: DRAW")
        return -1
    if p2_lost:
        logger.info(f"Game Over: P1({p1_id}) WINS")
        return p1_id
    if p1_lost:
        logger.info(f"Game Over: P2({p2_id}) WINS")
        return p2_id
        
    return None


def apply_ab_explosion(battle_data: Dict[str, Any], center_x: int, center_y: int) -> None:
    """Explode атомной бомбой (АБ) по правилам: квадрат 5x5 вокруг центра (радиус 2).

    В онлайне мы делаем это детерминированно и сразу. Детонация других АБ внутри зоны
    вызывается рекурсивно.
    """
    to_detonate = [(center_x, center_y)]
    detonated = set()

    while to_detonate:
        cx, cy = to_detonate.pop()
        if (cx, cy) in detonated:
            continue
        detonated.add((cx, cy))

        for player_id, ships in (battle_data.get('positions') or {}).items():
            for s in ships or []:
                if not s.get('alive', True):
                    continue
                sx, sy = s.get('x'), s.get('y')
                if not isinstance(sx, int) or not isinstance(sy, int):
                    continue
                if abs(sx - cx) <= 2 and abs(sy - cy) <= 2:
                    # Если внутри зоны есть другая АБ — она детонирует по тем же правилам
                    if s.get('type') == 'АБ' and (sx, sy) not in detonated:
                        to_detonate.append((sx, sy))
                    s['alive'] = False
                    s['revealed'] = True


def _get_group_ships(battle_data: Dict[str, Any], user_id: int, group_id: str) -> List[Dict[str, Any]]:
    ships = battle_data.get('positions', {}).get(str(user_id), []) or []
    return [s for s in ships if s.get('alive', True) and s.get('group_id') == group_id]


def _compute_group_strength(ships: List[Dict[str, Any]]) -> int:
    return sum(get_ship_strength(s.get('type', '')) for s in ships)


def _order_group_ships_for_poker(battle_data: Dict[str, Any], group_id: str, ships: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return ships in a deterministic order for 'poker' reveals.

    Prefer stored order in battle_data['groups'][group_id]['ships'] (list of ship ids).
    Fallback to sorting by id.
    """
    try:
        group = (battle_data.get('groups') or {}).get(group_id) or {}
        ordered_ids = group.get('ships') or []
        by_id = {s.get('id'): s for s in ships}
        ordered = [by_id.get(i) for i in ordered_ids if i in by_id]
        # Append any missing ships deterministically
        missing = [s for s in ships if s not in ordered]
        ordered.extend(sorted(missing, key=lambda s: int(s.get('id', 0))))
        return [s for s in ordered if s]
    except Exception:
        return sorted(ships, key=lambda s: int(s.get('id', 0)))


def resolve_poker_group_battle(
    attacker_ships: List[Dict[str, Any]],
    defender_ships: List[Dict[str, Any]],
    battle_data: Dict[str, Any],
    attacker_group_id: Optional[str] = None,
    defender_group_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Resolve group vs group (or group vs single) battle using 'poker' incremental reveal.

    Mechanics implemented:
    - Start with 1 revealed ship from attacker.
    - Defender reveals ships until its revealed strength >= attacker strength or exhausted.
    - If defender strength > attacker strength, attacker reveals until >= or exhausted.
    - Repeat until decision.
    - If equal strengths and both cannot reveal more => both sides destroyed.
    """
    a_ordered = attacker_ships
    d_ordered = defender_ships
    if attacker_group_id:
        a_ordered = _order_group_ships_for_poker(battle_data, attacker_group_id, attacker_ships)
    if defender_group_id:
        d_ordered = _order_group_ships_for_poker(battle_data, defender_group_id, defender_ships)

    a_revealed_n = min(1, len(a_ordered))
    d_revealed_n = 0

    def strength(ss: List[Dict[str, Any]]) -> int:
        return sum(get_ship_strength(s.get('type', '')) for s in ss)

    # Defender responds first
    while True:
        a_strength = strength(a_ordered[:a_revealed_n])

        while d_revealed_n < len(d_ordered) and strength(d_ordered[:d_revealed_n]) < a_strength:
            d_revealed_n += 1

        d_strength = strength(d_ordered[:d_revealed_n])

        if d_strength > a_strength:
            # Attacker must respond
            while a_revealed_n < len(a_ordered) and strength(a_ordered[:a_revealed_n]) < d_strength:
                a_revealed_n += 1
            a_strength = strength(a_ordered[:a_revealed_n])
            if a_strength > d_strength:
                continue
            if a_strength == d_strength:
                # If attacker can't improve further and defender can't improve further => tie
                if a_revealed_n == len(a_ordered) and d_revealed_n == len(d_ordered):
                    break
                # Otherwise allow defender to reveal again
                continue
            # Attacker couldn't catch up
            break

        if d_strength < a_strength:
            # Defender couldn't catch up
            break

        # Equal strengths
        if a_revealed_n == len(a_ordered) and d_revealed_n == len(d_ordered):
            break
        # Defender can still reveal to try to exceed
        if d_revealed_n < len(d_ordered):
            d_revealed_n += 1
            continue
        # Defender exhausted, attacker can try to exceed
        if a_revealed_n < len(a_ordered):
            a_revealed_n += 1
            continue
        break

    a_strength = strength(a_ordered[:a_revealed_n])
    d_strength = strength(d_ordered[:d_revealed_n])

    attacker_destroyed = False
    defender_destroyed = False
    if a_strength > d_strength:
        defender_destroyed = True
    elif d_strength > a_strength:
        attacker_destroyed = True
    else:
        attacker_destroyed = True
        defender_destroyed = True

    # Reveal only ships that were revealed during the poker sequence
    for s in a_ordered[:a_revealed_n]:
        s['revealed'] = True
    for s in d_ordered[:d_revealed_n]:
        s['revealed'] = True

    return {
        'attacker_destroyed': attacker_destroyed,
        'defender_destroyed': defender_destroyed,
        'attacker_revealed_n': a_revealed_n,
        'defender_revealed_n': d_revealed_n,
        'attacker_strength': a_strength,
        'defender_strength': d_strength,
        'defender_loses_turn': False,
    }


def _poker_strength(ships: List[Dict[str, Any]], revealed_n: int) -> int:
    return sum(get_ship_strength(s.get('type', '')) for s in (ships or [])[:max(0, revealed_n)])


def _ensure_pending_reveals_marked(ships: List[Dict[str, Any]], revealed_n: int) -> None:
    for s in (ships or [])[:max(0, revealed_n)]:
        s['revealed'] = True


def _resolve_pending_combat(battle_data: Dict[str, Any], game: Game, battle: BattleState) -> Dict[str, Any]:
    pending = battle_data.get('pending_combat') or {}
    attacker_player_id = pending.get('attacker_player_id')
    defender_player_id = pending.get('defender_player_id')
    attacker_ship_ids = pending.get('attacker_ship_ids') or []
    defender_ship_ids = pending.get('defender_ship_ids') or []
    a_revealed_n = int(pending.get('attacker_revealed_n') or 0)
    d_revealed_n = int(pending.get('defender_revealed_n') or 0)

    a_ships_all = battle_data.get('positions', {}).get(str(attacker_player_id), []) or []
    d_ships_all = battle_data.get('positions', {}).get(str(defender_player_id), []) or []

    a_by_id = {s.get('id'): s for s in a_ships_all if s.get('alive', True)}
    d_by_id = {s.get('id'): s for s in d_ships_all if s.get('alive', True)}

    a_ordered = [a_by_id.get(i) for i in attacker_ship_ids if i in a_by_id]
    d_ordered = [d_by_id.get(i) for i in defender_ship_ids if i in d_by_id]
    a_ordered = [s for s in a_ordered if s]
    d_ordered = [s for s in d_ordered if s]

    a_strength = _poker_strength(a_ordered, a_revealed_n)
    d_strength = _poker_strength(d_ordered, d_revealed_n)

    attacker_destroyed = False
    defender_destroyed = False
    if a_strength > d_strength:
        defender_destroyed = True
    elif d_strength > a_strength:
        attacker_destroyed = True
    else:
        attacker_destroyed = True
        defender_destroyed = True

    if attacker_destroyed:
        for s in a_ordered:
            s['alive'] = False
            s['revealed'] = True
    if defender_destroyed:
        for s in d_ordered:
            s['alive'] = False
            s['revealed'] = True

    # Clear pending combat
    battle_data.pop('pending_combat', None)

    winner_id = check_victory(battle_data, game)
    if winner_id is not None:
        battle.status = 'finished'
        game.status = 'finished'
        game.save()
        battle_data['status'] = 'finished'
        battle_data['winner_id'] = winner_id
        battle.positions = json.dumps(battle_data)
        battle.save()

    return {
        'attacker_destroyed': attacker_destroyed,
        'defender_destroyed': defender_destroyed,
        'attacker_strength': a_strength,
        'defender_strength': d_strength,
        'attacker_ship_ids': attacker_ship_ids,
        'defender_ship_ids': defender_ship_ids,
        'attacker_revealed_n': pending.get('attacker_revealed_n', 0),
        'defender_revealed_n': pending.get('defender_revealed_n', 0),
    }


def _advance_poker_turn(pending: Dict[str, Any], battle_data: Dict[str, Any]) -> None:
    """Advance which side should act next, following the "poker" rule.

    Defender responds until its strength >= attacker; if defender exceeds, attacker must respond, etc.
    """
    attacker_player_id = pending.get('attacker_player_id')
    defender_player_id = pending.get('defender_player_id')
    attacker_ship_ids = pending.get('attacker_ship_ids') or []
    defender_ship_ids = pending.get('defender_ship_ids') or []
    a_revealed_n = int(pending.get('attacker_revealed_n') or 0)
    d_revealed_n = int(pending.get('defender_revealed_n') or 0)

    a_ships_all = battle_data.get('positions', {}).get(str(attacker_player_id), []) or []
    d_ships_all = battle_data.get('positions', {}).get(str(defender_player_id), []) or []
    a_by_id = {s.get('id'): s for s in a_ships_all if s.get('alive', True)}
    d_by_id = {s.get('id'): s for s in d_ships_all if s.get('alive', True)}
    a_ordered = [a_by_id.get(i) for i in attacker_ship_ids if i in a_by_id]
    d_ordered = [d_by_id.get(i) for i in defender_ship_ids if i in d_by_id]
    a_ordered = [s for s in a_ordered if s]
    d_ordered = [s for s in d_ordered if s]

    a_strength = _poker_strength(a_ordered, a_revealed_n)
    d_strength = _poker_strength(d_ordered, d_revealed_n)

    if d_strength < a_strength and d_revealed_n < len(d_ordered):
        pending['next_actor'] = 'defender'
        return
    if d_strength > a_strength and a_revealed_n < len(a_ordered):
        pending['next_actor'] = 'attacker'
        return

    # If equal, let defender try to exceed if it can; else attacker; else either (we keep defender)
    if d_strength == a_strength:
        if d_revealed_n < len(d_ordered):
            pending['next_actor'] = 'defender'
            return
        if a_revealed_n < len(a_ordered):
            pending['next_actor'] = 'attacker'
            return

    # No one can improve: keep next_actor as-is
    pending['next_actor'] = pending.get('next_actor') or 'defender'


def get_opponent_id(game: Game, user_id: int) -> Optional[int]:
    if game.player1_id == user_id:
        return game.player2_id
    elif game.player2_id == user_id:
        return game.player1_id
    return None


def get_player1_id(game: Game) -> Optional[int]:
    return game.player1_id


def update_user_activity(user_id: int, nickname: str) -> None:
    (OnlineUser.insert(user_id=user_id, nickname=nickname, last_activity=datetime.now(), is_searching=0)
     .on_conflict(
         conflict_target=[OnlineUser.user],
         update={OnlineUser.last_activity: datetime.now(), OnlineUser.nickname: nickname}
     ).execute())


def set_user_searching(user_id: int, nickname: str, is_searching: int) -> None:
    (OnlineUser.insert(user_id=user_id, nickname=nickname, last_activity=datetime.now(), is_searching=is_searching)
     .on_conflict(
         conflict_target=[OnlineUser.user],
         update={OnlineUser.last_activity: datetime.now(), OnlineUser.is_searching: is_searching,
                 OnlineUser.nickname: nickname}
     ).execute())


def get_online_users() -> List[OnlineUser]:
    return list(OnlineUser.select().where(
        OnlineUser.last_activity > datetime.now().timestamp() - 90
    ).order_by(OnlineUser.last_activity.desc()))


def get_searching_users() -> List[OnlineUser]:
    return list(OnlineUser.select().where(
        (OnlineUser.is_searching == 1) &
        (OnlineUser.last_activity > datetime.now().timestamp() - 30)
    ).order_by(OnlineUser.last_activity))


def cleanup_offline_users() -> None:
    deleted = OnlineUser.delete().where(
        OnlineUser.last_activity <= datetime.now().timestamp() - 90
    ).execute()
    if deleted > 0:
        logger.info(f'🧹 Очищено {deleted} offline пользователей')

    Queue.delete().where(Queue.timestamp <= datetime.now().timestamp() - 60).execute()
    PlayerSearch.delete().where(PlayerSearch.created_at <= datetime.now().timestamp() - 600).execute()


def init_game_timer(game_id: int, player1_id: int, player2_id: Optional[int]) -> None:
    current_time = int(time.time())
    GameTimer.insert(
        game_id=game_id,
        setup_start_time=current_time,
        total_time_p1=900,
        total_time_p2=900,
        current_turn_start_time=current_time,
        current_turn_player_id=player1_id,
        game_phase='setup'
    ).execute()
    logger.info(f'Таймер инициализирован для игры {game_id}')


def init_battle_state(game_id: int, player1_id: int, player2_id: int) -> bool:
    logger.info(f'Инициализация боя для игры {game_id}: p1={player1_id}, p2={player2_id}')

    p1_ships = PlayerShips.get_or_none(game_id=game_id, user_id=player1_id)
    p2_ships = PlayerShips.get_or_none(game_id=game_id, user_id=player2_id)

    if not p1_ships or not p2_ships:
        ships1 = generate_battleship_field('top')
        ships2 = generate_battleship_field('bottom')
        PlayerShips.replace(game_id=game_id, user_id=player1_id, ships=json.dumps(ships1)).execute()
        PlayerShips.replace(game_id=game_id, user_id=player2_id, ships=json.dumps(ships2)).execute()
    else:
        ships1 = json.loads(p1_ships.ships)
        ships2 = json.loads(p2_ships.ships)

    battle_ships1 = [{
        'id': i, 'type': s['type'], 'x': s['x'], 'y': s['y'],
        'alive': True, 'revealed': False, 'size': s.get('size', 1)
    } for i, s in enumerate(ships1)]
    battle_ships2 = [{
        'id': i, 'type': s['type'], 'x': s['x'], 'y': s['y'],
        'alive': True, 'revealed': False, 'size': s.get('size', 1)
    } for i, s in enumerate(ships2)]

    positions = {str(player1_id): battle_ships1, str(player2_id): battle_ships2}
    current_turn = player1_id
    now = int(time.time())
    total_time = 15 * 60

    battle_data = {
        'positions': positions,
        'current_turn': current_turn,
        'move_start_time': now,
        'total_time_p1': total_time,
        'total_time_p2': total_time,
        'status': 'TURN_P1',
        'pauses_p1': {'long': 1, 'short': 1},
        'pauses_p2': {'long': 1, 'short': 1},
        'killed_ships_p1': {},
        'killed_ships_p2': {},
        'move_timer': 30,
        'turn_move_points': 0,
        'turn_actor_id': None
    }

    BattleState.replace(
        game_id=game_id,
        positions=json.dumps(battle_data),
        current_turn_player_id=current_turn,
        move_start_time=now,
        total_time_p1=total_time,
        total_time_p2=total_time,
        status='TURN_P1'
    ).execute()

    GameTimer.update(
        total_time_p1=total_time,
        total_time_p2=total_time,
        current_turn_start_time=now,
        current_turn_player_id=current_turn,
        game_phase='battle'
    ).where(GameTimer.game_id == game_id).execute()

    logger.info(f'Бой успешно инициализирован для игры {game_id}')
    return True


# =============================================================================
# ПРОВЕРКА ТАЙМЕРОВ (исправлена)
# =============================================================================

def check_game_timers(game_id: int, user_id: int) -> Tuple[bool, Optional[Dict]]:
    """
    Проверяет таймеры игры. Если время истекло, применяет штраф (отнимает 1 секунду)
    и при необходимости завершает игру.
    Возвращает (ok, response) – если ok=False, нужно вернуть response клиенту.
    """
    game = Game.get_or_none(Game.id == game_id)
    if not game:
        return False, {'ok': False, 'error': 'Игра не найдена'}

    timer = GameTimer.get_or_none(GameTimer.game_id == game_id)
    if not timer:
        # Таймер отсутствует – создаём его (на случай, если игра была создана без таймера)
        logger.warning(f'Таймер не найден для игры {game_id}, создаём автоматически')
        init_game_timer(game_id, game.player1_id, game.player2_id)
        timer = GameTimer.get_or_none(GameTimer.game_id == game_id)

    active_pause = GamePause.select().where(
        (GamePause.game_id == game_id) & (GamePause.is_active == 1)
    ).first()
    if active_pause:
        return True, None

    now = int(time.time())

    # Фаза setup
    if timer.game_phase == 'setup':
        elapsed = now - timer.setup_start_time
        if elapsed >= timer.setup_time_limit:
            p1_setup = SetupStatus.get_or_none(game_id=game_id, user_id=game.player1_id)
            p2_setup = SetupStatus.get_or_none(game_id=game_id, user_id=game.player2_id) if game.player2_id else None

            loser_id = None
            if not p1_setup or p1_setup.done == 0:
                loser_id = game.player1_id
            elif not p2_setup or p2_setup.done == 0:
                loser_id = game.player2_id

            if loser_id:
                winner_id = game.player2_id if loser_id == game.player1_id else game.player1_id
                game.status = 'finished'
                game.save()
                BattleState.update(status='finished').where(BattleState.game_id == game_id).execute()
                log_game_event('timeout_finish', game_id, loser_id, {'reason': 'setup_timeout'})
                return False, {'ok': False, 'error': 'Время на расстановку вышло', 'winner': winner_id}
        return True, None

    # Фаза battle
    if timer.game_phase == 'battle':
        battle = BattleState.get_or_none(BattleState.game_id == game_id)
        if not battle:
            return True, None

        current_turn_player_id = battle.current_turn_player_id
        if not current_turn_player_id:
            return True, None

        turn_limit = timer.turn_time_limit

        # Обрабатываем все просроченные интервалы подряд
        while True:
            turn_elapsed = now - battle.move_start_time
            if turn_elapsed < turn_limit:
                break

            # Применяем один штраф (1 секунда)
            penalty = 1
            if current_turn_player_id == game.player1_id:
                new_total = max(0, timer.total_time_p1 - penalty)
                timer.total_time_p1 = new_total
                battle.total_time_p1 = new_total
                loser_id = game.player1_id if new_total <= 0 else None
            else:
                new_total = max(0, timer.total_time_p2 - penalty)
                timer.total_time_p2 = new_total
                battle.total_time_p2 = new_total
                loser_id = game.player2_id if new_total <= 0 else None

            # Если общее время исчерпано – завершаем игру
            if loser_id:
                winner_id = game.player2_id if loser_id == game.player1_id else game.player1_id
                game.status = 'finished'
                game.save()
                battle.status = 'finished'
                battle.save()
                timer.save()
                log_game_event('timeout_finish', game_id, loser_id, {'reason': 'total_time_exhausted'})
                return False, {'ok': False, 'error': 'Ваше общее время истекло', 'winner': winner_id}

            # Таймаут хода: передаём ход сопернику и сбрасываем таймер
            opponent_id = get_opponent_id(game, current_turn_player_id)
            if opponent_id:
                current_turn_player_id = opponent_id
                battle.current_turn_player_id = opponent_id
                battle.status = 'TURN_P2' if opponent_id == game.player2_id else 'TURN_P1'
            battle.move_start_time = now

            logger.info(
                f'Штраф за просрочку хода в игре {game_id}: игрок {current_turn_player_id} -1 сек')

        # После цикла сохраняем изменения
        battle.save()
        timer.current_turn_player_id = battle.current_turn_player_id
        timer.current_turn_start_time = battle.move_start_time
        timer.save()

        # Синхронизируем total_time из timer в battle (на случай, если они разошлись)
        if battle.total_time_p1 != timer.total_time_p1 or battle.total_time_p2 != timer.total_time_p2:
            battle.total_time_p1 = timer.total_time_p1
            battle.total_time_p2 = timer.total_time_p2
            battle.save()

        return True, None

    return True, None


def is_game_paused(game_id: int) -> bool:
    pause = GamePause.select().where(
        (GamePause.game_id == game_id) & (GamePause.is_active == 1)
    ).first()
    return pause is not None

# FLASK ПРИЛОЖЕНИЕ
# =============================================================================

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(24).hex()

cookie_secure_env = os.environ.get('SESSION_COOKIE_SECURE', '').strip().lower()
cookie_secure = cookie_secure_env in ('1', 'true', 'yes', 'on')
cookie_samesite = os.environ.get('SESSION_COOKIE_SAMESITE')
if cookie_samesite is None:
    cookie_samesite = 'None' if cookie_secure else 'Lax'

app.config['SESSION_COOKIE_SAMESITE'] = cookie_samesite
app.config['SESSION_COOKIE_SECURE'] = cookie_secure
app.config['SESSION_COOKIE_HTTPONLY'] = False
app.config['SESSION_COOKIE_DOMAIN'] = None
app.config['SESSION_COOKIE_PATH'] = '/'

allowed_origins = [
    'https://gamekw.com', 'https://www.gamekw.com'
] if os.environ.get('FLASK_ENV') == 'production' else [
    'http://localhost:3000', 'http://127.0.0.1:3000',
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:5174', 'http://127.0.0.1:5174',
    'http://localhost:8080', 'http://127.0.0.1:8080',
    'http://10.2.0.2:5174', 'http://192.168.3.16:5174'
]

CORS(app, origins=allowed_origins, supports_credentials=True,
     allow_headers=['Content-Type', 'Authorization'],
     methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])


# =============================================================================
# ИНИЦИАЛИЗАЦИЯ БД
# =============================================================================

def init_db() -> None:
    db.connect()
    db.create_tables([
        User, Queue, Game, Stats, SetupStatus, BattleState, PlayerShips,
        ChatMessage, PlayerSearch, OnlineUser, GameInvite, GameTimer, GamePause
    ])

    q_user, _ = User.get_or_create(email='q@q.q', defaults={
        'password': generate_password_hash('q'), 'nickname': 'q'
    })
    w_user, _ = User.get_or_create(email='w@w.w', defaults={
        'password': generate_password_hash('w'), 'nickname': 'w'
    })

    Stats.get_or_create(user=q_user)
    Stats.get_or_create(user=w_user)

    game, created = Game.get_or_create(
        id=25,
        defaults={
            'player1': q_user,
            'player2': w_user,
            'status': 'active'
        }
    )
    if not created:
        game.player1 = q_user
        game.player2 = w_user
        game.status = 'active'
        game.save()

    for uid in (q_user.id, w_user.id):
        ships = PlayerShips.get_or_none(game_id=25, user_id=uid)
        if not ships:
            PlayerShips.create(game_id=25, user_id=uid, ships=json.dumps([]))

    SetupStatus.get_or_create(game_id=25, user_id=q_user.id, defaults={'done': 0})
    SetupStatus.get_or_create(game_id=25, user_id=w_user.id, defaults={'done': 0})

    battle = BattleState.get_or_none(game_id=25)
    if not battle:
        p1_ships = PlayerShips.get(game_id=25, user_id=q_user.id)
        p2_ships = PlayerShips.get(game_id=25, user_id=w_user.id)
        ships1 = ensure_61_ships(json.loads(p1_ships.ships), 'top')
        ships2 = ensure_61_ships(json.loads(p2_ships.ships), 'bottom')
        battle_ships1 = [{
            'id': i, 'type': s['type'], 'x': s['x'], 'y': s['y'],
            'alive': True, 'size': s.get('size', 1)
        } for i, s in enumerate(ships1)]
        battle_ships2 = [{
            'id': i, 'type': s['type'], 'x': s['x'], 'y': s['y'],
            'alive': True, 'size': s.get('size', 1)
        } for i, s in enumerate(ships2)]
        now_ts = int(time.time())
        total_time = 15 * 60
        battle_data = {
            'positions': {str(q_user.id): battle_ships1, str(w_user.id): battle_ships2},
            'current_turn': q_user.id,
            'move_start_time': now_ts,
            'total_time_p1': total_time,
            'total_time_p2': total_time,
            'status': 'TURN_P1',
            'pauses_p1': {'long': 1, 'short': 1},
            'pauses_p2': {'long': 1, 'short': 1},
            'killed_ships_p1': {},
            'killed_ships_p2': {},
            'move_timer': 30,
            'turn_move_points': 0,
            'turn_actor_id': None
        }
        BattleState.create(
            game_id=25,
            positions=json.dumps(battle_data),
            current_turn_player_id=q_user.id,
            move_start_time=now_ts,
            total_time_p1=total_time,
            total_time_p2=total_time,
            status='TURN_P1'
        )

    timer = GameTimer.get_or_none(game_id=25)
    if not timer:
        now_ts = int(time.time())
        GameTimer.create(
            game_id=25,
            setup_start_time=now_ts,
            total_time_p1=900,
            total_time_p2=900,
            current_turn_start_time=now_ts,
            current_turn_player_id=q_user.id,
            game_phase='battle'
        )

    db.close()
    logger.info('Database initialized with test data')


# =============================================================================
# ОБРАБОТКА ОШИБОК
# =============================================================================

@app.errorhandler(500)
def internal_error(error: Exception) -> Tuple[Any, int]:
    logger.error(f"500 error: {error}")
    return jsonify({'ok': False, 'error': 'Внутренняя ошибка сервера'}), 500


@app.errorhandler(404)
def not_found_error(error: Exception) -> Tuple[Any, int]:
    logger.error(f"404 error: {error}")
    return jsonify({'ok': False, 'error': 'Страница не найдена'}), 404


@app.errorhandler(Exception)
def handle_exception(e: Exception) -> Tuple[Any, int]:
    logger.error(f"Unhandled exception: {e}")
    return jsonify({'ok': False, 'error': 'Неожиданная ошибка'}), 500


# =============================================================================
# API ЭНДПОИНТЫ
# =============================================================================

@app.route('/')
def index() -> Any:
    return jsonify({'ok': True, 'message': 'Морской Бой API работает'})


@app.route('/register', methods=['GET', 'POST'])
def register() -> Any:
    log_request('/register')
    if request.method == 'GET':
        return jsonify({'ok': False, 'error': 'Используйте POST метод для регистрации'})

    try:
        data = request.get_json()
        if not data:
            return jsonify({'ok': False, 'error': 'Нет данных в запросе'}), 400

        email = data.get('email')
        password = data.get('password')
        nickname = data.get('nickname')

        if not email or not password or not nickname:
            return jsonify({'ok': False, 'error': 'Все поля обязательны'}), 400

        existing = User.get_or_none(User.email == email)
        if existing:
            return jsonify({'ok': False, 'error': 'Пользователь с таким email уже существует'})

        password_hash = generate_password_hash(password)
        user = User.create(email=email, password=password_hash, nickname=nickname)
        Stats.create(user=user)

        session['user_id'] = user.id
        session['nickname'] = nickname

        log_user_action('register', user.id)
        return jsonify({'ok': True, 'user_id': user.id, 'nickname': nickname})
    except Exception as e:
        logger.error(f"Registration error: {e}")
        return jsonify({'ok': False, 'error': f'Внутренняя ошибка сервера: {str(e)}'}), 500


@app.route('/login', methods=['GET', 'POST'])
def login() -> Any:
    log_request('/login')
    if request.method == 'GET':
        return jsonify({'ok': False, 'error': 'Используйте POST метод для входа'})

    try:
        data = request.get_json()
        if not data:
            return jsonify({'ok': False, 'error': 'Нет данных в запросе'}), 400

        email = data.get('email')
        password = data.get('password')

        user = User.get_or_none(User.email == email)
        if user and check_password_hash(user.password, password):
            session['user_id'] = user.id
            session['nickname'] = user.nickname
            log_user_action('login', user.id)
            return jsonify({'ok': True, 'user_id': user.id, 'nickname': user.nickname})
        else:
            return jsonify({'ok': False, 'error': 'Неверный email или пароль'}), 401
    except Exception as e:
        logger.error(f"Login error: {e}")
        return jsonify({'ok': False, 'error': f'Внутренняя ошибка сервера: {str(e)}'}), 500


@app.route('/logout')
def logout() -> Any:
    log_request('/logout')
    session.clear()
    return jsonify({'ok': True})


@app.route('/session-check')
def session_check() -> Any:
    return jsonify({
        'ok': True, 'session': dict(session),
        'user_id': session.get('user_id'), 'nickname': session.get('nickname')
    })


@app.route('/menu')
def menu() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    user = User.get_by_id(user_id)
    update_user_activity(user_id, user.nickname)
    return jsonify({'ok': True, 'user_id': user_id, 'nickname': user.nickname})


@app.route('/stats')
def stats() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    stats = Stats.get_or_none(user_id=user_id)
    if not stats:
        stats = Stats.create(user_id=user_id)

    return jsonify({
        'ok': True, 'total_games': stats.games_played,
        'games_won': stats.games_won,
        'games_lost': stats.games_played - stats.games_won,
        'total_time_played': stats.total_time_played,
        'games_vs_friends': stats.games_vs_friends,
        'games_vs_random': stats.games_vs_random,
        'wins_vs_friends': stats.wins_vs_friends,
        'wins_vs_random': stats.wins_vs_random
    })


@app.route('/start_search', methods=['POST'])
def start_search() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    user = User.get_by_id(user_id)
    update_user_activity(user_id, user.nickname)
    cleanup_offline_users()
    set_user_searching(user_id, user.nickname, 1)

    online = OnlineUser.get_or_none(user_id=user_id)
    is_searching = online.is_searching if online else False
    return jsonify({'ok': True, 'searching': is_searching})


@app.route('/stop_search', methods=['POST'])
def stop_search() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    user = User.get_by_id(user_id)
    set_user_searching(user_id, user.nickname, 0)
    return jsonify({'ok': True, 'searching': False})


@app.route('/start_search', methods=['GET'])
def start_search_get() -> Any:
    return jsonify({'ok': False, 'error': 'Используйте POST метод для запуска поиска'}), 405


@app.route('/stop_search', methods=['GET'])
def stop_search_get() -> Any:
    return jsonify({'ok': False, 'error': 'Используйте POST метод для остановки поиска'}), 405


@app.route('/find_random')
def find_random() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    user = User.get_by_id(user_id)
    update_user_activity(user_id, user.nickname)
    cleanup_offline_users()

    game = Game.select().where(
        ((Game.player1_id == user_id) | (Game.player2_id == user_id)) &
        (Game.status == 'active')
    ).order_by(Game.id.desc()).first()
    if game:
        return jsonify({'ok': True, 'game_id': game.id})

    online = OnlineUser.get_or_none(user_id=user_id)
    if not online or not online.is_searching:
        set_user_searching(user_id, user.nickname, 1)
        online = OnlineUser.get_or_none(user_id=user_id)

    searching_users = get_searching_users()
    opponent = None
    for ou in searching_users:
        if ou.user_id != user_id:
            opponent = ou
            break

    if opponent:
        with db.atomic():
            game = Game.create(player1_id=user_id, player2_id=opponent.user_id, status='active')
            set_user_searching(user_id, user.nickname, 0)
            set_user_searching(opponent.user_id, opponent.nickname, 0)

            # Создаём все необходимые записи для случайной игры
            PlayerShips.create(game_id=game.id, user_id=user_id, ships=json.dumps([]))
            PlayerShips.create(game_id=game.id, user_id=opponent.user_id, ships=json.dumps([]))
            SetupStatus.create(game_id=game.id, user_id=user_id, done=0)
            SetupStatus.create(game_id=game.id, user_id=opponent.user_id, done=0)
            init_game_timer(game.id, user_id, opponent.user_id)

        return jsonify({'ok': True, 'game_id': game.id, 'opponent': opponent.nickname})
    else:
        return jsonify({'ok': True, 'waiting': True})


@app.route('/heartbeat', methods=['POST'])
def heartbeat() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    user = User.get_or_none(User.id == user_id)
    if user:
        update_user_activity(user_id, user.nickname)
        nickname = user.nickname
    else:
        nickname = 'Unknown'

    return jsonify({
        'ok': True, 'timestamp': int(time.time()),
        'ping': 'pong', 'your_id': user_id, 'nickname': nickname
    })


@app.route('/ping', methods=['GET', 'POST'])
def ping() -> Any:
    return jsonify({'status': 'online', 'timestamp': int(time.time()), 'message': 'Server is alive'})


@app.route('/online_players')
def online_players() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    user = User.get_by_id(user_id)
    update_user_activity(user_id, user.nickname)
    cleanup_offline_users()

    online_users = get_online_users()
    players = []
    for ou in online_users:
        game = Game.select().where(
            ((Game.player1_id == ou.user_id) | (Game.player2_id == ou.user_id)) &
            (Game.status.in_(['waiting', 'active']))
        ).order_by(Game.created_at.desc()).first()
        game_info = None
        if game:
            game_info = {
                'game_id': game.id,
                'invite_code': game.invite_code,
                'status': game.status
            }
        players.append({
            'user_id': ou.user_id,
            'nickname': ou.nickname,
            'is_searching': bool(ou.is_searching),
            'last_activity': ou.last_activity,
            'current_game': game_info
        })

    return jsonify({'ok': True, 'players': players, 'total': len(players)})


@app.route('/check_game')
def check_game() -> Any:
    if 'user_id' not in session:
        return jsonify({'game_id': None})
    user_id = session['user_id']
    game = Game.select().where(
        ((Game.player1_id == user_id) | (Game.player2_id == user_id)) &
        (Game.status == 'active')
    ).order_by(Game.id.desc()).first()
    return jsonify({'game_id': game.id if game else None})


@app.route('/play_friend', methods=['GET', 'POST'])
def play_friend() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    user = User.get_by_id(user_id)

    invite_code = str(random.randint(10000, 99999))
    while Game.select().where(Game.invite_code == invite_code).exists():
        invite_code = str(random.randint(10000, 99999))

    with db.atomic():
        game = Game.create(player1_id=user_id, status='waiting', invite_code=invite_code)
        init_game_timer(game.id, user_id, None)
        PlayerShips.create(game_id=game.id, user_id=user_id, ships=json.dumps([]))
        SetupStatus.create(game_id=game.id, user_id=user_id, done=0)

    return jsonify({
        'ok': True, 'game_id': game.id, 'invite_code': invite_code,
        'invite_link': f'http://localhost:3366/game/{invite_code}'
    })


@app.route('/game/<invite_code>')
@app.route('/api/game/<invite_code>')
def game_invite(invite_code: str) -> Any:
    game = Game.get_or_none(Game.invite_code == invite_code)
    if not game:
        return jsonify({'ok': False, 'error': 'Игра не найдена'})

    if 'user_id' not in session:
        creator = User.get_by_id(game.player1_id)
        return jsonify({
            'ok': False, 'error': 'Не авторизован', 'action': 'login_required',
            'game_info': {
                'invite_code': invite_code,
                'creator': creator.nickname,
                'status': game.status,
                'has_second_player': game.player2_id is not None
            }
        })

    user_id = session['user_id']

    if game.status == 'waiting' and user_id != game.player1_id:
        with db.atomic():
            game.player2_id = user_id
            game.status = 'active'
            game.save()
            PlayerShips.create(game_id=game.id, user_id=user_id, ships=json.dumps([]))
            SetupStatus.create(game_id=game.id, user_id=user_id, done=0)
        return jsonify({'ok': True, 'game_id': game.id, 'invite_code': invite_code, 'role': 'joiner'})
    elif game.status == 'active' and (user_id == game.player1_id or user_id == game.player2_id):
        return jsonify({'ok': True, 'game_id': game.id, 'invite_code': invite_code, 'role': 'player'})
    elif user_id == game.player1_id:
        return jsonify({'ok': True, 'game_id': game.id, 'invite_code': invite_code, 'role': 'creator'})
    else:
        return jsonify({'ok': False, 'error': 'Вы не участник этой игры'})


@app.route('/check_opponent/<int:game_id>')
def check_opponent(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ready': False})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify({'ready': False})

    game = Game.get_or_none(Game.id == game_id)
    if not game:
        return jsonify({'ready': False})

    opponent_id = game.player2_id if user_id == game.player1_id else game.player1_id
    if opponent_id:
        opponent = User.get_by_id(opponent_id)
        ships = PlayerShips.get_or_none(game_id=game_id, user_id=opponent_id)
        opponent_progress = 0
        if ships:
            ships_list = json.loads(ships.ships)
            opponent_progress = min(100.0, len(ships_list) / 61 * 100)
        return jsonify({
            'ready': True, 'opponent_joined': True,
            'opponent': {'id': opponent.id, 'nickname': opponent.nickname},
            'opponent_progress': opponent_progress
        })

    return jsonify({'ready': False, 'opponent_joined': False})


@app.route('/leave_game/<int:game_id>', methods=['POST'])
def leave_game(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': True})
    user_id = session['user_id']

    game = Game.get_or_none(Game.id == game_id)
    if not game:
        return jsonify({'ok': True})

    with db.atomic():
        if user_id == game.player1_id:
            game.player1_id = None
        elif user_id == game.player2_id:
            game.player2_id = None
        game.save()

        if game.player1_id is None and game.player2_id is None:
            GameTimer.delete().where(GameTimer.game_id == game_id).execute()
            GamePause.delete().where(GamePause.game_id == game_id).execute()
            SetupStatus.delete().where(SetupStatus.game_id == game_id).execute()
            PlayerShips.delete().where(PlayerShips.game_id == game_id).execute()
            BattleState.delete().where(BattleState.game_id == game_id).execute()
            ChatMessage.delete().where(ChatMessage.game_id == game_id).execute()
            game.delete_instance()

    return jsonify({'ok': True})


@app.route('/setup_done/<int:game_id>', methods=['POST'])
def setup_done(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify(resp)

    game = Game.get_or_none(Game.id == game_id)
    if not game:
        return jsonify({'ok': False, 'error': 'Игра не найдена'})
    if user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Не ваша игра'})

    SetupStatus.replace(game_id=game_id, user_id=user_id, done=1).execute()
    return jsonify({'ok': True})


@app.route('/check_setup_done/<int:game_id>')
def check_setup_done(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify(resp)

    game = Game.get_or_none(Game.id == game_id)
    if not game:
        return jsonify({'ok': False, 'error': 'Игра не найдена'})
    if user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Не ваша игра'})

    p1_setup = SetupStatus.get_or_none(game_id=game_id, user_id=game.player1_id)
    p2_setup = SetupStatus.get_or_none(game_id=game_id, user_id=game.player2_id) if game.player2_id else None

    opponent_id = game.player2_id if user_id == game.player1_id else game.player1_id
    opponent_ships = PlayerShips.get_or_none(game_id=game_id, user_id=opponent_id)
    opponent_progress = 0
    if opponent_ships:
        ships = json.loads(opponent_ships.ships)
        opponent_progress = min(100.0, len(ships) / 61 * 100)

    battle_exists = BattleState.get_or_none(game_id=game_id) is not None

    if p1_setup and p1_setup.done and p2_setup and p2_setup.done:
        if not battle_exists:
            init_battle_state(game_id, game.player1_id, game.player2_id)
        return jsonify({
            'ready': True, 'opponent_progress': opponent_progress, 'battle_initialized': True,
            'player1_id': game.player1_id, 'player2_id': game.player2_id
        })

    return jsonify({
        'ready': False, 'opponent_progress': opponent_progress,
        'battle_initialized': battle_exists,
        'player1_id': game.player1_id, 'player2_id': game.player2_id
    })


@app.route('/save_ships/<int:game_id>', methods=['POST'])
def save_ships(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify(resp)

    game = Game.get_or_none(Game.id == game_id)
    if not game:
        return jsonify({'ok': False, 'error': 'Игра не найдена'})
    if user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Не ваша игра'})

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({'ok': False, 'error': 'Некорректный JSON'}), 400
    is_player1 = (user_id == game.player1_id)
    zone = 'top' if is_player1 else 'bottom'
    ships_raw = data.get('ships', [])
    if ships_raw is None:
        ships_raw = []
    if not isinstance(ships_raw, list):
        return jsonify({'ok': False, 'error': 'ships должен быть списком'}), 400
    ships = ensure_61_ships(ships_raw, zone)

    PlayerShips.replace(game_id=game_id, user_id=user_id, ships=json.dumps(ships)).execute()
    return jsonify({'ok': True})


@app.route('/lobby')
def lobby() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})

    empty_games = Game.select().where(Game.player1_id.is_null() & Game.player2_id.is_null())
    for game in empty_games:
        GameTimer.delete().where(GameTimer.game_id == game.id).execute()
        GamePause.delete().where(GamePause.game_id == game.id).execute()
        SetupStatus.delete().where(SetupStatus.game_id == game.id).execute()
        PlayerShips.delete().where(PlayerShips.game_id == game.id).execute()
        BattleState.delete().where(BattleState.game_id == game.id).execute()
        ChatMessage.delete().where(ChatMessage.game_id == game.id).execute()
        game.delete_instance()

    queue_players = (Queue
                     .select(Queue, User)
                     .join(User)
                     .where(Queue.user_id != session['user_id'])
                     .order_by(Queue.timestamp))

    players_in_queue = [{
        'user_id': q.user.id,
        'nickname': q.user.nickname,
        'waiting_since': q.timestamp
    } for q in queue_players]

    private_rooms = (Game
                     .select(Game, User)
                     .join(User, on=(Game.player1_id == User.id))
                     .where(Game.status == 'waiting', Game.invite_code.is_null(False), Game.player1_id.is_null(False))
                     .order_by(Game.created_at.desc()))

    rooms = []
    for g in private_rooms:
        rooms.append({
            'game_id': g.id,
            'invite_code': g.invite_code,
            'creator_id': g.player1.id,
            'creator_nickname': g.player1.nickname,
            'created_at': g.created_at,
            'invite_link': f'http://127.0.0.1:4466/game/{g.invite_code}'
        })

    return jsonify({
        'ok': True,
        'players_in_queue': players_in_queue,
        'private_rooms': rooms
    })


@app.route('/create_private_room', methods=['POST'])
def create_private_room() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    old_games = Game.select().where(Game.player1_id == user_id, Game.player2_id.is_null())
    for g in old_games:
        GameTimer.delete().where(GameTimer.game_id == g.id).execute()
        GamePause.delete().where(GamePause.game_id == g.id).execute()
        SetupStatus.delete().where(SetupStatus.game_id == g.id).execute()
        PlayerShips.delete().where(PlayerShips.game_id == g.id).execute()
        BattleState.delete().where(BattleState.game_id == g.id).execute()
        ChatMessage.delete().where(ChatMessage.game_id == g.id).execute()
        g.delete_instance()

    invite_code = str(random.randint(10000, 99999))
    while Game.select().where(Game.invite_code == invite_code).exists():
        invite_code = str(random.randint(10000, 99999))

    with db.atomic():
        game = Game.create(player1_id=user_id, status='waiting', invite_code=invite_code)
        PlayerShips.create(game_id=game.id, user_id=user_id, ships=json.dumps([]))
        SetupStatus.create(game_id=game.id, user_id=user_id, done=0)
        init_game_timer(game.id, user_id, None)

    return jsonify({
        'ok': True, 'game_id': game.id, 'invite_code': invite_code,
        'invite_link': f'http://127.0.0.1:4466/game/{invite_code}'
    })


@app.route('/auto_setup/<int:game_id>', methods=['POST'])
def auto_setup(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify(resp)

    game = Game.get_or_none(Game.id == game_id)
    if not game or user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Не ваша игра'})

    data = request.get_json()
    placed_ships = data.get('placed_ships', []) if data else []

    is_player1 = (user_id == game.player1_id)
    zone = 'top' if is_player1 else 'bottom'
    final_ships = ensure_61_ships(placed_ships, zone)

    PlayerShips.replace(game_id=game_id, user_id=user_id, ships=json.dumps(final_ships)).execute()
    return jsonify({'ok': True, 'ships': final_ships})


@app.route('/notify_opponent_joined/<int:game_id>', methods=['POST'])
def notify_opponent_joined(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify(resp)

    game = Game.get_or_none(Game.id == game_id)
    if not game or user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Не ваша игра'})

    opponent_id = game.player2_id if user_id == game.player1_id else game.player1_id
    if opponent_id:
        opponent = User.get_by_id(opponent_id)
        return jsonify({'ok': True, 'message': f'Противник {opponent.nickname} присоединился к игре!'})
    return jsonify({'ok': False, 'error': 'Противник не найден'})


@app.route('/chat/send/<int:game_id>', methods=['POST'])
def send_chat_message(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    data = request.get_json()
    message = data.get('message', '').strip()
    if not message:
        return jsonify({'ok': False, 'error': 'Сообщение не может быть пустым'})

    game = Game.get_or_none(Game.id == game_id)
    if not game or user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Не ваша игра'})

    ChatMessage.create(game_id=game_id, user_id=user_id, message=message)
    return jsonify({'ok': True, 'message': 'Сообщение отправлено'})


@app.route('/chat/messages/<int:game_id>')
def get_chat_messages(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    game = Game.get_or_none(Game.id == game_id)
    if not game or user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Доступ запрещен'})

    messages = (ChatMessage
                .select(ChatMessage, User)
                .join(User)
                .where(ChatMessage.game_id == game_id)
                .order_by(ChatMessage.timestamp))

    result = [{
        'id': m.id,
        'message': m.message,
        'timestamp': m.timestamp,
        'nickname': m.user.nickname
    } for m in messages]

    return jsonify({'ok': True, 'messages': result})


@app.route('/search/start', methods=['POST'])
def old_start_search() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    user = User.get_by_id(user_id)
    PlayerSearch.replace(user_id=user_id, nickname=user.nickname, status='searching').execute()
    return jsonify({'ok': True, 'message': 'Поиск начат'})


@app.route('/search/stop', methods=['POST'])
def old_stop_search() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    PlayerSearch.delete().where(PlayerSearch.user_id == user_id).execute()
    return jsonify({'ok': True, 'message': 'Поиск остановлен'})


@app.route('/search/players')
def old_get_searching_players() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    searches = PlayerSearch.select().where(
        (PlayerSearch.user_id != user_id) & (PlayerSearch.status == 'searching')
    ).order_by(PlayerSearch.created_at)

    players = [{
        'user_id': ps.user_id,
        'nickname': ps.nickname,
        'created_at': ps.created_at
    } for ps in searches]

    return jsonify({'ok': True, 'players': players})


@app.route('/invite/send', methods=['POST'])
def send_invite() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    data = request.get_json()
    to_user_id = data.get('to_user_id')
    if not to_user_id:
        return jsonify({'ok': False, 'error': 'Неверные данные'})

    to_user_search = PlayerSearch.get_or_none(PlayerSearch.user_id == to_user_id, PlayerSearch.status == 'searching')
    if not to_user_search:
        return jsonify({'ok': False, 'error': 'Игрок недоступен'})

    invite_code = str(random.randint(10000, 99999))
    while Game.select().where(Game.invite_code == invite_code).exists():
        invite_code = str(random.randint(10000, 99999))

    with db.atomic():
        game = Game.create(player1_id=user_id, status='waiting', invite_code=invite_code)
        init_game_timer(game.id, user_id, None)
        GameInvite.create(from_user_id=user_id, to_user_id=to_user_id, game_id=game.id)

    return jsonify({
        'ok': True, 'game_id': game.id, 'invite_code': invite_code, 'message': 'Приглашение отправлено'
    })


@app.route('/invite/check')
def check_invites() -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    invites = (GameInvite
               .select(GameInvite, Game, User)
               .join(Game)
               .switch(GameInvite)
               .join(User, on=(GameInvite.from_user_id == User.id))
               .where(GameInvite.to_user_id == user_id, GameInvite.status == 'pending')
               .order_by(GameInvite.created_at.desc()))

    result = [{
        'invite_id': inv.id,
        'game_id': inv.game.id,
        'invite_code': inv.game.invite_code,
        'from_nickname': inv.from_user.nickname,
        'created_at': inv.created_at
    } for inv in invites]

    return jsonify({'ok': True, 'invites': result})


@app.route('/invite/accept/<int:invite_id>', methods=['POST'])
def accept_invite(invite_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    invite = GameInvite.get_or_none(
        GameInvite.id == invite_id,
        GameInvite.to_user_id == user_id,
        GameInvite.status == 'pending'
    )
    if not invite:
        return jsonify({'ok': False, 'error': 'Приглашение не найдено'})

    with db.atomic():
        invite.status = 'accepted'
        invite.save()
        game = invite.game
        game.player2_id = user_id
        game.status = 'active'
        game.save()
        PlayerSearch.delete().where(PlayerSearch.user_id.in_([invite.from_user_id, user_id])).execute()

    return jsonify({'ok': True, 'game_id': game.id, 'message': 'Приглашение принято'})


@app.route('/invite/decline/<int:invite_id>', methods=['POST'])
def decline_invite(invite_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    invite = GameInvite.get_or_none(GameInvite.id == invite_id, GameInvite.to_user_id == user_id)
    if invite:
        invite.status = 'declined'
        invite.save()
    return jsonify({'ok': True, 'message': 'Приглашение отклонено'})


@app.route('/timer/status/<int:game_id>')
def get_timer_status(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    game = Game.get_or_none(Game.id == game_id)
    if not game or user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Доступ запрещен'})

    timer = GameTimer.get_or_none(GameTimer.game_id == game_id)
    if not timer:
        return jsonify({'ok': False, 'error': 'Таймер не найден'})

    active_pause = GamePause.select().where(
        GamePause.game_id == game_id, GamePause.is_active == 1
    ).first()
    is_paused = active_pause is not None
    now = int(time.time())

    if timer.game_phase == 'setup':
        elapsed = now - timer.setup_start_time
        remaining = max(0, timer.setup_time_limit - elapsed)
        return jsonify({
            'ok': True, 'phase': 'setup', 'remaining_time': remaining,
            'total_time_limit': timer.setup_time_limit, 'is_paused': is_paused
        })
    else:
        battle = BattleState.get_or_none(BattleState.game_id == game_id)
        if not battle:
            return jsonify({'ok': False, 'error': 'Состояние боя не найдено'})

        turn_elapsed = now - battle.move_start_time
        turn_remaining = max(0, timer.turn_time_limit - turn_elapsed)

        if battle.current_turn_player_id == user_id:
            total_remaining = timer.total_time_p1 if user_id == game.player1_id else timer.total_time_p2
        else:
            total_remaining = timer.total_time_p2 if user_id == game.player1_id else timer.total_time_p1

        return jsonify({
            'ok': True, 'phase': 'battle', 'turn_remaining': turn_remaining,
            'total_remaining': total_remaining, 'current_turn_player_id': battle.current_turn_player_id,
            'is_paused': is_paused
        })


@app.route('/pause/start/<int:game_id>', methods=['POST'])
def start_pause(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']
    data = request.get_json()
    pause_type = data.get('pause_type')
    if pause_type not in ('long', 'short'):
        return jsonify({'ok': False, 'error': 'Неверный тип паузы'})

    game = Game.get_or_none(Game.id == game_id)
    if not game or user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Доступ запрещен'})

    used = GamePause.select().where(
        GamePause.game_id == game_id,
        GamePause.user_id == user_id,
        GamePause.pause_type == pause_type
    ).count()
    if used >= 1:
        return jsonify({'ok': False, 'error': f'Пауза типа {pause_type} уже использована'})

    active = GamePause.select().where(GamePause.game_id == game_id, GamePause.is_active == 1).first()
    if active:
        return jsonify({'ok': False, 'error': 'Пауза уже активна'})

    now = int(time.time())
    duration = 180 if pause_type == 'long' else 60
    GamePause.create(
        game_id=game_id,
        user_id=user_id,
        pause_type=pause_type,
        pause_start_time=now,
        pause_duration=duration
    )
    return jsonify({
        'ok': True, 'pause_type': pause_type, 'duration': duration,
        'message': f'Пауза {pause_type} начата'
    })


@app.route('/pause/end/<int:game_id>', methods=['POST'])
def end_pause(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    game = Game.get_or_none(Game.id == game_id)
    if not game or user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Доступ запрещен'})

    GamePause.update(is_active=0).where(
        GamePause.game_id == game_id, GamePause.is_active == 1
    ).execute()
    return jsonify({'ok': True, 'message': 'Пауза завершена'})


@app.route('/pause/status/<int:game_id>')
def get_pause_status(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    game = Game.get_or_none(Game.id == game_id)
    if not game or user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Доступ запрещен'})

    pause = GamePause.select().where(
        GamePause.game_id == game_id, GamePause.is_active == 1
    ).first()
    if pause:
        now = int(time.time())
        elapsed = now - pause.pause_start_time
        remaining = max(0, pause.pause_duration - elapsed)
        return jsonify({
            'ok': True, 'is_paused': True, 'pause_type': pause.pause_type,
            'remaining_time': remaining, 'total_duration': pause.pause_duration
        })
    else:
        return jsonify({'ok': True, 'is_paused': False})


@app.route('/battle/state/<int:game_id>')
def battle_state(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify(resp)

    game = Game.get_or_none(Game.id == game_id)
    if not game or user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Доступ запрещен'})

    battle = BattleState.get_or_none(BattleState.game_id == game_id)
    if not battle:
        return jsonify({'ok': False, 'error': 'Бой не найден'})

    try:
        battle_data = json.loads(battle.positions)

        positions_data = battle_data.get('positions', {})
        changed = False
        for pid, ships in positions_data.items():
            for ship in ships:
                if 'revealed' not in ship:
                    ship['revealed'] = False
                    changed = True
        if changed:
            battle.positions = json.dumps(battle_data)
            battle.save()
    except Exception as e:
        logger.error(f'Ошибка парсинга JSON для игры {game_id}: {e}')

    now = int(time.time())
    move_time_left = max(0, 30 - (now - battle.move_start_time))

    # Безопасное получение pauses из battle_data
    pauses_p1 = battle_data.get('pauses_p1', {'long': 1, 'short': 1})
    pauses_p2 = battle_data.get('pauses_p2', {'long': 1, 'short': 1})

    if user_id == game.player1_id:
        user_pauses, opponent_pauses = pauses_p1, pauses_p2
        user_total_time = battle.total_time_p1
        opponent_total_time = battle.total_time_p2
    else:
        user_pauses, opponent_pauses = pauses_p2, pauses_p1
        user_total_time = battle.total_time_p2
        opponent_total_time = battle.total_time_p1

    return jsonify({
        'ok': True,
        'positions': battle_data['positions'],
        'pending_combat': battle_data.get('pending_combat'),
        'current_turn': battle.current_turn_player_id,
        'status': battle.status,
        'move_time_left': move_time_left,
        'total_time_p1': battle.total_time_p1,
        'total_time_p2': battle.total_time_p2,
        'pauses_p1': user_pauses,
        'pauses_p2': opponent_pauses,
        'killed_ships_p1': battle_data.get('killed_ships_p1', {}),
        'killed_ships_p2': battle_data.get('killed_ships_p2', {}),
        'user_total_time': user_total_time,
        'opponent_total_time': opponent_total_time,
        'player1_id': game.player1_id,
        'player2_id': game.player2_id
    })


@app.route('/battle/combat_action/<int:game_id>', methods=['POST'])
def battle_combat_action(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify(resp)

    game = Game.get_or_none(Game.id == game_id)
    if not game or user_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'Доступ запрещен'})

    battle = BattleState.get_or_none(BattleState.game_id == game_id)
    if not battle:
        return jsonify({'ok': False, 'error': 'Бой не найден'})

    if is_game_paused(game_id):
        return jsonify({'ok': False, 'error': 'Игра на паузе'})

    battle_data = json.loads(battle.positions)
    pending = battle_data.get('pending_combat')
    if not pending:
        return jsonify({'ok': False, 'error': 'Нет активного боя'})

    # При активном покер-бое разрешаем ход ОБОИМ участникам (атакующему и защитнику)
    if user_id not in (pending.get('attacker_player_id'), pending.get('defender_player_id')):
        return jsonify({'ok': False, 'error': 'Вы не участник боя'})

    data = request.get_json() or {}
    action = data.get('action')
    if action not in ('reveal', 'stop', 'join_propose', 'join_accept', 'join_decline'):
        return jsonify({'ok': False, 'error': 'Некорректное действие'})

    role = 'attacker' if user_id == pending.get('attacker_player_id') else 'defender'
    if pending.get('next_actor') and pending.get('next_actor') != role:
        return jsonify({'ok': False, 'error': 'Сейчас ход в бою за другой стороной'})

    # ── join_propose: текущий игрок предлагает добавить свои корабли к бою ──
    if action == 'join_propose':
        if pending.get('join_proposal'):
            return jsonify({'ok': False, 'error': 'Уже есть активное предложение присоединиться к бою'})

        ship_ids = data.get('ship_ids') or []
        if not ship_ids:
            return jsonify({'ok': False, 'error': 'Укажите корабли для присоединения'})

        my_ships_all = battle_data.get('positions', {}).get(str(user_id), []) or []
        my_ship_map = {s.get('id'): s for s in my_ships_all if s.get('alive', True)}
        existing_my_ids = set(pending.get(f'{role}_ship_ids') or [])

        for sid in ship_ids:
            if sid not in my_ship_map:
                return jsonify({'ok': False, 'error': f'Корабль {sid} не найден или уничтожен'})
            if sid in existing_my_ids:
                return jsonify({'ok': False, 'error': f'Корабль {sid} уже участвует в бою'})

        pending['join_proposal'] = {'proposer_role': role, 'ship_ids': ship_ids}

        opponent_role = 'defender' if role == 'attacker' else 'attacker'
        pending['next_actor'] = opponent_role
        opp_id = pending.get('defender_player_id') if opponent_role == 'defender' else pending.get('attacker_player_id')
        if opp_id:
            battle.current_turn_player_id = opp_id
            battle.status = 'TURN_P2' if opp_id == game.player2_id else 'TURN_P1'
            battle_data['current_turn'] = opp_id
            battle_data['status'] = battle.status

        battle_data['move_timer'] = 30
        battle.move_start_time = int(time.time())
        battle.positions = json.dumps(battle_data)
        battle.save()
        return jsonify({'ok': True, 'battle': battle_data, 'pending_combat': battle_data.get('pending_combat')})

    # ── join_accept: противник принимает предложение и добавляет свои корабли ──
    if action == 'join_accept':
        proposal = pending.get('join_proposal')
        if not proposal:
            return jsonify({'ok': False, 'error': 'Нет активного предложения'})
        proposer_role = proposal.get('proposer_role')
        if role == proposer_role:
            return jsonify({'ok': False, 'error': 'Вы не можете принять своё предложение'})

        proposer_ship_ids = proposal.get('ship_ids') or []
        accepter_ship_ids = data.get('ship_ids') or []

        proposer_player_id = pending.get('attacker_player_id') if proposer_role == 'attacker' else pending.get('defender_player_id')
        proposer_ships_all = battle_data.get('positions', {}).get(str(proposer_player_id), []) or []
        proposer_ship_map = {s.get('id'): s for s in proposer_ships_all if s.get('alive', True)}

        accepter_ships_all = battle_data.get('positions', {}).get(str(user_id), []) or []
        accepter_ship_map = {s.get('id'): s for s in accepter_ships_all if s.get('alive', True)}
        existing_accepter_ids = set(pending.get(f'{role}_ship_ids') or [])

        for sid in accepter_ship_ids:
            if sid not in accepter_ship_map:
                return jsonify({'ok': False, 'error': f'Корабль {sid} не найден или уничтожен'})
            if sid in existing_accepter_ids:
                return jsonify({'ok': False, 'error': f'Корабль {sid} уже участвует в бою'})

        # Добавляем корабли предлагающего
        if proposer_role == 'attacker':
            pending['attacker_ship_ids'] = list(pending.get('attacker_ship_ids') or []) + proposer_ship_ids
            pending['attacker_revealed_n'] = int(pending.get('attacker_revealed_n') or 0) + len(proposer_ship_ids)
        else:
            pending['defender_ship_ids'] = list(pending.get('defender_ship_ids') or []) + proposer_ship_ids
            pending['defender_revealed_n'] = int(pending.get('defender_revealed_n') or 0) + len(proposer_ship_ids)
        for sid in proposer_ship_ids:
            if sid in proposer_ship_map:
                proposer_ship_map[sid]['revealed'] = True

        # Добавляем корабли принимающего (если есть)
        if accepter_ship_ids:
            if role == 'attacker':
                pending['attacker_ship_ids'] = list(pending.get('attacker_ship_ids') or []) + accepter_ship_ids
                pending['attacker_revealed_n'] = int(pending.get('attacker_revealed_n') or 0) + len(accepter_ship_ids)
            else:
                pending['defender_ship_ids'] = list(pending.get('defender_ship_ids') or []) + accepter_ship_ids
                pending['defender_revealed_n'] = int(pending.get('defender_revealed_n') or 0) + len(accepter_ship_ids)
            for sid in accepter_ship_ids:
                if sid in accepter_ship_map:
                    accepter_ship_map[sid]['revealed'] = True

        pending.pop('join_proposal', None)
        _advance_poker_turn(pending, battle_data)

        next_actor = pending.get('next_actor')
        next_actor_id = pending.get('attacker_player_id') if next_actor == 'attacker' else pending.get('defender_player_id')
        if next_actor_id:
            battle.current_turn_player_id = next_actor_id
            battle.status = 'TURN_P2' if next_actor_id == game.player2_id else 'TURN_P1'
            battle_data['current_turn'] = next_actor_id
            battle_data['status'] = battle.status

        battle_data['move_timer'] = 30
        battle.move_start_time = int(time.time())
        battle.positions = json.dumps(battle_data)
        battle.save()
        return jsonify({'ok': True, 'battle': battle_data, 'pending_combat': battle_data.get('pending_combat')})

    # ── join_decline: противник отклоняет предложение ──
    if action == 'join_decline':
        proposal = pending.get('join_proposal')
        if not proposal:
            return jsonify({'ok': False, 'error': 'Нет активного предложения'})
        proposer_role = proposal.get('proposer_role')
        if role == proposer_role:
            return jsonify({'ok': False, 'error': 'Вы не можете отклонить своё предложение'})

        pending.pop('join_proposal', None)
        pending['next_actor'] = role

        battle_data['move_timer'] = 30
        battle.move_start_time = int(time.time())
        battle.positions = json.dumps(battle_data)
        battle.save()
        return jsonify({'ok': True, 'battle': battle_data, 'pending_combat': battle_data.get('pending_combat')})

    # Resolve orders
    attacker_ship_ids = pending.get('attacker_ship_ids') or []
    defender_ship_ids = pending.get('defender_ship_ids') or []
    a_revealed_n = int(pending.get('attacker_revealed_n') or 0)
    d_revealed_n = int(pending.get('defender_revealed_n') or 0)

    if action == 'reveal':
        # Auto-reveal mechanic: defender reveals enough ships to exceed attacker strength
        attacker_revealed = int(pending.get('attacker_revealed_n') or 0)
        defender_revealed = int(pending.get('defender_revealed_n') or 0)
        
        if role == 'attacker':
            if attacker_revealed >= len(attacker_ship_ids):
                return jsonify({'ok': False, 'error': 'Больше нечего раскрывать'})
            # Attacker reveals ONE ship at a time
            pending['attacker_revealed_n'] = attacker_revealed + 1
        else:
            if defender_revealed >= len(defender_ship_ids):
                return jsonify({'ok': False, 'error': 'Больше нечего раскрывать'})
            # Defender reveals ONE ship at a time (poker rule: incremental reveal)
            # Calculate attacker's current revealed strength
            a_ships_for_strength = battle_data.get('positions', {}).get(str(pending.get('attacker_player_id')), []) or []
            d_ships_for_strength = battle_data.get('positions', {}).get(str(pending.get('defender_player_id')), []) or []
            a_by_id_for_strength = {s.get('id'): s for s in a_ships_for_strength}
            d_by_id_for_strength = {s.get('id'): s for s in d_ships_for_strength}
            a_ordered_for_str = [a_by_id_for_strength.get(i) for i in attacker_ship_ids if i in a_by_id_for_strength]
            d_ordered_for_str = [d_by_id_for_strength.get(i) for i in defender_ship_ids if i in d_by_id_for_strength]
            a_ordered_for_str = [s for s in a_ordered_for_str if s]
            d_ordered_for_str = [s for s in d_ordered_for_str if s]

            a_strength_now = _poker_strength(a_ordered_for_str, attacker_revealed)
            d_strength_now = _poker_strength(d_ordered_for_str, defender_revealed)

            # Poker rule: defender reveals ONE ship at a time
            # If defender's current strength is still less than attacker's, reveal one more
            pending['defender_revealed_n'] = defender_revealed + 1

        # Mark revealed ships in positions
        a_ships = battle_data.get('positions', {}).get(str(pending.get('attacker_player_id')), []) or []
        d_ships = battle_data.get('positions', {}).get(str(pending.get('defender_player_id')), []) or []
        a_by_id = {s.get('id'): s for s in a_ships}
        d_by_id = {s.get('id'): s for s in d_ships}
        _ensure_pending_reveals_marked([a_by_id.get(i) for i in attacker_ship_ids if i in a_by_id], int(pending.get('attacker_revealed_n') or 0))
        _ensure_pending_reveals_marked([d_by_id.get(i) for i in defender_ship_ids if i in d_by_id], int(pending.get('defender_revealed_n') or 0))

        # Сбрасываем таймер хода после каждого reveal в групповом бою
        battle_data['move_timer'] = 30
        battle.move_start_time = int(time.time())

        _advance_poker_turn(pending, battle_data)

        # Обновляем текущий ход в бою согласно следующему актору
        next_actor = pending.get('next_actor')
        if next_actor == 'attacker':
            next_actor_id = pending.get('attacker_player_id')
        else:
            next_actor_id = pending.get('defender_player_id')
        if next_actor_id:
            battle.current_turn_player_id = next_actor_id
            battle.status = 'TURN_P2' if next_actor_id == game.player2_id else 'TURN_P1'
            battle_data['current_turn'] = next_actor_id
            battle_data['status'] = battle.status

    if action == 'stop':
        # Stop immediately resolves with currently revealed strengths
        battle_info = _resolve_pending_combat(battle_data, game, battle)

        # If game not finished, pass turn to opponent after combat resolution
        if battle.status != 'finished' and game.status != 'finished':
            opponent_id = get_opponent_id(game, user_id)
            if opponent_id:
                battle.current_turn_player_id = opponent_id
                battle.move_start_time = int(time.time())
                battle.status = 'TURN_P2' if battle.current_turn_player_id == game.player2_id else 'TURN_P1'
                battle_data['move_timer'] = 30  # Сбрасываем таймер хода

                timer = GameTimer.get_or_none(GameTimer.game_id == game_id)
                if timer:
                    timer.current_turn_player_id = battle.current_turn_player_id
                    timer.current_turn_start_time = battle.move_start_time
                    timer.save()

        battle.positions = json.dumps(battle_data)
        battle.save()
        return jsonify({'ok': True, 'battle': battle_data, 'battle_info': battle_info})

    # If both sides can't improve and equal strengths, allow stop to resolve; otherwise continue
    battle.positions = json.dumps(battle_data)
    battle.save()
    return jsonify({'ok': True, 'battle': battle_data, 'pending_combat': battle_data.get('pending_combat')})


@app.route('/battle/torpedo_directions/<int:game_id>', methods=['POST'])
def get_torpedo_directions(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify(resp)

    battle = BattleState.get_or_none(BattleState.game_id == game_id)
    if not battle:
        return jsonify({'ok': False, 'error': 'Бой не найден'})

    if battle.current_turn_player_id != user_id:
        return jsonify({'ok': False, 'error': 'Не ваш ход'})

    battle_data = json.loads(battle.positions)
    data = request.get_json(silent=True) or {}
    tk_id = data.get('tk_id')
    t_id = data.get('t_id')
    if not tk_id or not t_id:
        return jsonify({'ok': False, 'error': 'Требуются ID торпедного катера и торпеды'})

    try:
        tk_id = int(tk_id)
        t_id = int(t_id)
    except Exception:
        return jsonify({'ok': False, 'error': 'Некорректные ID торпеды/катера'})

    my_ships = battle_data['positions'].get(str(user_id), [])
    tk_ship = next((s for s in my_ships if s.get('id') == tk_id and s.get('alive', True)), None)
    t_ship = next((s for s in my_ships if s.get('id') == t_id and s.get('alive', True)), None)

    if not tk_ship or tk_ship['type'] != 'ТК':
        return jsonify({'ok': False, 'error': 'Торпедный катер не найден'})
    if not t_ship or t_ship['type'] != 'Т':
        return jsonify({'ok': False, 'error': 'Торпеда не найдена'})

    # Торпеда должна быть рядом со своим торпедным катером (радиус 1, включая диагональ).
    # Направление "вперёд" для выстрела задаётся вектором от ТК к торпеде.
    dx0 = abs(t_ship.get('x') - tk_ship.get('x'))
    dy0 = abs(t_ship.get('y') - tk_ship.get('y'))
    if max(dx0, dy0) != 1 or (dx0 == 0 and dy0 == 0):
        return jsonify({'ok': False, 'error': 'Торпеда должна стоять рядом с торпедным катером'})

    enemy_id = get_opponent_id(Game.get_by_id(game_id), user_id)
    enemy_ships = battle_data['positions'].get(str(enemy_id), [])
    enemy_cells = {(s.get('x'), s.get('y')) for s in enemy_ships if s.get('alive', True)}
    my_cells = {(s.get('x'), s.get('y')) for s in my_ships if s.get('alive', True)}
    occupied_cells = my_cells | enemy_cells

    # Направление "вперёд" = от ТК к Т.
    fdx = t_ship['x'] - tk_ship['x']
    fdy = t_ship['y'] - tk_ship['y']
    if fdx != 0:
        fdx = 1 if fdx > 0 else -1
    if fdy != 0:
        fdy = 1 if fdy > 0 else -1
    ldx, ldy = -fdy, fdx

    def _in_bounds(px: int, py: int) -> bool:
        return 0 <= px < 14 and 0 <= py < 15

    def _zone_cells():
        res = set()
        tx, ty = t_ship['x'], t_ship['y']
        # d=1: 3 клетки (лево, центр, право)
        for s in (-1, 0, 1):
            res.add((tx + fdx * 1 + ldx * s, ty + fdy * 1 + ldy * s))
        # d=2: 3 клетки (лево, центр, право)
        # НОВОЕ УТОЧНЕНИЕ: если на d=2 стоит враг (центр), то боковые (лево/право) не атакуются?
        # Пользователь сказал: "клеточки справа и слева от красной(от врага) не должны быть атакуемыми! Только в случае когда враг через клетку от торпеды."
        # Это значит на d=2 если есть враг в центре, бока d=2 убираем.
        for s in (-1, 0, 1):
            res.add((tx + fdx * 2 + ldx * s, ty + fdy * 2 + ldy * s))
        # d=3: только центральная клетка
        res.add((tx + fdx * 3, ty + fdy * 3))
        return {(x, y) for (x, y) in res if _in_bounds(x, y)}

    def _is_clear_path(target_x: int, target_y: int) -> bool:
        """Проверка препятствий для расширенной зоны.
        Если на пути (по центральной линии) стоит корабль, он блокирует клетки дальше.
        """
        tx, ty = t_ship['x'], t_ship['y']
        rel_x = target_x - tx
        rel_y = target_y - ty

        # Определяем дистанцию d и смещение s
        target_d = None
        target_s = None
        
        # d=1, 2, 3
        for d in (1, 2, 3):
            for s in (-1, 0, 1):
                if rel_x == fdx * d + ldx * s and rel_y == fdy * d + ldy * s:
                    target_d = d
                    target_s = s
                    break
            if target_d: break

        if not target_d: return False
        if (target_x, target_y) in my_cells: return False

        # Блокировка: d=1 (центр) блокирует d=2 (центр) и d=3 (центр)
        # Блокировка: d=2 (центр) блокирует d=3 (центр)
        if target_s == 0:
            if target_d >= 2:
                cx, cy = tx + fdx * 1, ty + fdy * 1
                if (cx, cy) in occupied_cells: return False
            if target_d >= 3:
                cx, cy = tx + fdx * 2, ty + fdy * 2
                if (cx, cy) in occupied_cells: return False
        
        # Для боковых клеток d=2:
        # Если в центре d=2 (враг), то бока d=2 недоступны
        if target_s != 0 and target_d == 2:
            # Проверяем центр d=2
            mid_x, mid_y = tx + fdx * 2, ty + fdy * 2
            # Если в центре на d=2 кто-то есть (враг), боковые d=2 отключаем
            if (mid_x, mid_y) in enemy_cells:
                return False
            
            # Также стандартная блокировка от d=1 (бок)
            cx, cy = tx + fdx * 1 + ldx * target_s, ty + fdy * 1 + ldy * target_s
            if (cx, cy) in occupied_cells: return False

        return True

    zone_cells = []
    # Собираем все клетки зоны
    for d in (1, 2):
        for s in (-1, 0, 1):
            x = t_ship['x'] + fdx * d + ldx * s
            y = t_ship['y'] + fdy * d + ldy * s
            if _in_bounds(x, y) and _is_clear_path(x, y):
                zone_cells.append([x, y])
    
    # d=3: только центр
    x, y = t_ship['x'] + fdx * 3, t_ship['y'] + fdy * 3
    if _in_bounds(x, y) and _is_clear_path(x, y):
        zone_cells.append([x, y])

    directions = []
    if zone_cells:
        directions.append({'direction': 'ZONE', 'target_positions': zone_cells})

    return jsonify({
        'ok': True, 'directions': directions,
        'tk_position': {'x': tk_ship['x'], 'y': tk_ship['y']},
        't_position': {'x': t_ship['x'], 'y': t_ship['y']}
    })


@app.route('/battle/air_directions/<int:game_id>', methods=['POST'])
def get_air_attack_directions(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify(resp)

    battle = BattleState.get_or_none(BattleState.game_id == game_id)
    if not battle:
        return jsonify({'ok': False, 'error': 'Бой не найден'})

    if battle.current_turn_player_id != user_id:
        return jsonify({'ok': False, 'error': 'Не ваш ход'})

    if is_game_paused(game_id):
        return jsonify({'ok': False, 'error': 'Игра на паузе'})

    battle_data = json.loads(battle.positions)
    data = request.get_json()
    a_id = data.get('a_id')
    s_id = data.get('s_id')
    if not a_id or not s_id:
        return jsonify({'ok': False, 'error': 'Требуются ID авианосца и самолета'})

    my_ships = battle_data['positions'].get(str(user_id), [])
    aircraft_carrier = next((s for s in my_ships if s.get('id') == a_id and s.get('alive', True)), None)
    aircraft = next((s for s in my_ships if s.get('id') == s_id and s.get('alive', True)), None)

    if not aircraft_carrier or aircraft_carrier['type'] != 'А':
        return jsonify({'ok': False, 'error': 'Авианосец не найден'})
    if not aircraft or aircraft['type'] != 'С':
        return jsonify({'ok': False, 'error': 'Самолет не найден'})

    # Самолет должен быть рядом с авианосцем (по соседству)
    dx = abs(aircraft_carrier['x'] - aircraft['x'])
    dy = abs(aircraft_carrier['y'] - aircraft['y'])
    if max(dx, dy) != 1 or (dx == 0 and dy == 0):
        return jsonify({'ok': False, 'error': 'Самолет должен быть рядом с авианосцем'})

    # Определяем сторону игрока для направления "вперёд"
    # Player 1 (сверху, y=0-4): вперёд = вниз (S, y+1)
    # Player 2 (снизу, y=10-14): вперёд = вверх (N, y-1)
    my_ships_y_values = [s.get('y', 0) for s in my_ships if s.get('alive', True)]
    avg_y = sum(my_ships_y_values) / len(my_ships_y_values) if my_ships_y_values else 7
    
    # Возможные направления: только вперёд (по вертикали)
    directions = []
    if avg_y < 7:
        # Player 1 - вперёд вниз
        dir_map = {'S': (0, 1)}
    else:
        # Player 2 - вперёд вверх  
        dir_map = {'N': (0, -1)}

    # Самолет может атаковать только если он стоит "перед" авианосцем,
    # то есть самолет находится между авианосцем и направлением атаки (самолет впереди).
    # Для Player 1 (атака вниз): самолет должен быть ниже авианосца (y > carrier.y).
    # Для Player 2 (атака вверх): самолет должен быть выше авианосца (y < carrier.y).
    if avg_y < 7:
        if not (aircraft['x'] == aircraft_carrier['x'] and aircraft['y'] > aircraft_carrier['y']):
            return jsonify({'ok': False, 'error': 'Самолет должен стоять впереди авианосца'} )
    else:
        if not (aircraft['x'] == aircraft_carrier['x'] and aircraft['y'] < aircraft_carrier['y']):
            return jsonify({'ok': False, 'error': 'Самолет должен стоять впереди авианосца'} )
    
    x, y = aircraft['x'], aircraft['y']
    
    for direction, (dx, dy) in dir_map.items():
        target_positions = []
        valid = True
        tx, ty = x, y
        
        # Проверяем 5 клеток вперед
        for step in range(5):
            tx += dx
            ty += dy
            if tx < 0 or tx >= 14 or ty < 0 or ty >= 15:
                # За пределами поля - направление невалидно
                valid = False
                break
            target_positions.append([tx, ty])
        
        if valid and target_positions:
            directions.append({
                'direction': direction,
                'target_positions': target_positions
            })

    return jsonify({
        'ok': True, 'directions': directions,
        'aircraft_carrier_position': {'x': aircraft_carrier['x'], 'y': aircraft_carrier['y']},
        'aircraft_position': {'x': aircraft['x'], 'y': aircraft['y']}
    })


@app.route('/battle/create_group/<int:game_id>', methods=['POST'])
def create_group(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify(resp)

    battle = BattleState.get_or_none(BattleState.game_id == game_id)
    if not battle:
        return jsonify({'ok': False, 'error': 'Бой не найден'})

    if battle.current_turn_player_id != user_id:
        return jsonify({'ok': False, 'error': 'Не ваш ход'})

    if is_game_paused(game_id):
        return jsonify({'ok': False, 'error': 'Игра на паузе'})

    battle_data = json.loads(battle.positions)

    # Нельзя создавать/менять группы во время интерактивного боя (Покер)
    if battle_data.get('pending_combat'):
        return jsonify({'ok': False, 'error': 'Идёт бой (Покер). Сначала завершите бой.'})

    data = request.get_json()
    ship_ids = data.get('ship_ids', [])
    ship_ids = list(ship_ids or [])
    # Убираем дубликаты, сохраняя порядок
    seen = set()
    ship_ids = [sid for sid in ship_ids if not (sid in seen or seen.add(sid))]
    if len(ship_ids) < 2 or len(ship_ids) > 3:
        return jsonify({'ok': False, 'error': 'Выберите 2-3 корабля для группы'})

    my_ships = battle_data['positions'].get(str(user_id), [])
    group_ships = [s for s in my_ships if s.get('id') in ship_ids and s.get('alive', True)]
    if len(group_ships) != len(ship_ids):
        return jsonify({'ok': False, 'error': 'Некоторые корабли не найдены или мертвы'})

    if any(s.get('group_id') for s in group_ships):
        return jsonify({'ok': False, 'error': 'Один или несколько кораблей уже состоят в группе'})

    ship_types = [s['type'] for s in group_ships]
    can_group, error_message = can_ships_be_grouped(ship_types)
    if not can_group:
        return jsonify({'ok': False, 'error': error_message})

    if not are_ships_adjacent(group_ships):
        return jsonify({'ok': False, 'error': 'Корабли должны находиться рядом'})

    group_id = f"group_{int(time.time())}_{random.randint(1000, 9999)}"
    total_strength = sum(get_ship_strength(s['type']) for s in group_ships)

    for ship in group_ships:
        ship['group_id'] = group_id

    if 'groups' not in battle_data:
        battle_data['groups'] = {}

    battle_data['groups'][group_id] = {
        'id': group_id, 'ships': ship_ids, 'total_strength': total_strength,
        'leader_id': ship_ids[0], 'created_by': user_id, 'ship_type': ship_types[0], 'ship_count': len(group_ships)
    }

    battle.positions = json.dumps(battle_data)
    battle.save()
    return jsonify({'ok': True, 'group': {'group_id': group_id, 'total_strength': total_strength}, 'battle': battle_data})


@app.route('/battle/disband_group/<int:game_id>', methods=['POST'])
def disband_group_endpoint(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify(resp)

    battle = BattleState.get_or_none(BattleState.game_id == game_id)
    if not battle:
        return jsonify({'ok': False, 'error': 'Бой не найден'})

    if battle.current_turn_player_id != user_id:
        return jsonify({'ok': False, 'error': 'Не ваш ход'})

    if is_game_paused(game_id):
        return jsonify({'ok': False, 'error': 'Игра на паузе'})

    battle_data = json.loads(battle.positions)

    # Нельзя расформировывать группы во время интерактивного боя (Покер)
    if battle_data.get('pending_combat'):
        return jsonify({'ok': False, 'error': 'Идёт бой (Покер). Сначала завершите бой.'})

    data = request.get_json()
    group_id = data.get('group_id')
    if not group_id or 'groups' not in battle_data or group_id not in battle_data['groups']:
        return jsonify({'ok': False, 'error': 'Группа не найдена'})

    group = battle_data['groups'][group_id]
    if group['created_by'] != user_id:
        return jsonify({'ok': False, 'error': 'Вы можете расформировать только свои группы'})

    my_ships = battle_data['positions'].get(str(user_id), [])
    for ship in my_ships:
        if ship.get('group_id') == group_id:
            del ship['group_id']
    del battle_data['groups'][group_id]

    battle.positions = json.dumps(battle_data)
    battle.save()
    return jsonify({'ok': True, 'message': 'Группа расформирована', 'battle': battle_data})


@app.route('/battle/move/<int:game_id>', methods=['POST'])
def battle_move(game_id: int) -> Any:
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'Не авторизован'})
    user_id = session['user_id']

    ok, resp = check_game_timers(game_id, user_id)
    if not ok:
        return jsonify(resp)

    game = Game.get_or_none(Game.id == game_id)
    if not game:
        return jsonify({'ok': False, 'error': 'Игра не найдена'})

    battle = BattleState.get_or_none(BattleState.game_id == game_id)
    if not battle:
        return jsonify({'ok': False, 'error': 'Бой не найден'})

    if battle.current_turn_player_id != user_id:
        return jsonify({'ok': False, 'error': 'Не ваш ход'})

    if battle.status not in ['TURN_P1', 'TURN_P2']:
        return jsonify({'ok': False, 'error': 'Неверная фаза игры'})

    if is_game_paused(game_id):
        return jsonify({'ok': False, 'error': 'Игра на паузе'})

    battle_data = json.loads(battle.positions)
    data = request.get_json()

    if data.get('end_turn'):
        opponent_id = get_opponent_id(game, user_id)
        next_turn_player_id = opponent_id
        next_status = 'TURN_P2' if next_turn_player_id == game.player2_id else 'TURN_P1'
        next_move_start_time = int(time.time())

        battle.current_turn_player_id = next_turn_player_id
        battle.move_start_time = next_move_start_time
        battle.status = next_status

        battle_data['current_turn'] = next_turn_player_id
        battle_data['status'] = next_status
        battle_data['move_start_time'] = next_move_start_time

        battle.positions = json.dumps(battle_data)
        battle.save()

        timer = GameTimer.get_or_none(GameTimer.game_id == game_id)
        if timer:
            timer.current_turn_player_id = next_turn_player_id
            timer.current_turn_start_time = next_move_start_time
            timer.save()

        return jsonify({'ok': True, 'battle': battle_data})

    # Пока идёт пошаговый бой по правилу "Покера" — запрещаем любые обычные действия.
    # Разрешены только /battle/combat_action.
    if battle_data.get('pending_combat'):
        return jsonify({'ok': False, 'error': 'Идёт бой (Покер). Завершите бой действиями "Показать ещё" или "Стоп".'})

    if 'torpedo_shot' in data:
        shot = data.get('torpedo_shot') or {}
        tk_id = shot.get('tk_id')
        t_id = shot.get('t_id')
        target = shot.get('target')
        logger.info(f"🚀 Torpedo Shot Attempt: tk_id={tk_id}, t_id={t_id}, target={target}")
        if tk_id is None or t_id is None or not target:
            logger.warning("❌ Torpedo Shot: Missing data")
            return jsonify({'ok': False, 'error': 'Некорректные данные торпедного выстрела'})

        if not (isinstance(target, (list, tuple)) and len(target) == 2):
            return jsonify({'ok': False, 'error': 'Некорректная цель торпеды'})
        try:
            target_x = int(target[0])
            target_y = int(target[1])
        except Exception:
            return jsonify({'ok': False, 'error': 'Некорректная цель торпеды'})

        try:
            tk_id = int(tk_id)
            t_id = int(t_id)
        except Exception:
            return jsonify({'ok': False, 'error': 'Некорректные ID торпеды/катера'})

        my_ships = battle_data['positions'].get(str(user_id), [])
        tk_ship = next((s for s in my_ships if s.get('id') == tk_id and s.get('alive', True)), None)
        t_ship = next((s for s in my_ships if s.get('id') == t_id and s.get('alive', True)), None)

        if not tk_ship or tk_ship.get('type') != 'ТК':
            logger.warning(f"❌ Torpedo Shot: TK ship not found or wrong type (id={tk_id})")
            return jsonify({'ok': False, 'error': 'Торпедный катер не найден'})
        if not t_ship or t_ship.get('type') != 'Т':
            logger.warning(f"❌ Torpedo Shot: Torpedo ship not found or wrong type (id={t_id})")
            return jsonify({'ok': False, 'error': 'Торпеда не найдена'})

        # Торпеда должна быть рядом со своим торпедным катером (радиус 1, включая диагональ).
        # Направление "вперёд" для выстрела задаётся вектором от ТК к торпеде.
        dx0 = abs(t_ship.get('x') - tk_ship.get('x'))
        dy0 = abs(t_ship.get('y') - tk_ship.get('y'))
        if max(dx0, dy0) != 1 or (dx0 == 0 and dy0 == 0):
            logger.warning(f"❌ Torpedo Shot: Torpedo not near TK. T({t_ship['x']},{t_ship['y']}) TK({tk_ship['x']},{tk_ship['y']})")
            return jsonify({'ok': False, 'error': 'Торпеда должна стоять рядом с торпедным катером'})

        if not (0 <= target_x < 14 and 0 <= target_y < 15):
            return jsonify({'ok': False, 'error': 'Цель вне поля'})
        opponent_id = get_opponent_id(game, user_id)
        opponent_ships = battle_data['positions'].get(str(opponent_id), [])

        destroyed_enemy = None
        enemy_cells = {(s.get('x'), s.get('y')) for s in opponent_ships if s.get('alive', True)}
        my_cells = {(s.get('x'), s.get('y')) for s in my_ships if s.get('alive', True)}
        occupied_cells = my_cells | enemy_cells

        # Направление "вперёд" = от ТК к Т.
        fdx = t_ship['x'] - tk_ship['x']
        fdy = t_ship['y'] - tk_ship['y']
        
        # Нормализуем fdx, fdy
        if fdx != 0:
            fdx = 1 if fdx > 0 else -1
        if fdy != 0:
            fdy = 1 if fdy > 0 else -1
        
        # Перпендикуляр (ldx, ldy) для "клиновидного" расширения
        ldx, ldy = -fdy, fdx

        def _get_shot_zone():
            res = set()
            tx, ty = t_ship['x'], t_ship['y']
            # d=1: 3 клетки
            for s in (-1, 0, 1):
                res.add((tx + fdx * 1 + ldx * s, ty + fdy * 1 + ldy * s))
            # d=2: 3 клетки
            for s in (-1, 0, 1):
                res.add((tx + fdx * 2 + ldx * s, ty + fdy * 2 + ldy * s))
            # d=3: только центр
            res.add((tx + fdx * 3, ty + fdy * 3))
            return {(x, y) for (x, y) in res if 0 <= x < 14 and 0 <= y < 15}

        allowed_zone = _get_shot_zone()
        if (target_x, target_y) not in allowed_zone:
            logger.warning(f"❌ Torpedo Shot: Target {target_x},{target_y} not in allowed zone")
            return jsonify({'ok': False, 'error': 'Цель не входит в зону торпедного выстрела'})

        # Блокировка путей
        rel_x = target_x - t_ship['x']
        rel_y = target_y - t_ship['y']
        
        target_d = None
        target_s = None
        for d in (1, 2, 3):
            for s in (-1, 0, 1):
                if rel_x == fdx * d + ldx * s and rel_y == fdy * d + ldy * s:
                    target_d = d
                    target_s = s
                    break
            if target_d: break

        # Блокировка по центру
        if target_s == 0:
            if target_d >= 2:
                bx, by = t_ship['x'] + fdx * 1, t_ship['y'] + fdy * 1
                if (bx, by) in occupied_cells:
                    logger.warning(f"❌ Torpedo Shot: Path blocked at d=1 ({bx},{by})")
                    return jsonify({'ok': False, 'error': 'Торпеда не может атаковать через препятствия'})
            if target_d >= 3:
                bx, by = t_ship['x'] + fdx * 2, t_ship['y'] + fdy * 2
                if (bx, by) in occupied_cells:
                    logger.warning(f"❌ Torpedo Shot: Path blocked at d=2 ({bx},{by})")
                    return jsonify({'ok': False, 'error': 'Торпеда не может атаковать через препятствия'})
        # Блокировка боковых клеток
        elif target_d == 2:
            # Если в центре d=2 враг, боковые d=2 недоступны
            if (t_ship['x'] + fdx * 2, t_ship['y'] + fdy * 2) in enemy_cells:
                logger.warning("❌ Torpedo Shot: Side cell blocked by enemy in center at d=2")
                return jsonify({'ok': False, 'error': 'Боковые клетки на d=2 недоступны, если в центре враг'})
            
            bx, by = t_ship['x'] + fdx * 1 + ldx * target_s, t_ship['y'] + fdy * 1 + ldy * target_s
            if (bx, by) in occupied_cells:
                logger.warning(f"❌ Torpedo Shot: Path blocked at side d=1 ({bx},{by})")
                return jsonify({'ok': False, 'error': 'Торпеда не может атаковать через препятствия'})

        if (target_x, target_y) in enemy_cells:
            # Находим корабль в общем списке всех позиций, чтобы пометить его как уничтоженный для обоих игроков
            found_hit = False
            for pid_str in battle_data.get('positions', {}):
                ships_list = battle_data['positions'][pid_str]
                for s in ships_list:
                    if s.get('alive', True) and s.get('x') == target_x and s.get('y') == target_y:
                        s['alive'] = False
                        s['revealed'] = True
                        destroyed_enemy = {'type': s.get('type'), 'x': target_x, 'y': target_y}
                        found_hit = True
                        break
                if found_hit:
                    break
        
        # Торпеда одноразовая
        t_ship['alive'] = False

        winner_id = check_victory(battle_data, game)
        if winner_id is not None:
            battle.status = 'finished'
            game.status = 'finished'
            game.save()
            battle_data['status'] = 'finished'
            battle_data['winner_id'] = winner_id
            battle.positions = json.dumps(battle_data)
            battle.save()
            return jsonify({
                'ok': True, 
                'victory': winner_id != -1, 
                'draw': winner_id == -1, 
                'winner_id': winner_id, 
                'battle': battle_data,
                'torpedo_shot_result': {'destroyed_enemy': destroyed_enemy}
            })

        # Передача хода оппоненту
        opponent_id = get_opponent_id(game, user_id)
        next_turn_player_id = opponent_id
        next_status = 'TURN_P2' if next_turn_player_id == game.player2_id else 'TURN_P1'
        next_move_start_time = int(time.time())

        battle.current_turn_player_id = next_turn_player_id
        battle.move_start_time = next_move_start_time
        battle.status = next_status
        battle_data['current_turn'] = next_turn_player_id
        battle_data['status'] = next_status
        battle_data['move_start_time'] = next_move_start_time

        logger.info(f"✅ Torpedo Shot Success: target={target_x},{target_y}, destroyed={destroyed_enemy}")

        battle.positions = json.dumps(battle_data)
        battle.save()

        timer = GameTimer.get_or_none(GameTimer.game_id == game_id)
        if timer:
            timer.current_turn_player_id = next_turn_player_id
            timer.current_turn_start_time = next_move_start_time
            timer.save()

        return jsonify({
            'ok': True,
            'battle': battle_data,
            'torpedo_shot_result': {'destroyed_enemy': destroyed_enemy}
        })

    if 'air_attack' in data:
        payload = data.get('air_attack') or {}
        a_id = payload.get('a_id')
        s_id = payload.get('s_id')
        direction = payload.get('direction')
        if not a_id or not s_id or not direction:
            return jsonify({'ok': False, 'error': 'Некорректные данные воздушной атаки'})

        my_ships = battle_data['positions'].get(str(user_id), [])
        aircraft_carrier = next((s for s in my_ships if s.get('id') == a_id and s.get('alive', True)), None)
        aircraft = next((s for s in my_ships if s.get('id') == s_id and s.get('alive', True)), None)
        if not aircraft_carrier or aircraft_carrier.get('type') != 'А':
            return jsonify({'ok': False, 'error': 'Авианосец не найден'})
        if not aircraft or aircraft.get('type') != 'С':
            return jsonify({'ok': False, 'error': 'Самолет не найден'})

        # Самолет должен быть рядом с авианосцем
        dx0 = abs(aircraft_carrier['x'] - aircraft['x'])
        dy0 = abs(aircraft_carrier['y'] - aircraft['y'])
        if max(dx0, dy0) != 1 or (dx0 == 0 and dy0 == 0):
            return jsonify({'ok': False, 'error': 'Самолет должен быть рядом с авианосцем'})

        # Определяем сторону игрока
        my_ships_y_values = [s.get('y', 0) for s in my_ships if s.get('alive', True)]
        avg_y = sum(my_ships_y_values) / len(my_ships_y_values) if my_ships_y_values else 7
        if avg_y < 7:
            # Player 1: вперед вниз
            if direction != 'S':
                return jsonify({'ok': False, 'error': 'Самолет атакует только вперед'})
            fdx, fdy = 0, 1
            # Самолет должен стоять впереди авианосца (ниже него)
            if not (aircraft['x'] == aircraft_carrier['x'] and aircraft['y'] > aircraft_carrier['y']):
                return jsonify({'ok': False, 'error': 'Самолет должен стоять впереди авианосца'})
        else:
            # Player 2: вперед вверх
            if direction != 'N':
                return jsonify({'ok': False, 'error': 'Самолет атакует только вперед'})
            fdx, fdy = 0, -1
            # Самолет должен стоять впереди авианосца (выше него)
            if not (aircraft['x'] == aircraft_carrier['x'] and aircraft['y'] < aircraft_carrier['y']):
                return jsonify({'ok': False, 'error': 'Самолет должен стоять впереди авианосца'})

        # Сносим все, что находится на 5 клетках вперед
        destroyed = []
        ax, ay = aircraft['x'], aircraft['y']
        for step in range(1, 6):
            tx = ax + fdx * step
            ty = ay + fdy * step
            if not (0 <= tx < 14 and 0 <= ty < 15):
                break
            for pid, ships in battle_data.get('positions', {}).items():
                for s in ships:
                    if not s.get('alive', True):
                        continue
                    if s.get('x') == tx and s.get('y') == ty:
                        s['alive'] = False
                        if str(pid) != str(user_id):
                            s['revealed'] = True
                        destroyed.append({'type': s.get('type'), 'x': tx, 'y': ty})
        
        # Самолет одноразовый - исчезает после выстрела (как торпеда)
        aircraft['alive'] = False
        aircraft['revealed'] = True

        winner_id = check_victory(battle_data, game)
        if winner_id is not None:
            battle.status = 'finished'
            game.status = 'finished'
            game.save()
            battle_data['status'] = 'finished'
            battle_data['winner_id'] = winner_id
            battle.positions = json.dumps(battle_data)
            battle.save()
            return jsonify({
                'ok': True, 
                'victory': winner_id != -1, 
                'draw': winner_id == -1, 
                'winner_id': winner_id, 
                'battle': battle_data,
                'air_attack_result': {
                    'destroyed_enemies': destroyed
                }
            })

        opponent_id = get_opponent_id(game, user_id)
        next_turn_player_id = opponent_id
        next_status = 'TURN_P2' if next_turn_player_id == game.player2_id else 'TURN_P1'
        next_move_start_time = int(time.time())
        battle.current_turn_player_id = next_turn_player_id
        battle.move_start_time = next_move_start_time
        battle.status = next_status
        battle_data['current_turn'] = next_turn_player_id
        battle_data['status'] = next_status
        battle_data['move_start_time'] = next_move_start_time
        battle.positions = json.dumps(battle_data)
        battle.save()

        timer = GameTimer.get_or_none(GameTimer.game_id == game_id)
        if timer:
            timer.current_turn_player_id = next_turn_player_id
            timer.current_turn_start_time = next_move_start_time
            timer.save()

        return jsonify({
            'ok': True,
            'battle': battle_data,
            'air_attack_result': {
                'destroyed_enemies': destroyed
            }
        })

    if 'move' in data:
        move_data = data['move']
        new_x, new_y = move_data['to']
        try:
            new_x = int(new_x)
            new_y = int(new_y)
        except Exception:
            return jsonify({'ok': False, 'error': 'Некорректные координаты'})

        if not (0 <= new_x < 14 and 0 <= new_y < 15):
            return jsonify({'ok': False, 'error': 'Клетка вне поля'})

        my_ships = battle_data['positions'].get(str(user_id), [])
        ship = None
        ship_id = move_data.get('ship_id')
        if ship_id is not None:
            try:
                ship_id = int(ship_id)
            except Exception:
                pass
            ship = next((s for s in my_ships if s.get('id') == ship_id), None)
        else:
            idx = move_data.get('idx')
            if isinstance(idx, int) and 0 <= idx < len(my_ships):
                ship = my_ships[idx]

        if not ship:
            return jsonify({'ok': False, 'error': 'Корабль не найден'})
        if not is_movable(ship, battle_data, user_id):
            return jsonify({'ok': False, 'error': 'Эта фишка не может двигаться'})

        # Особые правила орбитальных спец-юнитов: должны оставаться рядом со СВОИМ носителем.
        # Важно: если на поле может быть несколько носителей, выбираем носитель рядом с текущей позицией спец-юнита.
        if ship.get('type') in ('Т', 'С', 'М'):
            carrier_map = {'Т': 'ТК', 'С': 'А', 'М': 'ЭС'}
            carrier_type = carrier_map.get(ship.get('type'))
            cur_x = ship.get('x')
            cur_y = ship.get('y')
            carrier = next((s for s in my_ships
                           if s.get('alive', True)
                           and s.get('type') == carrier_type
                           and max(abs(cur_x - s.get('x')), abs(cur_y - s.get('y'))) == 1), None)
            if carrier:
                dx = abs(new_x - carrier.get('x'))
                dy = abs(new_y - carrier.get('y'))
                if max(dx, dy) > 1:
                    return jsonify({'ok': False, 'error': 'Спец-юнит должен оставаться рядом с носителем (радиус 1)'})
                # (dx==0 and dy==0) означает что спец-юнит встает на клетку носителя, что запрещено общим правилом ниже

        own_ship_on_cell = next((s for s in my_ships
                                if s is not ship
                                and s.get('alive', True)
                                and s.get('x') == new_x and s.get('y') == new_y), None)
        if own_ship_on_cell:
            return jsonify({'ok': False, 'error': 'Нельзя ходить на занятую клетку (ваш корабль)'}), 400

        old_x, old_y = ship['x'], ship['y']
        dx_step = abs(new_x - old_x)
        dy_step = abs(new_y - old_y)
        is_special_orbit_unit = ship.get('type') in ('Т', 'С')
        distance = abs(new_x - old_x) + abs(new_y - old_y)

        if ship['type'] == 'ТК':
            if distance not in (1, 2):
                return jsonify({'ok': False, 'error': 'ТК может ходить на 1-2 клетки'})
        else:
            if is_special_orbit_unit:
                if max(dx_step, dy_step) != 1 or (dx_step == 0 and dy_step == 0):
                    return jsonify({'ok': False, 'error': 'Можно ходить только на 1 клетку'})
            else:
                if distance != 1:
                    return jsonify({'ok': False, 'error': 'Можно ходить только на 1 клетку'})

        if not is_special_orbit_unit:
            if not (new_x == old_x or new_y == old_y):
                return jsonify({'ok': False, 'error': 'Ход только по вертикали/горизонтали'})

        # Спец-юниты (торпеда/самолёт/мина) должны оставаться рядом с носителем (включая диагональ)
        if ship.get('type') in ('Т', 'С', 'М'):
            carrier_type_map = {'Т': 'ТК', 'С': 'А', 'М': 'ЭС'}
            carrier_type = carrier_type_map.get(ship.get('type'))
            if carrier_type:
                temp_ship = dict(ship)
                temp_ship['x'] = new_x
                temp_ship['y'] = new_y
                if not _is_near_carrier(battle_data, user_id, temp_ship, carrier_type):
                    return jsonify({'ok': False, 'error': 'Спец-юнит должен оставаться рядом с носителем (включая диагональ)'})
                
                # ДОПОЛНИТЕЛЬНОЕ ПРАВИЛО ДЛЯ ОРБИТАЛЬНЫХ ЮНИТОВ (Т/С/М):
                # Ход только на соседнюю позицию по кольцу 8 клеток вокруг носителя (без прыжков).
                if ship.get('type') in ('Т', 'С', 'М'):
                    carrier = next((s for s in my_ships
                                   if s.get('alive', True)
                                   and s.get('type') == carrier_type
                                   and max(abs(old_x - s.get('x')), abs(old_y - s.get('y'))) == 1), None)
                    if not carrier:
                        return jsonify({'ok': False, 'error': 'Носитель не найден рядом со спец-юнитом'})

                    ring = [
                        (-1, -1), (0, -1), (1, -1),
                        (1, 0),
                        (1, 1), (0, 1), (-1, 1),
                        (-1, 0)
                    ]

                    cur_dx = old_x - carrier.get('x')
                    cur_dy = old_y - carrier.get('y')
                    try:
                        cur_idx = ring.index((cur_dx, cur_dy))
                    except ValueError:
                        return jsonify({'ok': False, 'error': 'Спец-юнит должен находиться на кольце вокруг носителя'})

                    next_dx = new_x - carrier.get('x')
                    next_dy = new_y - carrier.get('y')
                    try:
                        next_idx = ring.index((next_dx, next_dy))
                    except ValueError:
                        return jsonify({'ok': False, 'error': 'Спец-юнит должен находиться на кольце вокруг носителя'})

                    left_idx = (cur_idx - 1) % 8
                    right_idx = (cur_idx + 1) % 8
                    if next_idx not in (left_idx, right_idx):
                        return jsonify({'ok': False, 'error': 'Прыжки по кольцу запрещены'})
                    
                    # 3. Проверка "строго впереди" (относительно стороны игрока)
                    # Торпеда может ходить по кругу вокруг ТК (все 8 клеток).
                    # Ограничение "строго впереди" удалено по просьбе пользователя.
                    pass

        ship['x'], ship['y'] = new_x, new_y

        opponent_id = get_opponent_id(game, user_id)
        opponent_ships = battle_data['positions'].get(str(opponent_id), [])
        enemy_ship = next((s for s in opponent_ships if s.get('alive', True) and s['x'] == new_x and s['y'] == new_y), None)

        if enemy_ship:
            # Возвращаем корабль назад - ход на клетку врага запрещен
            ship['x'], ship['y'] = old_x, old_y
            return jsonify({'ok': False, 'error': 'Нельзя ходить на клетку с врагом. Подойдите вплотную и используйте отдельное действие атаки.'})

        # АТОМНАЯ БОМБА (АБ): взрывается как обычная атака (выбор после хода)
        # Убрано автоматическое срабатывание при приближении.

        # Проверяем, есть ли враг в соседней клетке после хода (лицом к лицу)
        # Атака после хода разрешена ТОЛЬКО "вперед" относительно стороны игрока.
        # Player 1 (сверху): вперед = вниз (dy = 1)
        # Player 2 (снизу): вперед = вверх (dy = -1)
        adjacent_enemies = []
        
        is_p1 = (user_id == game.player1_id)
        forward_dy = 1 if is_p1 else -1

        for enemy in opponent_ships:
            if not enemy.get('alive', True):
                continue
            
            ex, ey = enemy['x'], enemy['y']
            dx = ex - new_x
            dy = ey - new_y
            
            # Враг должен быть вплотную (дистанция 1)
            if abs(dx) + abs(dy) == 1:
                # ПРОВЕРКА "В ЛОБ": Враг должен находиться СВЕРХУ или СНИЗУ в зависимости от игрока
                # Мы игнорируем вектор движения dx/dy и смотрим только на ориентацию поля
                if dy == forward_dy and dx == 0:
                    adjacent_enemies.append(enemy)
                else:
                    logger.debug(f"Enemy at ({ex},{ey}) ignored because it's side/back (player: {'P1' if is_p1 else 'P2'}, dy: {dy})")

        # Если есть соседние враги — даём возможность атаковать
        can_attack_adjacent = len(adjacent_enemies) > 0

        next_turn_player_id = opponent_id if not can_attack_adjacent else user_id
        next_status = 'TURN_P2' if next_turn_player_id == game.player2_id else 'TURN_P1'
        next_move_start_time = int(time.time())

        battle.current_turn_player_id = next_turn_player_id
        battle.move_start_time = next_move_start_time
        battle.status = next_status

        battle_data['current_turn'] = next_turn_player_id
        battle_data['status'] = next_status
        battle_data['move_start_time'] = next_move_start_time

        battle.positions = json.dumps(battle_data)
        battle.save()

        timer = GameTimer.get_or_none(GameTimer.game_id == game_id)
        if timer:
            timer.current_turn_player_id = next_turn_player_id
            timer.current_turn_start_time = next_move_start_time
            timer.save()

        return jsonify({
            'ok': True,
            'battle': battle_data,
            'can_attack_adjacent': can_attack_adjacent,
            'adjacent_enemies': [{'type': e['type'], 'x': e['x'], 'y': e['y']} for e in adjacent_enemies] if can_attack_adjacent else []
        })

    if 'attack' in data:
        attack_data = data['attack']
        attacker_ship_id = attack_data.get('attacker_ship_id')
        target_x, target_y = attack_data.get('x'), attack_data.get('y')

        if attacker_ship_id is None:
            return jsonify({'ok': False, 'error': 'Не указан атакующий корабль'})

        try:
            attacker_ship_id = int(attacker_ship_id)
        except Exception:
            return jsonify({'ok': False, 'error': 'Некорректный attacker_ship_id'})

        if target_x is None or target_y is None:
            return jsonify({'ok': False, 'error': 'Не указана цель атаки'})

        try:
            target_x = int(target_x)
            target_y = int(target_y)
        except Exception:
            return jsonify({'ok': False, 'error': 'Некорректные координаты цели'})
        opponent_id = get_opponent_id(game, user_id)
        opponent_ships = battle_data['positions'].get(str(opponent_id), [])

        target_ship = next((s for s in opponent_ships if s.get('alive', True) and s['x'] == target_x and s['y'] == target_y), None)

        if not target_ship:
            return jsonify({'ok': False, 'error': 'На цели нет фишки противника'})

        my_ships = battle_data['positions'].get(str(user_id), [])
        attacker = next((s for s in my_ships if s.get('alive', True) and s.get('id') == attacker_ship_id), None)
        if not attacker:
            return jsonify({'ok': False, 'error': 'Атакующий корабль не найден'})

        # Атака обычно только "лицом к лицу": цель должна быть в соседней клетке.
        # ОГРАНИЧЕНИЕ: Атаковать можно ТОЛЬКО ВПЕРЕД относительно стороны игрока.
        # Player 1 (сверху): вперед = вниз (target_y > ay)
        # Player 2 (снизу): вперед = вверх (target_y < ay)
        is_p1 = (user_id == game.player1_id)
        ax = attacker.get('x', -999)
        ay = attacker.get('y', -999)
        
        dx = target_x - ax
        dy = target_y - ay
        
        # Проверяем, что атака идет строго вперед (по вертикали в сторону противника)
        # Для P1: dy должно быть > 0 (вниз), dx должно быть 0
        # Для P2: dy должно быть < 0 (вверх), dx должно быть 0
        is_forward = False
        if is_p1:
            if dy > 0 and dx == 0:
                is_forward = True
        else:
            if dy < 0 and dx == 0:
                is_forward = True
                
        if not is_forward:
            return jsonify({'ok': False, 'error': 'Атаковать можно только вперед!'})

        dist = abs(dx) + abs(dy)

        if dist != 1:
            allow_dist2 = False
            if dist == 2 and (ax == target_x or ay == target_y):
                mid_x = ax if ax == target_x else int((ax + target_x) / 2)
                mid_y = ay if ay == target_y else int((ay + target_y) / 2)

                occupied = False
                for pid, ships in battle_data.get('positions', {}).items():
                    for s in ships:
                        if not s.get('alive', True):
                            continue
                        if s.get('x') == mid_x and s.get('y') == mid_y:
                            occupied = True
                            break
                    if occupied:
                        break

                allow_dist2 = not occupied

            if not allow_dist2:
                return jsonify({'ok': False, 'error': 'Атака возможна только лицом к лицу (соседняя клетка) или на 2 клетки по прямой при пустой промежуточной клетке'})

        attacker_type = attacker.get('type', 'unknown')
        defender_type = target_ship.get('type', 'unknown')

        # Если корабли объединены в группы — бой идёт силами групп (сумма сил)
        attacker_group_id = attacker.get('group_id')
        defender_group_id = target_ship.get('group_id')

        attacker_entities = [attacker]
        defender_entities = [target_ship]
        attacker_strength = get_ship_strength(attacker_type)
        defender_strength = get_ship_strength(defender_type)

        battle_result: Dict[str, Any] = {'defender_loses_turn': False}

        if attacker_group_id:
            attacker_entities = _get_group_ships(battle_data, user_id, attacker_group_id)
            attacker_strength = _compute_group_strength(attacker_entities)

        if defender_group_id:
            defender_entities = _get_group_ships(battle_data, opponent_id, defender_group_id)
            defender_strength = _compute_group_strength(defender_entities)

        # Группы не включают спец-типы, поэтому спец-правила применяем только когда обе стороны одиночные
        # (мины/торпеды/АБ/подлодки и т.п. не должны быть в группе).
        if len(attacker_entities) == 1 and len(defender_entities) == 1:
            defender_entities[0]['revealed'] = True
            attacker_entities[0]['revealed'] = True

            if defender_type == 'М' or attacker_type == 'М':
                # МИНА (М) — не атомная бомба.
                # Правило: при атаке мины любым кораблём кроме тральщика (ТР)
                # взрывается только атакующий корабль и мина.
                # Если мину атакует тральщик (ТР) — уничтожается только мина.
                if defender_type == 'М' and attacker_type == 'ТР':
                    defender_entities[0]['alive'] = False
                    battle_result = {
                        'attacker_destroyed': False,
                        'defender_destroyed': True,
                        'attacker_loses_turn': False,
                        'defender_loses_turn': False,
                    }
                else:
                    attacker_entities[0]['alive'] = False
                    defender_entities[0]['alive'] = False
                    battle_result = {
                        'attacker_destroyed': True,
                        'defender_destroyed': True,
                        'attacker_loses_turn': False,
                        'defender_loses_turn': False,
                    }
            else:
                battle_result = resolve_battle(attacker_type, defender_type)
                if battle_result.get('special_explosion'):
                    apply_ab_explosion(battle_data, target_x, target_y)
                else:
                    if battle_result.get('attacker_destroyed'):
                        attacker_entities[0]['alive'] = False
                    if battle_result.get('defender_destroyed'):
                        defender_entities[0]['alive'] = False
        else:
            # Групповой бой по правилу "Покера" делаем пошаговым процессом (онлайн):
            # создаём pending_combat и дальше стороны раскрывают силу через /battle/combat_action.
            a_ordered = attacker_entities
            d_ordered = defender_entities
            if attacker_group_id:
                a_ordered = _order_group_ships_for_poker(battle_data, attacker_group_id, attacker_entities)
            else:
                a_ordered = sorted(attacker_entities, key=lambda s: int(s.get('id', 0)))
            if defender_group_id:
                d_ordered = _order_group_ships_for_poker(battle_data, defender_group_id, defender_entities)
            else:
                d_ordered = sorted(defender_entities, key=lambda s: int(s.get('id', 0)))

            battle_data['pending_combat'] = {
                'attacker_player_id': user_id,
                'defender_player_id': opponent_id,
                'attacker_group_id': attacker_group_id,
                'defender_group_id': defender_group_id,
                'attacker_ship_ids': [s.get('id') for s in a_ordered if s.get('id') is not None],
                'defender_ship_ids': [s.get('id') for s in d_ordered if s.get('id') is not None],
                'attacker_revealed_n': 1,
                'defender_revealed_n': 0,
                'next_actor': 'defender',
                'target': {'x': target_x, 'y': target_y},
                'started_at': int(time.time()),
            }

            # Первую фишку атакующего раскрываем сразу
            if a_ordered:
                a_ordered[0]['revealed'] = True

            # Передаём текущий ход в битве защитнику
            battle.current_turn_player_id = opponent_id
            battle.status = 'TURN_P2' if opponent_id == game.player2_id else 'TURN_P1'
            battle_data['current_turn'] = opponent_id
            battle_data['status'] = battle.status

            # Сбрасываем таймер хода при начале группового боя
            battle_data['move_timer'] = 30
            battle.move_start_time = int(time.time())

            battle.positions = json.dumps(battle_data)
            battle.save()
            return jsonify({'ok': True, 'battle': battle_data, 'pending_combat': battle_data.get('pending_combat')})

        winner_id = check_victory(battle_data, game)
        if winner_id is not None:
            battle.status = 'finished'
            game.status = 'finished'
            game.save()
            battle_data['status'] = 'finished'
            battle_data['winner_id'] = winner_id
            battle.positions = json.dumps(battle_data)
            battle.save()
            return jsonify({'ok': True, 'victory': winner_id != -1, 'draw': winner_id == -1, 'winner_id': winner_id, 'battle': battle_data})

        if not battle_result.get('defender_loses_turn', False):
            battle.current_turn_player_id = opponent_id
        battle.move_start_time = int(time.time())
        battle.status = 'TURN_P2' if battle.current_turn_player_id == game.player2_id else 'TURN_P1'
        battle_data['move_timer'] = 30  # Сбрасываем таймер хода
        battle.positions = json.dumps(battle_data)
        battle.save()

        timer = GameTimer.get_or_none(GameTimer.game_id == game_id)
        if timer:
            timer.current_turn_player_id = battle.current_turn_player_id
            timer.current_turn_start_time = battle.move_start_time
            timer.save()

        return jsonify({'ok': True, 'battle': battle_data})

    return jsonify({'ok': False, 'error': 'Неверный запрос'})


@app.route('/test/generate_ships/<zone>')
def test_generate_ships(zone: str) -> Any:
    if zone not in ['top', 'bottom']:
        return jsonify({'error': 'Неверная зона. Используйте "top" или "bottom"'}), 400
    try:
        ships = generate_battleship_field(zone)
        return jsonify(ships)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _require_autotest_token() -> Optional[Any]:
    token = os.environ.get('AUTOTEST_TOKEN')
    if not token:
        return jsonify({'ok': False, 'error': 'AUTOTEST_TOKEN не задан на сервере'}), 403

    provided = request.headers.get('X-Autotest-Token')
    if not provided or provided != token:
        return jsonify({'ok': False, 'error': 'Недостаточно прав (autotest token)'}), 403
    return None


@app.route('/test/autotest/set_battle_state/<int:game_id>', methods=['POST'])
def autotest_set_battle_state(game_id: int) -> Any:
    deny = _require_autotest_token()
    if deny is not None:
        return deny

    game = Game.get_or_none(Game.id == game_id)
    if not game or not game.player1_id or not game.player2_id:
        return jsonify({'ok': False, 'error': 'Игра не найдена или нет двух игроков'})

    battle = BattleState.get_or_none(BattleState.game_id == game_id)
    if not battle:
        init_battle_state(game_id, game.player1_id, game.player2_id)
        battle = BattleState.get_or_none(BattleState.game_id == game_id)
        if not battle:
            return jsonify({'ok': False, 'error': 'Не удалось инициализировать бой'})

    data = request.get_json() or {}
    p1_ships = data.get('p1_ships')
    p2_ships = data.get('p2_ships')
    current_turn = data.get('current_turn')

    if not isinstance(p1_ships, list) or not isinstance(p2_ships, list):
        return jsonify({'ok': False, 'error': 'Нужны p1_ships и p2_ships (списки кораблей)'}), 400

    try:
        battle_data = json.loads(battle.positions)
    except Exception:
        battle_data = {}

    now = int(time.time())
    battle_data['positions'] = {
        str(game.player1_id): p1_ships,
        str(game.player2_id): p2_ships,
    }
    battle_data['pending_combat'] = None
    battle_data.pop('pending_combat', None)

    # минимальные поля для корректной работы фронта/таймеров
    battle_data['current_turn'] = int(current_turn) if current_turn else (battle.current_turn_player_id or game.player1_id)
    battle_data['status'] = 'TURN_P1' if battle_data['current_turn'] == game.player1_id else 'TURN_P2'
    battle_data['move_start_time'] = now
    battle_data.setdefault('pauses_p1', {'long': 1, 'short': 1})
    battle_data.setdefault('pauses_p2', {'long': 1, 'short': 1})
    battle_data.setdefault('killed_ships_p1', {})
    battle_data.setdefault('killed_ships_p2', {})
    battle_data.setdefault('groups', {})

    battle.current_turn_player_id = battle_data['current_turn']
    battle.status = battle_data['status']
    battle.move_start_time = now
    battle.positions = json.dumps(battle_data)
    battle.save()

    timer = GameTimer.get_or_none(GameTimer.game_id == game_id)
    if timer:
        timer.game_phase = 'battle'
        timer.current_turn_player_id = battle.current_turn_player_id
        timer.current_turn_start_time = now
        timer.save()

    return jsonify({'ok': True, 'battle': battle_data})


@app.route('/test/autotest/force_turn/<int:game_id>', methods=['POST'])
def autotest_force_turn(game_id: int) -> Any:
    deny = _require_autotest_token()
    if deny is not None:
        return deny

    game = Game.get_or_none(Game.id == game_id)
    if not game:
        return jsonify({'ok': False, 'error': 'Игра не найдена'})
    battle = BattleState.get_or_none(BattleState.game_id == game_id)
    if not battle:
        return jsonify({'ok': False, 'error': 'Бой не найден'})

    data = request.get_json() or {}
    player_id = data.get('player_id')
    if not player_id:
        return jsonify({'ok': False, 'error': 'Нужен player_id'})
    try:
        player_id = int(player_id)
    except Exception:
        return jsonify({'ok': False, 'error': 'Некорректный player_id'})

    if player_id not in (game.player1_id, game.player2_id):
        return jsonify({'ok': False, 'error': 'player_id не участник игры'})

    now = int(time.time())
    try:
        battle_data = json.loads(battle.positions)
    except Exception:
        battle_data = {}

    battle.current_turn_player_id = player_id
    battle.move_start_time = now
    battle.status = 'TURN_P1' if player_id == game.player1_id else 'TURN_P2'
    battle.save()

    battle_data['current_turn'] = player_id
    battle_data['status'] = battle.status
    battle_data['move_start_time'] = now
    battle.positions = json.dumps(battle_data)
    battle.save()

    timer = GameTimer.get_or_none(GameTimer.game_id == game_id)
    if timer:
        timer.game_phase = 'battle'
        timer.current_turn_player_id = player_id
        timer.current_turn_start_time = now
        timer.save()

    return jsonify({'ok': True, 'battle': battle_data})


# =============================================================================
# СТАТИЧЕСКИЕ ФАЙЛЫ (продакшн)
# =============================================================================

FRONTEND_DIST = os.path.join(os.path.dirname(__file__), 'frontend', 'dist')

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    if path and os.path.exists(os.path.join(FRONTEND_DIST, path)):
        return send_from_directory(FRONTEND_DIST, path)
    return send_from_directory(FRONTEND_DIST, 'index.html')


# =============================================================================
# ЗАПУСК ПРИЛОЖЕНИЯ
# =============================================================================

if __name__ == '__main__':
    init_db()
    app.run(debug=False, host='127.0.0.1', port=8000)