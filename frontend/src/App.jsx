import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Login from './components/Login'
import Register from './components/Register'
import MainMenu from './components/MainMenu'
import Stats from './components/Stats'
import GameRoom from './components/GameRoom'
import Battle from './components/Battle'
import Lobby from './components/Lobby'
import PlayerSearch from './components/PlayerSearch'
import InviteNotification from './components/InviteNotification'
import { getApiUrl, API_ENDPOINTS } from './config'

const DualLocalTest = () => {
  const [path, setPath] = useState('/')

  const protocol = window.location.protocol
  const port = window.location.port ? `:${window.location.port}` : ''
  const leftBase = `${protocol}//localhost${port}`
  const rightBase = `${protocol}//127.0.0.1${port}`
  const normalizedPath = path && path.startsWith('/') ? path : (path ? `/${path}` : '')

  const leftUrl = `${leftBase}${normalizedPath}`
  const rightUrl = `${rightBase}${normalizedPath}`

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-7xl mx-auto space-y-3">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1">
            <div className="text-lg font-semibold">Dual Local Test</div>
            <div className="text-sm text-gray-300">Левый: {leftBase} | Правый: {rightBase}</div>
          </div>
          <button
            onClick={() => {
              window.history.pushState({}, '', '/')
              window.location.reload()
            }}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
          >
            Назад
          </button>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="Путь, например: / или /game/12345"
            className="flex-1 px-3 py-2 rounded bg-gray-800 border border-gray-700"
          />
          <button
            onClick={() => setPath('/')}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded"
          >
            Открыть /
          </button>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <button
            onClick={() => window.open(leftUrl, 'dual-left-window')}
            className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded"
          >
            Открыть Player A (окно)
          </button>
          <button
            onClick={() => window.open(rightUrl, 'dual-right-window')}
            className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded"
          >
            Открыть Player B (окно)
          </button>
          <div className="text-sm text-gray-300 md:self-center">
            Если в iframe «Не авторизован» — используй кнопки выше (в отдельных окнах куки не блокируются).
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ height: 'calc(100vh - 160px)' }}>
          <div className="rounded overflow-hidden border border-gray-700">
            <div className="px-3 py-2 bg-gray-800 border-b border-gray-700 text-sm">Player A (localhost)</div>
            <iframe title="dual-left" src={leftUrl} className="w-full h-full bg-white" />
          </div>
          <div className="rounded overflow-hidden border border-gray-700">
            <div className="px-3 py-2 bg-gray-800 border-b border-gray-700 text-sm">Player B (127.0.0.1)</div>
            <iframe title="dual-right" src={rightUrl} className="w-full h-full bg-white" />
          </div>
        </div>
      </div>
    </div>
  )
}

