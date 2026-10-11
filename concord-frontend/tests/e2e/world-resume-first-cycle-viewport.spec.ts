import { test, expect, type Page } from '@playwright/test';
import { blockUnmockedApi, corsFulfill, mockAuthSuccess } from './_helpers';

/**
 * The Resume First Cycle pill is `fixed` to the viewport, and the sidebar
 * is a fixed rail that paints above it. At 1280×800 the rail covers the
 * pill's left edge (collapsed w-16) or the whole control (expanded w-64).
 * The bounding box must sit fully inside the viewport and fully to the
 * right of the rail.
 */
test.describe('Resume First Cycle is fully visible at 1280x800', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'viewport geometry is asserted once on desktop chromium',
    );
  });

  test('button bounding box clears the sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await blockUnmockedApi(page);
    await mockAuthSuccess(page);
    // mockAuthSuccess dismisses the pill. This wizard is what we are measuring.
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('concord_first_win_dismissed');
        // Default rail is the collapsed 4rem icon strip.
        localStorage.setItem(
          'concord-ui-store',
          JSON.stringify({ state: { sidebarCollapsed: true, theme: 'dark' }, version: 0 }),
        );
      } catch { /* private mode */ }
    });
    await page.route('**/api/guidance/first-win', (route) =>
      corsFulfill(route, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          allDone: false,
          completedCount: 0,
          steps: [{ id: 'create_dtu', label: 'Create your first DTU', completed: false }],
        }),
      }),
    );
    await page.route('**/api/tutorial/first-cycle', (route) =>
      corsFulfill(route, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          tutorial: 'first_cycle',
          currentPhase: 'complete',
          complete: true,
          phases: [],
        }),
      }),
    );

    await page.goto('/lenses/world', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);

    const button = page.getByRole('button', { name: 'Resume First Cycle' });
    await expect(button).toBeVisible();
    await assertClearsSidebar(page, button);
  });
});

async function assertClearsSidebar(page: Page, button: ReturnType<Page['getByRole']>) {
  await expect(button).toBeInViewport({ ratio: 1 });
  const box = await button.boundingBox();
  const sidebar = await page.getByTestId('sidebar').boundingBox();
  const vp = page.viewportSize();
  expect(box).not.toBeNull();
  expect(sidebar).not.toBeNull();
  expect(vp).toEqual({ width: 1280, height: 800 });
  // Fully inside the viewport.
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp!.height + 1);
  // Fully to the right of the rail — not clipped underneath it.
  expect(box!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width - 1);
}
