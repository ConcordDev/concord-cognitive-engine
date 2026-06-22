// tests/e2e/_helpers.ts
//
// Shared fixtures + helpers for E2E specs.
//
// The big one: mockAuthSuccess() — wires up every endpoint the login flow
// touches so a `successful login redirects` test isn't tripped by the
// `useAuth()` hydration call that fires once the user lands on the
// post-login page (HomeClient → useAuth → GET /api/auth/me).
//
// Without this, tests that mock /api/auth/login alone get into a
// race where the login POST succeeds, the redirect fires, the new page
// calls /api/auth/me, that hits the real backend (unauthenticated in
// CI), returns 401, the auth context redirects back to /login, and the
// `expect(page).not.toHaveURL(/\/login/)` assertion times out at 30s.

import type { Page } from '@playwright/test';

export interface AuthMockOptions {
  /** Username surfaced by /api/auth/me. Default: "testuser". */
  username?: string;
  /** Role surfaced by /api/auth/me. Default: "user". */
  role?: string;
  /** Spark/CC balance surfaced by various wallet probes. Default: 0. */
  walletBalance?: number;
}

/**
 * Mock the full auth-success path so `successful login redirects` and
 * `multiple protected routes redirect to login` style assertions don't
 * time out on the post-redirect /api/auth/me hydration.
 *
 * Usage:
 *   import { mockAuthSuccess } from './_helpers';
 *   test('foo', async ({ page }) => {
 *     await mockAuthSuccess(page);
 *     // ... the rest of your test
 *   });
 */
export async function mockAuthSuccess(page: Page, opts: AuthMockOptions = {}) {
  const { username = 'testuser', role = 'user', walletBalance = 0 } = opts;
  const userId = `usr_${username}`;

  // Pre-dismiss the first-run overlays BEFORE any page script runs. The
  // OnboardingWizard renders a full-screen `fixed inset-0 z-50 bg-black/80`
  // modal whenever `concord-onboarding-completed` is unset (and its
  // /api/onboarding/wizard-status probe doesn't say completed) — for a
  // freshly-"logged-in" mock user that's always, so the modal COVERS the
  // page and intercepts every click / hides content the spec asserts on
  // (NEC-calculator tab clicks timed out at 120s; "Admin access required"
  // read as not-visible underneath it). FirstWinWizard + CookieConsent are
  // the same class of overlay. addInitScript persists across navigations.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('concord-onboarding-completed', 'true');
      localStorage.setItem('concord_first_win_dismissed', 'true');
      localStorage.setItem('concord_arrival_seen', 'true');
      localStorage.setItem('concord_cookie_consent', 'accepted');
      localStorage.setItem('world_lens_visited', '1');
      localStorage.setItem('concord_entered', 'true');
    } catch { /* private mode */ }
  });
  // Belt-and-suspenders for the OnboardingWizard server probe.
  await page.route('**/api/onboarding/wizard-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, completed: true }),
    })
  );

  // CSRF token — fired before login + after login by app/login/page.tsx
  await page.route('**/api/auth/csrf-token', (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ token: 'mock-csrf' }) })
  );

  // Login POST — returns ok so the redirect fires
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, userId }),
    })
  );

  // Hydration: useAuth() calls /api/auth/me on every authed page mount.
  // Returning a real-shape user payload keeps the auth context happy and
  // prevents the redirect-back-to-/login loop that times out the test.
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user: {
          id: userId,
          username,
          role,
          email: `${username}@test.local`,
          createdAt: new Date().toISOString(),
        },
      }),
    })
  );

  // Wallet probe — Topbar / FirstWinWizard often call this to render the
  // balance pill; failing it is non-fatal but adds 1-3s of XHR-retry
  // latency to every page mount.
  await page.route('**/api/economic/wallet/balance', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, balance: walletBalance, sparks: walletBalance }),
    })
  );
}

/**
 * Mock the /api/auth/me hydration to return UNAUTHENTICATED so that
 * `protected route redirects to login` style assertions resolve quickly
 * instead of waiting for a real backend 401.
 */
export async function mockAuthUnauthenticated(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'unauthenticated' }),
    })
  );
}

/**
 * Navigate and wait out post-navigation hydration before probing the DOM.
 *
 * The Core specs probe with `if (await el.isVisible()) { await el.click() }`.
 * When `.click()` lands mid-hydration the element detaches and the click
 * burns the full 60s action timeout — which, ×retry across several specs,
 * pushes the whole E2E Core job past its 25-min budget (observed: the job
 * gets cancelled before finishing). Settling the network first — capped,
 * since the app holds websockets open so 'networkidle' never fully
 * settles — makes the probe race-free.
 *
 * No error-swallowing: a genuinely broken interaction still throws and
 * fails the spec. Pair with a bounded `.click({ timeout })` at call sites
 * so a stuck interaction fails fast instead of eating the job budget.
 */
export async function gotoStable(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  return response;
}
