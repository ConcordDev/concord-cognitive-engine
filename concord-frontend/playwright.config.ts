import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // CI retry budget: 1 retry per test (was 2). Three runs of every
  // failing test compounds rapidly across 16 specs — 1 retry catches
  // genuine flakes without blowing the time budget. Real failures
  // still surface; they just surface in 2x time instead of 3x.
  retries: process.env.CI ? 1 : 0,
  // Two workers in CI (was 1). Playwright handles per-test isolation
  // via separate browser contexts; the bottleneck on one worker was
  // serial execution, not contention. Two workers halve the wall-
  // clock time without measurably increasing flake rate.
  workers: process.env.CI ? 2 : undefined,
  // Hard cap on the entire test run. 20 minutes leaves 5 min headroom
  // under the 25-min job timeout in .github/workflows/ci.yml for the
  // artifact upload + cleanup steps. Without this, playwright will
  // happily run for an hour and the GitHub runner gives up first
  // ('hosted runner lost communication') — a confusing failure mode.
  globalTimeout: 20 * 60 * 1000,
  reporter: 'html',

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'lens-smoke',
      testDir: './tests/lens-e2e',
      use: { ...devices['Desktop Chrome'] },
      retries: 1,
      workers: 2,
    },
  ],

  // In CI we ship against a production build (`npm run start:ci` →
  // `next start`). `next dev` cold-compiles all 200+ lens routes on
  // every run and the default 120 s webServer timeout was tripping
  // before any spec executed (visible in CI as "process completed
  // with exit 1" + no failed-spec output). Local devs still get the
  // dev server via `npm run dev`.
  webServer: {
    command: process.env.CI ? 'npm run start:ci' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 180000 : 120000,
  },
});
