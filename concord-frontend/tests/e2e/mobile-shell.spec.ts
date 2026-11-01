// Phase 1 of the mobile layout pass (brief mobile-layout-shared-20261031): the
// shared shell must fit a phone. Backend mocked; read-only.
//   - nothing in the top bar extends past the viewport (the avatar used to be pushed off)
//   - lens content inset is 24px or less per side (NorthStarFrame was a fixed 32px)
//   - the primary CTA and the Help button never overlap
//   - shell tap targets are 40px or more
import { test, expect, devices, type Page } from '@playwright/test';
import { blockUnmockedApi, mockAuthSuccess } from './_helpers';

const { defaultBrowserType: _ignored, ...iphone14 } = devices['iPhone 14'];

const LENSES = ['chat', 'education', 'marketplace', 'accounting', 'board'];
const PROFILES = [
  { name: 'iPhone 14 (390x844)', use: iphone14 },
  { name: '360x740', use: { ...iphone14, viewport: { width: 360, height: 740 }, screen: { width: 360, height: 740 } } },
] as const;

async function boot(page: Page, lens: string) {
  await blockUnmockedApi(page);
  await mockAuthSuccess(page);
  await page.goto(`/lenses/${lens}`);
  await page.locator('header[role="banner"]').first().waitFor({ state: 'visible' });
}

for (const profile of PROFILES) {
  test.describe(profile.name, () => {
    test.use(profile.use);

    for (const lens of LENSES) {
      test(`${lens}: top bar fits, content inset small, FABs apart, tap targets >= 40px`, async ({ page }) => {
        await boot(page, lens);

        // 1. Nothing in the top bar extends past the viewport; the avatar is fully visible.
        const bar = await page.evaluate(() => {
          const header = document.querySelector('header[role="banner"]')!;
          const w = window.innerWidth;
          const over: string[] = [];
          header.querySelectorAll('*').forEach((el) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            if (r.right > w + 0.5) over.push(`${el.tagName}.${(el as HTMLElement).className}`.slice(0, 80));
          });
          return { over };
        });
        expect(bar.over, 'top bar elements past the viewport').toEqual([]);
        const avatar = page.getByRole('button', { name: 'User menu' }).first();
        await expect(avatar).toBeVisible();
        const vw = page.viewportSize()!.width;
        const ab = (await avatar.boundingBox())!;
        expect(ab.x + ab.width).toBeLessThanOrEqual(vw);

        // 2. Lens content inset (only lenses framed by NorthStarFrame carry data-lens-theme).
        const inset = await page.evaluate(() => {
          const f = document.querySelector('[data-lens-theme]');
          if (!f) return null;
          const cs = getComputedStyle(f);
          return { left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight) };
        });
        if (inset) {
          expect(inset.left).toBeLessThanOrEqual(24);
          expect(inset.right).toBeLessThanOrEqual(24);
        }

        // 3. CTA and Help never intersect.
        const cta = page.getByTestId('north-star-cta');
        const help = page.getByRole('button', { name: 'Help and feedback' });
        if ((await cta.count()) && (await help.count()) && (await cta.isVisible()) && (await help.isVisible())) {
          const a = (await cta.boundingBox())!;
          const b = (await help.boundingBox())!;
          const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
          expect(apart, `CTA ${JSON.stringify(a)} vs Help ${JSON.stringify(b)}`).toBe(true);
        }

        // 4. Shell tap targets.
        for (const loc of [page.getByRole('button', { name: 'User menu' }).first(), page.getByTestId('lens-tools-menu')]) {
          if ((await loc.count()) && (await loc.first().isVisible())) {
            const box = (await loc.first().boundingBox())!;
            expect(box.width).toBeGreaterThanOrEqual(40);
            expect(box.height).toBeGreaterThanOrEqual(40);
          }
        }
      });
    }
  });
}
