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
 * route to /login — we log in for real.
 *
 * Uses the standalone `request` fixture, NOT context.request: the
 * browser-context-bound request hangs against the cross-origin backend
 * in CI (60s timeout). The standalone fixture is the pattern
 * playthrough.spec.ts uses and it reaches localhost:5050 reliably. The
 * issued Set-Cookie headers are re-parsed onto the browser context, the
 * `concord_entered` flag a logged-in browser carries is seeded
 * (Providers.tsx gates socket + CSRF + scope fetch on it), and the whole
 * thing is persisted as Playwright storageState. The chat/wallet specs
 * reuse it via `test.use({ storageState })`.
 *
 * Runs as its own `setup` project; the `chromium` project depends on it.
 */
setup('authenticate against the e2e-infra backend', async ({ request, context, page }) => {
  const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5050').replace(/\/$/, '');
  const username = process.env.CONCORD_E2E_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'testpassword123';

  // Log in for real. /api/auth/login is CSRF-exempt — no token round-trip
  // needed. The standalone `request` fixture's User-Agent is not
  // bot-flagged (the backend botGuard 403s curl/wget/etc on /api/ paths;
  // playthrough.spec.ts proves this fixture clears it).
  const loginRes = await request.post(`${apiBase}/api/auth/login`, {
    headers: { 'content-type': 'application/json' },
    data: { username, password },
  });
  expect(
    loginRes.ok(),
    `e2e-infra login failed (HTTP ${loginRes.status()}). This suite needs the ` +
      `seeded admin user — confirm ADMIN_PASSWORD is set in the E2E Infra ` +
      `job and the backend came up cleanly. Response: ${await loginRes.text()}`,
  ).toBeTruthy();

  // Re-parse the Set-Cookie headers onto the browser context so the specs
  // (and the saved storageState) carry a genuine session. Under
  // NODE_ENV=ci the backend issues host-only, non-Secure cookies (no
  // Domain attr), so domain 'localhost' applies across the :3000 frontend
  // and :5050 backend alike.
  const setCookies = loginRes
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value);
  if (setCookies.length === 0) {
    throw new Error(
      `login succeeded (HTTP ${loginRes.status()}) but issued no Set-Cookie ` +
        `header — cannot establish a session for the infra specs.`,
    );
  }
  const cookies = setCookies.map((raw) => {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    return {
      name: pair.slice(0, eq).trim(),
      value: pair.slice(eq + 1).trim(),
      domain: 'localhost',
      path: '/',
    };
  });
  await context.addCookies(cookies);

  // A real logged-in browser has localStorage.concord_entered set; without
  // it Providers.tsx skips socket + CSRF + /api/auth/me. Seed it on the
  // app origin so storageState captures it alongside the cookies.
  await page.goto('/');
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
