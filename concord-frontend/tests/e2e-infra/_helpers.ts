import type { Page } from '@playwright/test';

/**
 * Playwright storageState file produced by auth.setup.ts. Holds the real
 * concord_auth / concord_refresh cookies the e2e-infra backend issues on
 * login, plus the `concord_entered` flag a logged-in browser carries.
 * Relative to the config dir (concord-frontend/) — resolves correctly for
 * both `test.use({ storageState })` and `context.storageState({ path })`.
 * Gitignored: it contains a live session token.
 */
export const AUTH_STATE_FILE = 'tests/e2e-infra/.auth/state.json';

/**
 * Navigate and wait out any client-side transition before probing the DOM.
 * With real auth (see auth.setup.ts) a protected route should no longer
 * bounce to /login — but settling the network here still removes the
 * post-navigation hydration race that made `.click()` probes flaky, and
 * `redirectedToLogin` stays as a defensive signal: if the seeded session
 * ever stops being accepted, specs degrade to a clean skip instead of a
 * 60s timeout, and the canary specs assert it explicitly so the breakage
 * is still loud.
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
