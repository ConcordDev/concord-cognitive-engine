import { defineConfig, devices } from '@playwright/test';

/**
 * Infra-tier E2E config.
 *
 * The specs under tests/e2e-infra/ exercise paths that depend on
 * external infrastructure CI does not provision:
 *
 *   - chat-flow.spec.ts      — needs Ollama (5-brain pipeline)
 *   - chat-modes.spec.ts     — needs Ollama
 *   - auth-oauth.spec.ts     — needs Google + Apple OAuth credentials
 *   - wallet-flow.spec.ts    — needs Stripe webhook secret + endpoints
 *
 * They run in their own GitHub Actions job (E2E Infra) which is
 * marked continue-on-error so the gate stays informational. The core
 * E2E job (driven by playwright.config.ts → tests/e2e/) is blocking.
 *
 * The split mirrors the CLAUDE.md "Plan B infra sprint" deliverable:
 * the prior workaround was to mark the entire E2E job non-blocking;
 * now only the genuinely-infra-dependent slice is non-blocking, and
 * everything else gates merges again.
 */
export default defineConfig({
  testDir: './tests/e2e-infra',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  globalTimeout: 20 * 60 * 1000,
  // Mirror the core config's reporter trio so the infra job emits
  // json+html+list. The ci.yml infra job reads the JSON for failure
  // surfacing (same shape as the core slice).
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
    // Infra-tier specs hit cold-compiled routes via `next start`; the
    // first goto per spec can stretch toward 60 s. Bump from the
    // 30 s playwright default so we observe the actual page content
    // instead of timing out on the first-route compile latency.
    // actionTimeout: bumped to 60 s to match navigationTimeout —
    // Playwright's internal action default is 30 s even when this is
    // unset, and post-navigation hydration on cold-compiled routes
    // can straddle it. Bump explicitly.
    navigationTimeout: 60000,
    actionTimeout: 60000,
  },
  timeout: 90000,

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // CI uses `next start` against a pre-built artifact to avoid the
  // dev-server cold-compile timeout that was killing both E2E jobs.
  // See playwright.config.ts for the full rationale.
  webServer: {
    command: process.env.CI ? 'npm run start:ci' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 180000 : 120000,
  },
});
