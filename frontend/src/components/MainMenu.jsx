import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Trophy, Users, UserPlus, Settings, LogOut, Gamepad2, Search, Play, Square, Wifi } from 'lucide-react'
import { getApiUrl, API_ENDPOINTS } from '../config'

const MainMenu = ({ onNavigate, onLogout }) => {
  const [userData, setUserData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [gameId, setGameId] = useState(null)
  const [inviteCode, setInviteCode] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [onlinePlayers, setOnlinePlayers] = useState([])
  const [showPlayersList, setShowPlayersList] = useState(false)

  useEffect(() => {
    fetchUserData()

    // Регулярно обновляем список онлайн игроков (каждую минуту)
    const playersInterval = setInterval(fetchOnlinePlayers, 60000) // 1 минута
    fetchOnlinePlayers()

    // Отправляем heartbeat каждые 30 секунд для поддержания онлайн статуса
    const heartbeatInterval = setInterval(sendHeartbeat, 30000) // 30 секунд

    return () => {
      clearInterval(playersInterval)
      clearInterval(heartbeatInterval)
    }
  }, [])

  const fetchUserData = async () => {
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.MENU), {
        credentials: 'include'
      })
      const data = await response.json()

      if (data.ok) {
        setUserData(data)
      } else {
        setError(data.error || 'Ошибка загрузки данных')
      }
    } catch (err) {
      setError('Ошибка соединения с сервером')
    } finally {
      setLoading(false)
    }
  }

  const sendHeartbeat = async () => {
    try {
      const startTime = Date.now()
      const response = await fetch(getApiUrl(API_ENDPOINTS.HEARTBEAT), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (response.ok) {
        const data = await response.json()
        const pingTime = Date.now() - startTime
        console.log(`💓 Heartbeat успешен: ${data.nickname} (ping: ${pingTime}ms)`)
      } else {
        console.warn('❌ Heartbeat failed:', response.status)
      }
    } catch (err) {
      console.warn('💥 Ошибка heartbeat:', err)
      // При ошибке попробуем простой ping
      try {
        await fetch(getApiUrl(API_ENDPOINTS.PING))
        console.log('🏓 Сервер доступен через ping')
      } catch (pingErr) {
        console.error('🔴 Сервер недоступен:', pingErr)
      }
    }
  }

  const fetchOnlinePlayers = async () => {
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.ONLINE_PLAYERS), {
        credentials: 'include'
      })
      const data = await response.json()

      if (data.ok) {
        setOnlinePlayers(data.players || [])
        console.log(`🟢 Обновлен список онлайн игроков: ${data.players?.length || 0} игроков`)
        console.log('📋 Список игроков:', data.players?.map(p => `${p.nickname}(${p.user_id})`) || [])
      } else {
        console.error('❌ Ошибка получения списка игроков:', data.error)
      }
    } catch (err) {
      console.error('💥 Ошибка сети при получении списка игроков:', err)
    }
  };

  let timerRandom = null;

  const handleStartSearch = async () => {
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.START_SEARCH), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      })
      const data = await response.json()

      if (data.ok) {
        setIsSearching(true);
        setError('');
        setInfo('')

        // Начинаем искать игру
        if (!!timerRandom) clearInterval(timerRandom);
        timerRandom = setInterval(() => {
          handleFindRandom(true);
        }, 3000);
      } else {
        setError(data.error || 'Ошибка запуска поиска');
        setInfo('')
      }
    } catch (err) {
      setIsSearching(false);
      setError('Ошибка соединения с сервером');
      setInfo('')

      console.error("Ошибка соединения с сервером", err);
    }
  }

  const handleStopSearch = async () => {
    try {
      if (!!timerRandom) clearInterval(timerRandom);

      const response = await fetch(getApiUrl(API_ENDPOINTS.STOP_SEARCH), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      })
      const data = await response.json()

      if (data.ok) {
        setIsSearching(false)
        setError('')
        setInfo('')
      }
    } catch (err) {
      setError('Ошибка соединения с сервером')
      setInfo('')
    }
  }

  const handleFindRandom = async (isSearchingNew = false) => {
    if (!isSearching && !isSearchingNew) {
      setIsSearching(false);

      return;
    }

    try {
      console.log('🔍 Начинаем поиск случайного игрока...')
      const response = await fetch(getApiUrl(API_ENDPOINTS.FIND_RANDOM), {
        method: 'GET',
        credentials: 'include'
      })
      const data = await response.json()

      console.log('📡 Ответ поиска:', data)

      if (data.ok) {
        if (data.game_id) {
          if (!!timerRandom) clearInterval(timerRandom);

          console.log(`✅ Найдена игра ${data.game_id} с соперником ${data.opponent || 'неизвестен'}`)
          setGameId(data.game_id)
          setIsSearching(false)
          setError('')
          setInfo('')
          onNavigate('gameRoom', data.game_id)
        } else if (data.waiting) {
          console.log('⏳ Нет доступных соперников, ждем...')

          setInterval(() => {
            if (isSearching) handleFindRandom()
          }, 3000);
        }
      } else {
        console.error('❌ Ошибка поиска игры:', data.error)
        setError(data.error || 'Ошибка поиска игры')
        setInfo('')
        setIsSearching(false)
      }
    } catch (err) {
      console.error('💥 Ошибка сети при поиске игры:', err)
      setError('Ошибка соединения с сервером')
      setInfo('')
      setIsSearching(false)
    }
  }

  const handleCreateGame = async () => {
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.CREATE_PRIVATE_ROOM), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      })
      let data = null
      try {
        data = await response.json()
      } catch (e) {
        data = null
      }

      if (data && data.ok) {
        setGameId(data.game_id)
        setInviteCode(data.invite_code)
        setError('')

        // Копируем ссылку в буфер обмена
        const currentPort = window.location.port || '80'
        const baseUrl = `${window.location.protocol}//${window.location.hostname}:${currentPort}`
        const inviteLink = `${baseUrl}/game/${data.invite_code}`
        console.log('🔗 Сгенерирована ссылка приглашения:', inviteLink)
        try {
          await navigator.clipboard.writeText(inviteLink)
          setInfo(`Ссылка скопирована! Комната: ${data.invite_code}`)
        } catch (clipboardErr) {
          setInfo(`Комната создана: ${data.invite_code}. Ссылка: ${inviteLink}`)
        }

        // Автоматически переходим в комнату расстановки
        setTimeout(() => {
          onNavigate('gameRoom', {
            game_id: data.game_id,
            invite_code: data.invite_code,
            role: 'creator'
          })
        }, 2000)
      } else {
        setInfo('')
        setError((data && data.error) ? data.error : 'Ошибка создания игры')
      }
    } catch (err) {
      setInfo('')
      setError('Ошибка соединения с сервером')
    }
  }

  const handleJoinGame = async () => {
    if (!inviteCode.trim()) {
      setError('Введите код приглашения')
      return
    }

    try {
      const response = await fetch(getApiUrl(`${API_ENDPOINTS.GAME_INVITE}/${inviteCode}`), {
        method: 'GET',
        credentials: 'include'
      })
      const data = await response.json()

      if (data.ok) {
        setGameId(data.game_id)
        setError('')
        setInfo('')
        // Автоматически переходим в комнату расстановки
        onNavigate('gameRoom', {
          game_id: data.game_id,
          invite_code: inviteCode,
          role: data.role || 'joiner'
        })
      } else {
        setError(data.error || 'Ошибка присоединения к игре')
        setInfo('')
      }
    } catch (err) {
      setError('Ошибка соединения с сервером')
      setInfo('')
    }
  }

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center"
      >
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white">Загрузка...</p>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 p-6"
    >
      <div className="max-w-4xl mx-auto">
        {/* Заголовок */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-4">Морской Бой</h1>
          {userData && (
            <div className="flex items-center justify-center gap-2 text-blue-200">
              <User className="w-5 h-5" />
              <span>Добро пожаловать, {userData.nickname}!</span>
            </div>
          )}
        </div>

        {info && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-600 text-white p-4 rounded-lg mb-6 text-center"
          >
            {info}
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-600 text-white p-4 rounded-lg mb-6 text-center"
          >
            {error}
          </motion.div>
        )}

        {/* Основные кнопки */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={isSearching ? handleStopSearch : handleStartSearch}
            className={`flex items-center justify-center gap-3 p-6 text-white rounded-lg font-semibold text-lg transition-colors ${isSearching
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-blue-600 hover:bg-blue-700'
              }`}
          >
            {isSearching ? <Square className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            {isSearching ? 'Остановить поиск' : 'Найти случайного противника'}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              window.history.pushState({}, '', '/dual')
              window.location.reload()
            }}
            className="flex items-center justify-center gap-3 p-6 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold text-lg transition-colors"
          >
            <Users className="w-6 h-6" />
            Dual Local Test
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowPlayersList(!showPlayersList)}
            className="flex items-center justify-center gap-3 p-6 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-lg transition-colors"
          >
            <Wifi className="w-6 h-6" />
            Список игроков ({onlinePlayers.length})
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onNavigate('lobby')}
            className="flex items-center justify-center gap-3 p-6 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold text-lg transition-colors"
          >
            <Gamepad2 className="w-6 h-6" />
            Лобби
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleCreateGame}
            className="flex items-center justify-center gap-3 p-6 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-semibold text-lg transition-colors"
          >
            <UserPlus className="w-6 h-6" />
            Создать игру с другом
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onNavigate('stats')}
            className="flex items-center justify-center gap-3 p-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-lg transition-colors"
          >
            <Trophy className="w-6 h-6" />
            Статистика
          </motion.button>
        </div>

        {/* Присоединиться к игре */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/10 backdrop-blur-sm rounded-lg p-6 mb-8"
        >
          <h3 className="text-xl font-semibold text-white mb-4">Присоединиться к игре</h3>
          <div className="flex gap-4">
            <input
              type="text"
              placeholder="Введите код приглашения"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="flex-1 px-4 py-2 bg-white/20 text-white placeholder-blue-200 rounded-lg border border-white/20 focus:outline-none focus:border-blue-400"
            />
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleJoinGame}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
            >
              Присоединиться
            </motion.button>
          </div>
        </motion.div>

        {/* Список онлайн игроков */}
        <AnimatePresence>
          {showPlayersList && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 bg-gray-800 rounded-lg p-6"
            >
              <h3 className="text-white text-xl font-semibold mb-4 flex items-center gap-2">
                <Wifi className="w-5 h-5" />
                Онлайн игроки ({onlinePlayers.length})
              </h3>

              {onlinePlayers.length === 0 ? (
                <p className="text-gray-400 text-center">Нет игроков онлайн</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {onlinePlayers.map((player) => (
                    <div
                      key={player.user_id}
                      className="flex items-center justify-between p-3 bg-gray-700 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                        <div>
                          <div className="text-white font-medium">{player.nickname}</div>
                          {player.current_game && (
                            <div className="text-xs text-blue-400">
                              Комната: {player.current_game.invite_code || 'ID:' + player.current_game.game_id}
                              ({player.current_game.status === 'waiting' ? 'ожидание' : 'игра'})
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {player.is_searching && (
                          <span className="px-2 py-1 bg-blue-600 text-white text-xs rounded-full">
                            В поиске
                          </span>
                        )}
                        {player.current_game && player.current_game.status === 'waiting' && player.current_game.invite_code && (
                          <button
                            onClick={() => {
                              setInviteCode(player.current_game.invite_code)
                              console.log(`📋 Скопирован код комнаты: ${player.current_game.invite_code}`)
                            }}
                            className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded-full transition-colors"
                          >
                            Присоединиться
                          </button>
                        )}
                        <span className="text-gray-400 text-xs">
                          {new Date(player.last_activity).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Дополнительные опции */}
        <div className="flex justify-center gap-4">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onNavigate('settings')}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
          >
            <Settings className="w-4 h-4" />
            Настройки
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onLogout}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Выйти
          </motion.button>
        </div>
      </div>
    </motion.div>
  )
}

export default MainMenu 