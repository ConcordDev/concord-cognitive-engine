import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Pre-seed localStorage so first-run wizards and "always-on" guidance
// overlays do not open during E2E. Each one auto-mounts at AppShell render
// time and can intercept pointer events for click-target tests.
//
// Keys observed in source:
//   concord-onboarding-completed     — components/onboarding/OnboardingWizard.tsx
//   concord_entered                  — components/Providers.tsx (gate to socket connect)
//   concord_first_win_dismissed      — components/guidance/FirstWinWizard.tsx
//   concord-system-guide-collapsed   — components/guidance/SystemGuidePanel.tsx
//   concord-assistant-hidden         — components/common/DomainAssistant.tsx
const E2E_STORAGE_STATE = {
  cookies: [],
  origins: [
    {
      origin: BASE_URL,
      localStorage: [
        { name: 'concord-onboarding-completed', value: 'true' },
        { name: 'concord_entered', value: 'true' },
        { name: 'concord_first_win_dismissed', value: 'true' },
        { name: 'concord-system-guide-collapsed', value: 'true' },
        { name: 'concord-assistant-hidden', value: 'true' },
      ],
    },
  ],
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    storageState: E2E_STORAGE_STATE,
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

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    // Always reuse an existing server when one is responding on :3000.
    // CI explicitly starts `next start` (production mode) before invoking
    // playwright so we get fast, deterministic boots; Playwright reuses
    // that server and skips spawning `next dev`. Locally, with no server
    // running, Playwright still falls back to spawning `next dev`.
    reuseExistingServer: true,
    timeout: 240000,
  },
});
