import { test, expect } from '@playwright/test';
import { mockAuthSuccess, gotoStable } from './_helpers';

/**
 * Admin-gated lenses must render a friendly "Admin access required" state (not a
 * blank page / stuck spinner / raw 403 string) when the backend denies a non-admin.
 * We mock every data endpoint the 6 operator lenses touch to return 403, sign in as
 * a plain user, and assert the gate renders. Regression for the audit finding that
 * these lenses swallowed the 403.
 */

const ADMIN_LENSES = ['ops-telemetry', 'repair-telemetry', 'psyops', 'crisis-ops', 'ops', 'admin'];

async function denyAdminData(page: import('@playwright/test').Page) {
  const forbid = (route: import('@playwright/test').Route) =>
    route.fulfill({
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
      await mockAuthSuccess(page, { role: 'user' });
      await denyAdminData(page);
      await gotoStable(page, `/lenses/${lens}`);
      await expect(page.getByText(/Admin access required/i)).toBeVisible({ timeout: 15_000 });
    });
  }
});
