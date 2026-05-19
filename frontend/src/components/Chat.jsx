import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Send, MessageCircle } from 'lucide-react'
import { getApiUrl, API_ENDPOINTS, logApiRequest, logApiResponse } from '../config'

const Chat = ({ gameId, user, onMessagesLoaded, onClose }) => {
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Загружаем сообщения
  const loadMessages = async () => {
    try {
      const url = getApiUrl(`${API_ENDPOINTS.CHAT_MESSAGES}/${gameId}`)
      logApiRequest(url, 'GET')
      
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      })
      
      if (response.ok) {
        const data = await response.json()
        logApiResponse(url, response.status, data)
        const messagesData = data.messages || []
        setMessages(messagesData)
        // Уведомляем родительский компонент о загруженных сообщениях
        if (onMessagesLoaded) {
          onMessagesLoaded(messagesData)
        }
      }
    } catch (error) {
      console.error('Ошибка загрузки сообщений:', error)
    }
  }

  // Отправляем сообщение
  const sendMessage = async (e) => {
    e.preventDefault()
    if (!newMessage.trim() || isLoading) return

    setIsLoading(true)
    try {
      const url = getApiUrl(`${API_ENDPOINTS.CHAT_SEND}/${gameId}`)
      logApiRequest(url, 'POST', { message: newMessage })
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: newMessage })
      })
      
      if (response.ok) {
        const data = await response.json()
        logApiResponse(url, response.status, data)
        setNewMessage('')
        // Перезагружаем сообщения
        await loadMessages()
      }
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Загружаем сообщения при монтировании и каждые 3 секунды
  useEffect(() => {
    loadMessages()
    const interval = setInterval(loadMessages, 3000)
    return () => clearInterval(interval)
  }, [gameId])

  const formatTime = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('ru-RU', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="w-80 bg-ocean-800 rounded-lg border border-ocean-600 flex flex-col h-full"
    >
      {/* Заголовок чата */}
      <div className="p-4 border-b border-ocean-600 bg-ocean-700 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <MessageCircle className="w-5 h-5 text-blue-400" />
          <h3 className="text-white font-semibold">Чат игры</h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-ocean-300 hover:text-white transition-colors"
            title="Закрыть чат"
          >
            ✕
          </button>
        )}
      </div>

      {/* Сообщения */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-96">
        {messages.length === 0 ? (
          <div className="text-center text-ocean-300 text-sm">
            Нет сообщений. Начните общение!
          </div>
        ) : (
          messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.is_own ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs px-3 py-2 rounded-lg ${
                  msg.is_own
                    ? 'bg-blue-600 text-white'
                    : 'bg-ocean-700 text-white'
                }`}
              >
                <div className="flex items-center space-x-2 mb-1">
                  <span className="text-xs font-medium">
                    {msg.nickname}
                  </span>
                  <span className="text-xs opacity-70">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <p className="text-sm">{msg.message}</p>
              </div>
            </motion.div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Форма отправки */}
      <form onSubmit={sendMessage} className="p-4 border-t border-ocean-600">
        <div className="flex space-x-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Введите сообщение..."
            className="flex-1 bg-ocean-700 text-white placeholder-ocean-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || isLoading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-ocean-600 disabled:cursor-not-allowed text-white p-2 rounded-lg transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </motion.div>
  )
}

export default Chat 