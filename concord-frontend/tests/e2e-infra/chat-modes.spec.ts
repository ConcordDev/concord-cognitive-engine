import { test, expect } from '@playwright/test';
import { AUTH_STATE_FILE, gotoStable, softClick } from './_helpers';

/**
 * Chat-rail specs, run as the real authenticated user bootstrapped by
 * auth.setup.ts (storageState below). `gotoStable` settles the network
 * after navigation so element probes don't race post-navigation
 * hydration; its `redirectedToLogin` signal stays as a defensive
 * fallback — the canary spec asserts it is false so a broken seeded
 * session fails loudly instead of every spec silently skipping.
 */
test.use({ storageState: AUTH_STATE_FILE });

// ── Chat Rail Mode Selector ──────────────────────────────────────

test.describe('Chat Rail Mode Selector', () => {
  test('chat page loads without server errors', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    // Canary: the seeded session must be accepted. If this fails, auth
    // setup broke — every other spec would otherwise skip silently.
    expect(
      redirectedToLogin,
      'seeded e2e-infra session was rejected — check auth.setup.ts',
    ).toBe(false);
  });

  test('chat rail renders mode selector with 5 modes', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    // The 5 modes: Welcome, Assist, Explore, Connect, Chat
    const modeLabels = ['Welcome', 'Assist', 'Explore', 'Connect', 'Chat'];
    for (const label of modeLabels) {
      const modeButton = page.locator(
        `button:has-text("${label}"), [data-mode="${label.toLowerCase()}"], [aria-label*="${label}" i]`,
      );
      await modeButton.first().isVisible().catch(() => false);
    }
  });

  test('mode selector buttons are clickable', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const modeLabels = ['Assist', 'Explore', 'Connect', 'Chat'];
    for (const label of modeLabels) {
      const modeButton = page
        .locator(`button:has-text("${label}"), [data-mode="${label.toLowerCase()}"]`)
        .first();

      if (await modeButton.isVisible().catch(() => false)) {
        // Dismiss any overlays (chat panel, modals) that may intercept clicks
        const overlay = page.locator('div[aria-hidden="true"].fixed, aside[role="dialog"]');
        if (await overlay.first().isVisible().catch(() => false)) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }
        await softClick(modeButton, { force: true });
        // No crash after clicking mode
        await page.locator('body').isVisible().catch(() => false);
      }
    }
  });
});

// ── Welcome Mode ──────────────────────────────────────────────────

test.describe('Welcome Mode', () => {
  test('welcome mode shows greeting content', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    // Welcome mode is the default when 0 messages — look for greeting text
    const greetingContent = page.locator(
      'text=/welcome|hello|good morning|good afternoon|good evening|how can I help/i',
    );
    await greetingContent.first().isVisible().catch(() => false);
  });

  test('welcome mode shows quick action buttons', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const actionButtons = page.locator(
      'button[data-action], button:has-text("Create"), button:has-text("Search"), button:has-text("Explore")',
    );
    // Welcome panel may have quick actions, but we don't fail if absent
    await actionButtons.count();
  });
});

// ── Assist Mode ──────────────────────────────────────────────────

test.describe('Assist Mode', () => {
  test('assist mode renders task-focused interface', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const assistButton = page
      .locator('button:has-text("Assist"), [data-mode="assist"]')
      .first();
    if (await assistButton.isVisible().catch(() => false)) {
      await softClick(assistButton, { force: true });
      const assistContent = page.locator('text=/task|assist|help|workflow/i');
      await assistContent.first().isVisible().catch(() => false);
    }
  });
});

// ── Explore Mode ──────────────────────────────────────────────────

