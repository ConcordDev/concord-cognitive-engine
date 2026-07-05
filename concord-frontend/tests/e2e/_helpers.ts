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

/**
 * Catch-all safety net: fulfills EVERY /api/** request with a benign 200 so
 * an endpoint a spec forgot to mock never falls through to the real :5050
 * backend. This matters because a real backend 401 on ANY authenticated
 * fetch trips the axios auto-refresh interceptor (lib/api/client.ts:196-214),
 * which POSTs the REAL /api/auth/refresh; the server rejects the E2E specs'
 * fake `concord_refresh` cookie and CLEARS both auth cookies
 * (server/routes/auth.js:547-557), so every subsequent navigation 307s to
 * /login and the actual assertion (e.g. "Admin access required") never gets
 * a chance to render.
 *
 * Call this BEFORE any endpoint-specific mock (mockAuthSuccess,
 * mockSovereignAuth, denyAdminData, grantAdminData, ...). Playwright invokes
 * page.route() handlers in the REVERSE of their registration order — "the
 * last registered route can always override all the previous ones" per the
 * Playwright docs (route.fallback()) — so whichever handler is registered
 * LAST wins whenever two patterns match the same request. Registering this
 * catch-all first means every later, more-specific mock takes precedence
 * over it, while anything nobody bothered to mock still gets a safe 200
 * instead of hitting the live backend and 401ing.
 */
export async function blockUnmockedApi(page: Page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: [], items: [], artifacts: [], total: 0 }),
    })
  );
}

export interface AuthMockOptions {
  /** Username surfaced by /api/auth/me. Default: "testuser". */
  username?: string;
  /** Role surfaced by /api/auth/me. Default: "user". */
  role?: string;
  /**
   * Permission scopes surfaced by /api/auth/me (useAuth reads `user.scopes`).
   * Default: []. Admin/operator surfaces gate server-side, but a complete
   * elevated user payload keeps any client-side scope check honest too.
   */
  scopes?: string[];
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
  const { username = 'testuser', role = 'user', scopes = [], walletBalance = 0 } = opts;
  const userId = `usr_${username}`;

  // THE load-bearing line (root cause of the 9 deterministic E2E failures):
  // middleware.ts gates every non-public path on the concord_auth/concord_refresh
  // COOKIE — a server-side check on the document request that page.route() API
  // mocks can never intercept. Without it, every /lenses/* navigation 307s to
  // /login before the page mounts ("Admin access required" never renders; the
  // NEC-Calculators click burns the full 120s actionTimeout). Mirrors the
  // explicit-cookie pattern the passing middleware spec uses (auth.spec.ts).
  await page.context().addCookies([
    { name: 'concord_refresh', value: 'e2e-mock-refresh-token', domain: 'localhost', path: '/' },
  ]);

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

  // Root-cause fix for the E2E mock leak: the axios interceptor
  // (lib/api/client.ts:196-214) auto-POSTs the REAL /api/auth/refresh on any
  // unmocked 401. The real server rejects our fake `concord_refresh` cookie
  // and CLEARS both auth cookies (server/routes/auth.js:547-557), which
  // 307s every subsequent navigation to /login. Mocking refresh to a benign
  // 200 means that destructive real-refresh path can never fire in a mocked
  // session, no matter which background probe triggers it.
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
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
          scopes,
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
 * Grant the admin/operator data surface (the inverse of the 403 gate the
 * admin-gated-lenses spec exercises).
 *
 * The operator lenses (ops-telemetry, admin, psyops, crisis-ops, …) render
 * their controls only when the FIRST admin data probe returns 2xx; a 403 flips
 * them to the friendly <AdminRequiredState> gate. The gate is purely
 * response-driven — there is NO client-side role check hiding the controls —
 * so to walk an ELEVATED user THROUGH the controls we 200-mock the admin data
 * endpoints + the sovereignty status probe. Call AFTER mockSovereignAuth (or
 * mockAuthSuccess with an elevated role) so the identity + the data agree.
 */
export async function grantAdminData(page: Page) {
  const ok = (body: unknown) => (route: import('@playwright/test').Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  // Sovereignty controls (use70Lock → /api/sovereignty/status). Shape mirrors
  // hooks/use70Lock.ts SovereigntyStatus: lockPercentage, invariants[], etc.
  await page.route('**/api/sovereignty/status', ok({
    ok: true,
    lockPercentage: 72,
    isHealthy: true,
    lastAudit: new Date().toISOString(),
    invariants: [
      { id: 'royalty_cap', name: 'Royalty cap ≤ 30%', status: 'enforced' },
      { id: 'withdrawal_hold', name: '48h withdrawal hold', status: 'enforced' },
      { id: 'personal_dtu_leak', name: 'Personal DTUs never leak', status: 'enforced' },
    ],
  }));
  await page.route('**/api/sovereignty/audit', ok({ ok: true, lockPercentage: 72 }));

  // Generic admin data — a permissive 200 keeps the operator lenses off the
  // 403 gate. Individual specs still override specific endpoints with richer
  // fixtures (backup/CDN widgets do this) — later route() wins in Playwright.
  await page.route('**/api/admin/**', ok({ ok: true }));
  await page.route('**/api/guidance/**', ok({ ok: true, items: [] }));
  await page.route('**/api/perf/**', ok({ ok: true, samples: [] }));
  await page.route('**/api/events**', ok({ ok: true, events: [] }));
  // Generic lens-data (useLensData → GET /api/lens/:domain). Lens pages gate
  // their main render on this query's isLoading; without a mock it hangs on a
  // dead backend and the page is stuck on a spinner (e.g. /lenses/lock's
  // historyLoading gate). Empty items resolve the query so the controls render.
  await page.route('**/api/lens/**', ok({ ok: true, items: [] }));
}

/**
 * Sign in as an elevated (sovereign + admin + operator) user AND grant the
 * admin data surface — the one call an admin/sovereign walkthrough needs.
 * Keeps the non-admin 403-gate path (mockAuthSuccess role:'user') untouched.
 */
export async function mockSovereignAuth(page: Page, opts: AuthMockOptions = {}) {
  await mockAuthSuccess(page, {
    username: 'sovereign',
    role: 'sovereign',
    scopes: ['admin', 'operator', 'sovereign'],
    ...opts,
  });
  await grantAdminData(page);
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
