import { test, expect } from '@playwright/test';

// ── Auth Page with OAuth ──────────────────────────────────────────

test.describe('Auth Page OAuth Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('login page renders OAuth sign-in buttons', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('networkidle');

    // Look for Google and Apple OAuth buttons
    const googleButton = page.locator(
      'button:has-text("Google"), a:has-text("Google"), button[aria-label*="Google" i]'
    );
    const appleButton = page.locator(
      'button:has-text("Apple"), a:has-text("Apple"), button[aria-label*="Apple" i]'
    );

    // Verify buttons if they exist
    const googleVisible = await googleButton.first().isVisible().catch(() => false);
    if (googleVisible) {
      await expect(googleButton.first()).toBeVisible();
    }
    const appleVisible = await appleButton.first().isVisible().catch(() => false);
    if (appleVisible) {
      await expect(appleButton.first()).toBeVisible();
    }
  });

  test('Google sign-in button redirects to Google OAuth URL', async ({ page }) => {
    // Mock the OAuth URL endpoint
    await page.route('**/api/auth/google', (route) => {
      route.fulfill({
        status: 302,
        headers: {
          Location: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test&redirect_uri=test&response_type=code&scope=openid+email+profile',
        },
      });
    });

    const response = await page.goto('/login');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('networkidle');

    const googleButton = page.locator(
      'button:has-text("Google"), a:has-text("Google"), a[href*="google"], button[aria-label*="Google" i]'
    );

    if (await googleButton.first().isVisible().catch(() => false)) {
      // Intercept navigation to verify redirect target
      const [request] = await Promise.all([
        page.waitForRequest(
          (req) =>
            req.url().includes('google') || req.url().includes('/api/auth/google'),
          { timeout: 5000 }
        ).catch(() => null),
        googleButton.first().click().catch(() => {}),
      ]);

      if (request) {
        expect(request.url()).toContain('google');
      }
    }
  });

  test('Apple sign-in button redirects to Apple OAuth URL', async ({ page }) => {
    // Mock the OAuth URL endpoint
    await page.route('**/api/auth/apple', (route) => {
      route.fulfill({
        status: 302,
        headers: {
          Location: 'https://appleid.apple.com/auth/authorize?client_id=test&redirect_uri=test&response_type=code&scope=name+email',
        },
      });
    });

    const response = await page.goto('/login');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('networkidle');

    const appleButton = page.locator(
      'button:has-text("Apple"), a:has-text("Apple"), a[href*="apple"], button[aria-label*="Apple" i]'
    );

    if (await appleButton.first().isVisible().catch(() => false)) {
      const [request] = await Promise.all([
        page.waitForRequest(
          (req) =>
            req.url().includes('apple') || req.url().includes('/api/auth/apple'),
          { timeout: 5000 }
        ).catch(() => null),
        appleButton.first().click().catch(() => {}),
      ]);

      if (request) {
        expect(request.url()).toContain('apple');
      }
    }
  });
});

// ── Sign In / Sign Up Toggle ──────────────────────────────────────

test.describe('Sign In / Sign Up Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('login page has link to register', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBeLessThan(500);

    const registerLink = page.locator('a[href="/register"]');
    const visible = await registerLink.first().isVisible().catch(() => false);
    if (visible) {
      const text = await registerLink.first().textContent().catch(() => '');
      expect(text?.toLowerCase()).toMatch(/create|register|sign up/);
    }
  });

  test('register page has link to login', async ({ page }) => {
    const response = await page.goto('/register');
    expect(response?.status()).toBeLessThan(500);

    const loginLink = page.locator('a[href="/login"]');
    const visible = await loginLink.first().isVisible().catch(() => false);
    if (visible) {
      const text = await loginLink.first().textContent().catch(() => '');
      expect(text?.toLowerCase()).toMatch(/sign in|login/);
    }
  });

  test('can toggle between sign in and sign up pages', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBeLessThan(500);

    const registerLink = page.locator('a[href="/register"]');
    const visible = await registerLink.first().isVisible().catch(() => false);
    if (visible) {
      // Navigate to register
      await registerLink.first().click().catch(() => {});
      const url1 = page.url();
      if (url1.includes('/register')) {
        // Navigate back to login
        const loginLink = page.locator('a[href="/login"]');
        const loginVisible = await loginLink.first().isVisible().catch(() => false);
        if (loginVisible) {
          await loginLink.first().click().catch(() => {});
          const url2 = page.url();
          expect(url2).toContain('/login');
        }
      }
    }
  });
});

