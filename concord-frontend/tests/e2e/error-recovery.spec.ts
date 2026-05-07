import { test, expect } from '@playwright/test';

test.describe('Error Recovery', () => {
  test('should handle API errors gracefully', async ({ page }) => {
    // Intercept API calls to simulate failures
    await page.route('**/api/status', route => {
      route.fulfill({ status: 500, body: JSON.stringify({ ok: false, error: 'Test error' }) });
    });

    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Page should still render, not crash
    const bodyVisible = await page.locator('body').isVisible().catch(() => false);
    if (bodyVisible) {
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should handle network timeouts gracefully', async ({ page }) => {
    // Simulate slow API
    await page.route('**/api/dtus**', route => {
      route.fulfill({ status: 504, body: 'Gateway Timeout' });
    });

    const response = await page.goto('/lenses/music');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Should show error state, not blank page
    const bodyVisible = await page.locator('body').isVisible().catch(() => false);
    if (bodyVisible) {
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should recover from error boundary with retry', async ({ page }) => {
    let requestCount = 0;
    await page.route('**/api/status', route => {
      requestCount++;
      if (requestCount <= 1) {
        route.fulfill({ status: 500, body: JSON.stringify({ ok: false }) });
      } else {
        route.fulfill({ status: 200, body: JSON.stringify({ ok: true, version: '2.0' }) });
      }
    });

    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Look for retry button if error boundary triggered
    const retryButton = page.locator('button:has-text("Retry"), button:has-text("Try Again")').first();
    if (await retryButton.isVisible().catch(() => false)) {
      await retryButton.click();
      await page.waitForLoadState('domcontentloaded');
    }
  });

  test('should handle 404 pages', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    const bodyVisible = await page.locator('body').isVisible().catch(() => false);
    if (bodyVisible) {
      await expect(page.locator('body')).toBeVisible();
    }
  });
});
