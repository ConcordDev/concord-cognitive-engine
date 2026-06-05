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
    await expect(page.getByText('#8 AWG')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('50A')).toBeVisible();
    await expect(page.getByText('2.9%')).toBeVisible();
  });

  test('conduitFill: recommended conduit size + fill % render', async ({ page }) => {
    await page.getByRole('button', { name: /^Size conduit$/i }).click();
    await expect(page.getByText('1"')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('11.5%')).toBeVisible();
  });

  test('boxFill: required volume + PASS verdict render', async ({ page }) => {
    await page.getByRole('button', { name: /^Verify box fill$/i }).click();
    await expect(page.getByText(/PASS — within NEC 314\.16/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('14 in³', { exact: false })).toBeVisible();
  });
});