const App = () => {
  const [currentView, setCurrentView] = useState('login')
  const [user, setUser] = useState(null)
  const [gameId, setGameId] = useState(null)
  const [loading, setLoading] = useState(true)

  if (window.location.pathname === '/dual') {
    return <DualLocalTest />
  }

  useEffect(() => {
    checkAuthStatus()
  }, [])

  const checkAuthStatus = async () => {
    try {
      // Проверяем, есть ли invite_code в URL
      const urlPath = window.location.pathname
      const gameMatch = urlPath.match(/^\/game\/(\d{5})$/)

      if (gameMatch) {
        const inviteCode = gameMatch[1]
        console.log('🎮 Обнаружен invite_code в URL:', inviteCode)
        await handleInviteLink(inviteCode)
        return
      }

      const response = await fetch(getApiUrl(API_ENDPOINTS.MENU), {
        credentials: 'include'
      })
      const data = await response.json()

      if (data.ok) {
        setUser(data)
        setCurrentView('mainMenu')
      } else {
        setCurrentView('login')
      }
    } catch (err) {
      setCurrentView('login')
    } finally {
      setLoading(false)
    }
  }

  const handleInviteLink = async (inviteCode) => {
    try {
      console.log('🔗 Обработка ссылки приглашения:', inviteCode)

      // Сначала проверяем авторизацию
      const authResponse = await fetch(getApiUrl(API_ENDPOINTS.MENU), {
        credentials: 'include'
      })

      if (!authResponse.ok) {
        // Пользователь не авторизован, показываем страницу входа
        setCurrentView('login')
        setLoading(false)
        return
      }

      const userData = await authResponse.json()
      setUser(userData)

      // Теперь обрабатываем приглашение
      const inviteResponse = await fetch(getApiUrl(`${API_ENDPOINTS.GAME_INVITE}/${inviteCode}`), {
        method: 'GET',
        credentials: 'include'
      })

      const inviteData = await inviteResponse.json()
      console.log('📡 Ответ обработки приглашения:', inviteData)

      if (inviteData.ok) {
        console.log('✅ Приглашение обработано успешно:', inviteData)
        setGameId(inviteData.game_id)

        if (inviteData.role === 'creator') {
          // Создатель возвращается в комнату
          setCurrentView('gameRoom')
        } else if (inviteData.role === 'joiner') {
          // Новоприбывший тоже идет в комнату
          setCurrentView('gameRoom')
        } else if (inviteData.role === 'player') {
          // Уже участник игры
          setCurrentView('gameRoom')
        }
      } else {
        console.error('❌ Ошибка обработки приглашения:', inviteData.error)
        if (inviteData.action === 'login_required') {
          setCurrentView('login')
        } else {
          setCurrentView('mainMenu')
        }
      }
    } catch (err) {
      console.error('💥 Ошибка при обработке ссылки приглашения:', err)
      setCurrentView('login')
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = (userData) => {
    setUser(userData)
    setCurrentView('mainMenu')
  }

  const handleRegister = (userData) => {
    setUser(userData)
    setCurrentView('mainMenu')
  }

  const handleLogout = async () => {
    try {
      await fetch(getApiUrl(API_ENDPOINTS.LOGOUT), {
        credentials: 'include'
      })
    } catch (err) {
      console.error('Ошибка при выходе:', err)
    }
    setUser(null)
    setCurrentView('login')
  }

  const handleNavigate = (view, data = null) => {
    console.log('🧭 Навигация:', view, data)
    console.log('👤 Текущий пользователь:', user)

    if (data && typeof data === 'object') {
      // Если передан объект с game_id
      if (data.game_id) {
        setGameId(data.game_id)
        console.log('🎮 Установлен gameId из объекта:', data.game_id)
      }
    } else if (typeof data === 'number') {
      // Если передан просто number (game_id)
      setGameId(data)
      console.log('🎮 Установлен gameId из числа:', data)
    }

    setCurrentView(view)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white">Загрузка...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="App">
      {/* Уведомления о приглашениях */}
      <InviteNotification onNavigate={handleNavigate} />
      
      <AnimatePresence mode="wait">
        {currentView === 'login' && (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Login onLogin={handleLogin} onNavigate={() => setCurrentView('register')} />
          </motion.div>
        )}

        {currentView === 'register' && (
          <motion.div
            key="register"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Register onRegister={handleRegister} onNavigate={() => setCurrentView('login')} />
          </motion.div>
        )}

        {currentView === 'mainMenu' && (
          <motion.div
            key="mainMenu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <MainMenu onNavigate={handleNavigate} onLogout={handleLogout} />
          </motion.div>
        )}

        {currentView === 'stats' && (
          <motion.div
            key="stats"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Stats onNavigate={handleNavigate} />
          </motion.div>
        )}

        {currentView === 'lobby' && (
          <motion.div
            key="lobby"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Lobby onNavigate={handleNavigate} />
          </motion.div>
        )}

        {currentView === 'playerSearch' && (
          <motion.div
            key="playerSearch"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <PlayerSearch onNavigate={handleNavigate} onBack={() => setCurrentView('mainMenu')} />
          </motion.div>
        )}

        {currentView === 'gameRoom' && gameId && (
          <motion.div
            key="gameRoom"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <GameRoom
              gameData={{
                game_id: gameId,
                invite_code: window.location.pathname.match(/^\/game\/(\d{5})$/)?.[1] || null
              }}
              user={user}
              onNavigate={handleNavigate}
            />
          </motion.div>
        )}

        {currentView === 'battle' && gameId && (
          <motion.div
            key="battle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {console.log('🎯 Рендеринг Battle с данными:', { gameId, user })}
            {console.log('👤 Данные пользователя в Battle:', user)}
            {console.log('🎮 Данные игры в Battle:', { game_id: gameId })}
            <Battle gameData={{ game_id: gameId }} user={user} onNavigate={handleNavigate} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App 