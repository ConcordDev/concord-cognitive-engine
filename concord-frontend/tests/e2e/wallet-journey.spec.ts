import { test, expect } from '@playwright/test';
import { mockAuthSuccess, gotoStable } from './_helpers';

/**
 * #5 — critical-path journey: the authenticated "money path".
 *
 * One e2e walk transitively exercises hundreds of components (AppShell, sidebar,
 * lens router, wallet shell, the balance/Buy-CC cards #807 touched) in a real
 * browser against the real backend — far more coverage-per-test than units, and
 * it catches integration regressions units can't (routing, hydration, the
 * SSR→client handoff). Assertions are deliberately defensive (status, presence)
 * so this is a stable smoke, not a brittle snapshot — see the backlog doc for
 * deeper assertion candidates.
 *
 * Set a session cookie so the middleware admits protected routes; uses
 * concord_refresh (not concord_auth) so the fake token isn't JWT-validated.
 */
async function authenticateContext(context: import('@playwright/test').BrowserContext) {
  await context.addCookies([
    { name: 'concord_refresh', value: 'e2e_test_token', domain: 'localhost', path: '/' },
  ]);
}

test.describe('Journey — authenticated money path', () => {
  test('login → home shell → wallet lens renders without errors', async ({ page, context }) => {
    test.setTimeout(60_000);
    await authenticateContext(context);
    await mockAuthSuccess(page, { username: 'walletuser', walletBalance: 1234 });

    // 1) Home shell hydrates.
    const home = await gotoStable(page, '/');
    expect((home?.status() ?? 200)).toBeLessThan(500);

    // 2) Wallet lens loads (the SSR→client handoff + lens router + wallet shell).
    const wallet = await gotoStable(page, '/lenses/wallet');
    expect((wallet?.status() ?? 200)).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    // 3) The page reached an interactive state — a heading or main region exists.
    //    (Defensive: the lens may render an empty/onboarding state with a mocked
    //    wallet, which is still a valid non-error render.)
    const landmark = page.locator('h1, h2, [role="main"], main');
    await expect.poll(async () => landmark.count(), { timeout: 15_000 }).toBeGreaterThan(0);

    // 4) No client-side crash boundary surfaced.
    await expect(page.getByText(/something went wrong|application error/i)).toHaveCount(0);
  });
});
