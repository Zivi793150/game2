import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Users, UserPlus, Copy, ArrowLeft, RefreshCw } from 'lucide-react'
import { getApiUrl, API_ENDPOINTS } from '../config'

const Lobby = ({ onNavigate }) => {
  const [lobbyData, setLobbyData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedCode, setCopiedCode] = useState('')
  const [createdRoom, setCreatedRoom] = useState(null)

  const fetchLobbyData = async () => {
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.LOBBY), {
        credentials: 'include'
      })
      let data = null
      try {
        data = await response.json()
      } catch (e) {
        data = null
      }
      
      if (data && data.ok) {
        setLobbyData(data)
      } else {
        const msg = (data && data.error) ? data.error : 'Ошибка загрузки лобби'
        setError(msg)
      }
    } catch (err) {
      setError('Ошибка соединения с сервером')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLobbyData()
    const interval = setInterval(fetchLobbyData, 5000) // Обновляем каждые 5 секунд
    return () => clearInterval(interval)
  }, [])

  // Очищаем созданную комнату при обновлении данных лобби
  useEffect(() => {
    if (lobbyData && createdRoom) {
      // Проверяем, есть ли наша комната в списке приватных комнат
      const roomStillExists = lobbyData.private_rooms?.some(room => room.game_id === createdRoom.game_id)
      if (!roomStillExists) {
        setCreatedRoom(null)
      }
    }
  }, [lobbyData, createdRoom])

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    setCopiedCode(text)
    setTimeout(() => setCopiedCode(''), 2000)
  }

  const createPrivateRoom = async () => {
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
        setCreatedRoom({
          game_id: data.game_id,
          invite_code: data.invite_code,
          invite_link: data.invite_link
        })
        // Автоматически копируем ссылку в буфер обмена
        copyToClipboard(data.invite_link)
      } else {
        const msg = (data && data.error) ? data.error : 'Ошибка создания комнаты'
        setError(msg)
      }
    } catch (err) {
      setError('Ошибка соединения с сервером')
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
          <RefreshCw className="w-8 h-8 animate-spin text-white mx-auto mb-4" />
          <p className="text-white">Загрузка лобби...</p>
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
      <div className="max-w-6xl mx-auto">
        {/* Заголовок */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-4">Лобби</h1>
          <p className="text-blue-200">Найдите противника или создайте приватную комнату</p>
        </div>

        {/* Кнопки действий */}
        <div className="flex justify-center gap-4 mb-8">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onNavigate('mainMenu')}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Назад в меню
          </motion.button>
          
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={createPrivateRoom}
            className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
          >
            <UserPlus className="w-5 h-5" />
            Создать приватную комнату
          </motion.button>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-600 text-white p-4 rounded-lg mb-6 text-center"
          >
            {error}
          </motion.div>
        )}

        {copiedCode && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-600 text-white p-4 rounded-lg mb-6 text-center"
          >
            Ссылка скопирована в буфер обмена!
          </motion.div>
        )}

        {createdRoom && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-blue-600 text-white p-6 rounded-lg mb-6"
          >
            <h3 className="text-xl font-bold mb-3 text-center">Комната создана!</h3>
            <div className="text-center space-y-2">
              <p className="text-lg">
                <span className="font-semibold">Номер комнаты:</span> {createdRoom.invite_code}
              </p>
              <p className="text-sm text-blue-200">
                Отправьте этот номер другу для присоединения к игре
              </p>
              <div className="flex justify-center gap-4 mt-4">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => copyToClipboard(createdRoom.invite_link)}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors"
                >
                  <Copy className="w-4 h-4 inline mr-2" />
                  Скопировать ссылку
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => window.location.href = `/game/${createdRoom.invite_code}`}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
                >
                  Перейти в комнату
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        <div className="grid md:grid-cols-2 gap-8">
          {/* Игроки в очереди */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white/10 backdrop-blur-sm rounded-lg p-6"
          >
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <Users className="w-6 h-6" />
              Игроки в очереди ({lobbyData?.players_in_queue?.length || 0})
            </h2>
            
            {lobbyData?.players_in_queue?.length > 0 ? (
              <div className="space-y-3">
                {lobbyData.players_in_queue.map((player, index) => (
                  <motion.div
                    key={player.user_id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="bg-white/20 rounded-lg p-4 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-white font-semibold">{player.nickname}</p>
                      <p className="text-blue-200 text-sm">
                        Ожидает: {new Date(player.waiting_since).toLocaleTimeString()}
                      </p>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => onNavigate('findRandom')}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                      Играть
                    </motion.button>
                  </motion.div>
                ))}
              </div>
            ) : (
              <p className="text-blue-200 text-center py-8">Нет игроков в очереди</p>
            )}
          </motion.div>

          {/* Приватные комнаты */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white/10 backdrop-blur-sm rounded-lg p-6"
          >
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <UserPlus className="w-6 h-6" />
              Приватные комнаты ({lobbyData?.private_rooms?.length || 0})
            </h2>
            
            {lobbyData?.private_rooms?.length > 0 ? (
              <div className="space-y-3">
                {lobbyData.private_rooms.map((room, index) => (
                  <motion.div
                    key={room.game_id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="bg-white/20 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-white font-semibold">{room.creator_nickname}</p>
                        <p className="text-blue-200 text-sm">
                          Код: {room.invite_code}
                        </p>
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => copyToClipboard(room.invite_link || `http://127.0.0.1:4466/game/${room.invite_code}`)}
                        className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                        title="Скопировать ссылку"
                      >
                        <Copy className="w-4 h-4" />
                      </motion.button>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => window.location.href = `/game/${room.invite_code}`}
                      className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
                    >
                      Присоединиться
                    </motion.button>
                  </motion.div>
                ))}
              </div>
            ) : (
              <p className="text-blue-200 text-center py-8">Нет активных приватных комнат</p>
            )}
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}

export default Lobby 