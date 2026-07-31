import { test, expect } from '@playwright/test';
import { mockAuthSuccess, gotoStable, blockUnmockedApi, corsFulfill } from './_helpers';

/**
 * Admin-gated lenses must render a friendly "Admin access required" state (not a
 * blank page / stuck spinner / raw 403 string) when the backend denies a non-admin.
 * We mock every data endpoint the 6 operator lenses touch to return 403, sign in as
 * a plain user, and assert the gate renders. Regression for the audit finding that
 * these lenses swallowed the 403.
 */

const ADMIN_LENSES = ['ops-telemetry', 'repair-telemetry', 'psyops', 'crisis-ops', 'ops', 'admin'];

// These are the test's SUBJECT — the 403 on these exact patterns must still
// reach the lens pages so <AdminRequiredState> renders. They are registered
// (in the test body) AFTER blockUnmockedApi()'s catch-all, so per Playwright's
// last-registered-wins route precedence they correctly override the generic
// 200 for these specific patterns while every other endpoint the page
// background-probes (age-status, pulse, circuits, quality/thresholds,
// flywheel, org/list, pipeline/executions, ...) still gets a benign 200 from
// the catch-all instead of a real 401 that would trip the auth-refresh
// interceptor and bounce the whole page to /login.
async function denyAdminData(page: import('@playwright/test').Page) {
  // corsFulfill (not a bare route.fulfill): NEXT_PUBLIC_API_URL is an
  // absolute cross-origin URL in CI (frontend :3000, backend :5050), and the
  // shared axios instance (lib/api/client.ts) sends a default
  // `Content-Type: application/json` header on every request — including
  // lensRun's/apiHelpers' GETs — which forces a real CORS preflight. Without
  // answering that preflight (and the actual 403) with CORS headers, the
  // browser blocks the request as a generic network error before the real
  // 403 status ever reaches the page's JS: `isForbidden()` only recognizes
  // an actual 403 (or its message text), never a CORS-blocked network error,
  // so the page falls through to a "couldn't load" state instead of the
  // friendly Admin-required gate this spec is checking for. This was the
  // reason 5 of the 6 lenses here failed while ops-telemetry (a raw
  // `fetch()` probe with no custom headers — a simple request, no preflight)
  // passed: it was never a frontend gate-detection bug, it was this helper
  // not emulating the real backend's own CORS middleware
  // (server/middleware/index.js's corsOptions, which the actual server
  // answers preflight with correctly).
  const forbid = (route: import('@playwright/test').Route) =>
    corsFulfill(route, {
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'Insufficient permissions', requiredRoles: ['admin'] }),
    });
  // Raw-fetch admin endpoints (ops-telemetry), the macro gateway (lensRun lenses),
  // and the admin page's guidance/perf/events queries.
  await page.route('**/api/admin/**', forbid);
  await page.route('**/api/lens/run', forbid);
  await page.route('**/api/guidance/**', forbid);
  await page.route('**/api/perf/**', forbid);
  await page.route('**/api/events**', forbid);
}

test.describe('Admin-gated lenses show a friendly Admin-required state on 403', () => {
  for (const lens of ADMIN_LENSES) {
    test(`/lenses/${lens} renders "Admin access required" for a non-admin`, async ({ page }) => {
      // Registration order matters: blockUnmockedApi's catch-all MUST be
      // registered first so mockAuthSuccess's + denyAdminData's more-specific
      // mocks (registered after) take precedence over it (see _helpers.ts).
      await blockUnmockedApi(page);
      await mockAuthSuccess(page, { role: 'user' });
      await denyAdminData(page);
      await gotoStable(page, `/lenses/${lens}`);
      await expect(page.getByText(/Admin access required/i)).toBeVisible({ timeout: 15_000 });
    });
  }
});
