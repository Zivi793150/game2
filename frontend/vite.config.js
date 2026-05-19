import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5000,
    host: '0.0.0.0', // Allow access from any IP address
    allowedHosts: true, // Allow all hosts for development
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/register': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/login': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/menu': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/logout': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/stats': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/find_random': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/play_friend': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/game_room': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/battle': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/check_opponent': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/check_setup_done': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/setup_done': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/save_ships': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/leave_game': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/auto_setup': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/lobby': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/create_private_room': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/notify_opponent_joined': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/chat/send': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/chat/messages': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      
      // Additional missing endpoints
      '/start_search': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/stop_search': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/online_players': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/heartbeat': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/ping': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/check_game': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/session-check': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      
      // API groups (for parameterized endpoints)
      '/invite': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/search': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/timer': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/pause': { target: 'http://127.0.0.1:8000', changeOrigin: true }
    }
  }
}) 