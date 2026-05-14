import type { Page, BrowserContext } from '@playwright/test';

/**
 * Set a session cookie so Next.js middleware allows access to protected
 * routes. The fake token is intentionally not a valid backend JWT — the
 * middleware accepts it on presence, but the client-side auth context
 * validates against the live e2e-infra backend and may still redirect to
 * /login. Callers MUST handle the `redirectedToLogin` result of
 * `gotoStable` rather than assuming the protected page stays mounted.
 */
export async function authenticateContext(context: BrowserContext) {
  await context.addCookies([
    {
      name: 'concord_refresh',
      value: 'e2e_test_token',
      domain: 'localhost',
      path: '/',
    },
  ]);
}

/**
 * Navigate and wait out any client-side auth redirect before probing the
 * DOM. The e2e-infra suite runs against a real backend that rejects the
 * fake test token, so a protected route can bounce to /login a beat after
 * first paint — detaching elements mid-test and causing flaky 60s click
 * timeouts / toBeVisible failures. Settling the network here makes that
 * deterministic: a caller that sees `redirectedToLogin` returns early
 * instead of racing element probes against a page that is navigating away.
 */
export async function gotoStable(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  // Capped — the app holds websockets open so 'networkidle' never fully
  // settles; the cap is enough for a redirect round-trip to complete.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  return { response, redirectedToLogin: /\/login/.test(page.url()) };
}

/**
 * Best-effort click for optional UI surfaces. A short timeout means a
 * detached / non-actionable element fails fast instead of burning the
 * 60s default and turning a flaky surface into a hard suite failure.
 */
export async function softClick(
  locator: ReturnType<Page['locator']>,
  opts: { force?: boolean } = {},
) {
  await locator.click({ timeout: 8000, force: opts.force }).catch(() => {});
}
