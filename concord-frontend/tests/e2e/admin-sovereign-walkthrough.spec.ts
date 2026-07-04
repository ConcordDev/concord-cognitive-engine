import { test, expect } from '@playwright/test';
import { mockSovereignAuth, gotoStable, blockUnmockedApi } from './_helpers';

/**
 * Positive counterpart to admin-gated-lenses.spec.ts.
 *
 * That spec proves a NON-admin sees the friendly "Admin access required" gate
 * on a 403. This one proves an ELEVATED (sovereign + admin + operator) user
 * walks THROUGH the operator + sovereignty controls — the controls render and
 * the gate does NOT. The operator lenses gate purely on the data response
 * (403 → gate), so mockSovereignAuth() 200-mocks the admin data surface +
 * /api/sovereignty/status; no client-side role check hides the controls.
 *
 * Regression guard for the release requirement that an admin/sovereign
 * walkthrough is possible in E2E (previously only role:'user' was mockable,
 * so any admin/sovereign traversal either failed or silently no-op'd).
 */

test.describe('Elevated user walks through admin + sovereign controls', () => {
  test('operator lens (ops-telemetry) renders controls, NOT the admin gate', async ({ page }) => {
    // blockUnmockedApi's catch-all MUST be registered before mockSovereignAuth
    // so the auth + admin-data mocks it registers (more specific patterns)
    // take precedence — Playwright routes last-registered-first (_helpers.ts).
    await blockUnmockedApi(page);
    await mockSovereignAuth(page);
    await gotoStable(page, '/lenses/ops-telemetry');
    // The 403 gate must NOT appear for an elevated user with 200 admin data.
    await expect(page.getByText(/Admin access required/i)).toHaveCount(0);
    // Page mounted (didn't 307 to /login) and rendered real chrome.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('admin lens renders without the access gate for an elevated user', async ({ page }) => {
    await blockUnmockedApi(page);
    await mockSovereignAuth(page);
    const res = await gotoStable(page, '/lenses/admin');
    expect(res?.status() ?? 200).toBeLessThan(500);
    await expect(page.getByText(/Admin access required/i)).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('sovereignty controls (/lenses/lock) render live lock state', async ({ page }) => {
    await blockUnmockedApi(page);
    await mockSovereignAuth(page);
    await gotoStable(page, '/lenses/lock');
    await expect(page).not.toHaveURL(/\/login/);
    // use70Lock consumes the mocked /api/sovereignty/status (lockPercentage 72,
    // 3 enforced invariants) — the dashboard's stable labels must render.
    await expect(
      page.getByText(/Invariant Enforcement|Sovereignty Lock|Total Invariants/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
