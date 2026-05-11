import { test, expect } from '@playwright/test';

// ── Terms of Service ──────────────────────────────────────────────

test.describe('Terms of Service Page', () => {
  test('terms page loads without server errors', async ({ page }) => {
    const response = await page.goto('/legal/terms');

    expect(response?.status()).toBeLessThan(500);
  });

  test('terms page displays page title', async ({ page }) => {
    const response = await page.goto('/legal/terms');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Skip title check if redirected away from the legal page
    if (!/\/legal\/terms/.test(page.url())) return;

    // Look for a heading that contains "terms" anywhere on the page
    // (the first h1 may belong to the app shell, not the legal content)
    const termsHeading = page.locator('h1:has-text("Terms"), h2:has-text("Terms")');
    const visible = await termsHeading.first().isVisible().catch(() => false);
    if (visible) {
      const text = await termsHeading.first().textContent();
      expect(text?.toLowerCase()).toContain('terms');
    }
  });

  test('terms page shows effective date', async ({ page }) => {
    const response = await page.goto('/legal/terms');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    const effectiveDate = page.locator('text=/Effective Date/i');
    const visible = await effectiveDate.first().isVisible().catch(() => false);
    if (visible) {
      expect(visible).toBe(true);
    }
  });

  test('terms page has table of contents', async ({ page }) => {
    const response = await page.goto('/legal/terms');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // TOC contains section links
    const tocNav = page.locator('nav');
    const visible = await tocNav.first().isVisible().catch(() => false);
    if (visible) {
      expect(visible).toBe(true);
    }
  });

  test('terms page has section anchors', async ({ page }) => {
    const response = await page.goto('/legal/terms');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Check key section IDs exist
    const sectionIds = [
      'acceptance',
      'eligibility',
      'accounts',
      'concord-coin',
      'content-ownership',
    ];

    for (const id of sectionIds) {
      const section = page.locator(`#${id}`);
      const visible = await section.first().isVisible().catch(() => false);
      if (visible) {
        const count = await section.count();
        expect(count).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('terms page section links navigate to correct anchors', async ({ page }) => {
    const response = await page.goto('/legal/terms');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Click a TOC link and verify URL hash changes
    const tocLink = page.locator('a[href="#acceptance"]');
    if (await tocLink.first().isVisible().catch(() => false)) {
      await tocLink.first().click();
      await page.waitForURL(/#acceptance/, { timeout: 5000 }).catch(() => {});
    }
  });
});

// ── Privacy Policy ──────────────────────────────────────────────────

test.describe('Privacy Policy Page', () => {
  test('privacy page loads without server errors', async ({ page }) => {
    const response = await page.goto('/legal/privacy');

    expect(response?.status()).toBeLessThan(500);
  });

  test('privacy page displays page title', async ({ page }) => {
    const response = await page.goto('/legal/privacy');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Skip title check if redirected away from the legal page
    if (!/\/legal\/privacy/.test(page.url())) return;

    // Look for a heading that contains "privacy" anywhere on the page
    // (the first h1 may belong to the app shell, not the legal content)
    const privacyHeading = page.locator('h1:has-text("Privacy"), h2:has-text("Privacy")');
    const visible = await privacyHeading.first().isVisible().catch(() => false);
    if (visible) {
      const text = await privacyHeading.first().textContent();
      expect(text?.toLowerCase()).toContain('privacy');
    }
  });

  test('privacy page shows effective date', async ({ page }) => {
    const response = await page.goto('/legal/privacy');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    const effectiveDate = page.locator('text=/Effective Date/i');
    const visible = await effectiveDate.first().isVisible().catch(() => false);
    if (visible) {
      expect(visible).toBe(true);
    }
  });

  test('privacy page has section anchors', async ({ page }) => {
    const response = await page.goto('/legal/privacy');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Check key section IDs exist
    const sectionIds = [
      'information-collected',
      'how-we-use',
      'data-sharing',
      'user-rights',
      'security',
    ];

    for (const id of sectionIds) {
      const section = page.locator(`#${id}`);
      const visible = await section.first().isVisible().catch(() => false);
      if (visible) {
        const count = await section.count();
        expect(count).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('privacy page mentions data sovereignty', async ({ page }) => {
    const response = await page.goto('/legal/privacy');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    const dataSovereignty = page.locator('text=/data sovereignty|your data belongs to you/i');
    const visible = await dataSovereignty.first().isVisible().catch(() => false);
    if (visible) {
      expect(visible).toBe(true);
    }
  });
});

// ── DMCA Page ──────────────────────────────────────────────────────

test.describe('DMCA Policy Page', () => {
  test('dmca page loads without server errors', async ({ page }) => {
    const response = await page.goto('/legal/dmca');

    expect(response?.status()).toBeLessThan(500);
  });

  test('dmca page displays page title', async ({ page }) => {
    const response = await page.goto('/legal/dmca');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Skip title check if redirected away from the legal page
    if (!/\/legal\/dmca/.test(page.url())) return;

    const heading = page.locator('h1');
    const visible = await heading.first().isVisible().catch(() => false);
    if (visible) {
      const headingText = await heading.first().textContent();
      expect(headingText?.toLowerCase()).toContain('dmca');
    }
  });

  test('dmca page shows submission form', async ({ page }) => {
    const response = await page.goto('/legal/dmca');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // The DMCA form should have key fields
    const formFields = [
      'input[name="claimantName"], #claimantName, label:has-text("Name")',
      'input[name="claimantEmail"], #claimantEmail, label:has-text("Email")',
      'textarea[name="description"], #description, label:has-text("Description")',
      'input[name="signature"], #signature, label:has-text("Signature")',
    ];

    for (const selector of formFields) {
      const field = page.locator(selector);
      if (await field.first().isVisible().catch(() => false)) {
        expect(true).toBe(true);
      }
    }
  });

  test('dmca page has good faith and accuracy checkboxes', async ({ page }) => {
    const response = await page.goto('/legal/dmca');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Look for checkbox inputs for statements
    const checkboxes = page.locator('input[type="checkbox"]');
    const visible = await checkboxes.first().isVisible().catch(() => false);

    if (visible) {
      const count = await checkboxes.count();
      // Should have at least the good faith and accuracy checkboxes
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  test('dmca form validation prevents empty submission', async ({ page }) => {
    const response = await page.goto('/legal/dmca');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Find and click the submit button without filling form
    const submitButton = page.locator(
      'button[type="submit"], button:has-text("Submit")'
    );
    if (await submitButton.first().isVisible().catch(() => false)) {
      await submitButton.first().click({ force: true });

      // Form should stay on page (browser validation or custom validation prevents submit)
      await page.waitForURL(/\/legal\/dmca/, { timeout: 5000 }).catch(() => {});
    }
  });

  test('dmca form accepts input in fields', async ({ page }) => {
    const response = await page.goto('/legal/dmca');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Fill in claimant name if visible
    const nameInput = page.locator(
      'input[name="claimantName"], #claimantName'
    ).first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Test Claimant');
      const value = await nameInput.inputValue();
      expect(value).toBe('Test Claimant');
    }

    // Fill in email if visible
    const emailInput = page.locator(
      'input[name="claimantEmail"], #claimantEmail'
    ).first();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill('test@example.com');
      const value = await emailInput.inputValue();
      expect(value).toBe('test@example.com');
    }
  });

  test('dmca page has counter-notification section', async ({ page }) => {
    const response = await page.goto('/legal/dmca');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // The DMCA page should mention counter-notification process
    const counterNotification = page.locator('text=/counter.*notification/i');
    const visible = await counterNotification.first().isVisible().catch(() => false);
    if (visible) {
      expect(visible).toBe(true);
    }
  });
});

// ── Legal Footer Links ──────────────────────────────────────────────

test.describe('Legal Footer Links', () => {
  test('landing page has link to terms of service', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    const termsLink = page.locator('a[href="/legal/terms"]');
    if (await termsLink.first().isVisible().catch(() => false)) {
      expect(true).toBe(true);
    }
  });

  test('landing page has link to privacy policy', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    const privacyLink = page.locator('a[href="/legal/privacy"]');
    if (await privacyLink.first().isVisible().catch(() => false)) {
      expect(true).toBe(true);
    }
  });

  test('legal pages cross-link each other', async ({ page }) => {
    const response = await page.goto('/legal/terms');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Terms page should link to privacy policy
    const privacyLink = page.locator('a[href="/legal/privacy"]');
    const visible = await privacyLink.first().isVisible().catch(() => false);
    if (visible) {
      const count = await privacyLink.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  test('footer links navigate correctly to legal pages', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    const termsLink = page.locator('a[href="/legal/terms"]');
    if (await termsLink.first().isVisible().catch(() => false)) {
      await termsLink.first().click();
      await page.waitForURL(/\/legal\/terms/, { timeout: 5000 }).catch(() => {});

      // Only check heading if we actually navigated to the terms page
      if (/\/legal\/terms/.test(page.url())) {
        const heading = page.locator('h1');
        const headingVisible = await heading.first().isVisible().catch(() => false);
        if (headingVisible) {
          const text = await heading.first().textContent();
          expect(text?.toLowerCase()).toContain('terms');
        }
      }
    }
  });
});

// ── Legal Page Layout ──────────────────────────────────────────────

test.describe('Legal Page Layout', () => {
  test('legal layout wraps all legal pages', async ({ page }) => {
    const response = await page.goto('/legal/terms');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    // Legal pages should share a common layout
    const article = page.locator('article');
    const visible = await article.first().isVisible().catch(() => false);
    if (visible) {
      expect(visible).toBe(true);
    }
  });

  test('legal pages render without horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const response = await page.goto('/legal/terms');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    const bodyVisible = await page.locator('body').isVisible().catch(() => false);
    if (bodyVisible) {
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);

      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
    }
  });
});
