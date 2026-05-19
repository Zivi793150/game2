import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { UserPlus, Check, XCircle, Bell } from 'lucide-react'
import { getApiUrl, API_ENDPOINTS } from '../config'

const InviteNotification = ({ onNavigate }) => {
  const [invites, setInvites] = useState([])
  const [showNotification, setShowNotification] = useState(false)

  useEffect(() => {
    // Проверяем приглашения каждые 5 секунд
    const interval = setInterval(checkInvites, 5000)
    checkInvites() // Проверяем сразу при загрузке
    
    return () => clearInterval(interval)
  }, [])

  const checkInvites = async () => {
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.INVITE_CHECK), {
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok && data.invites && data.invites.length > 0) {
        setInvites(data.invites)
        setShowNotification(true)
      } else {
        setShowNotification(false)
      }
    } catch (err) {
      console.error('Ошибка проверки приглашений:', err)
    }
  }

  const acceptInvite = async (inviteId) => {
    try {
      const response = await fetch(getApiUrl(`${API_ENDPOINTS.INVITE_ACCEPT}/${inviteId}`), {
        method: 'POST',
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok) {
        setInvites(invites.filter(invite => invite.invite_id !== inviteId))
        if (invites.length <= 1) {
          setShowNotification(false)
        }
        // Переходим в игру
        onNavigate('gameRoom', data.game_id)
      }
    } catch (err) {
      console.error('Ошибка принятия приглашения:', err)
    }
  }

  const declineInvite = async (inviteId) => {
    try {
      const response = await fetch(getApiUrl(`${API_ENDPOINTS.INVITE_DECLINE}/${inviteId}`), {
        method: 'POST',
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.ok) {
        setInvites(invites.filter(invite => invite.invite_id !== inviteId))
        if (invites.length <= 1) {
          setShowNotification(false)
        }
      }
    } catch (err) {
      console.error('Ошибка отклонения приглашения:', err)
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

  if (!showNotification || invites.length === 0) {
    return null
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -100, scale: 0.8 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -100, scale: 0.8 }}
        className="fixed top-4 right-4 z-50 max-w-sm"
      >
        <div className="bg-gradient-to-r from-yellow-500 to-orange-500 rounded-lg shadow-2xl border-2 border-yellow-300">
          {/* Заголовок уведомления */}
          <div className="flex items-center justify-between p-4 border-b border-yellow-300">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-white animate-pulse" />
              <span className="text-white font-semibold">Новое приглашение!</span>
            </div>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowNotification(false)}
              className="text-white hover:text-yellow-200 transition-colors"
            >
              <XCircle className="w-5 h-5" />
            </motion.button>
          </div>

          {/* Список приглашений */}
          <div className="p-4 space-y-3">
            {invites.map((invite) => (
              <motion.div
                key={invite.invite_id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-white/20 backdrop-blur-sm rounded-lg p-3"
              >
                <div className="flex items-center gap-3 mb-3">
                  <UserPlus className="w-5 h-5 text-white" />
                  <div className="flex-1">
                    <p className="text-white font-medium">
                      {invite.from_nickname} приглашает вас в игру
                    </p>
                    <p className="text-yellow-200 text-sm">
                      {formatTime(invite.created_at)}
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => acceptInvite(invite.invite_id)}
                    className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    Принять
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => declineInvite(invite.invite_id)}
                    className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    Отклонить
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

export default InviteNotification 