import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Ship, Target, Zap, Clock, Trophy, X, HelpCircle, MessageCircle } from 'lucide-react'
import { getApiUrl, API_ENDPOINTS, logApiRequest, logApiResponse } from '../config'
import GameTimer from './GameTimer'
import Chat from './Chat'

 const Battle = ({ user, gameData, onNavigate }) => {
  const [battleState, setBattleState] = useState(null)
  const [selectedShip, setSelectedShip] = useState(null)
  const [selectedGroupShips, setSelectedGroupShips] = useState([])
  const [allowedMoves, setAllowedMoves] = useState([])
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [timeLeft, setTimeLeft] = useState(30)
  const [gameOver, setGameOver] = useState(false)
  const [winner, setWinner] = useState(null)
  const [showChat, setShowChat] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [notification, setNotification] = useState(null)
  const [fixedPerspective, setFixedPerspective] = useState(null)
  const [finalOutcome, setFinalOutcome] = useState(null)
  const [torpedoMode, setTorpedoMode] = useState(false)
  const [selectedTK, setSelectedTK] = useState(null)
  const [selectedTorpedo, setSelectedTorpedo] = useState(null)
  const [torpedoDirections, setTorpedoDirections] = useState([])
  const [airAttackMode, setAirAttackMode] = useState(false)
  const [selectedAircraftCarrier, setSelectedAircraftCarrier] = useState(null)
  const [selectedAircraft, setSelectedAircraft] = useState(null)
  const [airAttackDirections, setAirAttackDirections] = useState([])
  const [adjacentEnemy, setAdjacentEnemy] = useState(null) // Враг рядом для выбора "встать или атаковать"
  const [pendingMoveTarget, setPendingMoveTarget] = useState(null) // Куда хотим встать
  const [queuedAttackTarget, setQueuedAttackTarget] = useState(null)
  // Присоединение к бою
  const [joinMode, setJoinMode] = useState(false)       // режим выбора кораблей для присоединения
  const [joinShips, setJoinShips] = useState([])        // корабли, выбранные для join-предложения

  // Флаг блокировки - не обновляем isMyTurn из poll пока пользователь совершает действие
  const [actionInProgress, setActionInProgress] = useState(false)

  useEffect(() => {
    const myUserId = user?.id ?? user?.user_id
    console.log('🎯 Battle компонент инициализирован:', { gameData, user })
    
    const fetchBattleState = async () => {
      try {
        const url = getApiUrl(`${API_ENDPOINTS.BATTLE_STATE}/${gameData.game_id}`)
        logApiRequest(url, 'GET')
        
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        })
        
        if (response.ok) {
          const data = await response.json()
          logApiResponse(url, response.status, data)
          
          if (data.ok) {
            const finished = (data.status === 'finished')
            
            // Не перезаписываем battleState из поллинга, если игрок в процессе принятия решения
            // (adjacentEnemy не null - ждет выбора "стоять или атаковать").
            // Иначе запрос поллинга, отправленный ДО хода, может прийти ПОСЛЕ ответа на ход
            // и перезаписать позиции старыми данными — фишка визуально возвращается назад.
            if (!adjacentEnemy && !pendingMoveTarget) {
              setBattleState(data)
              setIsMyTurn(!finished && Number(data.current_turn) === Number(myUserId))
            }
            setTimeLeft(data.move_time_left || 30)

            if (finished) {
              setFinalOutcome(prev => {
                if (!prev) return { status: 'finished', winner_id: data.winner_id }
                if (prev?.winner_id == null && data.winner_id != null) {
                  return { ...prev, winner_id: data.winner_id }
                }
                return prev
              })
            }
            
            // Устанавливаем фиксированную перспективу один раз
            if (!fixedPerspective && data.player1_id && data.player2_id) {
              const isPlayer1 = parseInt(myUserId) === parseInt(data.player1_id)
              const perspective = isPlayer1 ? 'A_side' : 'N_side'
              setFixedPerspective(perspective)
              console.log('🎯 Установлена фиксированная перспектива:', perspective)
            }
          } else {
            console.error('❌ Ошибка в данных битвы:', data.error)
          }
        } else {
          const errorData = await response.json()
          console.error('❌ Ошибка получения состояния битвы:', errorData)
          logApiResponse(url, response.status, errorData)
        }
      } catch (err) {
        console.error('💥 Ошибка получения состояния битвы:', err)
      }
    }

    const sendHeartbeat = async () => {
      try {
        await fetch(getApiUrl(API_ENDPOINTS.HEARTBEAT), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        })
      } catch (err) {
        console.warn('Ошибка heartbeat в битве:', err)
      }
    }

    fetchBattleState()
    const stateInterval = setInterval(fetchBattleState, 1000)
    const heartbeatInterval = setInterval(sendHeartbeat, 30000) // Heartbeat каждые 30 секунд
    
    return () => {
      clearInterval(stateInterval)
      clearInterval(heartbeatInterval)
    }
  }, [gameData.game_id, user])

  useEffect(() => {
    if (timeLeft > 0 && isMyTurn) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [timeLeft, isMyTurn])

  const getMyUserId = () => (user?.id ?? user?.user_id)
  const userId = getMyUserId()
  const userIdInt = userId != null ? parseInt(userId) : null
  const winnerIdInt = battleState?.winner_id != null ? parseInt(battleState.winner_id) : null
  const effectiveStatus = finalOutcome?.status ?? battleState?.status
  const effectiveWinnerIdInt = finalOutcome?.winner_id != null ? parseInt(finalOutcome.winner_id) : winnerIdInt
  const isFinished = effectiveStatus === 'finished'
  
  const showNotification = (message, type = 'info') => {
    setNotification({ message, type, timestamp: Date.now() })
    setTimeout(() => setNotification(null), 3000)
  }

  const areShipsAdjacentClient = (ships) => {
    if (!ships || ships.length < 2) return true
    for (let i = 0; i < ships.length; i++) {
      let hasNeighbor = false
      for (let j = 0; j < ships.length; j++) {
        if (i === j) continue
        const d = Math.abs(ships[i].x - ships[j].x) + Math.abs(ships[i].y - ships[j].y)
        if (d === 1) {
          hasNeighbor = true
          break
        }
      }
      if (!hasNeighbor) return false
    }
    return true
  }

  const toggleGroupShipSelection = (ship) => {
    if (!ship) return
    if (!isMyTurn) {
      showNotification('❌ Группы можно создавать только в свой ход', 'error')
      return
    }
    if (battleState?.pending_combat) {
      showNotification('❌ Нельзя менять группы во время боя (Покер)', 'error')
      return
    }
    if (torpedoMode || airAttackMode) {
      showNotification('❌ Выйдите из спецрежима перед созданием группы', 'error')
      return
    }
    setSelectedShip(null)
    setAllowedMoves([])

    setSelectedGroupShips((prev) => {
      const exists = prev.some(s => s.id === ship.id)
      if (exists) {
        return prev.filter(s => s.id !== ship.id)
      }

      // Если выбираем корабль из существующей группы — разрешаем выбирать только его (для сброса)
      // и не смешиваем с кораблями без группы.
      if (ship.group_id) {
        if (prev.length > 0 && prev[0]?.group_id !== ship.group_id) {
          showNotification('❌ Для сброса выберите корабль из одной и той же группы', 'error')
          return prev
        }
        return [ship]
      }

      if (prev.length > 0 && prev[0]?.group_id) {
        showNotification('❌ Нельзя смешивать корабли из группы и вне группы', 'error')
        return prev
      }

      if (prev.length >= 3) {
        showNotification('❌ Группа максимум из 3 кораблей', 'error')
        return prev
      }
      const next = [...prev, ship]
      if (next.length >= 2 && !areShipsAdjacentClient(next)) {
        showNotification('❌ Корабли должны быть соседними (вплотную)', 'error')
        return prev
      }
      return next
    })
  }

  const createGroup = async () => {
    try {
      if (!isMyTurn) return
      if (battleState?.pending_combat) return
      if (selectedGroupShips.length < 2 || selectedGroupShips.length > 3) {
        showNotification('❌ Выберите 2–3 корабля для группы', 'error')
        return
      }
      if (selectedGroupShips.some(s => s.group_id)) {
        showNotification('❌ Нельзя создать группу: один из кораблей уже в группе', 'error')
        return
      }
      const shipIds = selectedGroupShips.map(s => s.id)
      const url = getApiUrl(`${API_ENDPOINTS.BATTLE_CREATE_GROUP}/${gameData.game_id}`)
      const payload = { ship_ids: shipIds }
      logApiRequest(url, 'POST', payload)
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      })
      const result = await response.json()
      logApiResponse(url, response.status, result)
      if (result.ok) {
        setBattleState(result.battle)
        setSelectedGroupShips([])
        showNotification('✅ Группа создана', 'info')
      } else {
        showNotification(`❌ ${result.error}`, 'error')
      }
    } catch (err) {
      console.error('Ошибка создания группы:', err)
      showNotification('💥 Ошибка создания группы', 'error')
    }
  }

  const disbandGroup = async () => {
    try {
      if (!isMyTurn) return
      if (battleState?.pending_combat) return
      if (selectedGroupShips.length !== 1 || !selectedGroupShips[0]?.group_id) {
        showNotification('❌ Выберите 1 корабль, который уже состоит в группе', 'error')
        return
      }
      const groupId = selectedGroupShips[0].group_id
      const url = getApiUrl(`${API_ENDPOINTS.BATTLE_DISBAND_GROUP}/${gameData.game_id}`)
      const payload = { group_id: groupId }
      logApiRequest(url, 'POST', payload)
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      })
      const result = await response.json()
      logApiResponse(url, response.status, result)
      if (result.ok) {
        setBattleState(result.battle)
        setSelectedGroupShips([])
        showNotification('✅ Группа расформирована', 'info')
      } else {
        showNotification(`❌ ${result.error}`, 'error')
      }
    } catch (err) {
      console.error('Ошибка расформирования группы:', err)
      showNotification('💥 Ошибка расформирования группы', 'error')
    }
  }

  // Система координат как в шахматах
  const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'] // 14 колонок
  const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] // 15 рядов

  // Функции конвертации координат
  const indexToCoord = (x, y) => {
    return `${COLUMNS[x]}${y + 1}`
  }

  const coordToIndex = (coord) => {
    const col = coord[0]
    const row = parseInt(coord.slice(1))
    return {
      x: COLUMNS.indexOf(col),
      y: row - 1
    }
  }

  const combatReveal = async () => {
    try {
      const url = getApiUrl(`/battle/combat_action/${gameData.game_id}`)
      const payload = { action: 'reveal' }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      })

      if (response.ok) {
        const result = await response.json()
        if (result.ok) {
          setBattleState(result.battle)
          const myUserId = user?.id ?? user?.user_id
          setIsMyTurn(result.battle?.status !== 'finished' && Number(result.battle.current_turn) === Number(myUserId))
        } else {
          showNotification(`❌ ${result.error}`, 'error')
        }
      } else {
        const err = await response.json()
        showNotification(`❌ ${err.error}`, 'error')
      }
    } catch (e) {
      console.error('💥 Ошибка combat reveal:', e)
      showNotification('💥 Ошибка действия в бою', 'error')
    }
  }

  const combatStop = async () => {
    try {
      const url = getApiUrl(`/battle/combat_action/${gameData.game_id}`)
      const payload = { action: 'stop' }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      })

      if (response.ok) {
        const result = await response.json()
        if (result.ok) {
          setBattleState(result.battle)
          if (result.battle?.status === 'finished') {
            setFinalOutcome(prev => {
              if (!prev) return { status: 'finished', winner_id: result.battle.winner_id }
              if (prev?.winner_id == null && result.battle.winner_id != null) {
                return { ...prev, winner_id: result.battle.winner_id }
              }
              return prev
            })
          }
          const myUserId = user?.id ?? user?.user_id
          setIsMyTurn(result.battle?.status !== 'finished' && Number(result.battle.current_turn) === Number(myUserId))
          setTimeLeft(result.battle.move_timer || 30)

          if (result.battle_info) {
            if (result.battle_info.attacker_destroyed && result.battle_info.defender_destroyed) {
              showNotification('💥 Бой завершён: взаимное уничтожение', 'warning')
            } else if (result.battle_info.defender_destroyed) {
              showNotification('🎯 Бой завершён: защитник уничтожен', 'success')
            } else if (result.battle_info.attacker_destroyed) {
              showNotification('😞 Бой завершён: атакующий уничтожен', 'error')
            } else {
              showNotification('⚔️ Бой завершён', 'info')
            }
          }
        } else {
          showNotification(`❌ ${result.error}`, 'error')
        }
      } else {
        const err = await response.json()
        showNotification(`❌ ${err.error}`, 'error')
      }
    } catch (e) {
      console.error('💥 Ошибка combat stop:', e)
      showNotification('💥 Ошибка завершения боя', 'error')
    }
  }

  const combatJoinPropose = async () => {
    if (!joinShips.length) {
      showNotification('❌ Выберите корабли для присоединения (Ctrl+клик по своим кораблям)', 'error')
      return
    }
    try {
      const url = getApiUrl(`/battle/combat_action/${gameData.game_id}`)
      const payload = { action: 'join_propose', ship_ids: joinShips.map(s => s.id) }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      })
      if (response.ok) {
        const result = await response.json()
        if (result.ok) {
          setBattleState(result.battle)
          const myUserId = user?.id ?? user?.user_id
          setIsMyTurn(result.battle?.status !== 'finished' && Number(result.battle.current_turn) === Number(myUserId))
          setJoinMode(false)
          setJoinShips([])
          showNotification(`⚔️ Предложение отправлено: +${payload.ship_ids.length} кораблей`, 'info')
        } else {
          showNotification(`❌ ${result.error}`, 'error')
        }
      } else {
        const err = await response.json()
        showNotification(`❌ ${err.error}`, 'error')
      }
    } catch (e) {
      console.error('💥 Ошибка join_propose:', e)
      showNotification('💥 Ошибка отправки предложения', 'error')
    }
  }

  const combatJoinAccept = async (responseShipIds = []) => {
    try {
      const url = getApiUrl(`/battle/combat_action/${gameData.game_id}`)
      const payload = { action: 'join_accept', ship_ids: responseShipIds }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      })
      if (response.ok) {
        const result = await response.json()
        if (result.ok) {
          setBattleState(result.battle)
          const myUserId = user?.id ?? user?.user_id
          setIsMyTurn(result.battle?.status !== 'finished' && Number(result.battle.current_turn) === Number(myUserId))
          setJoinMode(false)
          setJoinShips([])
          showNotification('✅ Предложение принято — корабли добавлены к бою', 'success')
        } else {
          showNotification(`❌ ${result.error}`, 'error')
        }
      } else {
        const err = await response.json()
        showNotification(`❌ ${err.error}`, 'error')
      }
    } catch (e) {
      console.error('💥 Ошибка join_accept:', e)
      showNotification('💥 Ошибка принятия предложения', 'error')
    }
  }

  const combatJoinDecline = async () => {
    try {
      const url = getApiUrl(`/battle/combat_action/${gameData.game_id}`)
      const payload = { action: 'join_decline' }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      })
      if (response.ok) {
        const result = await response.json()
        if (result.ok) {
          setBattleState(result.battle)
          const myUserId = user?.id ?? user?.user_id
          setIsMyTurn(result.battle?.status !== 'finished' && Number(result.battle.current_turn) === Number(myUserId))
          setJoinMode(false)
          setJoinShips([])
          showNotification('🚫 Предложение отклонено', 'info')
        } else {
          showNotification(`❌ ${result.error}`, 'error')
        }
      } else {
        const err = await response.json()
        showNotification(`❌ ${err.error}`, 'error')
      }
    } catch (e) {
      console.error('💥 Ошибка join_decline:', e)
      showNotification('💥 Ошибка отклонения предложения', 'error')
    }
  }

  // Функция для определения силы корабля (соответствует backend)
  const getShipStrength = (shipType) => {
    const strengthMap = {
      // Самые сильные корабли (согласно правилам)
      'БДК': 15,     // Большой десантный корабль - самый сильный
      'Л': 14,       // Линейный корабль (линкор)
      'АБ': 13,      // Атомная бомба
      'КРПЛ': 12,    // Крейсерская подводная лодка
      'КР': 11,      // Крейсер
      'А': 10,       // Авианосец
      'ЭС': 9,       // Эсминец
      'ПЛ': 8,       // Подводная лодка
      'Ф': 7,        // Фрегат
      'ТК': 6,       // Торпедный катер
      'ТР': 5,       // Тральщик
      'ТН': 4,       // Танкер
      'С': 3,        // Самолет
      'СТ': 2,       // Сторожевой корабль - самый слабый
      
      // Особые типы (взрывчатые/неподвижные)
      'Т': 1,        // Торпеда
      'М': 1,        // Мина
      'СМ': 0,       // Стационарная мина
      'ВМБ': 0,      // Военно-морская база
    }
    return strengthMap[shipType] || 1
  }

  const isExplosive = (shipType) => {
    return ['Т', 'М'].includes(shipType)
  }

  const getShipStrengthColor = (strength) => {
    if (strength >= 9) return 'text-red-500'      // Сверхсильные
    if (strength >= 7) return 'text-orange-500'   // Сильные
    if (strength >= 4) return 'text-yellow-500'   // Средние
    if (strength >= 2) return 'text-green-500'    // Слабые
    return 'text-gray-500'                        // Очень слабые/небоевые
  }

  // Определение роли игрока
  const getPlayerRole = () => {
    const myId = getMyUserId()
    const opponentId = Object.keys(battleState?.positions || {}).find(id => id !== String(myId))
    
    // Используем данные о ролях игроков из gameData или battleState, если доступны
    const player1Id = gameData?.player1_id || battleState?.player1_id
    const player2Id = gameData?.player2_id || battleState?.player2_id
    
    let isPlayer1
    if (player1Id !== undefined && player2Id !== undefined) {
      isPlayer1 = parseInt(myId) === parseInt(player1Id)
    } else {
      // Резервная логика, если данные о ролях недоступны
      isPlayer1 = parseInt(myId) < parseInt(opponentId)
    }
    
    // Player1 видит доску со стороны A (верх), Player2 со стороны N (низ)
    // Используем фиксированную перспективу, если она установлена
    const perspective = fixedPerspective || (isPlayer1 ? 'A_side' : 'N_side')
    const myZone = isPlayer1 ? 'rows_1_5' : 'rows_11_15' // Ряды 1-5 для Player1, 11-15 для Player2
    
    console.log('🎭 Определение роли игрока:', {
      myId,
      opponentId,
      player1Id,
      player2Id,
      isPlayer1,
      perspective,
      myZone,
      fixedPerspective,
      gameData
    })
    
    return { myId, opponentId, isPlayer1, perspective, myZone }
  }

  const getPendingCombatInfo = () => {
    const pending = battleState?.pending_combat
    if (!pending || !battleState?.positions) return null

    const attackerId = String(pending.attacker_player_id)
    const defenderId = String(pending.defender_player_id)
    const attackerShips = battleState.positions[attackerId] || []
    const defenderShips = battleState.positions[defenderId] || []
    const attackerIds = pending.attacker_ship_ids || []
    const defenderIds = pending.defender_ship_ids || []

    const computeStrength = (ships, ids, onlyRevealed = false) => {
      return ships
        .filter(s => ids.includes(s.id))
        .reduce((sum, ship) => {
          if (onlyRevealed && !ship.revealed) return sum
          return sum + getShipStrength(ship.type)
        }, 0)
    }

    return {
      attackerRevealedStrength: computeStrength(attackerShips, attackerIds, true),
      defenderRevealedStrength: computeStrength(defenderShips, defenderIds, true),
      attackerTotalStrength: computeStrength(attackerShips, attackerIds, false),
      defenderTotalStrength: computeStrength(defenderShips, defenderIds, false),
    }
  }

  // Получение доски с правильным отображением
  const getBoard = () => {
    if (!battleState || !battleState.positions) {
      return Array(15).fill().map(() => Array(14).fill(null))
    }

    const board = Array(15).fill().map(() => Array(14).fill(null))
    const { myId, opponentId, isPlayer1, perspective } = getPlayerRole()
    
    const myShips = battleState.positions[String(myId)] || []
    const enemyShips = battleState.positions[opponentId] || []

    console.log('🎯 Отображение доски:', { 
      myId, 
      opponentId, 
      isPlayer1,
      perspective,
      myShipsCount: myShips.length,
      enemyShipsCount: enemyShips.length
    })

    // Размещаем корабли напрямую без сложных преобразований
    // Player1 видит со стороны A: его корабли в рядах 1-5, врагов в рядах 11-15
    // Player2 видит со стороны N: его корабли в рядах 11-15, врагов в рядах 1-5
    
    // Размещаем свои корабли
    myShips.forEach((ship) => {
      if (ship.alive !== false && ship.x >= 0 && ship.x < 14 && ship.y >= 0 && ship.y < 15) {
        // Определяем начальное направление: игрок 1 смотрит вверх (к врагу), игрок 2 вниз
        const initialDirection = isPlayer1 ? 0 : 2 // 0=up, 2=down
        board[ship.y][ship.x] = { 
          ...ship, 
          owner: 'me',
          realX: ship.x,
          realY: ship.y,
          coord: indexToCoord(ship.x, ship.y),
          direction: ship.direction ?? initialDirection // 0=up, 1=right, 2=down, 3=left
        }
      }
    })

    // Размещаем вражеские корабли
    enemyShips.forEach((ship) => {
      if (ship.alive !== false && ship.x >= 0 && ship.x < 14 && ship.y >= 0 && ship.y < 15) {
        board[ship.y][ship.x] = { 
          ...ship, 
          owner: 'opponent',
          realX: ship.x,
          realY: ship.y,
          coord: indexToCoord(ship.x, ship.y)
          // Убираем изменение типа - передаем корабль как есть, revealed определяет отображение
        }
      }
    })

    return board
  }

  const pendingCombatInfo = getPendingCombatInfo()

  // Преобразование экранных координат в реальные (теперь 1:1)
  const screenToReal = (screenX, screenY) => {
    // Теперь экранные координаты = реальным координатам
    return { realX: screenX, realY: screenY }
  }

  const computeAllowedMoves = (ship) => {
    if (isFinished) return []
    if (!ship) return []
    const { myId, isPlayer1: player1 } = getPlayerRole()
    const myShips = battleState?.positions?.[String(myId)] || []
    
    console.log('🎯 Вычисляем ходы для корабля:', ship)
    
    // Определяем количество шагов для каждого типа корабля
    let maxSteps = 1
    
    if (ship.type === 'ТК') {
      maxSteps = 2
    } else if (['СМ', 'ВМБ'].includes(ship.type)) {
      maxSteps = 0
    } else if (ship.type === 'Т') {
      maxSteps = 1 // Торпеда всегда на 1 клетку за ход
    } else if (ship.type === 'С') {
      maxSteps = isNearCarrier(ship, 'А') ? 1 : 0
    } else if (ship.type === 'М') {
      maxSteps = isNearCarrier(ship, 'ЭС') ? 1 : 0
    }
    
    if (maxSteps === 0) return []
    
    const moves = []
    const carrierTypeMap = { 'Т': 'ТК', 'С': 'А', 'М': 'ЭС' }
    const carrierType = carrierTypeMap[ship.type]
    const dirs = (ship.type === 'Т' || ship.type === 'С' || ship.type === 'М')
      ? [[1,0], [-1,0], [0,1], [0,-1], [1,1], [1,-1], [-1,1], [-1,-1]]
      : [[1,0], [-1,0], [0,1], [0,-1]]
    
    const shipX = ship.realX ?? ship.x
    const shipY = ship.realY ?? ship.y
    
    console.log('🔍 Анализ ходов:', { 
      shipType: ship.type, 
      shipCoord: indexToCoord(shipX, shipY),
      shipX, 
      shipY, 
      maxSteps
    })
    
    for (const [dx, dy] of dirs) {
      for (let step = 1; step <= maxSteps; step++) {
        const nx = shipX + dx*step
        const ny = shipY + dy*step
        
        console.log(`🔎 Проверяем клетку: ${indexToCoord(nx, ny)} (${nx}, ${ny})`)
        
        // Проверяем границы поля
        if (nx < 0 || nx >= 14 || ny < 0 || ny >= 15) {
          console.log(`❌ Вне границ: ${indexToCoord(nx, ny)}`)
          break
        }
        
        // Проверяем занятость клетки
        const isOccupiedByMe = isCellOccupiedByMe(nx, ny)
        const isOccupiedByEnemy = isCellOccupiedByEnemy(nx, ny)
        
        console.log(`🔍 Занятость клетки ${indexToCoord(nx, ny)}: myShip=${isOccupiedByMe}, enemy=${isOccupiedByEnemy}`)
        
        if (isOccupiedByEnemy) {
          // ПРОВЕРКА "СТРОГО ВПЕРЕД" (только по вертикали в сторону противника)
          // Player 1 (A_side): вперед = вниз (ny > shipY), dx должен быть 0
          // Player 2 (N_side): вперед = вверх (ny < shipY), dx должен быть 0
          const isForward = player1 ? (ny > shipY && nx === shipX) : (ny < shipY && nx === shipX)
          
          if (isForward) {
            moves.push({ screenX: nx, screenY: ny, kind: 'attack' })
            console.log(`⚔️ Можно атаковать ВПЕРЁД: ${indexToCoord(nx, ny)}`)
          } else {
            console.log(`🚫 Враг ${indexToCoord(nx, ny)} не в зоне прямой атаки (только вперед)`)
          }
          // При встрече врага останавливаем движение
          break
        }
        
        if (isOccupiedByMe) {
          console.log(`🚫 Клетка ${indexToCoord(nx, ny)} занята моим кораблем`)
          break
        }

        // Спец-юниты должны оставаться рядом с носителем (включая диагональ)
        if (carrierType) {
          const tempShip = { x: nx, y: ny }
          const nearCarrier = isNearCarrier(tempShip, carrierType)
          
          if (!nearCarrier) {
            console.log(`🚫 Спец-юнит ${ship.type} в ${indexToCoord(nx, ny)} слишком далеко от ${carrierType}`)
            continue // Пробуем следующее направление, а не выходим из цикла совсем
          }

          if (ship.type === 'Т' || ship.type === 'С' || ship.type === 'М') {
            const requiredCarrierType = carrierTypeMap[ship.type]
            const carrier = myShips.find(s => {
              if (s.alive === false || s.type !== requiredCarrierType) return false
              const dx0 = Math.abs(shipX - s.x)
              const dy0 = Math.abs(shipY - s.y)
              return Math.max(dx0, dy0) === 1
            })
            if (!carrier) {
              console.log(`🚫 Носитель ${requiredCarrierType} не найден рядом со спец-юнитом ${ship.type}`)
              continue
            }

            const ring = [
              [-1, -1], [0, -1], [1, -1],
              [1, 0],
              [1, 1], [0, 1], [-1, 1],
              [-1, 0]
            ]

            const curDx = shipX - carrier.x
            const curDy = shipY - carrier.y
            const curIdx = ring.findIndex(([rx, ry]) => rx === curDx && ry === curDy)
            if (curIdx < 0) {
              console.log(`🚫 Спец-юнит ${ship.type} не на кольце вокруг ${requiredCarrierType} (cur=${curDx},${curDy})`)
              continue
            }

            const nextDx = nx - carrier.x
            const nextDy = ny - carrier.y
            const nextIdx = ring.findIndex(([rx, ry]) => rx === nextDx && ry === nextDy)
            if (nextIdx < 0) {
              console.log(`🚫 Спец-юнит ${ship.type} в ${indexToCoord(nx, ny)} не на кольце вокруг ${requiredCarrierType}`)
              continue
            }

            const leftIdx = (curIdx + 7) % 8
            const rightIdx = (curIdx + 1) % 8
            if (nextIdx !== leftIdx && nextIdx !== rightIdx) {
              console.log(`🚫 Прыжок по кольцу запрещен: ${indexToCoord(shipX, shipY)} -> ${indexToCoord(nx, ny)}`)
              continue
            }
          }
        }
        
        moves.push({ screenX: nx, screenY: ny, kind: 'move' })
        console.log(`✅ Можно переместиться: ${indexToCoord(nx, ny)}`)
      }
    }
    
    console.log('📋 Найденные ходы:', moves.map(m => `${indexToCoord(m.screenX, m.screenY)} (${m.kind})`))
    return moves
  }

  const isCellOccupiedByMe = (realX, realY) => {
    const { myId } = getPlayerRole()
    const myShips = battleState?.positions?.[String(myId)] || []
    return myShips.some(s => s.alive !== false && s.x === realX && s.y === realY)
  }

  const isCellOccupiedByEnemy = (realX, realY) => {
    const { myId, opponentId } = getPlayerRole()
    const enemyShips = battleState?.positions?.[opponentId] || []
    return enemyShips.some(s => s.alive !== false && s.x === realX && s.y === realY)
  }

  // Проверка близости носителя для спец-юнитов
  const isNearCarrier = (ship, carrierType) => {
    const { myId } = getPlayerRole()
    const myShips = battleState?.positions?.[String(myId)] || []
    const shipX = ship.realX ?? ship.x
    const shipY = ship.realY ?? ship.y
    
    for (const otherShip of myShips) {
      if (otherShip.alive !== false && otherShip.type === carrierType) {
        const dx = Math.abs(shipX - otherShip.x)
        const dy = Math.abs(shipY - otherShip.y)
        if (Math.max(dx, dy) === 1 && !(dx === 0 && dy === 0)) return true
      }
    }
    return false
  }

  const isTorpedoInFrontOfTK = (torpedoShip) => {
    const { myId } = getPlayerRole()
    const myShips = battleState?.positions?.[String(myId)] || []
    const tx = torpedoShip.realX ?? torpedoShip.x
    const ty = torpedoShip.realY ?? torpedoShip.y
    // Теперь торпеда считается "в позиции" если она на любой из 8 клеток вокруг ТК
    return myShips.some(s => {
      if (s.alive !== false && s.type === 'ТК') {
        const dx = Math.abs(tx - s.x)
        const dy = Math.abs(ty - s.y)
        return Math.max(dx, dy) === 1
      }
      return false
    })
  }

  // Поиск индекса корабля
  const findMyShipIndexById = (shipId) => {
    const { myId } = getPlayerRole()
    const myShips = battleState?.positions?.[String(myId)] || []
    return myShips.findIndex(s => s.id === shipId)
  }

  // Обработка движения
  const handleMoveTo = async (screenX, screenY) => {
    if (isFinished) return
    if (!selectedShip) return
    
    const idx = findMyShipIndexById(selectedShip.id)
    if (idx < 0) return
    
    try {
      const { realX, realY } = screenToReal(screenX, screenY)
      
      const url = getApiUrl(`${API_ENDPOINTS.BATTLE_MOVE}/${gameData.game_id}`)
      const moveData = { move: { ship_id: selectedShip.id, idx, to: [realX, realY] } }
      logApiRequest(url, 'POST', moveData)
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(moveData),
        credentials: 'include'
      })
      
      if (response.ok) {
        const result = await response.json()
        if (result.ok && result.battle) {
          setBattleState(result.battle)
          if (result.battle.status === 'finished') {
            setFinalOutcome(prev => {
              if (!prev) return { status: 'finished', winner_id: result.battle.winner_id }
              if (prev?.winner_id == null && result.battle.winner_id != null) {
                return { ...prev, winner_id: result.battle.winner_id }
              }
              return prev
            })
          }
          const myUserId = user?.id ?? user?.user_id
          setIsMyTurn(result.battle.status !== 'finished' && Number(result.battle.current_turn) === Number(myUserId))
          setTimeLeft(result.battle.move_timer || 30)
          showNotification('🚢 Корабль перемещен!', 'info')
          
          // Обновляем selectedShip актуальными координатами из battleState
          const { myId } = getPlayerRole()
          const myShips = result.battle?.positions?.[String(myId)] || []
          console.log('🔍 Updating selectedShip:', {myId, myShipsCount: myShips.length, selectedShipId: selectedShip?.id})
          const updatedShip = myShips.find(s => s.id === selectedShip.id && s.alive !== false)
          
          if (updatedShip) {
            console.log('✅ Found updatedShip:', {id: updatedShip.id, x: updatedShip.x, y: updatedShip.y})
            // Определяем направление движения
            const oldX = selectedShip.x ?? selectedShip.realX
            const oldY = selectedShip.y ?? selectedShip.realY
            const newX = updatedShip.x
            const newY = updatedShip.y
            let newDirection = selectedShip.direction
            if (newX > oldX) newDirection = 1 // вправо
            else if (newX < oldX) newDirection = 3 // влево
            else if (newY > oldY) newDirection = 2 // вниз
            else if (newY < oldY) newDirection = 0 // вверх
            
            setSelectedShip(prev => ({
              ...prev,
              x: updatedShip.x,
              y: updatedShip.y,
              realX: updatedShip.x,
              realY: updatedShip.y,
              direction: newDirection
            }))
            console.log('🚢 selectedShip updated:', {old: {x: oldX, y: oldY}, new: {x: newX, y: newY}, direction: newDirection})
          } else {
            console.log('❌ updatedShip not found!')
          }

          // Если после хода появилась возможность атаки (условное второе действие)
          if (result.can_attack_adjacent && Array.isArray(result.adjacent_enemies) && result.adjacent_enemies.length > 0) {
            setAdjacentEnemy(result.adjacent_enemies)
            setPendingMoveTarget({ x: realX, y: realY })
            setAllowedMoves(
              result.adjacent_enemies.map(e => ({ screenX: e.x, screenY: e.y, kind: 'attack' }))
            )
            showNotification('⚔️ Враг впереди! Выберите: атаковать или остаться', 'info')
            return
          }

          if (queuedAttackTarget) {
            const { screenX: tx, screenY: ty } = queuedAttackTarget
            setQueuedAttackTarget(null)
            handleAttackAt(tx, ty, result.battle)
            return
          }
          
          // Сбрасываем выбор после хода
          setSelectedShip(null)
          setAllowedMoves([])
          setAdjacentEnemy(null)
          setPendingMoveTarget(null)
        } else {
          console.error('❌ Ошибка движения (HTTP 200):', result)
          showNotification(`❌ Ошибка движения: ${result?.error || 'неизвестная ошибка'}`, 'error')
        }
      } else {
        const err = await response.json()
        console.error('❌ Ошибка движения:', err)
        showNotification(`❌ Ошибка движения: ${err.error}`, 'error')
      }
    } catch (e) {
      console.error('💥 Ошибка перемещения:', e)
      showNotification('💥 Ошибка перемещения', 'error')
    }
  }

  // Получить список врагов, находящихся рядом с кораблем (лицом к лицу)
  const getAdjacentEnemies = (ship, bState = battleState) => {
    if (!ship || !bState) return []
    const { opponentId } = getPlayerRole()
    const enemyShips = bState?.positions?.[opponentId] || []
    const shipX = ship.realX ?? ship.x
    const shipY = ship.realY ?? ship.y
    
    return enemyShips.filter(s => {
      if (s.alive === false) return false
      const distance = Math.abs(shipX - s.x) + Math.abs(shipY - s.y)
      return distance === 1
    })
  }

  // Атаковать соседнего врага (лицом к лицу)
  const attackAdjacentEnemy = async (enemy) => {
    if (isFinished) return
    if (!selectedShip || !enemy) return
    
    try {
      const url = getApiUrl(`${API_ENDPOINTS.BATTLE_MOVE}/${gameData.game_id}`)
      const attackData = { 
        attack: { 
          attacker_ship_id: selectedShip.id, 
          x: enemy.x, 
          y: enemy.y 
        } 
      }
      logApiRequest(url, 'POST', attackData)
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attackData),
        credentials: 'include'
      })
      
      if (response.ok) {
        const result = await response.json()
        if (result.ok && result.battle) {
          setBattleState(result.battle)
          if (result.battle.status === 'finished') {
            setFinalOutcome(prev => {
              if (!prev) return { status: 'finished', winner_id: result.battle.winner_id }
              if (prev?.winner_id == null && result.battle.winner_id != null) {
                return { ...prev, winner_id: result.battle.winner_id }
              }
              return prev
            })
          }
          const myUserId = user?.id ?? user?.user_id
          setIsMyTurn(result.battle.status !== 'finished' && Number(result.battle.current_turn) === Number(myUserId))
          setTimeLeft(result.battle.move_timer || 30)
          
          // Обрабатываем детальную информацию о бое
          if (result.battle_info) {
            const info = result.battle_info
            if (result.victory) {
              showNotification('🎉 Победа! Вы уничтожили все корабли противника!', 'success')
            } else if (info.attacker_destroyed && info.defender_destroyed) {
              showNotification(`💥 Взаимное уничтожение! Ваш ${info.attacker_type} и вражеский ${info.defender_type} уничтожены!`, 'warning')
            } else if (info.attacker_destroyed) {
              showNotification(`😞 Ваш корабль ${info.attacker_type} затоплен!`, 'error')
            } else if (info.defender_destroyed) {
              showNotification(`🎯 Вы победили! Вражеский ${info.defender_type} уничтожен!`, 'success')
            }
          } else {
            showNotification('💥 Атака выполнена!', 'info')
          }

          setSelectedShip(null)
          setAllowedMoves([])
          setAdjacentEnemy(null)
          setPendingMoveTarget(null)
        } else {
          showNotification(`❌ ${result.error || 'Ошибка атаки'}`, 'error')
        }
      } else {
        const err = await response.json()
        showNotification(`❌ ${err.error || 'Ошибка атаки'}`, 'error')
      }
    } catch (e) {
      console.error('💥 Ошибка атаки:', e)
      showNotification('💥 Ошибка атаки', 'error')
    }
  }

  // Завершить ход без атаки (просто встать)
  const endTurnWithoutAttack = async () => {
    if (isFinished) return
    try {
      const url = getApiUrl(`${API_ENDPOINTS.BATTLE_MOVE}/${gameData.game_id}`)
      const payload = { end_turn: true }
      logApiRequest(url, 'POST', payload)
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      })
      if (response.ok) {
        const result = await response.json()
        if (result.ok && result.battle) {
          setBattleState(result.battle)
          if (result.battle.status === 'finished') {
            setFinalOutcome(prev => {
              if (!prev) return { status: 'finished', winner_id: result.battle.winner_id }
              if (prev?.winner_id == null && result.battle.winner_id != null) {
                return { ...prev, winner_id: result.battle.winner_id }
              }
              return prev
            })
          }
          const myUserId = user?.id ?? user?.user_id
          setIsMyTurn(result.battle.status !== 'finished' && Number(result.battle.current_turn) === Number(myUserId))
          setTimeLeft(result.battle.move_timer || 30)
        }
      }
    } finally {
      setSelectedShip(null)
      setAllowedMoves([])
      setAdjacentEnemy(null)
      setPendingMoveTarget(null)
      showNotification('🛡️ Ход завершён без атаки', 'info')
    }
  }

  // Обработка атаки
  const handleAttackAt = async (screenX, screenY, freshBattleState = null) => {
    if (isFinished) return
    if (!selectedShip) return
    
    try {
      const { realX, realY } = screenToReal(screenX, screenY)
      
      // Получаем актуальные координаты атакующего корабля из battleState
      const { myId } = getPlayerRole()
      const bState = freshBattleState || battleState
      const myShips = bState?.positions?.[String(myId)] || []
      const actualShip = myShips.find(s => s.id === selectedShip.id && s.alive !== false)
      
      if (!actualShip) {
        showNotification('❌ Корабль не найден или уничтожен', 'error')
        return
      }
      
      const attackerX = actualShip.x
      const attackerY = actualShip.y
      
      console.log('⚔️ ATTACK ATTEMPT:', {
        selectedShip: {id: selectedShip.id, type: selectedShip.type, x: selectedShip.x, y: selectedShip.y, realX: selectedShip.realX, realY: selectedShip.realY},
        actualShip: {id: actualShip.id, type: actualShip.type, x: actualShip.x, y: actualShip.y},
        screenCoords: {screenX, screenY},
        realCoords: {realX, realY},
        distance: Math.abs(attackerX - realX) + Math.abs(attackerY - realY)
      })
      
      const url = getApiUrl(`${API_ENDPOINTS.BATTLE_MOVE}/${gameData.game_id}`)
      const attackData = { attack: { attacker_ship_id: selectedShip.id, x: realX, y: realY } }
      logApiRequest(url, 'POST', attackData)
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attackData),
        credentials: 'include'
      })
      
      if (response.ok) {
        const result = await response.json()
        if (result.ok && result.battle) {
          setBattleState(result.battle)
          if (result.battle.status === 'finished') {
            setFinalOutcome(prev => {
              if (!prev) return { status: 'finished', winner_id: result.battle.winner_id }
              if (prev?.winner_id == null && result.battle.winner_id != null) {
                return { ...prev, winner_id: result.battle.winner_id }
              }
              return prev
            })
          }
          const myUserId = user?.id ?? user?.user_id
          setIsMyTurn(result.battle.status !== 'finished' && Number(result.battle.current_turn) === Number(myUserId))
          setTimeLeft(result.battle.move_timer || 30)
          
          // Обрабатываем детальную информацию о бое
          if (result.battle_info) {
            const info = result.battle_info
            const myAttackerDestroyed = info.attacker_destroyed
            const enemyDefenderDestroyed = info.defender_destroyed
            
            if (result.victory) {
              showNotification('🎉 Победа! Вы уничтожили все корабли противника!', 'success')
            } else if (myAttackerDestroyed && enemyDefenderDestroyed) {
              // Взаимное уничтожение
              showNotification(`💥 Взаимное уничтожение! Ваш ${info.attacker_type} и вражеский ${info.defender_type} уничтожены!`, 'warning')
            } else if (myAttackerDestroyed) {
              // Наш корабль уничтожен
              showNotification(`😞 Ваш корабль ${info.attacker_type} затоплен!`, 'error')
            } else if (enemyDefenderDestroyed) {
              // Мы победили
              showNotification(`🎯 Вы победили! Вражеский ${info.defender_type} уничтожен!`, 'success')
            } else {
              // Никто не уничтожен (такого не должно быть, но на всякий случай)
              showNotification(`🔍 Корабль ${info.defender_type} обнаружен!`, 'info')
            }
          } else {
            showNotification('💥 Атака выполнена!', 'info')
          }

          setSelectedShip(null)
          setAllowedMoves([])
        } else {
          console.error('❌ Ошибка атаки (HTTP 200):', result)
          showNotification(`❌ Ошибка атаки: ${result?.error || 'неизвестная ошибка'}`, 'error')
        }
      } else {
        const err = await response.json()
        console.error('❌ Ошибка атаки:', err)
        showNotification(`❌ Ошибка атаки: ${err.error}`, 'error')
      }
    } catch (e) {
      console.error('💥 Ошибка атаки:', e)
      showNotification('💥 Ошибка атаки', 'error')
    }
  }

  // Обработка паузы
  const handlePause = async (type) => {
    try {
      const url = getApiUrl(`${API_ENDPOINTS.PAUSE_START}/${gameData.game_id}`)
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
        credentials: 'include'
      })
      
      if (response.ok) {
        showNotification('⏸️ Пауза активирована', 'info')
      }
    } catch (e) {
      console.error('💥 Ошибка паузы:', e)
    }
  }

  // Выход из игры
  const handleLeaveGame = async () => {
    try {
      const url = getApiUrl(`${API_ENDPOINTS.LEAVE_GAME}/${gameData.game_id}`)
      await fetch(url, {
        method: 'POST',
        credentials: 'include'
      })
      onNavigate('mainMenu')
    } catch (e) {
      console.error('💥 Ошибка выхода:', e)
      onNavigate('mainMenu')
    }
  }

  // Torpedo shooting functions
  const enterTorpedoMode = () => {
    setTorpedoMode(true)
    setSelectedShip(null)
    setSelectedGroupShips([])
    setAllowedMoves([])
    setSelectedTK(null)
    setSelectedTorpedo(null)
    setTorpedoDirections([])
    showNotification('🚀 Режим торпедной атаки. Выберите торпедный катер (ТК)', 'info')
  }

  const exitTorpedoMode = () => {
    setTorpedoMode(false)
    setSelectedTK(null)
    setSelectedTorpedo(null)
    setTorpedoDirections([])
    showNotification('❌ Режим торпедной атаки отменен', 'info')
  }

  const selectTKForTorpedo = (ship) => {
    if (ship.type !== 'ТК') {
      showNotification('❌ Выберите торпедный катер (ТК)', 'error')
      return
    }
    setSelectedTK(ship)
    showNotification('🎯 Торпедный катер выбран. Теперь выберите торпеду (Т)', 'info')
  }

  const selectTorpedoForShooting = async (ship) => {
    if (ship.type !== 'Т') {
      showNotification('❌ Выберите торпеду (Т)', 'error')
      return
    }
    if (!selectedTK) {
      showNotification('❌ Сначала выберите торпедный катер', 'error')
      return
    }

    setSelectedTorpedo(ship)
    
    // Получаем доступные направления для стрельбы
    try {
      const url = getApiUrl(`/battle/torpedo_directions/${gameData.game_id}`)
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tk_id: selectedTK.id,
          t_id: ship.id
        }),
        credentials: 'include'
      })

      if (response.ok) {
        const result = await response.json()
        if (result.ok) {
          setTorpedoDirections(result.directions)
          if (result.directions.length === 0) {
            showNotification('❌ Нет доступных направлений для торпедного выстрела', 'error')
          } else {
            showNotification(`🚀 Доступно ${result.directions.length} направлений для стрельбы. Выберите цель.`, 'success')
          }
        } else {
          showNotification(`❌ ${result.error}`, 'error')
        }
      } else {
        const err = await response.json()
        showNotification(`❌ ${err.error}`, 'error')
      }
    } catch (e) {
      console.error('💥 Ошибка получения направлений торпеды:', e)
      showNotification('💥 Ошибка получения направлений торпеды', 'error')
    }
  }

  const fireTorpedoAt = async (targetX, targetY) => {
    if (isFinished) return
    if (!selectedTK || !selectedTorpedo) {
      showNotification('❌ Выберите торпедный катер и торпеду', 'error')
      return
    }

    try {
      const url = getApiUrl(`${API_ENDPOINTS.BATTLE_MOVE}/${gameData.game_id}`)
      const torpedoData = {
        torpedo_shot: {
          tk_id: selectedTK.id,
          t_id: selectedTorpedo.id,
          target: [targetX, targetY]
        }
      }
      logApiRequest(url, 'POST', torpedoData)
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(torpedoData),
        credentials: 'include'
      })
      
      if (response.ok) {
        const result = await response.json().catch((e) => {
          console.error('💥 Torpedo shot: failed to parse JSON:', e)
          return null
        })
        logApiResponse(url, response.status, result)
        console.log('🚀 Torpedo shot response:', { status: response.status, result })
        if (result.ok) {
          setBattleState(result.battle)
          const myUserId = user?.id ?? user?.user_id
          setIsMyTurn(Number(result.battle.current_turn) === Number(myUserId))
          setTimeLeft(result.battle.move_timer || 30)
          
          // Показываем результат торпедного выстрела
          const shotResult = result.torpedo_shot_result
          if (shotResult.destroyed_enemy) {
            showNotification(`💥 Торпеда уничтожила ${shotResult.destroyed_enemy.type} в ${indexToCoord(shotResult.destroyed_enemy.x, shotResult.destroyed_enemy.y)}!`, 'success')
          } else {
            showNotification('💨 Торпеда не попала ни в одну цель', 'info')
          }
          
          if (result.victory) {
            showNotification('🎉 Победа! Вы уничтожили все корабли противника!', 'success')
          }
          
          // Выходим из режима торпед
          exitTorpedoMode()
        } else {
          console.error('❌ Torpedo shot rejected:', result)
          showNotification(`❌ ${result.error || 'Ошибка торпедного выстрела'}`, 'error')
          exitTorpedoMode()
        }
      } else {
        const err = await response.json().catch(() => ({}))
        logApiResponse(url, response.status, err)
        console.error('❌ Torpedo shot HTTP error:', { status: response.status, err })
        showNotification(`❌ ${err.error || 'Ошибка торпедного выстрела'}`, 'error')
        exitTorpedoMode()
      }
    } catch (e) {
      console.error('💥 Ошибка торпедного выстрела:', e)
      showNotification('💥 Ошибка торпедного выстрела', 'error')
      exitTorpedoMode()
    }
  }

  const enterAirAttackMode = () => {
    setAirAttackMode(true)
    setSelectedShip(null)
    setSelectedGroupShips([])
    setAllowedMoves([])
    setSelectedAircraftCarrier(null)
    setSelectedAircraft(null)
    setAirAttackDirections([])
    showNotification('✈️ Режим воздушной атаки. Выберите авианосец (А)', 'info')
  }

  const exitAirAttackMode = ({ silent = false } = {}) => {
    setAirAttackMode(false)
    setSelectedAircraftCarrier(null)
    setSelectedAircraft(null)
    setAirAttackDirections([])
    if (!silent) {
      showNotification('❌ Режим воздушной атаки отменен', 'info')
    }
  }

  const selectAircraftCarrierForAttack = (ship) => {
    if (ship.type !== 'А') {
      showNotification('❌ Выберите авианосец (А)', 'error')
      return
    }
    setSelectedAircraftCarrier(ship)
    showNotification('🎯 Авианосец выбран. Теперь выберите самолет (С)', 'info')
  }

  const selectAircraftForAttack = async (ship) => {
    if (ship.type !== 'С') {
      showNotification('❌ Выберите самолет (С)', 'error')
      return
    }
    if (!selectedAircraftCarrier) {
      showNotification('❌ Сначала выберите авианосец', 'error')
      return
    }

    setSelectedAircraft(ship)
    
    // Получаем доступные направления для воздушной атаки
    try {
      const url = getApiUrl(`/battle/air_directions/${gameData.game_id}`)
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          a_id: selectedAircraftCarrier.id,
          s_id: ship.id
        }),
        credentials: 'include'
      })

      if (response.ok) {
        const result = await response.json()
        if (result.ok) {
          setAirAttackDirections(result.directions)
          if (result.directions.length === 0) {
            showNotification('❌ Нет доступных направлений для воздушной атаки. Самолет должен быть рядом с авианосцем.', 'error')
          } else {
            showNotification(`✈️ Доступно ${result.directions.length} направлений для воздушной атаки. Выберите направление.`, 'success')
          }
        } else {
          showNotification(`❌ ${result.error}`, 'error')
        }
      } else {
        const err = await response.json()
        showNotification(`❌ ${err.error}`, 'error')
      }
    } catch (e) {
      console.error('💥 Ошибка получения направлений воздушной атаки:', e)
      showNotification('💥 Ошибка получения направлений воздушной атаки', 'error')
    }
  }

  const executeAirAttack = async (direction) => {
    if (isFinished) return
    if (!selectedAircraftCarrier || !selectedAircraft) {
      showNotification('❌ Выберите авианосец и самолет', 'error')
      return
    }

    try {
      const url = getApiUrl(`${API_ENDPOINTS.BATTLE_MOVE}/${gameData.game_id}`)
      const airAttackData = {
        air_attack: {
          a_id: selectedAircraftCarrier.id,
          s_id: selectedAircraft.id,
          direction: direction
        }
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(airAttackData),
        credentials: 'include'
      })
      
      if (response.ok) {
        const result = await response.json()
        if (result.ok) {
          setBattleState(result.battle)
          if (result.battle?.status === 'finished') {
            setFinalOutcome(prev => {
              if (!prev) return { status: 'finished', winner_id: result.battle.winner_id }
              if (prev?.winner_id == null && result.battle.winner_id != null) {
                return { ...prev, winner_id: result.battle.winner_id }
              }
              return prev
            })
          }
          const myUserId = user?.id ?? user?.user_id
          setIsMyTurn(result.battle?.status !== 'finished' && Number(result.battle.current_turn) === Number(myUserId))
          setTimeLeft(result.battle.move_timer || 30)
          
          // Показываем результат воздушной атаки
          const attackResult = result.air_attack_result
          if (attackResult.destroyed_enemies && attackResult.destroyed_enemies.length > 0) {
            const destroyedTypes = attackResult.destroyed_enemies.map(e => e.type).join(', ')
            showNotification(`✈️ Воздушная атака уничтожила ${attackResult.destroyed_enemies.length} кораблей: ${destroyedTypes}!`, 'success')
          } else {
            showNotification('💨 Воздушная атака не попала в цели', 'info')
          }
          
          if (result.victory) {
            showNotification('🎉 Победа! Вы уничтожили все корабли противника!', 'success')
          }
          
          // Выходим из режима воздушной атаки
          exitAirAttackMode({ silent: true })
        } else {
          showNotification(`❌ ${result.error}`, 'error')
        }
      } else {
        const err = await response.json()
        showNotification(`❌ ${err.error}`, 'error')
      }
    } catch (e) {
      console.error('💥 Ошибка воздушной атаки:', e)
      showNotification('💥 Ошибка воздушной атаки', 'error')
    }
  }

  // Рендеринг доски
    const renderBoard = () => {
    const board = getBoard()
    const { perspective } = getPlayerRole()

    // Для игрока 1 (A_side) переворачиваем отображение поля снизу вверх
    // Используем фиксированную перспективу для предотвращения переворачивания при обновлениях
    const shouldFlip = (fixedPerspective || perspective) === 'A_side'
    const displayBoard = shouldFlip ? [...board].reverse() : board
    
    return (
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
        {displayBoard.map((row, displayY) => {
          // Вычисляем реальный Y-индекс для координат
          const realY = shouldFlip ? (14 - displayY) : displayY
          
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
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={(e) => {
                  // Логируем ВСЕ клики для отладки
                  console.log('🖱️ CLICK:', { 
                    x, realY, 
                    cellOwner: cell?.owner, 
                    cellType: cell?.type,
                    selectedShip: selectedShip?.type,
                    isMyTurn,
                    allowedMovesCount: allowedMoves.length
                  })

                  if (isFinished) {
                    return
                  }
                  
                  // При активном бою разрешаем клики - панель боя справа позволяет действия
                  if (battleState?.pending_combat) {
                    // В режиме присоединения к бою: Ctrl+клик по своим кораблям
                    if (joinMode && (e?.ctrlKey || e?.metaKey) && cell?.owner === 'me' && isMyTurn) {
                      const alreadyInCombat = (battleState.pending_combat.attacker_ship_ids || []).includes(cell?.id) ||
                                              (battleState.pending_combat.defender_ship_ids || []).includes(cell?.id)
                      if (alreadyInCombat) {
                        showNotification('❌ Этот корабль уже участвует в бою', 'error')
                        return
                      }
                      setJoinShips(prev => {
                        const exists = prev.some(s => s.id === cell.id)
                        if (exists) return prev.filter(s => s.id !== cell.id)
                        return [...prev, cell]
                      })
                      return
                    }
                    return
                  }

                  // Torpedo mode logic
                  if (torpedoMode) {
                    // 1) Если направления уже рассчитаны — разрешаем клик по подсвеченным клеткам
                    // независимо от того, что находится в клетке. Иначе клики могут "съедаться"
                    // веткой выбора своих кораблей.
                    if (torpedoDirections.length > 0) {
                      for (const dirInfo of torpedoDirections) {
                        if (dirInfo.target_positions?.some(pos => pos[0] === x && pos[1] === realY)) {
                          fireTorpedoAt(x, realY)
                          return
                        }
                      }
                    }

                    // 2) Этап выбора ТК/Торпеды
                    if (cell?.owner === 'me') {
                      if (cell.type === 'ТК' && !selectedTK) {
                        selectTKForTorpedo(cell)
                      } else if (cell.type === 'Т' && selectedTK && !selectedTorpedo) {
                        selectTorpedoForShooting(cell)
                      }
                    }
                    return
                  }
                  
                  // Air attack mode logic
                  if (airAttackMode) {
                    if (cell?.owner === 'me') {
                      if (cell.type === 'А' && !selectedAircraftCarrier) {
                        selectAircraftCarrierForAttack(cell)
                      } else if (cell.type === 'С' && selectedAircraftCarrier && !selectedAircraft) {
                        selectAircraftForAttack(cell)
                      }
                    } else if (airAttackDirections.length > 0) {
                      // Проверяем, можно ли атаковать в эту клетку
                      for (const dirInfo of airAttackDirections) {
                        if (dirInfo.target_positions.some(pos => pos[0] === x && pos[1] === realY)) {
                          executeAirAttack(dirInfo.direction)
                          return
                        }
                      }
                    }
                    return
                  }
                  
                  // Обычный режим
                  console.log('🔍 Поиск хода:', { x, realY, allowedMoves: allowedMoves.map(m => ({sx: m.screenX, sy: m.screenY, kind: m.kind})) })
                  const move = allowedMoves.find(m => m.screenX === x && m.screenY === realY)
                  console.log('🔍 Найден ход:', move)

                  if (adjacentEnemy && pendingMoveTarget && isMyTurn) {
                    if (cell?.owner === 'me') {
                      endTurnWithoutAttack()
                      return
                    }
                    if (!move) {
                      showNotification('⚔️ Выберите: атаковать подсвеченную цель или нажмите на свою фишку, чтобы остаться', 'info')
                      return
                    }
                  }

                  if (move) {
                    if (move.kind === 'attack') {
                      console.log('⚔️ EXECUTING ATTACK:', {screenX: x, screenY: realY, selectedShip: {id: selectedShip?.id, type: selectedShip?.type, x: selectedShip?.x, y: selectedShip?.y, realX: selectedShip?.realX, realY: selectedShip?.realY}})
                      handleAttackAt(x, realY)
                    } else {
                      handleMoveTo(x, realY)
                    }
                    return
                  }

                  // Fallback: если клик по вражеской клетке при выбранном корабле
                  // и дистанция 1 (лицом к лицу) — выполняем атаку даже если allowedMoves
                  // почему-то не содержит kind:'attack'.
                  console.log('🔍 Fallback check:', {
                    cellOwner: cell?.owner,
                    cellType: cell?.type,
                    selectedShip: selectedShip?.type,
                    selectedShipCoords: selectedShip ? {x: selectedShip.realX ?? selectedShip.x, y: selectedShip.realY ?? selectedShip.y} : null,
                    isMyTurn,
                    clickCoords: {x, realY}
                  })
                  if (cell?.owner === 'opponent' && selectedShip && isMyTurn) {
                    const sx = selectedShip.realX ?? selectedShip.x
                    const sy = selectedShip.realY ?? selectedShip.y
                    const dist = Math.abs(sx - x) + Math.abs(sy - realY)
                    console.log('🔍 Distance check:', {sx, sy, x, realY, dist})
                    if (dist === 1) {
                      console.log('⚔️ Fallback dist=1 attack triggered!')
                      handleAttackAt(x, realY)
                      return
                    }

                    if (dist === 2 && (sx === x || sy === realY)) {
                      console.log('⚔️ Fallback dist=2 straight-line attack triggered!')
                      handleAttackAt(x, realY)
                      return
                    }
                  }
                  
                  // Выбор своего корабля
                  if (cell?.owner === 'me' && isMyTurn) {
                    // Ctrl/Cmd-клик — выделение для создания группы
                    if (cell && (e?.ctrlKey || e?.metaKey)) {
                      toggleGroupShipSelection(cell)
                      return
                    }
                    setSelectedShip(cell)
                    setSelectedGroupShips([])
                    setAllowedMoves(computeAllowedMoves(cell))
                  } else {
                    setSelectedShip(null)
                    setSelectedGroupShips([])
                    setAllowedMoves([])
                  }
                }}
                className={`w-8 h-8 border border-gray-600 rounded flex items-center justify-center cursor-pointer relative ${
                  cell?.alive === false ? 'bg-red-600' : 
                  cell?.type ? (cell?.owner === 'me' ? 'bg-blue-600' : 'bg-red-600') : 'bg-gray-800'
                } ${
                  battleState?.pending_combat?.attacker_ship_ids?.includes(cell?.id) ? 'ring-2 ring-cyan-400' : ''
                } ${
                  battleState?.pending_combat?.defender_ship_ids?.includes(cell?.id) ? 'ring-2 ring-pink-400' : ''
                } ${
                  selectedShip?.id === cell?.id ? 'ring-2 ring-blue-400' : ''
                } ${
                  selectedGroupShips?.some(s => s.id === cell?.id) ? 'ring-2 ring-green-400' : ''
                } ${
                  selectedTK?.id === cell?.id ? 'ring-2 ring-yellow-400' : ''
                } ${
                  selectedTorpedo?.id === cell?.id ? 'ring-2 ring-purple-400' : ''
                } ${
                  selectedAircraftCarrier?.id === cell?.id ? 'ring-2 ring-orange-400' : ''
                } ${
                  selectedAircraft?.id === cell?.id ? 'ring-2 ring-pink-400' : ''
                } ${
                  joinShips?.some(s => s.id === cell?.id) ? 'ring-2 ring-yellow-300' : ''
                } ${
                  allowedMoves.some(m => m.screenX === x && m.screenY === realY && m.kind === 'move') ? 'bg-green-500 hover:bg-green-600' : ''
                } ${
                  allowedMoves.some(m => m.screenX === x && m.screenY === realY && m.kind === 'attack') ? 'bg-yellow-500 hover:bg-yellow-600' : ''
                } ${
                  torpedoDirections.some(dir => 
                    dir.target_positions.some(pos => pos[0] === x && pos[1] === realY)
                  ) ? 'bg-purple-500 hover:bg-purple-600' : ''
                } ${
                  airAttackDirections.some(dir => 
                    dir.target_positions.some(pos => pos[0] === x && pos[1] === realY)
                  ) ? 'bg-orange-500 hover:bg-orange-600' : ''
                }`}
                title={indexToCoord(x, realY)} // Показываем координату при наведении
              >
                {cell?.alive === false && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-full h-full flex items-center justify-center text-white"
                  >
                    <X size={12} />
                  </motion.div>
                )}

                {cell?.type && cell?.alive !== false && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-full h-full flex flex-col items-center justify-center text-white text-xs font-bold"
                  >
                    <div className={`text-xs ${
                      cell.owner === 'me' 
                        ? getShipStrengthColor(getShipStrength(cell.type))
                        : 'text-white'
                    }`}>
                      {cell.owner === 'opponent' 
                        ? (cell.revealed ? cell.type : '')  // Показываем тип только если раскрыт, иначе пустота
                        : cell.type
                      }
                    </div>
                    {/* Показываем силу для своих кораблей */}
                    {cell.owner === 'me' && getShipStrength(cell.type) > 0 && (
                      <div className="text-xs opacity-75">
                        {isExplosive(cell.type) ? '💥' : getShipStrength(cell.type)}
                      </div>
                    )}
                    {/* Показываем силу для раскрытых вражеских кораблей */}
                    {cell.owner === 'opponent' && cell.revealed && getShipStrength(cell.type) > 0 && (
                      <div className="text-xs opacity-75">
                        {isExplosive(cell.type) ? '💥' : getShipStrength(cell.type)}
                      </div>
                    )}
                  </motion.div>
                )}
                
                {/* Показываем название убитого корабля */}
                {cell?.alive === false && cell?.type && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute bottom-0 right-0 text-yellow-300 text-xs font-bold bg-black bg-opacity-50 px-1 rounded"
                    style={{ fontSize: '8px' }}
                  >
                    {cell.type}
                  </motion.div>
                )}
                
                {/* Показываем координаты для пустых клеток при отладке */}
                {!cell?.type && (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs opacity-30">
                    {indexToCoord(x, realY)}
                  </div>
                )}
              </motion.div>
            ))}
            </div>
          )
        })}
        
        {/* Подпись перспективы */}
        <div className="text-center mt-2 text-white text-sm">
          Вид со стороны: <span className="font-bold">{shouldFlip ? 'A (Север)' : 'N (Юг)'}</span>
        </div>
        
        {/* Справка о боевой системе */}
        <div className="mt-4 p-3 bg-gray-800 rounded-lg text-xs text-white">
          <div className="font-bold mb-2">⚔️ Боевая система:</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-red-500">●</span> Сверхсильные (9-10): АБ, Л</div>
            <div><span className="text-orange-500">●</span> Сильные (7-8): КР, КРПЛ</div>
            <div><span className="text-yellow-500">●</span> Средние (4-6): БДК, ЭС, С, Ф, ПЛ</div>
            <div><span className="text-green-500">●</span> Слабые (2-3): ТК, СТ, А, ТН, ТР</div>
          </div>
          <div className="mt-2 text-gray-300">
            💥 Торпеды (Т) и Мины (М) взрывают любой корабль, но гибнут сами<br/>
            🛡️ При любой атаке корабль противника раскрывается<br/>
            ⚔️ Сильный корабль побеждает слабого
          </div>
        </div>
      </div>
    )
  }

  if (!battleState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full mx-auto mb-4"
          />
          <p className="text-white text-lg">Загрузка битвы...</p>
        </div>
      </div>
    )
  }

  if (!battleState.positions || Object.keys(battleState.positions).length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-white text-lg mb-4">Ожидание инициализации битвы...</p>
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full mx-auto"
          />
        </div>
      </div>
    )
  }

  const shipInfo = {
    'БДК': { name: 'Большой десантный корабль', movement: '1 клетка', power: '15', description: 'Самый сильный рейтинг, уязвим к ПЛ' },
    'КР': { name: 'Крейсер', movement: '1 клетка', power: '11', description: 'Мощный боевой корабль, уязвим к КРПЛ' },
    'А': { name: 'Авианосец', movement: '1 клетка', power: '10', description: 'Носитель самолетов, воздушная атака, уязвим к ПЛ' },
    'С': { name: 'Самолет', movement: 'Вокруг А', power: '3', description: 'Воздушная единица, следует за авианосцем' },
    'ТН': { name: 'Танкер', movement: '1 клетка', power: '4', description: 'Взрывается при любом взаимодействии' },
    'Л': { name: 'Линейный корабль', movement: '1 клетка', power: '14', description: 'Мощный линкор, тяжелая артиллерия' },
    'ЭС': { name: 'Эсминец', movement: '1 клетка', power: '9', description: 'Основной боевой корабль, носитель мин' },
    'М': { name: 'Мина', movement: 'Вокруг ЭС', power: '1', description: 'Взрывает все корабли, кроме ТР' },
    'СМ': { name: 'Стационарная мина', movement: 'Неподвижна', power: '0', description: 'Взрывает любой корабль, включая ТР' },
    'Ф': { name: 'Фрегат', movement: '1 клетка', power: '7', description: 'Универсальный боевой корабль' },
    'ТК': { name: 'Торпедный катер', movement: '1-2 клетки', power: '6', description: 'Быстрый корабль, носитель торпед' },
    'Т': { name: 'Торпеда', movement: 'Вокруг ТК', power: '1', description: 'Взрывчатое оружие, 7-направленный выстрел' },
    'ТР': { name: 'Тральщик', movement: '1 клетка', power: '5', description: 'Обезвреживает обычные мины' },
    'СТ': { name: 'Сторожевой корабль', movement: '1 клетка', power: '2', description: 'Самый слабый рейтинг, патрульное судно' },
    'ПЛ': { name: 'Подводная лодка', movement: '1 клетка', power: '8', description: 'Уничтожает БДК и Авианосцы' },
    'КРПЛ': { name: 'Крейсерская ПЛ', movement: '1 клетка', power: '12', description: 'Тяжелая подлодка, уничтожает крейсеры' },
    'АБ': { name: 'Атомная бомба', movement: 'Неподвижна', power: '13', description: 'Взрыв 5x5 клеток, цепная реакция' },
    'ВМБ': { name: 'Военно-морская база', movement: 'Неподвижна', power: '0', description: 'Главная цель - уничтожьте 2 шт.' }
  }

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <h1 className="text-3xl font-bold text-white mb-2">Морская битва</h1>
          <p className="text-gray-300">Тактическая морская игра</p>
        </motion.div>

        {/* Уведомления */}
        <AnimatePresence>
          {notification && (
            <motion.div
              initial={{ opacity: 0, y: -50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -50 }}
              className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-lg text-white font-semibold text-center max-w-md shadow-lg ${
                notification.type === 'success' ? 'bg-green-600' :
                notification.type === 'error' ? 'bg-red-600' :
                notification.type === 'warning' ? 'bg-orange-600' :
                'bg-blue-600'
              }`}
            >
              {notification.message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Таймер игры */}
        <GameTimer 
          gameId={gameData.game_id} 
          user={user} 
          onTimeOut={(type) => {
            if (type === 'turn_timeout') {
              console.log('Время хода истекло')
            }
          }}
        />

        {/* Верхняя панель с кнопками */}
        <div className="flex justify-between items-center mb-4">
          <button
            onClick={() => onNavigate('mainMenu')}
            className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg transition-colors text-white"
          >
            Вернуться в лобби
          </button>
          
          <div className="flex items-center space-x-4">
            {/* Кнопка помощи */}
            <button
              onClick={() => setHelpOpen(!helpOpen)}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 text-white"
            >
              <HelpCircle size={20} />
              <span>Помощь</span>
            </button>
            
            {/* Кнопка чата */}
            <button
              onClick={() => setShowChat(!showChat)}
              className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 text-white"
            >
              <MessageCircle size={20} />
              <span>Чат</span>
            </button>
          </div>
        </div>

        {/* Окно помощи */}
        <AnimatePresence>
          {helpOpen && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-gray-800 border border-gray-600 rounded-lg p-6 max-w-4xl max-h-96 overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-blue-400">Справка по кораблям</h2>
                <button
                  onClick={() => setHelpOpen(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X size={24} />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(shipInfo).map(([symbol, info]) => (
                  <div key={symbol} className="bg-gray-700 p-4 rounded-lg border border-gray-600">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-2xl font-bold text-yellow-400">{symbol}</span>
                      <span className="text-lg font-semibold text-white">{info.name}</span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p><span className="text-green-400">Движение:</span> {info.movement}</p>
                      <p><span className="text-red-400">Сила:</span> {info.power}</p>
                      <p className="text-gray-300">{info.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 mb-8 items-start">
          {/* Левая колонка - чат */}
          <div className="xl:col-span-1 relative order-3 xl:order-1">
            {showChat && (
              <div className="relative">
                <Chat gameId={gameData.game_id} user={user} onClose={() => setShowChat(false)} />
              </div>
            )}
          </div>

          {/* Центральная колонка - поле и статус */}
          <div className="xl:col-span-2 order-1 xl:order-2 flex flex-col gap-6">
            {isFinished && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
                <div className="bg-gray-900/90 backdrop-blur-md border-4 border-yellow-500 rounded-2xl p-8 text-center shadow-[0_0_50px_rgba(234,179,8,0.3)] animate-in fade-in zoom-in duration-500 max-w-2xl w-full">
                  <div className="text-5xl mb-4">
                    {userIdInt != null && effectiveWinnerIdInt === userIdInt ? '🏆' : 
                     effectiveWinnerIdInt === -1 ? '⚖️' : '💀'}
                  </div>
                  <h2 className="text-4xl font-black text-white mb-2 tracking-tighter">БИТВА ЗАВЕРШЕНА</h2>
                  <div className={`text-2xl font-bold mb-6 ${
                    userIdInt != null && effectiveWinnerIdInt === userIdInt ? 'text-green-400' : 
                    effectiveWinnerIdInt === -1 ? 'text-blue-400' : 'text-red-500'
                  }`}>
                    {userIdInt != null && effectiveWinnerIdInt === userIdInt ? 'ВЫ ОДЕРЖАЛИ ПОБЕДУ!' : 
                     effectiveWinnerIdInt === -1 ? 'НИЧЬЯ' : 'ВЫ ПОТЕРПЕЛИ ПОРАЖЕНИЕ'}
                  </div>
                  <div className="flex justify-center gap-4">
                    <button 
                      onClick={() => {
                        if (typeof onNavigate === 'function') {
                          onNavigate('lobby')
                        } else {
                          window.location.href = '/lobby'
                        }
                      }}
                      className="bg-yellow-500 hover:bg-yellow-600 text-black font-black py-4 px-10 rounded-xl transition-all transform hover:scale-105 active:scale-95 shadow-lg"
                    >
                      ВЫЙТИ В ЛОББИ
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            <div className="bg-gray-800 rounded-xl p-4 shadow-inner">
              <h3 className="text-white font-semibold text-lg mb-4 text-center">Игровое поле</h3>
              {renderBoard()}
            </div>
          </div>
          
          {/* Правая колонка - информация об игре */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="xl:col-span-1 order-2 xl:order-3"
          >
            
            {/* Информация о ходе и времени */}
            <div className="bg-gray-800 rounded-lg p-4 mb-4">
              <h3 className="text-white font-semibold text-lg mb-3">Информация о ходе</h3>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-gray-700 p-3 rounded">
                  <div className="flex items-center space-x-2">
                    <Trophy size={16} className="text-yellow-400" />
                    <span className="text-white text-sm">Статус:</span>
                  </div>
                  <span className={`font-bold text-sm ${
                    isMyTurn ? 'text-green-400' : 'text-orange-400'
                  }`}>
                    {isMyTurn ? 'Ваш ход' : 'Ход противника'}
                  </span>
                </div>
                
                <div className="flex items-center justify-between bg-gray-700 p-3 rounded">
                  <div className="flex items-center space-x-2">
                    <Clock size={16} className="text-blue-400" />
                    <span className="text-white text-sm">Время хода:</span>
                  </div>
                  <span className={`font-bold text-sm ${
                    timeLeft <= 10 ? 'text-red-400' : 
                    timeLeft <= 20 ? 'text-yellow-400' : 'text-green-400'
                  }`}>
                    {timeLeft}s
                  </span>
                </div>
                
                <div className="flex items-center justify-between bg-gray-700 p-3 rounded">
                  <div className="flex items-center space-x-2">
                    <Clock size={16} className="text-purple-400" />
                    <span className="text-white text-sm">Время игры:</span>
                  </div>
                  <span className="text-white font-bold text-sm">
                    {Math.floor((battleState.user_total_time || 0) / 60)}м {((battleState.user_total_time || 0) % 60)}с
                  </span>
                </div>
              </div>
            </div>
            
            {/* Статистика боя */}
            <div className="bg-gray-800 rounded-lg p-4 mb-4">
              <h3 className="text-white font-semibold text-lg mb-3">Статистика</h3>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-gray-700 p-3 rounded">
                  <span className="text-white text-sm">Уничтожено кораблей:</span>
                  <span className="text-red-400 font-bold">
                    {Object.values(battleState.killed_ships_p1 || {}).reduce((sum, count) => sum + count, 0)}
                  </span>
                </div>
                
                <div className="flex items-center justify-between bg-gray-700 p-3 rounded">
                  <span className="text-white text-sm">Осталось пауз:</span>
                  <span className="text-blue-400 font-bold">
                    {(battleState.pauses_p1?.long || 0) + (battleState.pauses_p1?.short || 0)}
                  </span>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">Длинные (3 мин):</span>
                    <span className="text-yellow-400 font-bold">{battleState.pauses_p1?.long || 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">Короткие (1 мин):</span>
                    <span className="text-yellow-400 font-bold">{battleState.pauses_p1?.short || 0}</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Панель управления */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-white font-semibold text-lg mb-3">Управление</h3>
              
              <div className="space-y-3">
                {battleState?.pending_combat && (() => {
                  const pending = battleState.pending_combat
                  const myUserId = String(user?.id ?? user?.user_id)
                  const myRole = String(pending.attacker_player_id) === myUserId ? 'attacker' : 'defender'
                  const joinProposal = pending.join_proposal
                  const incomingProposal = joinProposal && joinProposal.proposer_role !== myRole

                  // Получаем список своих кораблей вне боя
                  const myShipsAll = battleState.positions?.[myUserId] || []
                  const currentCombatIds = new Set([...(pending.attacker_ship_ids || []), ...(pending.defender_ship_ids || [])])
                  const availableToJoin = myShipsAll.filter(s => s.alive !== false && !currentCombatIds.has(s.id))

                  // Количество и суммарная сила кораблей в предложении пришедшем от соперника
                  const proposerPlayerId = joinProposal
                    ? String(joinProposal.proposer_role === 'attacker' ? pending.attacker_player_id : pending.defender_player_id)
                    : null
                  const proposerShips = proposerPlayerId ? (battleState.positions?.[proposerPlayerId] || []) : []
                  const proposalShipDetails = joinProposal
                    ? proposerShips.filter(s => joinProposal.ship_ids.includes(s.id))
                    : []

                  return (
                    <div className="bg-gray-700 p-3 rounded text-sm text-white space-y-2">
                      <div className="font-semibold">⚔️ Бой (Покер)</div>
                      <div className="space-y-1 text-xs">
                        <div>Ход: {pending.next_actor === 'attacker' ? 'Атакующий' : 'Защитник'}</div>
                        <div>Раскрыто (А): {pending.attacker_revealed_n}/{(pending.attacker_ship_ids || []).length}</div>
                        <div>Раскрыто (З): {pending.defender_revealed_n}/{(pending.defender_ship_ids || []).length}</div>
                        <div className="text-cyan-300">Сила (А): {pendingCombatInfo?.attackerRevealedStrength ?? 0}</div>
                        <div className="text-pink-300">Сила (З): {pendingCombatInfo?.defenderRevealedStrength ?? 0}</div>
                      </div>

                      {/* Входящее предложение о присоединении */}
                      {incomingProposal && isMyTurn && (
                        <div className="bg-yellow-900 border border-yellow-500 rounded p-2 space-y-2">
                          <div className="text-yellow-300 font-semibold text-xs">⚠️ Противник хочет добавить к бою:</div>
                          <div className="text-xs space-y-1">
                            {proposalShipDetails.map(s => (
                              <span key={s.id} className="inline-block bg-gray-800 rounded px-1 mr-1">
                                {s.type} (сила {getShipStrength(s.type)})
                              </span>
                            ))}
                            {proposalShipDetails.length === 0 && (
                              <span>{joinProposal.ship_ids.length} кораблей</span>
                            )}
                          </div>
                          {/* Режим выбора ответных кораблей */}
                          {joinMode ? (
                            <div className="space-y-1">
                              <div className="text-xs text-gray-300">Ctrl+клик по своим кораблям для ответа:</div>
                              {joinShips.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {joinShips.map(s => (
                                    <span key={s.id} className="bg-green-800 text-green-200 text-xs px-1 rounded">{s.type}</span>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-1">
                                <button
                                  onClick={() => combatJoinAccept(joinShips.map(s => s.id))}
                                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-2 rounded text-xs"
                                >
                                  Принять{joinShips.length > 0 ? ` +${joinShips.length}` : ''}
                                </button>
                                <button
                                  onClick={() => { setJoinMode(false); setJoinShips([]) }}
                                  className="bg-gray-600 hover:bg-gray-500 text-white font-semibold py-1 px-2 rounded text-xs"
                                >
                                  Назад
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              <button
                                onClick={() => combatJoinAccept([])}
                                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-2 rounded text-xs"
                              >
                                Принять
                              </button>
                              {availableToJoin.length > 0 && (
                                <button
                                  onClick={() => setJoinMode(true)}
                                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-2 rounded text-xs"
                                >
                                  +Свои
                                </button>
                              )}
                              <button
                                onClick={combatJoinDecline}
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-2 rounded text-xs"
                              >
                                Отклонить
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Ожидание ответа на своё предложение */}
                      {joinProposal && !incomingProposal && !isMyTurn && (
                        <div className="bg-blue-900 border border-blue-500 rounded p-2 text-xs text-blue-200">
                          ⏳ Ждём ответа соперника на ваше предложение (+{joinProposal.ship_ids.length} кораблей)...
                        </div>
                      )}

                      {isMyTurn && !incomingProposal ? (
                        <div className="space-y-2">
                          {/* Обычные кнопки покера */}
                          <div className="flex gap-2">
                            <button
                              onClick={combatReveal}
                              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded-lg transition-colors text-sm"
                            >
                              Показать
                            </button>
                            <button
                              onClick={combatStop}
                              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-3 rounded-lg transition-colors text-sm"
                            >
                              Стоп
                            </button>
                          </div>

                          {/* Предложить присоединение */}
                          {!joinProposal && availableToJoin.length > 0 && (
                            joinMode ? (
                              <div className="bg-gray-800 border border-green-600 rounded p-2 space-y-1">
                                <div className="text-xs text-green-300 font-semibold">Выберите корабли (Ctrl+клик):</div>
                                {joinShips.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {joinShips.map(s => (
                                      <span key={s.id} className="bg-green-800 text-green-200 text-xs px-1 rounded">{s.type}</span>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-1">
                                  <button
                                    onClick={combatJoinPropose}
                                    disabled={joinShips.length === 0}
                                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-1 px-2 rounded text-xs"
                                  >
                                    Предложить +{joinShips.length}
                                  </button>
                                  <button
                                    onClick={() => { setJoinMode(false); setJoinShips([]) }}
                                    className="bg-gray-600 hover:bg-gray-500 text-white font-semibold py-1 px-2 rounded text-xs"
                                  >
                                    Отмена
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setJoinMode(true); setJoinShips([]) }}
                                className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-1 px-3 rounded-lg transition-colors text-xs"
                              >
                                ⚔️ Добавить корабли к бою
                              </button>
                            )
                          )}
                        </div>
                      ) : !isMyTurn && !joinProposal && (
                        <div className="text-center text-yellow-300 text-sm py-2">
                          ⏳ Ждём хода соперника...
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Torpedo mode button */}
                {isMyTurn && !battleState?.pending_combat && (
                  <button
                    onClick={torpedoMode ? exitTorpedoMode : enterTorpedoMode}
                    className={`w-full ${torpedoMode ? 'bg-red-600 hover:bg-red-700' : 'bg-purple-600 hover:bg-purple-700'} text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2 text-sm`}
                  >
                    <Target size={16} />
                    <span>{torpedoMode ? 'Отменить торпеды' : '🚀 Торпедная атака'}</span>
                  </button>
                )}
                
                {/* Air attack mode button */}
                {isMyTurn && !battleState?.pending_combat && (
                  <button
                    onClick={airAttackMode ? exitAirAttackMode : enterAirAttackMode}
                    className={`w-full ${airAttackMode ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-600 hover:bg-orange-700'} text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2 text-sm`}
                  >
                    <span>✈️</span>
                    <span>{airAttackMode ? 'Отменить авиацию' : '✈️ Воздушная атака'}</span>
                  </button>
                )}
                
                {/* Torpedo status */}
                {torpedoMode && (
                  <div className="bg-gray-700 p-3 rounded text-sm text-white">
                    <div className="space-y-1">
                      <div>ТК: {selectedTK ? `${selectedTK.type} (${indexToCoord(selectedTK.x, selectedTK.y)})` : 'Не выбран'}</div>
                      <div>Т: {selectedTorpedo ? `${selectedTorpedo.type} (${indexToCoord(selectedTorpedo.x, selectedTorpedo.y)})` : 'Не выбрана'}</div>
                      <div>Направлений: {torpedoDirections.length}</div>
                    </div>
                  </div>
                )}
                
                {/* Air attack status */}
                {airAttackMode && (
                  <div className="bg-gray-700 p-3 rounded text-sm text-white">
                    <div className="space-y-1">
                      <div>А: {selectedAircraftCarrier ? `${selectedAircraftCarrier.type} (${indexToCoord(selectedAircraftCarrier.x, selectedAircraftCarrier.y)})` : 'Не выбран'}</div>
                      <div>С: {selectedAircraft ? `${selectedAircraft.type} (${indexToCoord(selectedAircraft.x, selectedAircraft.y)})` : 'Не выбран'}</div>
                      <div>Направлений: {airAttackDirections.length}</div>
                    </div>
                  </div>
                )}

                {/* Group management */}
                {isMyTurn && !battleState?.pending_combat && !torpedoMode && !airAttackMode && (
                  <div className="bg-gray-700 p-3 rounded text-sm text-white space-y-2">
                    <div className="font-semibold">👥 Группы (2–3 соседних корабля)</div>
                    <div className="text-gray-200">
                      Выбрано: {selectedGroupShips.length}
                      {selectedGroupShips.length > 0 ? ` (${selectedGroupShips.map(s => s.type).join(', ')})` : ''}
                      {selectedGroupShips.length === 1 && selectedGroupShips[0]?.group_id ? ` • Группа: ${selectedGroupShips[0].group_id}` : ''}
                    </div>
                    <div className="text-gray-300 text-xs">
                      Ctrl/Cmd-клик по своим кораблям для выбора
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={createGroup}
                        disabled={selectedGroupShips.length < 2 || selectedGroupShips.length > 3 || selectedGroupShips.some(s => s.group_id)}
                        className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2 px-3 rounded-lg transition-colors text-sm"
                      >
                        Создать
                      </button>
                      <button
                        onClick={disbandGroup}
                        disabled={!(selectedGroupShips.length === 1 && selectedGroupShips[0]?.group_id)}
                        className="flex-1 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2 px-3 rounded-lg transition-colors text-sm"
                      >
                        Сбросить
                      </button>
                    </div>
                  </div>
                )}
                <button
                  onClick={() => handlePause('long')}
                  disabled={!isMyTurn || (battleState.pauses_p1?.long || 0) <= 0}
                  className="w-full bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2 text-sm"
                >
                  <Zap size={16} />
                  <span>Пауза 3 мин</span>
                </button>

                <button
                  onClick={() => handlePause('short')}
                  disabled={!isMyTurn || (battleState.pauses_p1?.short || 0) <= 0}
                  className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2 text-sm"
                >
                  <Clock size={16} />
                  <span>Пауза 1 мин</span>
                </button>

                <button
                  onClick={handleLeaveGame}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2 text-sm"
                >
                  <span>🚪</span>
                  <span>Выйти из игры</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>

      </div>
    </div>
  )
}

export default Battle