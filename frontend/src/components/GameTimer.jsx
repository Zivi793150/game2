import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Clock, Pause, Play, AlertTriangle } from 'lucide-react'
import { getApiUrl, API_ENDPOINTS } from '../config'

const GameTimer = ({ gameId, user, onTimeOut }) => {
  const [timerData, setTimerData] = useState(null)
  const [pauseData, setPauseData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (gameId) {
      fetchTimerStatus()
      fetchPauseStatus()
      
      // Обновляем каждую секунду
      const interval = setInterval(() => {
        fetchTimerStatus()
        fetchPauseStatus()
      }, 1000)
      
      return () => clearInterval(interval)
    }
  }, [gameId])

  const fetchTimerStatus = async () => {
    try {
      const response = await fetch(getApiUrl(`${API_ENDPOINTS.TIMER_STATUS}/${gameId}`), {
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok) {
        setTimerData(data)
        
        // Проверяем, не истекло ли время
        if (data.phase === 'setup' && data.remaining_time <= 0) {
          onTimeOut && onTimeOut('setup_timeout')
        } else if (data.phase === 'battle' && data.turn_remaining <= 0) {
          onTimeOut && onTimeOut('turn_timeout')
        }
      }
    } catch (err) {
      console.error('Ошибка получения статуса таймера:', err)
    }
  }

  const fetchPauseStatus = async () => {
    try {
      const response = await fetch(getApiUrl(`${API_ENDPOINTS.PAUSE_STATUS}/${gameId}`), {
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok) {
        setPauseData(data)
      }
    } catch (err) {
      console.error('Ошибка получения статуса паузы:', err)
    }
  }

  const startPause = async (pauseType) => {
    setLoading(true)
    setError('')
    
    try {
      const response = await fetch(getApiUrl(`${API_ENDPOINTS.PAUSE_START}/${gameId}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ pause_type: pauseType })
      })
      const data = await response.json()
      
      if (data.ok) {
        setError('')
      } else {
        setError(data.error || 'Ошибка начала паузы')
      }
    } catch (err) {
      setError('Ошибка соединения с сервером')
    } finally {
      setLoading(false)
    }
  }

  const endPause = async () => {
    setLoading(true)
    setError('')
    
    try {
      const response = await fetch(getApiUrl(`${API_ENDPOINTS.PAUSE_END}/${gameId}`), {
        method: 'POST',
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok) {
        setError('')
      } else {
        setError(data.error || 'Ошибка завершения паузы')
      }
    } catch (err) {
      setError('Ошибка соединения с сервером')
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getTimeColor = (remaining, total) => {
    const percentage = (remaining / total) * 100
    if (percentage <= 20) return 'text-red-500'
    if (percentage <= 50) return 'text-yellow-500'
    return 'text-green-500'
  }

  if (!timerData) {
    return null
  }

  return (
    <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 mb-4">
      {error && (
        <div className="bg-red-600 text-white p-2 rounded mb-3 text-sm text-center">
          {error}
        </div>
      )}

      {/* Пауза */}
      {pauseData?.is_paused && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-yellow-600/20 border border-yellow-500 rounded-lg p-3 mb-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pause className="w-5 h-5 text-yellow-400" />
              <span className="text-yellow-200 font-medium">
                Пауза ({pauseData.pause_type === 'long' ? '3 мин' : '1 мин'})
              </span>
            </div>
            <div className="text-yellow-300 font-mono">
              {formatTime(pauseData.remaining_time)}
            </div>
          </div>
          {user && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={endPause}
              disabled={loading}
              className="mt-2 px-3 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-sm transition-colors disabled:opacity-50"
            >
              Завершить паузу
            </motion.button>
          )}
        </motion.div>
      )}

      {/* Таймер фазы расстановки */}
      {timerData.phase === 'setup' && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-300" />
            <span className="text-white font-medium">Время расстановки:</span>
          </div>
          <div className={`font-mono text-lg ${getTimeColor(timerData.remaining_time, timerData.total_time_limit)}`}>
            {formatTime(timerData.remaining_time)}
          </div>
        </div>
      )}

      {/* Таймер фазы боя */}
      {timerData.phase === 'battle' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-300" />
              <span className="text-white font-medium">Ход:</span>
            </div>
            <div className={`font-mono text-lg ${getTimeColor(timerData.turn_remaining, 30)}`}>
              {formatTime(timerData.turn_remaining)}
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-300" />
              <span className="text-white font-medium">Общее время:</span>
            </div>
            <div className={`font-mono text-lg ${getTimeColor(timerData.total_remaining, 900)}`}>
              {formatTime(timerData.total_remaining)}
            </div>
          </div>

          {/* Кнопки пауз */}
          {user && timerData.current_turn_player_id === user.id && !pauseData?.is_paused && (
            <div className="flex gap-2 mt-3">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => startPause('short')}
                disabled={loading}
                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors disabled:opacity-50"
              >
                Пауза 1 мин
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => startPause('long')}
                disabled={loading}
                className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm transition-colors disabled:opacity-50"
              >
                Пауза 3 мин
              </motion.button>
            </div>
          )}
        </div>
      )}

      {/* Индикатор загрузки */}
      {loading && (
        <div className="text-center py-2">
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      )}
    </div>
  )
}

export default GameTimer 