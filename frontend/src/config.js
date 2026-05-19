// Конфигурация API
// - В dev можно задать VITE_API_URL (например http://localhost:5001)
// - В prod по умолчанию используем относительный путь (""), чтобы работало через reverse-proxy на том же домене
export const API_BASE_URL = import.meta?.env?.VITE_API_URL ?? '';

// API endpoints
export const API_ENDPOINTS = {
    LOGIN: '/login',
    REGISTER: '/register',
    LOGOUT: '/logout',
    MENU: '/menu',
    STATS: '/stats',
    FIND_RANDOM: '/find_random',
    START_SEARCH: '/start_search',
    STOP_SEARCH: '/stop_search',
    ONLINE_PLAYERS: '/online_players',
    HEARTBEAT: '/heartbeat',
    PING: '/ping',
    CHECK_GAME: '/check_game',
    PLAY_FRIEND: '/play_friend',
    GAME_INVITE: '/api/game',
    CHECK_OPPONENT: '/check_opponent',
    LEAVE_GAME: '/leave_game',
    SETUP_DONE: '/setup_done',
    CHECK_SETUP_DONE: '/check_setup_done',
    SAVE_SHIPS: '/save_ships',
    AUTO_SETUP: '/auto_setup',
    BATTLE_STATE: '/battle/state',
    BATTLE_MOVE: '/battle/move',
    BATTLE_CREATE_GROUP: '/battle/create_group',
    BATTLE_DISBAND_GROUP: '/battle/disband_group',
    LOBBY: '/lobby',
    CREATE_PRIVATE_ROOM: '/create_private_room',
    NOTIFY_OPPONENT_JOINED: '/notify_opponent_joined',
    CHAT_SEND: '/chat/send',
    CHAT_MESSAGES: '/chat/messages',
    // Новые эндпоинты для поиска игроков и приглашений
    SEARCH_START: '/search/start',
    SEARCH_STOP: '/search/stop',
    SEARCH_PLAYERS: '/search/players',
    INVITE_SEND: '/invite/send',
    INVITE_CHECK: '/invite/check',
    INVITE_ACCEPT: '/invite/accept',
    INVITE_DECLINE: '/invite/decline',
    // Эндпоинты для таймеров и пауз
    TIMER_STATUS: '/timer/status',
    PAUSE_START: '/pause/start',
    PAUSE_END: '/pause/end',
    PAUSE_STATUS: '/pause/status'
};

// Функция для создания полного URL
export const getApiUrl = (endpoint) => {
  return `${API_BASE_URL}${endpoint}`;
};

// Функция для проверки статуса сервера
export const checkServerStatus = async () => {
  try {
    const response = await fetch('/');
    return response.ok;
  } catch (error) {
    console.error('Ошибка подключения к серверу:', error);
    return false;
  }
};

// Функция для логирования API запросов
export const logApiRequest = (url, method, data = null) => {
  console.log(`🌐 API Request: ${method} ${url}`, data);
};

// Функция для логирования API ответов
export const logApiResponse = (url, status, data = null) => {
  console.log(`📡 API Response: ${status} ${url}`, data);
};

// Функция для создания fetch запроса с credentials
export const createApiRequest = (url, options = {}) => {
  return {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  };
}; 