import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Anchor, Eye, EyeOff, LogIn } from 'lucide-react'
import { getApiUrl, API_ENDPOINTS, logApiRequest, logApiResponse } from '../config'

const Login = ({ onLogin, onNavigate }) => {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  })
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const url = getApiUrl(API_ENDPOINTS.LOGIN);
      logApiRequest(url, 'POST', formData);
      
      console.log('🌐 Отправляем запрос на:', url);
      console.log('📤 Данные запроса:', formData);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
        credentials: 'include'
      })

      console.log('📡 Получен ответ:', response.status, response.statusText);
      console.log('📋 Заголовки ответа:', Object.fromEntries(response.headers.entries()));

      logApiResponse(url, response.status);

      if (response.ok) {
        const userData = await response.json()
        console.log('✅ Успешный ответ:', userData);
        logApiResponse(url, response.status, userData);
        onLogin(userData)
      } else {
        console.log('❌ Ошибка ответа:', response.status);
        
        // Пытаемся получить текст ответа для диагностики
        const responseText = await response.text();
        console.log('📄 Текст ответа:', responseText);
        
        let errorData;
        try {
          errorData = JSON.parse(responseText);
        } catch (e) {
          console.error('❌ Не удалось распарсить JSON:', e);
          errorData = { error: `Ошибка сервера: ${response.status} - ${responseText}` };
        }
        
        logApiResponse(url, response.status, errorData);
        setError(errorData.error || 'Ошибка входа')
      }
    } catch (err) {
      console.error('💥 Ошибка при входе:', err);
      console.error('🔍 Детали ошибки:', {
        name: err.name,
        message: err.message,
        stack: err.stack
      });
      setError('Ошибка соединения с сервером')
    } finally {
      setIsLoading(false)
    }
  }

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="card w-full max-w-md"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center justify-center w-20 h-20 bg-ocean-500 rounded-full mb-4">
            <Anchor className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Морской Бой</h1>
          <p className="text-white/70">Войдите в свой аккаунт</p>
        </motion.div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
          >
            <label className="block text-white text-sm font-medium mb-2">
              Email
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="input-field"
              placeholder="Введите ваш email"
              required
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
          >
            <label className="block text-white text-sm font-medium mb-2">
              Пароль
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleChange}
                className="input-field pr-12"
                placeholder="Введите пароль"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/60 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </motion.div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 text-red-200 text-sm"
            >
              {error}
            </motion.div>
          )}

          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            type="submit"
            disabled={isLoading}
            className="btn-primary w-full flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
              />
            ) : (
              <LogIn size={20} />
            )}
            <span>{isLoading ? 'Вход...' : 'Войти'}</span>
          </motion.button>
        </form>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center mt-6"
        >
          <p className="text-white/60">
            Нет аккаунта?{' '}
            <button
              onClick={onNavigate}
              className="text-ocean-300 hover:text-ocean-200 font-medium transition-colors"
            >
              Зарегистрироваться
            </button>
          </p>
        </motion.div>
      </motion.div>
    </div>
  )
}

export default Login 