import { test, expect } from '@playwright/test';
import { blockUnmockedApi, corsFulfill } from './_helpers';

/**
 * GB-1536 §6d (e2e half) — "Enter means Enter", driven in a real
 * browser against the built app:
 *
 *   - Enter lands on /hub as a guest: normal shell, guest banner,
 *     Log in / Sign up in the topbar.
 *   - The removed screens (/explore, /onboarding, location) 308
 *     to /hub; brain-mode STAYS (founder ruling) as the one kept
 *     post-signup step, carrying the return-to.
 *   - On a lens, a guest who tries to ACT (sending a chat message)
 *     gets the signup modal with the draft stashed — the message is
 *     never sent; Esc closes the modal and focus returns.
 *   - Completing signup inside the modal navigates back to exactly
 *     the page the guest was on (the return-to).
 *
 * The post-auth draft RESTORE is covered at unit level
 * (tests/guest-return-to.test.ts + the rail's useRestoredDraft wiring);
 * the live post-deploy re-walk covers the full round trip.
 */

const LENS_PATH = '/lenses/chem';

test.describe('GB-1536 guest entry', () => {
  test.beforeEach(async ({ page }) => {
    await blockUnmockedApi(page);
  });

  test('Enter lands on /hub as a guest with banner + topbar auth actions', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /enter/i }).first().click();
    await expect(page).toHaveURL(/\/hub$/);
    await expect(page.getByTestId('guest-banner')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign up' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' }).first()).toBeVisible();
  });

  test('the removed post-Enter screens redirect to /hub (brain-mode is NOT one of them)', async ({ page }) => {
    for (const gone of ['/explore', '/explore/engine', '/onboarding', '/onboarding/location']) {
      await page.goto(gone);
      await expect(page, gone).toHaveURL(/\/hub$/);
    }
  });

  test('a guest acting on a lens gets the modal, the draft stashed, nothing sent', async ({ page }) => {
    const chatPosts: string[] = [];
    page.on('request', (req) => {
      if (req.method() !== 'GET' && req.url().includes('/api/')) chatPosts.push(req.url());
    });

    await page.goto(LENS_PATH);
    await expect(page.getByTestId('guest-banner')).toBeVisible();

    const draft = 'size a beam for a 4 metre span';
    const box = page.locator('textarea').first();
    await box.fill(draft);
    await page.getByRole('button', { name: 'Send message' }).click();

    // The signup modal opens in place…
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getAttribute('aria-modal')).toBe('true');

    // …the intent draft is stashed under this page's returnTo…
    const stashKeys = await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) => k.startsWith('concord_guest_draft:')),
    );
    expect(stashKeys.length).toBe(1);
    expect(stashKeys[0]).toContain('/lenses/chem');

    // …and nothing was sent anywhere.
    expect(chatPosts).toEqual([]);

    // Esc closes the modal and the guest is still exactly here.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/lenses\/chem$/);
  });

  test('signup inside the modal navigates back to the return-to', async ({ page }) => {
    await page.route('**/api/auth/register', (route) =>
      corsFulfill(route, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          token: 'e2e-token',
          user: { id: 'e2e-user', username: 'guest-turned-member', email: 'g@example.com' },
        }),
      }),
    );
    await page.route('**/api/auth/me', (route) =>
      corsFulfill(route, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user: { id: 'e2e-user', username: 'guest-turned-member', email: 'g@example.com', needsOnboarding: true },
        }),
      }),
    );

    await page.goto(`${LENS_PATH}?study=beam-1`);
    await page.getByRole('button', { name: 'Sign up' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // AuthPage's signup form, inside the modal. (needsOnboarding:true
    // on /me must NOT reroute — GB-1536 removed the chain.)
    await dialog.locator('input[name="username"], input#username, input[type="text"]').first().fill('guest-turned-member');
    await dialog.locator('input[type="email"]').first().fill('g@example.com');
    await dialog.locator('input[type="password"]').first().fill('a-strong-password-1');
    await dialog.getByRole('button', { name: /create account|sign up/i }).last().click();

    // Founder ruling on the GB-1536 flag: a NEW account routes once
    // through the kept brain-mode screen, carrying the return-to…
    await expect(page).toHaveURL(/\/onboarding\/brain-mode\?from=/);
    // …and after the choice it hard-lands back exactly where the
    // guest was.
    await page.getByRole('button', { name: /stay private|continue/i }).first().click();
    await expect(page).toHaveURL(/\/lenses\/chem\?study=beam-1$/);
  });
});
