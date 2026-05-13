// Phase-verification config — bypasses the globalSetup warmup which
// breaks on ESM/CJS module-type mismatch in this environment. Inherits
// every other knob from playwright.config.ts.
//
// Sandbox notes:
//   - Playwright's CDN is not in the network allowlist here. We point
//     at a pre-installed chromium-1194 binary on disk instead of the
//     1208 binary playwright 1.58.1 expects.
//   - --no-sandbox is required because the runtime user is root.

import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

const CHROMIUM_EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  ...base,
  // Drop the globalSetup that fails to load (warmup is unneeded in dev).
  globalSetup: undefined,
  // Skip webServer launch — we have one running already.
  webServer: undefined,
  // Single project, single browser, real binary on disk.
  projects: [
    {
      name: 'chromium-sandbox',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: CHROMIUM_EXEC,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
      },
    },
  ],
});

