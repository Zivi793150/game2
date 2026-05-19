import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: After torpedo shot (around line 2730)
pattern1 = r"(battle\.current_turn_player_id = next_turn_player_id\n        battle\.move_start_time = next_move_start_time\n        battle\.status = next_status\n\n)(        timer = GameTimer\.get_or_none\(GameTimer\.game_id == game_id\))"
replacement1 = r"\1        battle_data['move_timer'] = 30  # Сбрасываем таймер хода\n\n\2"
content = re.sub(pattern1, replacement1, content, count=1)
print('Fixed torpedo shot timer')

# Fix 2: After air attack (around line 2917)
pattern2 = r"(battle\.current_turn_player_id = next_turn_player_id\n        battle\.move_start_time = next_move_start_time\n        battle\.status = next_status\n        battle_data\['current_turn'\] = next_turn_player_id\n\n)(        timer = GameTimer\.get_or_none\(GameTimer\.game_id == game_id\))"
replacement2 = r"\1        battle_data['move_timer'] = 30  # Сбрасываем таймер хода\n\n\2"
content = re.sub(pattern2, replacement2, content, count=1)
print('Fixed air attack timer')

# Fix 3: After torpedo direction (around line 3029)
pattern3 = r"(battle\.current_turn_player_id = next_turn_player_id\n        battle\.move_start_time = next_move_start_time\n        battle\.status = next_status\n        battle_data\['current_turn'\] = next_turn_player_id\n\n)(        timer = GameTimer\.get_or_none\(GameTimer\.game_id == game_id\))"
replacement3 = r"\1        battle_data['move_timer'] = 30  # Сбрасываем таймер хода\n\n\2"
content = re.sub(pattern3, replacement3, content, count=1)
print('Fixed torpedo direction timer')

# Fix 4: After regular move (around line 3228)
pattern4 = r"(battle\.current_turn_player_id = next_turn_player_id\n        battle\.move_start_time = next_move_start_time\n        battle\.status = next_status\n\n)(        timer = GameTimer\.get_or_none\(GameTimer\.game_id == game_id\))"
replacement4 = r"\1        battle_data['move_timer'] = 30  # Сбрасываем таймер хода\n\n\2"
content = re.sub(pattern4, replacement4, content, count=1)
print('Fixed regular move timer')

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)

print('All timer fixes applied successfully')
