import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Warm every Next.js app route once after the webServer comes up.
  // `next start` lazy-compiles each route on first visit; without
  // pre-warm, the first test that hits a given route waits 30-60 s
  // for compile. Across 270+ routes that compounds past the
  // per-action timeout. See scripts/playwright-warmup.ts.
  globalSetup: './scripts/playwright-warmup.ts',
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
  // Multiple reporters so:
  //   - `html`: human-browsable report at playwright-report/index.html
  //     (uploaded as the artifact on every PR)
  //   - `json` → playwright-report/results.json: read by ci.yml's
  //     "Surface failing E2E specs on failure" step to emit the per-spec
  //     failure list directly into the GitHub Actions run log so that
  //     E2E Phase 2 triage doesn't require downloading + extracting the
  //     49 MB html artifact. Without this entry the prior workflow step
  //     silently no-op'd because the file it grepped didn't exist.
  //   - `list`: live progress in stdout so the CI log is readable while
  //     the run is in progress.
  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Bump the per-action timeouts so first-route compile latency
    // under `next start` (which lazy-compiles each route on first
    // visit even in production mode) doesn't trip the default 30 s
    // goto. Mirrors playwright-infra.config.ts.
    // actionTimeout bumped to 60 s — Playwright's internal action
    // default is 30 s even when this is unset, and post-navigation
    // hydration on cold-compiled routes can straddle it.
    navigationTimeout: 60000,
    actionTimeout: 60000,
  },
  // Per-test timeout — covers the whole spec body including setup
  // and teardown. 90 s leaves a comfortable margin over a 60 s goto
  // plus a 15 s assertion budget.
  timeout: 90000,

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
