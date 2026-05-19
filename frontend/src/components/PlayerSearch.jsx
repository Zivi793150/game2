import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Users, UserPlus, X, Check, XCircle, Clock, User } from 'lucide-react'
import { getApiUrl, API_ENDPOINTS } from '../config'

const PlayerSearch = ({ onNavigate, onBack }) => {
  const [isSearching, setIsSearching] = useState(false)
  const [players, setPlayers] = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    // Проверяем входящие приглашения при загрузке
    checkInvites()
    
    // Если пользователь уже в поиске, показываем это
    checkSearchStatus()
  }, [])

  useEffect(() => {
    let interval
    if (isSearching) {
      // Обновляем список игроков каждые 3 секунды
      interval = setInterval(() => {
        fetchPlayers()
        checkInvites()
      }, 3000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isSearching])

  const checkSearchStatus = async () => {
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.SEARCH_PLAYERS), {
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok) {
        // Если пользователь в списке поиска, значит он уже ищет
        const currentUser = data.players.find(p => p.is_current)
        if (currentUser) {
          setIsSearching(true)
        }
      }
    } catch (err) {
      console.error('Ошибка проверки статуса поиска:', err)
    }
  }

  const startSearch = async () => {
    setLoading(true)
    setError('')
    
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.SEARCH_START), {
        method: 'POST',
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok) {
        setIsSearching(true)
        setSuccess('Поиск игроков начат')
        fetchPlayers()
      } else {
        setError(data.error || 'Ошибка начала поиска')
      }
    } catch (err) {
      setError('Ошибка соединения с сервером')
    } finally {
      setLoading(false)
    }
  }

  const stopSearch = async () => {
    setLoading(true)
    setError('')
    
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.SEARCH_STOP), {
        method: 'POST',
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok) {
        setIsSearching(false)
        setPlayers([])
        setSuccess('Поиск остановлен')
      } else {
        setError(data.error || 'Ошибка остановки поиска')
      }
    } catch (err) {
      setError('Ошибка соединения с сервером')
    } finally {
      setLoading(false)
    }
  }

  const fetchPlayers = async () => {
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.SEARCH_PLAYERS), {
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok) {
        setPlayers(data.players || [])
      }
    } catch (err) {
      console.error('Ошибка получения списка игроков:', err)
    }
  }

  const checkInvites = async () => {
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.INVITE_CHECK), {
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok) {
        setInvites(data.invites || [])
      }
    } catch (err) {
      console.error('Ошибка проверки приглашений:', err)
    }
  }

  const sendInvite = async (toUserId) => {
    setLoading(true)
    setError('')
    
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.INVITE_SEND), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ to_user_id: toUserId })
      })
      const data = await response.json()
      
      if (data.ok) {
        setSuccess('Приглашение отправлено!')
        // Останавливаем поиск и переходим в игру
        setIsSearching(false)
        onNavigate('gameRoom', data.game_id)
      } else {
        setError(data.error || 'Ошибка отправки приглашения')
      }
    } catch (err) {
      setError('Ошибка соединения с сервером')
    } finally {
      setLoading(false)
    }
  }

  const acceptInvite = async (inviteId) => {
    setLoading(true)
    setError('')
    
    try {
      const response = await fetch(getApiUrl(`${API_ENDPOINTS.INVITE_ACCEPT}/${inviteId}`), {
        method: 'POST',
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok) {
        setSuccess('Приглашение принято!')
        setInvites(invites.filter(invite => invite.invite_id !== inviteId))
        // Переходим в игру
        onNavigate('gameRoom', data.game_id)
      } else {
        setError(data.error || 'Ошибка принятия приглашения')
      }
    } catch (err) {
      setError('Ошибка соединения с сервером')
    } finally {
      setLoading(false)
    }
  }

  const declineInvite = async (inviteId) => {
    setLoading(true)
    setError('')
    
    try {
      const response = await fetch(getApiUrl(`${API_ENDPOINTS.INVITE_DECLINE}/${inviteId}`), {
        method: 'POST',
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok) {
        setSuccess('Приглашение отклонено')
        setInvites(invites.filter(invite => invite.invite_id !== inviteId))
      } else {
        setError(data.error || 'Ошибка отклонения приглашения')
      }
    } catch (err) {
      setError('Ошибка соединения с сервером')
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (timestamp) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = Math.floor((now - date) / 1000)
    
    if (diff < 60) return `${diff}с назад`
    if (diff < 3600) return `${Math.floor(diff / 60)}м назад`
    return `${Math.floor(diff / 3600)}ч назад`
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 p-6"
    >
      <div className="max-w-4xl mx-auto">
        {/* Заголовок */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Search className="w-8 h-8" />
            Поиск игроков
          </h1>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
            Назад
          </motion.button>
        </div>

        {/* Уведомления */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-red-600 text-white p-4 rounded-lg mb-6 text-center"
            >
              {error}
            </motion.div>
          )}
          {success && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-green-600 text-white p-4 rounded-lg mb-6 text-center"
            >
              {success}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Входящие приглашения */}
        {invites.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-yellow-600/20 backdrop-blur-sm rounded-lg p-6 mb-8"
          >
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Входящие приглашения
            </h2>
            <div className="space-y-3">
              {invites.map((invite) => (
                <motion.div
                  key={invite.invite_id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white/10 rounded-lg p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <User className="w-5 h-5 text-blue-300" />
                    <div>
                      <p className="text-white font-medium">
                        {invite.from_nickname} приглашает вас в игру
                      </p>
                      <p className="text-blue-200 text-sm">
                        {formatTime(invite.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => acceptInvite(invite.invite_id)}
                      disabled={loading}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" />
                      Принять
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => declineInvite(invite.invite_id)}
                      disabled={loading}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      Отклонить
                    </motion.button>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Кнопка поиска */}
        <div className="text-center mb-8">
          {!isSearching ? (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={startSearch}
              disabled={loading}
              className="flex items-center justify-center gap-3 px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-lg transition-colors disabled:opacity-50 mx-auto"
            >
              <Search className="w-6 h-6" />
              Начать поиск игроков
            </motion.button>
          ) : (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={stopSearch}
              disabled={loading}
              className="flex items-center justify-center gap-3 px-8 py-4 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-lg transition-colors disabled:opacity-50 mx-auto"
            >
              <X className="w-6 h-6" />
              Остановить поиск
            </motion.button>
          )}
        </div>

        {/* Список игроков в поиске */}
        {isSearching && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/10 backdrop-blur-sm rounded-lg p-6"
          >
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <Users className="w-5 h-5" />
              Игроки в поиске ({players.length})
            </h2>
            
            {players.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="w-12 h-12 text-blue-300 mx-auto mb-4" />
                <p className="text-blue-200">Ожидание других игроков...</p>
              </div>
            ) : (
              <div className="space-y-3">
                {players.map((player) => (
                  <motion.div
                    key={player.user_id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-white/10 rounded-lg p-4 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <User className="w-5 h-5 text-blue-300" />
                      <div>
                        <p className="text-white font-medium">{player.nickname}</p>
                        <p className="text-blue-200 text-sm">
                          Ищет игру {formatTime(player.created_at)}
                        </p>
                      </div>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => sendInvite(player.user_id)}
                      disabled={loading}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                      <UserPlus className="w-4 h-4" />
                      Пригласить
                    </motion.button>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* Индикатор загрузки */}
        {loading && (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-white">Загрузка...</p>
          </div>
        )}
      </div>
    </motion.div>
  )
}

export default PlayerSearch 