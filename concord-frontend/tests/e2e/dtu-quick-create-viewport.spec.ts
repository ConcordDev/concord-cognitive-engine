import { test, expect, type Page } from '@playwright/test';
import { blockUnmockedApi, mockAuthSuccess } from './_helpers';

/**
 * Create New DTU used to grow past the viewport (visibility + license fields).
 * The dialog lived under a transformed framer-motion ancestor, so position:fixed
 * did not track the screen and the Create button sat below the fold. Page scroll
 * could not bring it back. These viewports are the ones that failed in the
 * 2026-10-10 headless repro (1280×800) plus a short laptop and a phone width.
 */
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 700 },
  { width: 390, height: 844 },
] as const;

test.describe('DTU quick-create submit stays in the viewport', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'viewport geometry is asserted once on desktop chromium',
    );
  });

  for (const viewport of VIEWPORTS) {
    test(`Create DTU is clickable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await blockUnmockedApi(page);
      await mockAuthSuccess(page);
      await page.addInitScript(() => {
        try {
          localStorage.setItem('concord:first-run-tour:dtus', '1');
        } catch { /* private mode */ }
      });

      await page.goto('/lenses/dtus', { waitUntil: 'domcontentloaded' });
      await expect(page).not.toHaveURL(/\/login/);

      const open = page.getByRole('button', { name: 'New DTU' }).first();
      await expect(open).toBeVisible({ timeout: 60_000 });
      // data-hydrated flips in useEffect, after React has attached onClick.
      // One actionability-checked click. No retry loop.
      await expect(open).toHaveAttribute('data-hydrated', 'true');
      await open.click();

      const dialog = page.getByRole('dialog', { name: 'Create New DTU' });
      await expect(dialog).toBeVisible();

      await dialog.getByPlaceholder('The thought content...').fill('Usability note for the quick-create dialog');
      await dialog.getByPlaceholder('research, science, hypothesis').fill('usability, test');

      const submit = dialog.getByRole('button', { name: 'Create DTU' });
      await expect(submit).toBeEnabled();
      await assertFullyInViewport(page, submit);
      // The reported failure was click() → "element is outside of the viewport".
      // Trial performs that actionability check and does not submit.
      await submit.click({ trial: true });
      await expect(submit).toBeEnabled();

      const hit = await submit.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && (top === el || el.contains(top));
      });
      expect(hit).toBe(true);

      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);

      // Footer is outside the field scroller, so reaching the last license
      // scope must not push Create off the screen.
      const outsideScroller = await submit.evaluate((el) => !el.closest('.overflow-y-auto'));
      expect(outsideScroller).toBe(true);

      const before = await dialog.boundingBox();
      const commercial = dialog.locator('#quick-create-scope-commercial');
      await commercial.scrollIntoViewIfNeeded();
      await expect(commercial).toBeInViewport({ ratio: 1 });
      await assertFullyInViewport(page, submit);
      await submit.click({ trial: true });

      const title = dialog.getByPlaceholder('A descriptive title for this thought...');
      await title.scrollIntoViewIfNeeded();
      await expect(title).toBeInViewport({ ratio: 1 });
      await assertFullyInViewport(page, submit);
      await submit.click({ trial: true });

      const after = await dialog.boundingBox();
      expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
      expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThan(2);
    });
  }
});

async function assertFullyInViewport(page: Page, locator: ReturnType<Page['getByRole']>) {
  await expect(locator).toBeInViewport({ ratio: 1 });
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  expect(box).not.toBeNull();
  expect(vp).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp!.height + 1);
}
