/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ocean: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        navy: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        ship: {
          50: '#fef7ee',
          100: '#fdedd6',
          200: '#fbd7ad',
          300: '#f8bb84',
          400: '#f5955b',
          500: '#f26d32',
          600: '#e34d1c',
          700: '#bc3a18',
          800: '#952f1b',
          900: '#782a1a',
        }
      },
      animation: {
        'wave': 'wave 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
      },
      keyframes: {
        wave: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        }
      },
      backgroundImage: {
        'ocean-gradient': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'ship-gradient': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'navy-gradient': 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      }
    },
  },
  plugins: [],
} 