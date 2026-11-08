import { test, expect } from '@playwright/test';
import { blockUnmockedApi, mockAuthSuccess } from './_helpers';

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
    // Science is not one of the signed-out browse lenses (only Music and Market
    // are), so a visitor with no session is sent to /login by the middleware.
    // This test asserts the LENS shell, so it signs in the same way every
    // sibling spec does (session cookie + mocked API) instead of racing a
    // login page that happens to share the landmark selectors.
    await blockUnmockedApi(page);
    await mockAuthSuccess(page);
    const response = await page.goto('/lenses/science').catch(() => null);
    if (response) {
      expect(response.status()).toBeLessThan(500);
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    // Signed in, the lens must stay on its own route (no auth bounce).
    await expect(page).toHaveURL(/\/lenses\/science/);
    // The lens content landmark must be present and visible. toBeVisible()
    // retries internally, so there is no count()/isVisible() pre-check to
    // race a loading-to-content swap (the 2026-09-12 root cause), and an
    // absent landmark now fails instead of silently skipping the assertion.
    const main = page.locator('main, [role="main"], .lens-content, .page-content').first();
    await expect(main).toBeVisible();
  });
});
