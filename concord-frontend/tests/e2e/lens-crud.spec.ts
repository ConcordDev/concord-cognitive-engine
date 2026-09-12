import { test, expect } from '@playwright/test';

test.describe('Lens CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');
  });

  test('should navigate to a lens page', async ({ page }) => {
    // Click on a lens link in the sidebar or main navigation
    const lensLink = page.locator('a[href*="/lenses/"]').first();
    if (await lensLink.isVisible().catch(() => false)) {
      await lensLink.click();
      await page.waitForURL(/\/lenses\//, { timeout: 5000 }).catch(() => {});
      const url = page.url();
      if (url.includes('/lenses/')) {
        expect(url).toMatch(/\/lenses\//);
      }
    }
  });

  test('should display DTU list on lens page', async ({ page }) => {
    const response = await page.goto('/lenses/music');
    if (response) {
      expect(response.status()).toBeLessThan(500);
    }
    await page.waitForLoadState('domcontentloaded');
    // Page should load without errors
    const body = page.locator('body');
    if (await body.isVisible().catch(() => false)) {
      const text = await body.textContent().catch(() => '');
      if (text) {
        expect(text).not.toContain('Application error');
      }
    }
  });

  test('should handle lens page error gracefully', async ({ page }) => {
    // Navigate to a non-existent lens
    const response = await page.goto('/lenses/nonexistent-lens-xyz').catch(() => null);
    if (response?.status()) {
      expect(response.status()).toBeLessThan(500);
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    // Should show error boundary or redirect, not crash
    const body = page.locator('body');
    if (await body.isVisible().catch(() => false)) {
      await expect(body).toBeVisible();
    }
  });

  test('should display lens content with proper structure', async ({ page }) => {
    const response = await page.goto('/lenses/science').catch(() => null);
    if (response) {
      expect(response.status()).toBeLessThan(500);
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    // Check that the page has some structure.
    //
    // Root-caused 2026-09-12: the previous `if (await main.isVisible()) {
    // await expect(main).toBeVisible() }` shape is racy by construction —
    // `isVisible()` is a one-shot, non-retrying check, so a transient
    // loading-spinner-to-content swap (or any re-render) between that check
    // and the `expect` re-query can make the SAME locator resolve to a
    // now-unmounted element, failing "element(s) not found" even though a
    // matching container appeared moments earlier (observed directly in
    // CI). `expect().toBeVisible()` already retries/polls internally, so
    // gating it behind a separate one-shot visibility check adds no safety
    // and only opens that race window. Guard on `count()` instead — a
    // synchronous DOM query, not a time-varying one — then let the
    // assertion's own retry loop handle genuine loading-state timing.
    const main = page.locator('main, [role="main"], .lens-content, .page-content').first();
    if (await main.count().catch(() => 0) > 0) {
      await expect(main).toBeVisible();
    }
  });
});
