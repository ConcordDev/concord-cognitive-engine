/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Lattice Empire Theme
        lattice: {
          void: '#0a0a0f',
          deep: '#0d0d14',
          surface: '#12121a',
          elevated: '#1a1a24',
          border: '#2a2a3a',
        },
        neon: {
          blue: '#00d4ff',
          cyan: '#00fff7',
          purple: '#a855f7',
          pink: '#ec4899',
          green: '#22c55e',
        },
        'accent-warm': '#E8A44C',
        'accent-cool': '#5B8DEF',
        resonance: {
          low: '#3b82f6',
          mid: '#8b5cf6',
          high: '#ec4899',
          peak: '#f43f5e',
        },
        sovereignty: {
          locked: '#22c55e',
          warning: '#f59e0b',
          danger: '#ef4444',
        },
        status: {
          success: '#22c55e',
          warning: '#f59e0b',
          error: '#ef4444',
          info: '#3b82f6',
        },
      },
      fontFamily: {
        mono: ['var(--font-jetbrains-mono)', 'JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['var(--font-dm-sans)', 'system-ui', 'sans-serif'],
      },
      animation: {
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'resonance-wave': 'resonance-wave 3s ease-in-out infinite',
        'sovereignty-lock': 'sovereignty-lock 0.3s ease-out',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(0, 212, 255, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(0, 212, 255, 0.6)' },
        },
        'resonance-wave': {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.05)', opacity: '0.8' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'sovereignty-lock': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      boxShadow: {
        'neon-blue': '0 0 20px rgba(0, 212, 255, 0.4)',
        'neon-purple': '0 0 20px rgba(168, 85, 247, 0.4)',
        'neon-pink': '0 0 20px rgba(236, 72, 153, 0.4)',
      },
    },
  },
  plugins: [],
};
