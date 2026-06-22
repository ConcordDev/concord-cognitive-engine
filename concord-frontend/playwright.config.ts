import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // all-lenses-walk.spec.ts generates ONE test per lens (~259, mode:serial)
  // with a fixed 3.5s settle each — ~25-35 min wall-clock on its own, which
  // single-handedly blew the 25-min E2E Core job budget (the job was
  // cancelled mid-run). Its assertion is a soft `expect(bucket).toBeDefined()`
  // that always passes, so it contributes ZERO gate signal — it's a
  // diagnostic lens-health walk, not a pass/fail gate. Excluded from the
  // gating run here; still runnable on-demand via `npm run test:e2e:walk`
  // (playwright-walk.config.ts), which uploads the bucket report.
  testIgnore: ['**/all-lenses-walk.spec.ts'],
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
    // actionTimeout bumped to 120 s — under sustained CI load the
    // backend event loop intermittently stalls (heartbeats + embed
    // workers + SQLite writes), and 60 s was tripping on individual
    // page actions whose API calls were waiting on a brief stall.
    navigationTimeout: 60000,
    actionTimeout: 120000,
  },
  // Per-test timeout — covers the whole spec body including setup
  // and teardown. 180 s lets cold-loading heavy Three.js worlds
  // (concord-link-frontier etc.) finish on a slow CI runner; the
  // happy-path browsers finish in 17–25 s, but a webkit/firefox cold
  // boot of a heavy scene + screenshot can straddle the prior 90 s.
  timeout: 180000,

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // WebGL in headless Chromium: the default ('--use-gl=swiftshader' alone or
        // none) fails to create a WebGL2 context, so Three.js never mounts a
        // <canvas> and the world-lens 3D can't be screenshot-tested. The reliable
        // headless combo (verified: yields "WebGL 2.0 (OpenGL ES 3.0 Chromium)") is
        // ANGLE-over-SwiftShader. Refs: createit.com headless-chrome-webgl +
        // michelkraemer.com enable-gpu-headless. Swap to --use-gl=angle/egl +
        // xvfb on a GPU runner for hardware accel.
        launchOptions: {
          args: [
            '--use-angle=swiftshader',
            '--use-gl=angle',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
            '--no-sandbox',
            '--disable-dev-shm-usage',
          ],
        },
      },
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
