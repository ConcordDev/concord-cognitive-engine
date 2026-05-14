import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_STATE_FILE } from './_helpers';

/**
 * Real authentication for the infra suite.
 *
 * The E2E Infra CI job boots the backend with a seeded `admin` user
 * (created from ADMIN_PASSWORD when the user table is empty — see
 * server.js "Create default admin"). Rather than forging a fake session
 * cookie — which the backend correctly rejects, bouncing every protected
 * route to /login and making the specs race that redirect — we log in for
 * real, capture the genuine concord_auth + concord_refresh cookies the
 * backend issues, seed the `concord_entered` flag a logged-in browser
 * carries (Providers.tsx gates socket + CSRF + scope fetch on it), and
 * persist the whole thing as Playwright storageState. The chat/wallet
 * specs reuse that state via `test.use({ storageState })`, so they
 * exercise the authed app instead of skipping.
 *
 * Runs as its own `setup` project; the `chromium` project depends on it.
 */
setup('authenticate against the e2e-infra backend', async ({ page, context }) => {
  const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5050').replace(/\/$/, '');
  const username = process.env.CONCORD_E2E_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'testpassword123';

  // Load the app origin first: yields the real browser User-Agent and a
  // page to seed localStorage on once we're authenticated.
  await page.goto('/');
  const userAgent = await page.evaluate(() => navigator.userAgent);

  // Log in for real. context.request shares the browser context's cookie
  // jar, so the issued Set-Cookie headers land where the page can use
  // them. The explicit browser UA clears the backend bot-guard, which
  // 403s automated-looking User-Agents on /api/ paths (server.js
  // botGuardMiddleware). /api/auth/login is CSRF-exempt — no token
  // round-trip needed.
  const res = await context.request.post(`${apiBase}/api/auth/login`, {
    headers: { 'User-Agent': userAgent },
    data: { username, password },
  });
  expect(
    res.ok(),
    `e2e-infra login failed (HTTP ${res.status()}). This suite needs the ` +
      `seeded admin user — confirm ADMIN_PASSWORD is set in the E2E Infra ` +
      `job and the backend came up cleanly. Response: ${await res.text()}`,
  ).toBeTruthy();

  // A real logged-in browser has localStorage.concord_entered set; without
  // it Providers.tsx skips socket + CSRF + /api/auth/me. Seed it on the
  // app origin so storageState captures it alongside the cookies.
  await page.evaluate(() => {
    try {
      localStorage.setItem('concord_entered', 'true');
    } catch {
      /* storage unavailable — non-fatal, cookies still carry the session */
    }
  });

  fs.mkdirSync(path.dirname(AUTH_STATE_FILE), { recursive: true });
  await context.storageState({ path: AUTH_STATE_FILE });
});
