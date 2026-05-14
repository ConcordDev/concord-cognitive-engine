import { test as setup, expect, type APIResponse } from '@playwright/test';
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
  // Resolve the backend base. CI passes NEXT_PUBLIC_API_URL=http://localhost:5050,
  // but playwright's `request` fixture (undici) resolving `localhost` on a
  // GitHub runner can pick the IPv6 `::1` address. The server's
  // `app.listen(PORT)` opens a dual-stack socket, but the runner's IPv6
  // path is frequently broken — so the connection HANGS to the full
  // actionTimeout (60s) instead of failing fast. Force IPv4 `127.0.0.1`
  // to remove the ambiguity. _helpers.ts already gives the SPECS a
  // "degrade cleanly, never 60s-hang" contract; the setup project — which
  // every other infra spec depends on — needs the same resilience.
  const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5050')
    .replace(/\/$/, '')
    .replace('//localhost:', '//127.0.0.1:');
  const username = process.env.CONCORD_E2E_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'testpassword123';

  // Pre-flight: confirm the backend is actually answering before the login
  // POST. ci.yml's "Wait for server" step polls /health with curl (which
  // happily falls back across address families); this re-checks from the
  // SAME client that will do the login, with a short per-probe timeout, so
  // a crashed / unresponsive backend surfaces as a fast, clear failure
  // instead of a silent 60s hang inside request.post.
  let healthy = false;
  for (let i = 1; i <= 12 && !healthy; i++) {
    try {
      const h = await request.get(`${apiBase}/health`, { timeout: 5_000 });
      if (h.ok()) { healthy = true; break; }
    } catch { /* not ready — retry */ }
    await new Promise((r) => setTimeout(r, 2_500));
  }
  if (!healthy) {
    throw new Error(
      `e2e-infra backend at ${apiBase} never answered /health within ~30s — ` +
        `the server process likely crashed or is unresponsive. Check the ` +
        `"Start server" step's server.log.`,
    );
  }

  // Log in for real, with bounded retries. /api/auth/login is CSRF-exempt —
  // no token round-trip needed. The standalone `request` fixture's
  // User-Agent is not bot-flagged (the backend botGuard 403s curl/wget on
  // /api/ paths; this fixture clears it). A single unbounded request.post
  // would burn the full 60s actionTimeout on one transient hiccup; instead
  // try up to 3 times with a 20s per-attempt cap and a short backoff.
  let loginRes: APIResponse | null = null;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      loginRes = await request.post(`${apiBase}/api/auth/login`, {
        headers: { 'content-type': 'application/json' },
        data: { username, password },
        timeout: 20_000,
      });
      break;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2_000 * attempt));
    }
  }
  if (!loginRes) {
    throw new Error(
      `e2e-infra login POST to ${apiBase}/api/auth/login failed after 3 ` +
        `attempts (last error: ${String(lastErr)}). The backend answered ` +
        `/health but not the login route — likely resource-starved.`,
    );
  }
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
