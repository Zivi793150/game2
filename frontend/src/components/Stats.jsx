import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Target, Clock, Users, ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react'

const Stats = ({ user, onNavigate }) => {
  const [stats, setStats] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/stats')
        if (response.ok) {
          const data = await response.json()
          setStats(data)
        }
      } catch (err) {
        console.error('Ошибка получения статистики:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchStats()
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full"
        />
      </div>
    )
  }

  const statCards = [
    {
      icon: Trophy,
      title: 'Победы',
      value: stats?.wins || 0,
      color: 'bg-green-500',
      trend: 'up'
    },
    {
      icon: Target,
      title: 'Поражения',
      value: stats?.losses || 0,
      color: 'bg-red-500',
      trend: 'down'
    },
    {
      icon: Clock,
      title: 'Время игры',
      value: `${Math.floor((stats?.total_time || 0) / 60)}м`,
      color: 'bg-blue-500',
      trend: 'neutral'
    },
    {
      icon: Users,
      title: 'Всего игр',
      value: stats?.total_games || 0,
      color: 'bg-purple-500',
      trend: 'neutral'
    }
  ]

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-8"
        >
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Статистика</h1>
            <p className="text-white/70">Ваши достижения в игре</p>
          </div>
          <button
            onClick={() => onNavigate('menu')}
            className="btn-secondary flex items-center space-x-2"
          >
            <ArrowLeft size={20} />
            <span>Назад</span>
          </button>
        </motion.div>

        {/* Статистические карточки */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statCards.map((card, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ scale: 1.02 }}
              className="card"
            >
              <div className="flex items-center space-x-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${card.color}`}>
                  <card.icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-white/60 text-sm">{card.title}</p>
                  <p className="text-white font-bold text-2xl">{card.value}</p>
                </div>
                {card.trend !== 'neutral' && (
                  <div className="ml-auto">
                    {card.trend === 'up' ? (
                      <TrendingUp className="w-5 h-5 text-green-400" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-red-400" />
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Детальная статистика */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Последние игры */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            className="card"
          >
            <h3 className="text-white font-semibold text-lg mb-4">Последние игры</h3>
            <div className="space-y-3">
              {stats?.recent_games?.map((game, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
                >
                  <div>
                    <p className="text-white font-medium">{game.opponent}</p>
                    <p className="text-white/60 text-sm">{game.date}</p>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                    game.result === 'win' 
                      ? 'bg-green-500/20 text-green-400' 
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {game.result === 'win' ? 'Победа' : 'Поражение'}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Достижения */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            className="card"
          >
            <h3 className="text-white font-semibold text-lg mb-4">Достижения</h3>
            <div className="space-y-3">
              {stats?.achievements?.map((achievement, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center space-x-3 p-3 bg-white/5 rounded-lg"
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    achievement.unlocked ? 'bg-yellow-500' : 'bg-gray-500'
                  }`}>
                    <Trophy className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-medium">{achievement.name}</p>
                    <p className="text-white/60 text-sm">{achievement.description}</p>
                  </div>
                  {achievement.unlocked && (
                    <span className="text-yellow-400 text-sm">Получено</span>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* График прогресса */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card mt-8"
        >
          <h3 className="text-white font-semibold text-lg mb-4">Прогресс</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-white/60 text-sm mb-2">
                <span>Победы</span>
                <span>{stats?.wins || 0} / 100</span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min((stats?.wins || 0) / 100 * 100, 100)}%` }}
                  transition={{ duration: 1, delay: 0.5 }}
                  className="bg-green-500 h-2 rounded-full"
                />
              </div>
            </div>
            
            <div>
              <div className="flex justify-between text-white/60 text-sm mb-2">
                <span>Время игры</span>
                <span>{Math.floor((stats?.total_time || 0) / 60)}м / 1000м</span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min((stats?.total_time || 0) / 1000 * 100, 100)}%` }}
                  transition={{ duration: 1, delay: 0.7 }}
                  className="bg-blue-500 h-2 rounded-full"
                />
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export default Stats 