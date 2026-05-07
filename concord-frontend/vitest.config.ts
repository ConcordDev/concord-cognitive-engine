import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}'],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: process.env.CI ? 2 : undefined,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', '**/node_modules/**', '**/*.test.{ts,tsx}'],
      // Thresholds anchored at "no regression below current" — current
      // baseline is ~22% statements/lines, ~80% branches, ~41% functions
      // across components/ + lib/ + hooks/ at sprint Phase F.
      // High statement/line coverage of the world-lens infrastructure
      // (lod, material-seed, npc-system, physics-world, etc.) is gated
      // by integration testing infra that doesn't exist yet — those
      // files are 0% covered and account for most of the gap. Raise
      // these as that infra lands; do NOT raise without proportional
      // test coverage.
      thresholds: {
        statements: 22,
        branches: 80,
        functions: 35,
        lines: 22,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@/components': path.resolve(__dirname, './components'),
      '@/lib': path.resolve(__dirname, './lib'),
      '@/hooks': path.resolve(__dirname, './hooks'),
      '@/store': path.resolve(__dirname, './store'),
    },
  },
});
