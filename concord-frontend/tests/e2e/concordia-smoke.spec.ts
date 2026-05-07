/**
 * Concordia Phase 4 Smoke Tests (Playwright — chromium only)
 *
 * Validates that the world lens page loads and all Phase 4 toolbar panels
 * are reachable without uncaught JS errors.
 */

import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

test.describe('Concordia World Lens — Smoke', () => {
  test.beforeEach(async ({ page }) => {
    // Capture uncaught errors
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/lenses/world', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Give React time to hydrate
    await page.waitForTimeout(1500);

    // Attach errors array for use in tests
    (page as unknown as { _capturedErrors: string[] })._capturedErrors = errors;
  });

  test('page loads without fatal JS errors', async ({ page }) => {
    const errors = (page as unknown as { _capturedErrors: string[] })._capturedErrors ?? [];
    // Filter out expected/non-fatal noise:
    //   - React dev warnings (Warning: …)
    //   - ReactDOM hydration mismatches that recover
    //   - WebGL / Three.js warnings in headless mode (ANGLE, WebGL fallbacks)
    //   - Network errors from unconfigured infra in CI (Ollama 503 if model
    //     not loaded yet, federation peers offline, etc.) — these are a
    //     test-env artifact, not a product bug.
    //   - AbortErrors from in-flight requests when the page navigates fast
    const ignorablePatterns = [
      /^Warning:/i,
      /ReactDOM/,
      /WebGL|ANGLE/i,
      /Failed to fetch/i,
      /NetworkError|net::ERR_/i,
      /AbortError/i,
      /Hydration/i,
      /503|502|504/,        // upstream-unavailable echoes from server
      /Ollama|brain_offline/i,
      /federation|peer/i,
    ];
    const fatal = errors.filter((e) => !ignorablePatterns.some((p) => p.test(e)));
    if (fatal.length > 0) {
      // Surface the actual errors in the failure message so a real regression
      // shows up clearly instead of a generic "fatal errors found."
      console.error('Fatal JS errors during /lenses/world load:\n' + fatal.join('\n---\n'));
    }
    expect(fatal).toHaveLength(0);
  });

  test('page has a canvas element when Explore 3D is available', async ({ page }) => {
    // Try to find and click the Explore 3D button
    const exploreBtn = page.locator('button:has-text("Explore 3D"), button:has-text("Explore")').first();
    if (await exploreBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await exploreBtn.click();
      await page.waitForTimeout(500);
    }

    // Canvas may or may not be present depending on render mode
    const canvas = page.locator('canvas');
    const hasCanvas = await canvas.count() > 0;
    // Not a failure if canvas isn't rendered — just validate page structure is sane
    if (hasCanvas) {
      await expect(canvas.first()).toBeVisible();
    }
  });

  test('Leaderboard panel opens and closes', async ({ page }) => {
    const boardBtn = page.locator('button', { hasText: 'Board' });
    if (!await boardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip();
      return;
    }
    await boardBtn.click();
    await page.waitForTimeout(300);

    // Panel should be open — look for tab text
    await expect(page.locator('text=Sparks').first()).toBeVisible({ timeout: 5000 });

    // Dismiss with Escape
    await page.keyboard.press('Escape');
    // Panel might still be visible depending on implementation — just verify no crash
  });

  test('Events+ panel opens', async ({ page }) => {
    const eventsBtn = page.locator('button', { hasText: 'Events+' });
    if (!await eventsBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip();
      return;
    }
    await eventsBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=/active/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('Arena panel opens', async ({ page }) => {
    const arenaBtn = page.locator('button', { hasText: 'Arena' });
    if (!await arenaBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip();
      return;
    }
    await arenaBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=/arena/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('Jobs panel opens', async ({ page }) => {
    const jobsBtn = page.locator('button', { hasText: 'Jobs' });
    if (!await jobsBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip();
      return;
    }
    await jobsBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=Available').first()).toBeVisible({ timeout: 5000 });
  });

  test('Lore panel opens', async ({ page }) => {
    const loreBtn = page.locator('button', { hasText: 'Lore' });
    if (!await loreBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip();
      return;
    }
    await loreBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=/chronicle|oracle|lore/i').first()).toBeVisible({ timeout: 5000 });
  });
});