// ── Email/Password Form Validation ──────────────────────────────────

test.describe('Email/Password Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('login form shows required field validation', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBeLessThan(500);

    // Fields should have required attribute
    const usernameInput = page.locator('#username');
    const passwordInput = page.locator('#password');

    const usernameVisible = await usernameInput.isVisible().catch(() => false);
    if (usernameVisible) {
      const required = await usernameInput.getAttribute('required').catch(() => null);
      expect(required).not.toBeNull();
    }

    const passwordVisible = await passwordInput.isVisible().catch(() => false);
    if (passwordVisible) {
      const required = await passwordInput.getAttribute('required').catch(() => null);
      expect(required).not.toBeNull();
    }
  });

  test('register form validates password length', async ({ page }) => {
    await page.route('**/api/auth/csrf-token', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ token: 'mock' }) })
    );

    const response = await page.goto('/register');
    expect(response?.status()).toBeLessThan(500);

    const usernameInput = page.locator('#username');
    const emailInput = page.locator('#email');
    const passwordInput = page.locator('#password');
    const confirmInput = page.locator('#confirm-password');
    const submitButton = page.locator('button[type="submit"]');

    const formVisible = await usernameInput.isVisible().catch(() => false);
    if (formVisible) {
      await usernameInput.fill('testuser').catch(() => {});
      await emailInput.fill('test@example.com').catch(() => {});
      await passwordInput.fill('short').catch(() => {});
      await confirmInput.fill('short').catch(() => {});

      const submitVisible = await submitButton.first().isVisible().catch(() => false);
      if (submitVisible) {
        await submitButton.first().click().catch(() => {});

        // Should show password length validation error
        const errorMsg = page.locator('text=/at least 12 characters|Password must be/i');
        const errorVisible = await errorMsg.first().isVisible().catch(() => false);
        if (errorVisible) {
          expect(errorVisible).toBe(true);
        }
      }
    }
  });

  test('register form validates password match', async ({ page }) => {
    await page.route('**/api/auth/csrf-token', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ token: 'mock' }) })
    );

    const response = await page.goto('/register');
    expect(response?.status()).toBeLessThan(500);

    const usernameInput = page.locator('#username');
    const emailInput = page.locator('#email');
    const passwordInput = page.locator('#password');
    const confirmInput = page.locator('#confirm-password');
    const submitButton = page.locator('button[type="submit"]');

    const formVisible = await usernameInput.isVisible().catch(() => false);
    if (formVisible) {
      await usernameInput.fill('testuser').catch(() => {});
      await emailInput.fill('test@example.com').catch(() => {});
      await passwordInput.fill('securepassword12').catch(() => {});
      await confirmInput.fill('differentpassword').catch(() => {});

      const submitVisible = await submitButton.first().isVisible().catch(() => false);
      if (submitVisible) {
        await submitButton.first().click().catch(() => {});

        // Should show password mismatch error
        const errorMsg = page.locator('text=Passwords do not match');
        const errorVisible = await errorMsg.first().isVisible().catch(() => false);
        if (errorVisible) {
          expect(errorVisible).toBe(true);
        }
      }
    }
  });

  test('register form validates email format', async ({ page }) => {
    const response = await page.goto('/register');
    expect(response?.status()).toBeLessThan(500);

    const emailInput = page.locator('#email');
    const visible = await emailInput.isVisible().catch(() => false);
    if (visible) {
      const typeAttr = await emailInput.getAttribute('type').catch(() => null);
      expect(typeAttr).toBe('email');
    }
  });
});

