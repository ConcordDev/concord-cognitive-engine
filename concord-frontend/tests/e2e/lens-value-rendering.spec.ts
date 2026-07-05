import { test, expect } from '@playwright/test';
import { mockAuthSuccess, gotoStable } from './_helpers';

/**
 * Value-rendering E2E — closes the "correct-but-invisible" gap.
 *
 * The backend macro math is already proven (server-side value-assertion sweep).
 * What was UNtested is that the right computed value actually reaches the screen:
 * input → POST /api/lens/run → lensRun unwrap → render. These specs mock
 * /api/lens/run with a KNOWN computed envelope, drive a calculator, and assert the
 * value appears — proving the wiring, not re-testing the formula.
 *
 * Envelope shape must match what lensRun unwraps: it tolerates single OR double
 * { ok, result } wrapping, so we send the double-wrap the live server produces:
 *   { ok:true, result:{ ok:true, result:<payload> } }
 *
 * No data-testids exist on the calc components, so we assert on the unique output
 * strings (e.g. "#8 AWG", recommended conduit size, verdict) that only appear in
 * the result panel.
 */

type LensRunBody = { domain?: string; action?: string; name?: string; input?: unknown };
const wrap = (payload: unknown) => ({ ok: true, result: { ok: true, result: payload } });

/** Route /api/lens/run, dispatching a canned computed result per action. */
async function mockLensCalcs(page: import('@playwright/test').Page) {
  // The electrical lens page ALSO calls useLensData -> GET /api/lens/electrical
  // (lib/hooks/use-lens-data.ts) on every mount, independent of the calculator
  // POSTs mocked below. Left unmocked, that GET hits the real backend with the
  // fake e2e cookie, gets a 401, and LensPageShell (components/lens/LensPageShell.tsx)
  // renders <ErrorState> instead of children — so the tab bar (incl. the
  // "NEC Calculators" button the beforeEach clicks) never mounts and the click
  // times out. Response shape must match what use-lens-data.ts destructures:
  // `{ ok: boolean; artifacts: LensItem[]; total: number }` — an honest empty
  // list (no fabricated artifacts).
  await page.route('**/api/lens/electrical**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, artifacts: [], total: 0 }),
    })
  );
  // Defensive: mockAuthSuccess plants a fake refresh cookie but doesn't mock
  // /api/auth/refresh. If any unmocked call ever 401s, lib/api/client.ts's
  // interceptor tries a real POST /api/auth/refresh before giving up — mocking
  // it 200 keeps that path inert rather than racing the real backend.
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  );
  await page.route('**/api/lens/run', async (route) => {
    const body = (route.request().postDataJSON?.() ?? {}) as LensRunBody;
    const action = body.action || body.name;
    const table: Record<string, unknown> = {
      wireSize: {
        loadAmps: 40, designAmps: 50, ampacityRequiredWire: '#8',
        recommendedWire: '#8 AWG', recommendedAmpacity: 55, minBreaker: '50A',
        voltageDropAtRecommended: '2.9%', upsizedForVoltageDrop: false, basis: 'NEC 310.16',
      },
      conduitFill: {
        totalConductors: 3, totalConductorArea: 0.0399, necFillLimitPercent: 40,
        fillRule: '40% (3+ conductors)', recommendedConduitSize: '1"',
        recommendedActualFillPercent: 11.5,
      },
      boxFill: {
        largestConductor: '#14', totalConductorEquivalents: 7,
        requiredBoxVolume: 14, providedBoxVolume: 18, pass: true, verdict: 'PASS — within NEC 314.16',
      },
    };
    const payload = action && table[action];
    if (payload) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap(payload)) });
    }
    // anything else this lens loads → empty-but-ok so the page mounts cleanly
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result: { ok: true, result: {} } }) });
  });
}

test.describe('Lens value rendering — computed values reach the screen', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthSuccess(page, { role: 'user' });
    await mockLensCalcs(page);
    await gotoStable(page, '/lenses/electrical');
    await page.getByRole('button', { name: /NEC Calculators/i }).click();
  });

  test('wireSize: load amps → #8 AWG / 50A breaker render', async ({ page }) => {
    await page.getByPlaceholder('e.g. 40').fill('40');
    await page.getByRole('button', { name: /^Size wire$/i }).click();
    // NecCalculators.tsx renders each computed result in a `.font-mono.text-lg`
    // value cell; "50A" also appears verbatim inside a `Design load 50A ·
    // ampacity` caption elsewhere on the page, so a bare getByText('50A')
    // strict-mode-fails with 2 matches. Scope to the styled result cell.
    await expect(page.locator('div.font-mono.text-lg', { hasText: '#8 AWG' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('div.font-mono.text-lg', { hasText: /^50A$/ })).toBeVisible();
    await expect(page.locator('div.font-mono.text-lg', { hasText: /^2\.9%$/ })).toBeVisible();
  });

  test('conduitFill: recommended conduit size + fill % render', async ({ page }) => {
    await page.getByRole('button', { name: /^Size conduit$/i }).click();
    // Same ambiguity as above: the "Verify size (optional)" <select> has a
    // literal `<option>1"</option>` in the DOM alongside the computed result
    // cell, so getByText('1"') strict-mode-fails with 2 matches even though
    // only one is visible. Scope to the styled result cell.
    await expect(page.locator('div.font-mono.text-lg', { hasText: /^1"$/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('div.font-mono.text-lg', { hasText: /^11\.5%$/ })).toBeVisible();
  });

  test('boxFill: required volume + PASS verdict render', async ({ page }) => {
    await page.getByRole('button', { name: /^Verify box fill$/i }).click();
    await expect(page.getByText(/PASS — within NEC 314\.16/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('14 in³', { exact: false })).toBeVisible();
  });
});
