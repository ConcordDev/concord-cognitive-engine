import { test, expect } from '@playwright/test';

/**
 * Cloudflare Web Analytics injects https://static.cloudflareinsights.com/beacon.min.js
 * at the edge. This app does not embed that script, and the document CSP
 * must not allowlist it (docs/PRIVACY_POLICY.md: no analytics, no beacons,
 * no third-party scripts). A page load of our own HTML must not log a CSP
 * violation for that origin.
 */
test.describe('CSP does not trip on the Cloudflare analytics beacon', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'CSP console check runs once on chromium',
    );
  });

  test('login page load has no CSP console error', async ({ page }) => {
    const cspViolations: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (/content security policy|cloudflareinsights/i.test(text)) cspViolations.push(text);
    });
    page.on('pageerror', (err) => {
      if (/content security policy|cloudflareinsights/i.test(err.message)) {
        cspViolations.push(err.message);
      }
    });

    const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    const csp = response?.headers()['content-security-policy'] || '';
    expect(csp).toContain('script-src');
    expect(csp).not.toMatch(/cloudflareinsights\.com/);

    const html = await page.content();
    expect(html).not.toMatch(/cloudflareinsights\.com/);
    expect(html).not.toMatch(/beacon\.min\.js/);

    // Give late script tags a tick to violate CSP if any were injected.
    await page.waitForTimeout(500);
    expect(cspViolations).toEqual([]);
  });
});
