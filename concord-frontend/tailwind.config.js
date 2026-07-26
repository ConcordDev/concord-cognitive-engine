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
        /**
         * TheVault — a self-contained LIGHT island. Every other palette in
         * this file is tuned for the dark lattice surface; these are tuned
         * for paper. They are namespaced `vault-*` and used by exactly one
         * lens, so they cannot drift into the dark surfaces.
         *
         * NOTE ON `accent-warm` ABOVE: it is NOT the Vault brass. #E8A44C is
         * a dark-surface amber and measures 2.01:1 against `vault.paper` —
         * it fails WCAG for any text or UI use on paper. `vault.brass` is a
         * separately-derived, deliberately desaturated archival value.
         *
         * Measured contrast (sRGB relative luminance, WCAG 2.x):
         *   ink       on paper 16.70:1 · card 17.72:1  (AAA)
         *   graphite  on paper  8.82:1 · card  9.35:1  (AAA)
         *   gray      on paper  5.19:1 · card  5.51:1 · sunk 4.72:1 (AA)
         *   brass     on paper  5.37:1 · card  5.70:1 · sunk 4.88:1 (AA)
         *   brassLine on paper  3.72:1  → NON-TEXT ONLY (borders/rules, 3:1)
         *   rule      on paper  1.34:1  → decorative hairline only, never a
         *                                 control border and never text.
         */
        vault: {
          paper: '#FAF8F4',       // base wall surface — warm cotton white
          card: '#FFFFFF',        // the label / certificate stock itself
          sunk: '#F1EDE5',        // recessed well, drawer interior
          ink: '#1A1815',         // primary text — warm near-black
          graphite: '#4A4642',    // secondary text
          gray: '#6E6860',        // tertiary text / metadata (still AA)
          rule: '#DED8CE',        // decorative hairline
          brass: '#7E6234',       // Vault Gold — the single accent
          brassLine: '#9A7B4F',   // brass at border weight (non-text)
          brassLeaf: '#C2A25E',   // brass ON the ceremonial black only
          ceremonial: '#12100E',  // reserved: induction moment (not general UI)
        },
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
        /**
         * TheVault's serif — DELIBERATELY a distinct key (`font-vault`), NOT
         * an override of Tailwind's `serif`.
         *
         * `font-serif` currently resolves to Tailwind's default Georgia stack
         * and is relied on by 17 call sites across 12 files (the poetry lens
         * and its 6 panels, creative-writing, film-studios screenplay,
         * hypothesis StatsWorkbench, daily inspiration, karaoke). Several of
         * those are `<pre>` blocks and fixed-height textareas where swapping
         * the face silently changes metrics, wrapping, and line count. Those
         * files belong to other units, so this key claims new namespace
         * instead of mutating shared inherited state — `font-serif` keeps
         * resolving to Georgia everywhere, byte-for-byte unchanged.
         */
        vault: [
          'var(--font-vault-serif)',
          'Source Serif 4',
          'Source Serif Pro',
          'Georgia',
          'Times New Roman',
          'serif',
        ],
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
