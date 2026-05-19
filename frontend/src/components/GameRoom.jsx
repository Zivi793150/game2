import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Ship, Check, RotateCcw, Users, Clock, Bell, MessageCircle } from 'lucide-react'
import { getApiUrl, API_ENDPOINTS, logApiRequest, logApiResponse } from '../config'
import Chat from './Chat'
import GameTimer from './GameTimer'

const GameRoom = ({ gameData, user, onNavigate }) => {
  const [board, setBoard] = useState(Array(15).fill().map(() => Array(14).fill(null)))
  const [shipCounts, setShipCounts] = useState({})
  const [selectedShipType, setSelectedShipType] = useState(null)
  const [isReady, setIsReady] = useState(false)
  const [opponent, setOpponent] = useState(null)
  const [gameStatus, setGameStatus] = useState('waiting')
  const [opponentProgress, setOpponentProgress] = useState(0)
  const [showChat, setShowChat] = useState(false)
  const [notification, setNotification] = useState(null)
  const [messages, setMessages] = useState([])
  const [lastSeenMessageId, setLastSeenMessageId] = useState(0)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const [playerIds, setPlayerIds] = useState({ player1_id: null, player2_id: null })

  // Система координат как в шахматах
  const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'] // 14 колонок
  const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] // 15 рядов

  // Функции конвертации координат
  const indexToCoord = (x, y) => {
    return `${COLUMNS[x]}${y + 1}`
  }

  const shipTypes = [
    { type: 'БДК', size: 1, count: 2, color: 'bg-red-500', icon: '🚢' },
    { type: 'КР', size: 1, count: 6, color: 'bg-blue-500', icon: '⚓' },
    { type: 'А', size: 1, count: 1, color: 'bg-purple-500', icon: '🛥️' },
    { type: 'С', size: 1, count: 1, color: 'bg-indigo-500', icon: '🚤' },
    { type: 'ТН', size: 1, count: 1, color: 'bg-pink-500', icon: '⛴️' },
    { type: 'Л', size: 1, count: 2, color: 'bg-orange-500', icon: '🛳️' },
    { type: 'ЭС', size: 1, count: 6, color: 'bg-green-500', icon: '🚣' },
    { type: 'М', size: 1, count: 6, color: 'bg-teal-500', icon: '🛶' },
    { type: 'СМ', size: 1, count: 1, color: 'bg-gray-500', icon: '⛵' },
    { type: 'Ф', size: 1, count: 6, color: 'bg-cyan-500', icon: '🚁' },
    { type: 'ТК', size: 1, count: 6, color: 'bg-emerald-500', icon: '🚂' },
    { type: 'Т', size: 1, count: 6, color: 'bg-lime-500', icon: '🚃' },
    { type: 'ТР', size: 1, count: 6, color: 'bg-amber-500', icon: '🚄' },
    { type: 'СТ', size: 1, count: 6, color: 'bg-rose-500', icon: '🚅' },
    { type: 'ПЛ', size: 1, count: 1, color: 'bg-yellow-500', icon: '🚇' },
    { type: 'КРПЛ', size: 1, count: 1, color: 'bg-violet-500', icon: '🚈' },
    { type: 'АБ', size: 1, count: 1, color: 'bg-slate-500', icon: '🚉' },
    { type: 'ВМБ', size: 1, count: 2, color: 'bg-red-600', icon: '🚊' }
  ]

  useEffect(() => {
    // Инициализация счетчиков кораблей
    const initialCounts = {}
    shipTypes.forEach(shipType => {
      initialCounts[shipType.type] = shipType.count
    })
    setShipCounts(initialCounts)
  }, [])

  useEffect(() => {
    // Проверка статуса игры
    const checkGameStatus = async () => {
      try {
        console.log('🔄 Проверка статуса игры...')
        const url = getApiUrl(`${API_ENDPOINTS.CHECK_SETUP_DONE}/${gameData.game_id}`)
        logApiRequest(url, 'GET')
        
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        })
        
        console.log('📡 Статус игры:', response.status)
        
        if (response.ok) {
          const data = await response.json()
          console.log('📊 Данные статуса:', data)
          logApiResponse(url, response.status, data)

          if (data.player1_id && data.player2_id) {
            setPlayerIds({ player1_id: data.player1_id, player2_id: data.player2_id })
          }
          
          // Обновляем прогресс противника
          if (data.opponent_progress !== undefined) {
            setOpponentProgress(Math.round(data.opponent_progress))
          }
          
          if (data.ready && data.battle_initialized) {
            console.log('✅ Оба игрока готовы и битва инициализирована, переход к битве!')
            console.log('🎯 Переход к битве с данными:', gameData)
            console.log('👤 Пользователь:', user)
            
            // Передаем данные о ролях игроков
            const battleGameData = {
              ...gameData,
              player1_id: data.player1_id,
              player2_id: data.player2_id
            }
            
            // Добавляем небольшую задержку для стабилизации
            setTimeout(() => {
              onNavigate('battle', battleGameData)
            }, 1000)
          } else if (data.ready && !data.battle_initialized) {
            console.log('⏳ Оба игрока готовы, но битва еще не инициализирована...')
          } else {
            console.log('⏳ Игра еще не готова, продолжаем ожидание...')
          }
        } else {
          const errorData = await response.json()
          console.error('❌ Ошибка проверки статуса:', errorData)
          logApiResponse(url, response.status, errorData)
        }
      } catch (err) {
        console.error('💥 Ошибка проверки статуса:', err)
      }
    }

    const interval = setInterval(checkGameStatus, 2000)
    return () => clearInterval(interval)
  }, [gameData, onNavigate, user])

  // Проверяем подключение противника
  useEffect(() => {
    const checkOpponentJoined = async () => {
      try {
        const url = getApiUrl(`${API_ENDPOINTS.CHECK_OPPONENT}/${gameData.game_id}`)
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        })
        
        if (response.ok) {
          const data = await response.json()
          if (data.opponent_joined && !opponent) {
            setOpponent(data.opponent)
            setNotification('Противник присоединился к игре!')
            setTimeout(() => setNotification(null), 5000)
          }
        }
      } catch (error) {
        console.error('Ошибка проверки противника:', error)
      }
    }

    const interval = setInterval(checkOpponentJoined, 3000)
    return () => clearInterval(interval)
  }, [gameData.game_id, opponent])

  // Проверяем новые сообщения
  useEffect(() => {
    const checkNewMessages = async () => {
      try {
        const response = await fetch(getApiUrl(`${API_ENDPOINTS.CHAT_MESSAGES}/${gameData.game_id}`), {
          credentials: 'include'
        })
        const data = await response.json()
        
        if (data.ok && data.messages) {
          const messages = data.messages
          setMessages(messages) // Обновляем состояние сообщений
          if (messages.length > 0) {
            const latestMessageId = Math.max(...messages.map(msg => msg.id))
            
            if (latestMessageId > lastSeenMessageId) {
              const newMessages = messages.filter(msg => msg.id > lastSeenMessageId)
              setNewMessageCount(newMessages.length)
            }
          }
        }
      } catch (error) {
        console.error('Ошибка проверки новых сообщений:', error)
      }
    }

    const interval = setInterval(checkNewMessages, 3000)
    return () => clearInterval(interval)
  }, [gameData.game_id, lastSeenMessageId])

  const canPlaceShip = (shipType, x, y) => {
    const COLS = 14
    const ROWS = 15
    
    // Определяем роль игрока
    const myUserId = user?.id ?? user?.user_id
    const player1Id = playerIds?.player1_id ?? gameData?.player1_id ?? gameData?.player_1 ?? null
    const player2Id = playerIds?.player2_id ?? gameData?.player2_id ?? gameData?.player_2 ?? null
    const isPlayer1 = (gameData?.role === 'creator')
      ? true
      : (gameData?.role === 'joiner')
        ? false
        : (player1Id != null && parseInt(myUserId) === parseInt(player1Id))
    
    // Новая логика зон:
    // Player1 видит со стороны A: размещает в рядах 1-5 (y = 0-4)
    // Player2 видит со стороны N: размещает в рядах 11-15 (y = 10-14)
    const zoneStart = isPlayer1 ? 0 : 10
    const zoneEnd = isPlayer1 ? 5 : 15
    
    // Проверяем, что размещение только в нашей зоне
    if (y < zoneStart || y >= zoneEnd) return false
    
    // Проверяем границы поля
    if (x < 0 || x >= COLS) return false
    
    // Проверяем, что клетка свободна
    if (board[y][x] !== null) return false
    
    return true
  }

  const placeShip = (shipType, x, y) => {
    if (!canPlaceShip(shipType, x, y)) return
    
    // Проверяем, есть ли еще корабли этого типа
    if (shipCounts[shipType] <= 0) return

    const newBoard = [...board]
    newBoard[y][x] = shipType

    setBoard(newBoard)
    
    // Уменьшаем количество кораблей этого типа
    setShipCounts(prev => ({
      ...prev,
      [shipType]: prev[shipType] - 1
    }))
    
    // Снимаем выделение только если больше нет кораблей этого типа
    if (shipCounts[shipType] <= 1) {
      setSelectedShipType(null)
    }
  }

  const handleCellClick = (x, y) => {
    const cellValue = board?.[y]?.[x] ?? null

    // Если кликнули по уже поставленному кораблю — позволяем его переместить:
    // снимаем с клетки, возвращаем в счётчик и выбираем этот тип для повторной установки.
    if (cellValue) {
      const newBoard = [...board]
      newBoard[y][x] = null
      setBoard(newBoard)

      setShipCounts(prev => ({
        ...prev,
        [cellValue]: (prev[cellValue] ?? 0) + 1
      }))

      setSelectedShipType(cellValue)
      return
    }

    if (!selectedShipType) return
    placeShip(selectedShipType, x, y)
  }

  const handleAutoSetup = async () => {
    try {
      console.log('🤖 Авторасстановка кораблей...')
      
      // Создаем список уже размещенных кораблей
      const placedShips = []
      for (let y = 0; y < 15; y++) {
        for (let x = 0; x < 14; x++) {
          if (board[y][x]) {
            placedShips.push({
              type: board[y][x],
              x: x,
              y: y,
              alive: true,
              placed: true
            })
          }
        }
      }
      
      const autoSetupUrl = getApiUrl(`${API_ENDPOINTS.AUTO_SETUP}/${gameData.game_id}`)
      logApiRequest(autoSetupUrl, 'POST')
      
      const response = await fetch(autoSetupUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placed_ships: placedShips }),
        credentials: 'include'
      })

      console.log('📡 Ответ авторасстановки:', response.status)
      
      if (response.ok) {
        const data = await response.json()
        console.log('✅ Авторасстановка выполнена:', data)
        logApiResponse(autoSetupUrl, response.status, data)
        
        // Обновляем доску и счетчики
        if (data.ships) {
          const newBoard = Array(15).fill().map(() => Array(14).fill(null))
          const newCounts = {}
          
          // Инициализируем счетчики
          shipTypes.forEach(shipType => {
            newCounts[shipType.type] = shipType.count
          })
          
          // Размещаем корабли и обновляем счетчики
          // Определяем роль игрока для правильного отображения
          const myUserId = user?.id ?? user?.user_id
          const player1Id = playerIds?.player1_id ?? gameData?.player1_id ?? gameData?.player_1 ?? null
          const player2Id = playerIds?.player2_id ?? gameData?.player2_id ?? gameData?.player_2 ?? null
          const isPlayer1 = (gameData?.role === 'creator')
            ? true
            : (gameData?.role === 'joiner')
              ? false
              : (player1Id != null && parseInt(myUserId) === parseInt(player1Id))
          
          data.ships.forEach(ship => {
            // Теперь координаты отображаются напрямую без преобразований
            const displayX = ship.x
            const displayY = ship.y
            
            if (displayX >= 0 && displayX < 14 && displayY >= 0 && displayY < 15) {
              newBoard[displayY][displayX] = ship.type
              if (newCounts[ship.type] > 0) {
                newCounts[ship.type]--
              }
            }
          })
          
          setBoard(newBoard)
          setShipCounts(newCounts)
        }
      } else {
        const errorData = await response.json()
        console.error('❌ Ошибка авторасстановки:', errorData)
        logApiResponse(autoSetupUrl, response.status, errorData)
      }
    } catch (err) {
      console.error('💥 Ошибка авторасстановки:', err)
    }
  }

  const handleReady = async () => {
    // Проверяем, что все корабли размещены
    const totalShips = Object.values(shipCounts).reduce((sum, count) => sum + count, 0)
    if (totalShips > 0) {
      console.log('⚠️ Не все корабли размещены, осталось:', totalShips)
      return
    }

    try {
      console.log('💾 Сохранение кораблей...')
      
      // Собираем размещенные корабли с доски
      const placedShips = []
      
      // Определяем роль игрока для правильного преобразования координат
      const myUserId = user?.id ?? user?.user_id
      const player1Id = playerIds?.player1_id ?? gameData?.player1_id ?? gameData?.player_1 ?? null
      const player2Id = playerIds?.player2_id ?? gameData?.player2_id ?? gameData?.player_2 ?? null
      const isPlayer1 = (gameData?.role === 'creator')
        ? true
        : (gameData?.role === 'joiner')
          ? false
          : (player1Id != null && parseInt(myUserId) === parseInt(player1Id))
      
      for (let y = 0; y < 15; y++) {
        for (let x = 0; x < 14; x++) {
          if (board[y][x]) {
            // Теперь координаты сохраняются как есть, без преобразований
            placedShips.push({
              type: board[y][x],
              x: x,
              y: y,
              alive: true,
              placed: true
            })
          }
        }
      }
      
      console.log('📦 Размещено кораблей:', placedShips.length)
      
      // Сохраняем корабли
      const saveUrl = getApiUrl(`${API_ENDPOINTS.SAVE_SHIPS}/${gameData.game_id}`)
      const shipsData = { ships: placedShips }
      logApiRequest(saveUrl, 'POST', shipsData)
      
      const saveResponse = await fetch(saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shipsData),
        credentials: 'include'
      })

      console.log('📡 Ответ сохранения кораблей:', saveResponse.status)
      
      if (saveResponse.ok) {
        console.log('✅ Корабли сохранены')
        logApiResponse(saveUrl, saveResponse.status)
        
        // Отмечаем готовность
        const readyUrl = getApiUrl(`${API_ENDPOINTS.SETUP_DONE}/${gameData.game_id}`)
        logApiRequest(readyUrl, 'POST')
        
        const readyResponse = await fetch(readyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        })

        console.log('📡 Ответ готовности:', readyResponse.status)
        
        if (readyResponse.ok) {
          console.log('✅ Готовность отмечена')
          logApiResponse(readyUrl, readyResponse.status)
          setIsReady(true)
          console.log('🎯 Игрок готов, ожидаем противника...')
        } else {
          const errorData = await readyResponse.json()
          console.error('❌ Ошибка отметки готовности:', errorData)
          logApiResponse(readyUrl, readyResponse.status, errorData)
        }
      } else {
        const errorData = await saveResponse.json()
        console.error('❌ Ошибка сохранения кораблей:', errorData)
        logApiResponse(saveUrl, saveResponse.status, errorData)
      }
    } catch (err) {
      console.error('💥 Ошибка сохранения:', err)
    }
  }

  const resetBoard = () => {
    setBoard(Array(15).fill().map(() => Array(14).fill(null)))
    const initialCounts = {}
    shipTypes.forEach(shipType => {
      initialCounts[shipType.type] = shipType.count
    })
    setShipCounts(initialCounts)
    setSelectedShipType(null)
  }

  const handleLeaveGame = async () => {
    try {
      console.log('🚪 Выход из игры...')
      const url = getApiUrl(`${API_ENDPOINTS.LEAVE_GAME}/${gameData.game_id}`)
      logApiRequest(url, 'POST')
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      })
      
      console.log('📡 Ответ выхода:', response.status)
      
      if (response.ok) {
        console.log('✅ Успешно вышли из игры')
        logApiResponse(url, response.status)
        onNavigate('mainMenu')
      } else {
        const errorData = await response.json()
        console.error('❌ Ошибка выхода:', errorData)
        logApiResponse(url, response.status, errorData)
      }
    } catch (err) {
      console.error('💥 Ошибка выхода из игры:', err)
    }
  }

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <h1 className="text-3xl font-bold text-white mb-2">Расстановка кораблей</h1>
          <p className="text-white/70">Разместите ваши корабли на поле</p>
        </motion.div>

        <div className="flex gap-6">
          {/* Игровое поле */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex-1"
          >
            {/* Таймер игры */}
            <GameTimer 
              gameId={gameData.game_id} 
              user={user} 
              onTimeOut={(type) => {
                if (type === 'setup_timeout') {
                  // Автоматически расставляем корабли при истечении времени
                  handleAutoSetup()
                }
              }}
            />
            
            <div className="card">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-white font-bold text-xl">Расстановка кораблей</h2>
                <div className="text-right">
                  <div className="text-white text-sm opacity-75">Комната:</div>
                  <div className="text-blue-400 font-bold text-lg">
                    {gameData.invite_code || `ID:${gameData.game_id}`}
                  </div>
                  <div className="text-white text-xs opacity-50 mt-1">
                    ID: {gameData.game_id}
                  </div>
                </div>
              </div>
              <div className="bg-gray-900 p-4 rounded-lg max-w-fit mx-auto">
                {/* Заголовок с координатами столбцов */}
                <div className="flex gap-1 mb-1">
                  <div className="w-8 h-8"></div> {/* Пустая ячейка для угла */}
                  {COLUMNS.map(col => (
                    <div key={col} className="w-8 h-8 flex items-center justify-center text-white text-xs font-bold">
                      {col}
                    </div>
                  ))}
                </div>
                
                {/* Строки с координатами и ячейками */}
                {(() => {
                  const myUserId = user?.id ?? user?.user_id
                  const player1Id = playerIds?.player1_id ?? gameData?.player1_id ?? gameData?.player_1 ?? null
                  const isPlayer1 = (gameData?.role === 'creator')
                    ? true
                    : (gameData?.role === 'joiner')
                      ? false
                      : (player1Id != null && parseInt(myUserId) === parseInt(player1Id))
                  const displayBoard = board
                  
                  return displayBoard.map((row, displayY) => {
                    const realY = displayY
                    
                    return (
                      <div key={realY} className="flex gap-1 mb-1">
                        {/* Номер ряда */}
                        <div className="w-8 h-8 flex items-center justify-center text-white text-xs font-bold">
                          {realY + 1}
                        </div>
                    
                        {/* Ячейки ряда */}
                        {row.map((cell, x) => (
                          <motion.div
                            key={`${x}-${realY}`}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => handleCellClick(x, realY)}
                        className={`w-8 h-8 border border-gray-600 rounded flex items-center justify-center cursor-pointer ${
                          cell ? 'bg-blue-600' : 'bg-gray-800'
                        } ${
                          selectedShipType && canPlaceShip(selectedShipType, x, realY)
                            ? 'ring-2 ring-green-400'
                            : ''
                        } ${
                          (() => {
                            const myUserId = user?.id ?? user?.user_id
                            const player1Id = playerIds?.player1_id ?? gameData?.player1_id ?? gameData?.player_1 ?? null
                            const isPlayer1 = (gameData?.role === 'creator')
                              ? true
                              : (gameData?.role === 'joiner')
                                ? false
                                : (player1Id != null && parseInt(myUserId) === parseInt(player1Id))
                            const inMyZone = isPlayer1 ? (realY >= 0 && realY < 5) : (realY >= 10 && realY < 15)
                            return inMyZone ? 'border-green-500' : 'border-gray-600 opacity-50'
                          })()
                        }`}
                        title={indexToCoord(x, realY)} // Показываем координату при наведении
                      >
                        {cell && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="w-full h-full flex items-center justify-center text-white text-xs font-bold"
                          >
                            <span className="text-lg">{cell}</span>
                          </motion.div>
                          )}
                          </motion.div>
                        ))}
                      </div>
                    )
                  })
                })()}
                
                {/* Подпись о зоне размещения */}
                <div className="text-center mt-2 text-white text-sm">
                  {(() => {
                    const myUserId = user?.id ?? user?.user_id
                    const player1Id = gameData?.player1_id || gameData?.player_1 || 1
                    const isPlayer1 = parseInt(myUserId) === parseInt(player1Id)
                    const zone = isPlayer1 ? 'ряды 1-5 (A1-N5)' : 'ряды 11-15 (A11-N15)'
                    const perspective = isPlayer1 ? 'A (Север)' : 'N (Юг)'
                    return (
                      <>
                        <div>Вид со стороны: <span className="font-bold">{perspective}</span></div>
                        <div>Ваша зона размещения: <span className="font-bold text-green-400">{zone}</span></div>
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Панель кораблей */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            {/* Корабли для размещения */}
            <div className="card">
              <h3 className="text-white font-semibold text-lg mb-4">Корабли</h3>
              <div className="space-y-3">
                {shipTypes
                  .filter(shipType => shipCounts[shipType.type] > 0)
                  .map(shipType => (
                    <motion.div
                      key={shipType.type}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={`p-3 rounded-lg cursor-pointer transition-all ${
                        selectedShipType === shipType.type ? 'ring-2 ring-ocean-400' : ''
                      } ${shipType.color} text-white`}
                      onClick={() => setSelectedShipType(shipType.type)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <span className="text-2xl">{shipType.icon}</span>
                          <div>
                            <p className="font-semibold">{shipType.type}</p>
                            <p className="text-sm opacity-80">Осталось: {shipCounts[shipType.type]}</p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
              </div>
            </div>

            {/* Прогресс противника */}
            <div className="card">
              <h3 className="text-white font-semibold text-lg mb-1">Противник</h3>
              {opponent && (
                <div className="text-white/90 mb-3">{opponent.nickname}</div>
              )}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white/70">Прогресс:</span>
                  <span className="text-white">{opponentProgress}%</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div 
                    className="bg-green-500 h-2 rounded-full transition-all duration-300" 
                    style={{ width: `${opponentProgress}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Кнопки управления */}
            <div className="space-y-3">
              <button
                onClick={handleAutoSetup}
                className="w-full btn-secondary flex items-center justify-center space-x-2"
              >
                <Ship size={20} />
                <span>Авторасстановка</span>
              </button>
              
              <button
                onClick={resetBoard}
                className="w-full btn-secondary flex items-center justify-center space-x-2"
              >
                <RotateCcw size={20} />
                <span>Сбросить</span>
              </button>
              
              <button
                onClick={handleReady}
                disabled={Object.values(shipCounts).reduce((sum, count) => sum + count, 0) > 0 || isReady}
                className="w-full btn-primary flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check size={20} />
                <span>{isReady ? 'Готово!' : 'Готов'}</span>
              </button>
              
              <button
                onClick={handleLeaveGame}
                className="w-full btn-danger flex items-center justify-center space-x-2"
              >
                <span>🚪</span>
                <span>Выйти из игры</span>
              </button>
            </div>

            {/* Статус игры */}
            <div className="card">
              <h3 className="text-white font-semibold text-lg mb-4 flex items-center space-x-2">
                <Clock size={20} />
                <span>Статус игры</span>
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white/70">Вы:</span>
                  <span className="text-white">{isReady ? 'Готов' : 'Расставляете корабли'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/70">Противник:</span>
                  <span className="text-white">
                    {opponent ? (opponentProgress >= 100 ? 'Готов' : 'Расставляет корабли') : 'Ожидание...'}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Уведомления */}
        <AnimatePresence>
          {notification && (
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center space-x-2"
            >
              <Bell className="w-5 h-5" />
              <span>{notification}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Чат */}
        <AnimatePresence>
          {showChat && (
            <motion.div
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              className="fixed right-4 top-4 z-40"
            >
              <Chat 
                gameId={gameData.game_id} 
                user={user} 
                onClose={() => setShowChat(false)}
                onMessagesLoaded={(messages) => {
                  if (messages.length > 0) {
                    const latestMessageId = Math.max(...messages.map(msg => msg.id))
                    setLastSeenMessageId(latestMessageId)
                  }
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Кнопка чата (перенос наверх) */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => {
            setShowChat(!showChat)
            if (!showChat) {
              // При открытии чата сбрасываем счетчик новых сообщений
              setNewMessageCount(0)
              // Обновляем ID последнего просмотренного сообщения
              if (messages && messages.length > 0) {
                const latestMessageId = Math.max(...messages.map(msg => msg.id))
                setLastSeenMessageId(latestMessageId)
              }
            }
          }}
          className="fixed top-4 left-4 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full shadow-lg z-30 relative"
        >
          <MessageCircle className="w-6 h-6" />
          {newMessageCount > 0 && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold"
            >
              {newMessageCount > 9 ? '9+' : newMessageCount}
            </motion.div>
          )}
        </motion.button>
      </div>
    </div>
  )
}

export default GameRoom 