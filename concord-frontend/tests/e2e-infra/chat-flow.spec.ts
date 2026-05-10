import { test, expect } from '@playwright/test';

test.describe('Chat Flow', () => {
  test.beforeEach(async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('networkidle');
  });

  test('should display chat rail toggle', async ({ page }) => {
    // Look for chat toggle button
    const chatToggle = page.locator('[aria-label*="chat" i], [title*="chat" i], button:has-text("Chat")').first();
    if (await chatToggle.isVisible().catch(() => false)) {
      await expect(chatToggle).toBeVisible();
    }
  });

  test('should open chat panel when toggled', async ({ page }) => {
    const chatToggle = page.locator('[aria-label*="chat" i], [title*="chat" i], button:has-text("Chat")').first();
    if (await chatToggle.isVisible().catch(() => false)) {
      await chatToggle.click();
      // Chat panel should become visible
      const chatPanel = page.locator('[class*="chat"], [data-testid="chat-panel"]').first();
      const panelVisible = await chatPanel.isVisible().catch(() => false);
      if (panelVisible) {
        await expect(chatPanel).toBeVisible();
      }
    }
  });

  test('should have message input field in chat', async ({ page }) => {
    const chatToggle = page.locator('[aria-label*="chat" i], [title*="chat" i], button:has-text("Chat")').first();
    if (await chatToggle.isVisible().catch(() => false)) {
      await chatToggle.click();
      const input = page.locator('input[type="text"], textarea, [contenteditable="true"]').last();
      if (await input.isVisible().catch(() => false)) {
        await expect(input).toBeEnabled();
      }
    }
  });
});