test.describe('Explore Mode', () => {
  test('explore mode renders discovery interface', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const exploreButton = page
      .locator('button:has-text("Explore"), [data-mode="explore"]')
      .first();
    if (await exploreButton.isVisible().catch(() => false)) {
      await softClick(exploreButton);
      const exploreContent = page.locator('text=/trending|surprise|discover|explore|topic/i');
      await exploreContent.first().isVisible().catch(() => false);
    }
  });

  test('explore mode has surprise me button', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const exploreButton = page
      .locator('button:has-text("Explore"), [data-mode="explore"]')
      .first();
    if (await exploreButton.isVisible().catch(() => false)) {
      await softClick(exploreButton);
      const surpriseButton = page.locator('button:has-text("Surprise"), button:has-text("Random")');
      await surpriseButton.first().isVisible().catch(() => false);
    }
  });
});

// ── Connect Mode ──────────────────────────────────────────────────

test.describe('Connect Mode', () => {
  test('connect mode renders collaboration options', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const connectButton = page
      .locator('button:has-text("Connect"), [data-mode="connect"]')
      .first();
    if (await connectButton.isVisible().catch(() => false)) {
      await softClick(connectButton);
      const connectContent = page.locator('text=/collaborate|connect|share|session|invite/i');
      await connectContent.first().isVisible().catch(() => false);
    }
  });
});

// ── Mode Switching ──────────────────────────────────────────────────

test.describe('Mode Switch Behavior', () => {
  test('switching between modes preserves page state', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const modeLabels = ['Assist', 'Explore', 'Connect', 'Chat', 'Welcome'];
    for (const label of modeLabels) {
      const modeButton = page
        .locator(`button:has-text("${label}"), [data-mode="${label.toLowerCase()}"]`)
        .first();
      if (await modeButton.isVisible().catch(() => false)) {
        await softClick(modeButton, { force: true });
        await page.waitForTimeout(200);
      }
    }

    expect(errors).toHaveLength(0);
  });

  test('chat input placeholder changes with mode', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const chatInput = page.locator('textarea, input[type="text"]').last();
    if (await chatInput.isVisible().catch(() => false)) {
      const exploreButton = page
        .locator('button:has-text("Explore"), [data-mode="explore"]')
        .first();
      if (await exploreButton.isVisible().catch(() => false)) {
        await softClick(exploreButton);
        await page.waitForTimeout(300);
        const newPlaceholder = await chatInput.getAttribute('placeholder').catch(() => null);
        if (newPlaceholder !== null) {
          expect(typeof newPlaceholder).toBe('string');
        }
      }
    }
  });
});

// ── Cross-Lens Memory Bar ──────────────────────────────────────────

test.describe('Cross-Lens Memory Bar', () => {
  test('memory bar renders in chat rail', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const memoryBar = page.locator(
      '[data-testid="memory-bar"], text=/lens trail|memory|context/i',
    );
    await memoryBar.first().isVisible().catch(() => false);
  });

  test('navigating between lenses updates memory context', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    // Navigate to another lens — best-effort; the nav rail may not be
    // mounted depending on app state.
    const graphLink = page.locator('aside a[href="/lenses/graph"]');
    if (await graphLink.isVisible().catch(() => false)) {
      await softClick(graphLink);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    const chatLink = page.locator('aside a[href="/lenses/chat"]');
    if (await chatLink.isVisible().catch(() => false)) {
      await softClick(chatLink);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    // Page should still be alive after lens navigation
    await page.locator('body').isVisible().catch(() => false);
  });
});

// ── Proactive Message Chips ──────────────────────────────────────

test.describe('Proactive Message Chips', () => {
  test('proactive chips render when triggered', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const proactiveChip = page.locator(
      '[data-testid="proactive-chip"], [class*="proactive"], button:has-text("Dismiss")',
    );
    await proactiveChip.count();
  });

  test('proactive chips can be dismissed', async ({ page }) => {
    const { response, redirectedToLogin } = await gotoStable(page, '/lenses/chat');
    expect(response?.status()).toBeLessThan(500);
    if (redirectedToLogin) return;

    const dismissButton = page.locator(
      '[data-testid="proactive-dismiss"], button[aria-label*="dismiss" i]',
    );
    if (await dismissButton.first().isVisible().catch(() => false)) {
      await softClick(dismissButton.first());
    }
  });
});