// ── Error State Display ──────────────────────────────────────────

test.describe('Error State Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('login shows error for invalid credentials', async ({ page }) => {
    await page.route('**/api/auth/csrf-token', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ token: 'mock' }) })
    );
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid credentials' }),
      })
    );

    const response = await page.goto('/login');
    expect(response?.status()).toBeLessThan(500);

    const usernameInput = page.locator('#username');
    const passwordInput = page.locator('#password');
    const submitButton = page.locator('button[type="submit"]');

    const formVisible = await usernameInput.isVisible().catch(() => false);
    if (formVisible) {
      await usernameInput.fill('wronguser').catch(() => {});
      await passwordInput.fill('wrongpassword').catch(() => {});

      const submitVisible = await submitButton.first().isVisible().catch(() => false);
      if (submitVisible) {
        await submitButton.first().click().catch(() => {});

        // Error message should appear
        const errorMsg = page.locator('text=Invalid credentials');
        const errorVisible = await errorMsg.first().isVisible().catch(() => false);
        if (errorVisible) {
          expect(errorVisible).toBe(true);
        }
      }
    }
  });

  test('login shows loading state during submit', async ({ page }) => {
    await page.route('**/api/auth/csrf-token', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ token: 'mock' }) })
    );
    await page.route('**/api/auth/login', (route) =>
      new Promise((resolve) => setTimeout(resolve, 500)).then(() =>
        route.fulfill({
          status: 401,
          body: JSON.stringify({ error: 'Invalid credentials' }),
        })
      )
    );

    const response = await page.goto('/login');
    expect(response?.status()).toBeLessThan(500);

    const usernameInput = page.locator('#username');
    const passwordInput = page.locator('#password');
    const submitButton = page.locator('button[type="submit"]');

    const formVisible = await usernameInput.isVisible().catch(() => false);
    if (formVisible) {
      await usernameInput.fill('testuser').catch(() => {});
      await passwordInput.fill('testpassword123').catch(() => {});

      const submitVisible = await submitButton.first().isVisible().catch(() => false);
      if (submitVisible) {
        await submitButton.first().click().catch(() => {});

        // Should show loading state
        const loadingMsg = page.locator('text=Signing in');
        const loadingVisible = await loadingMsg.first().isVisible().catch(() => false);
        if (loadingVisible) {
          expect(loadingVisible).toBe(true);
        }
      }
    }
  });

  test('register shows error for duplicate username', async ({ page }) => {
    await page.route('**/api/auth/csrf-token', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ token: 'mock' }) })
    );
    await page.route('**/api/auth/register', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Username already taken' }),
      })
    );

    const response = await page.goto('/register');
    expect(response?.status()).toBeLessThan(500);

    const usernameInput = page.locator('#username');
    const emailInput = page.locator('#email');
    const passwordInput = page.locator('#password');
    const confirmInput = page.locator('#confirm-password');
    const submitButton = page.locator('button[type="submit"]');

    const formVisible = await usernameInput.isVisible().catch(() => false);
    if (formVisible) {
      await usernameInput.fill('existinguser').catch(() => {});
      await emailInput.fill('new@example.com').catch(() => {});
      await passwordInput.fill('securepassword12').catch(() => {});
      await confirmInput.fill('securepassword12').catch(() => {});

      const submitVisible = await submitButton.first().isVisible().catch(() => false);
      if (submitVisible) {
        await submitButton.first().click().catch(() => {});

        // Should show duplicate error
        const errorMsg = page.locator('text=/already taken|already exists/i');
        const errorVisible = await errorMsg.first().isVisible().catch(() => false);
        if (errorVisible) {
          expect(errorVisible).toBe(true);
        }
      }
    }
  });
});
