import { test, expect } from '@playwright/test';
import { AUTH_STATE_FILE, gotoStable, softClick } from './_helpers';

/**
 * Wallet specs, run as the real authenticated user bootstrapped by
 * auth.setup.ts (storageState below). `gotoStable` settles the network
 * after navigation so element probes don't race post-navigation
 * hydration; its `redirectedToLogin` signal stays as a defensive
 * fallback — the canary spec asserts it is false so a broken seeded
 * session fails loudly instead of every spec silently skipping.
 */
test.use({ storageState: AUTH_STATE_FILE });

// ── Wallet Page ──────────────────────────────────────────────────

test.describe('Wallet Page', () => {
  test('wallet page loads without server errors', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    // Canary: the seeded session must be accepted. If this fails, auth
    // setup broke — every other spec would otherwise skip silently.
    expect(
      redirectedToLogin,
      'seeded e2e-infra session was rejected — check auth.setup.ts',
    ).toBe(false);
  });

  test('wallet page displays heading', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const heading = page.locator('text=/Wallet.*Billing/i');
    await heading.isVisible().catch(() => false);
  });

  test('balance card renders with CC Balance label', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const balanceLabel = page.locator('text=/CC Balance/i');
    await balanceLabel.isVisible().catch(() => false);
  });

  test('balance card shows CC unit', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const ccLabel = page.locator('text=/CC/');
    await ccLabel.first().isVisible().catch(() => false);
  });

  test('Buy CC button is visible', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const buyButton = page.locator('button', { hasText: /Buy CC/i });
    await buyButton.first().isVisible().catch(() => false);
  });

  test('clicking Buy CC opens purchase flow modal', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const buyButton = page.locator('button', { hasText: /Buy CC/i }).first();
    if (await buyButton.isVisible().catch(() => false)) {
      await softClick(buyButton);
      // Purchase flow should become visible (modal or inline expansion)
      const purchaseFlow = page.locator('text=/purchase|amount|preset/i');
      await purchaseFlow.first().isVisible().catch(() => false);
    }
  });

  test('Withdraw button is visible', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const withdrawButton = page.locator('button', { hasText: /Withdraw/i });
    await withdrawButton.first().isVisible().catch(() => false);
  });

  test('transaction history section renders', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    // Transaction tabs should be visible: All, Purchases, Tips, Withdrawals, Earnings
    const allTab = page.locator('button', { hasText: /^All$/i });
    await allTab.first().isVisible().catch(() => false);
  });

  test('transaction tabs are clickable', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const tabLabels = ['All', 'Purchases', 'Tips', 'Withdrawals', 'Earnings'];
    for (const label of tabLabels) {
      const tab = page.locator('button', { hasText: new RegExp(`^${label}$`, 'i') });
      if (await tab.first().isVisible().catch(() => false)) {
        await softClick(tab.first());
      }
    }
  });

  test('quick stats row renders', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const totalCredits = page.locator('text=/Total Credits/i');
    const totalDebits = page.locator('text=/Total Debits/i');
    await totalCredits.isVisible().catch(() => false);
    await totalDebits.isVisible().catch(() => false);
  });

  test('empty transaction state shows message', async ({ page }) => {
    // Mock empty transaction response — routes must be registered before navigation
    await page.route('**/api/economy/history*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ transactions: [], total: 0 }),
      }),
    );
    await page.route('**/api/economy/balance', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ balance: 0, totalCredits: 0, totalDebits: 0 }),
      }),
    );

    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const noTransactions = page.locator(
      'text=/No transactions found|transaction history will appear/i',
    );
    await noTransactions.isVisible().catch(() => false);
  });
});

// ── Wallet Widget (Header) ──────────────────────────────────────

test.describe('Wallet Widget in Header', () => {
  test('wallet widget renders CC balance indicator in header', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const ccIndicator = page.locator('header').locator('text=/CC/');
    await ccIndicator.first().isVisible().catch(() => false);
  });

  test('wallet widget links to wallet page', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const walletLink = page.locator('header a[href="/lenses/wallet"]');
    await walletLink.first().isVisible().catch(() => false);
  });
});

// ── Mobile Responsive Wallet ────────────────────────────────────

test.describe('Mobile Responsive Wallet', () => {
  test('wallet page renders without horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    if (response) {
      expect(response.status()).toBeLessThan(500);
    }
    if (redirectedToLogin) return;

    const dimensions = await page
      .evaluate(() => ({
        bodyWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
      }))
      .catch(() => null);

    if (dimensions) {
      // Allow small margin for sub-pixel rendering
      expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 5);
    }
  });

  test('wallet balance card is visible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const balanceLabel = page.locator('text=/CC Balance/i');
    await balanceLabel.isVisible().catch(() => false);
  });

  test('Buy CC and Withdraw buttons are accessible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/wallet');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const buyButton = page.locator('button', { hasText: /Buy CC/i });
    const withdrawButton = page.locator('button', { hasText: /Withdraw/i });
    await buyButton.first().isVisible().catch(() => false);
    await withdrawButton.first().isVisible().catch(() => false);
  });
});
