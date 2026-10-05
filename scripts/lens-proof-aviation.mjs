// scripts/lens-proof-aviation.mjs — REAL browser proof for the Aviation lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   1. /lenses/aviation → EFB tab → "Logbook & tracks" sub-nav → Aircraft
//      sub-tab → add a real aircraft (aviation.aircraft-add)
//   2. → Logbook sub-tab → fill the real flight form (aircraft, date, from,
//      to, total hrs, PIC, conditions) → "Log flight" (aviation.logbook-add)
//      → entry renders in the logbook list (aviation.logbook-list)
//   3. The AviationKeepMenu "Keep this flight" renders under the form →
//      "Save flight as DTU" (dtu.create + dtu.get read-back) → "Draft in
//      Thread" (thread.thread-draft citing the DTU)
//   4. screenshot aviation.png with the DTU + draft ids on screen
//   5. independent read-back: dtu.get + thread.draft-detail
//   6. full page reload → EFB → Logbook → the flight is still listed
//   7. /lenses/thread → Composer lists the draft citing the DTU (aviation-thread.png)
//
// Run: node scripts/lens-proof-aviation.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import {
  mkLog, openBrowser, login, gotoLens, keepToDtuAndThread, verifyReadBack,
  verifyThreadHandoff, shot, keepMenu, checkDisk, pageLensRun,
} from './lens-proof-lib.mjs';

const log = mkLog('aviation');
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const TAIL = `N${STAMP}`;
const FROM = 'KSEA';
const TO = 'KPDX';
const SHOT = shot('aviation.png');

const { browser, ctx, page } = await openBrowser(log);
const result = { tail: TAIL, from: FROM, to: TO };
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/aviation', log);

  // Navigate to the EFB tab.
  const efbTab = page.getByRole('button', { name: /^EFB$/ }).first();
  await efbTab.waitFor({ state: 'visible', timeout: 90000 });
  await efbTab.click();
  await page.waitForTimeout(1000);

  // Click "Logbook & tracks" sub-nav to expand the records sub-tabs.
  const recordsNav = page.getByRole('button', { name: /Logbook & tracks/i }).first();
  await recordsNav.waitFor({ state: 'visible', timeout: 30000 });
  await recordsNav.click();
  await page.waitForTimeout(500);

  // First, add an aircraft via the Aircraft sub-tab.
  const aircraftSubTab = page.getByRole('button', { name: /^Aircraft$/ }).first();
  await aircraftSubTab.waitFor({ state: 'visible', timeout: 15000 });
  await aircraftSubTab.click();
  await page.waitForTimeout(500);

  // Fill the aircraft-add form. The AircraftPanel has inputs for tail, make, model.
  const tailInput = page.locator('input[placeholder="N12345"]').first();
  await tailInput.waitFor({ state: 'visible', timeout: 15000 });
  await tailInput.fill(TAIL);
  await page.locator('input[placeholder="Make"]').first().fill('Cessna');
  await page.locator('input[placeholder="Model"]').first().fill('172S');
  await page.getByRole('button', { name: /Add aircraft/i }).first().click();
  await page.waitForTimeout(2000);
  log('aircraft added:', TAIL);

  // Now switch to the Logbook sub-tab.
  const logbookSubTab = page.getByRole('button', { name: /^Logbook$/ }).first();
  await logbookSubTab.waitFor({ state: 'visible', timeout: 15000 });
  await logbookSubTab.click();
  await page.waitForTimeout(1000);

  // Fill the logbook-add form. The aircraft select should now list our tail.
  const acSelect = page.locator('select').first();
  await acSelect.waitFor({ state: 'visible', timeout: 15000 });
  // Select the option that matches our tail.
  const options = await acSelect.locator('option').allTextContents();
  const tailOpt = options.find((o) => o.includes(TAIL));
  if (!tailOpt) throw new Error(`aircraft ${TAIL} not in select options: ${JSON.stringify(options)}`);
  await acSelect.selectOption({ label: tailOpt });

  await page.locator('input[placeholder="From ICAO"]').first().fill(FROM);
  await page.locator('input[placeholder="To ICAO"]').first().fill(TO);
  await page.locator('input[placeholder="Total hrs"]').first().fill('1.5');
  await page.locator('input[placeholder="PIC hrs"]').first().fill('1.5');
  await page.getByRole('button', { name: /Log flight/i }).first().click();

  // Wait for the entry to render in the logbook list.
  const entryRow = page.locator('body', { hasText: `${FROM}→${TO}` }).first();
  await entryRow.waitFor({ state: 'visible', timeout: 60000 });
  log('flight rendered in the logbook:', `${FROM}→${TO}`);

  // The AviationKeepMenu renders under the form once the entry is saved.
  const menu = keepMenu(page, 'Keep this flight');
  await menu.waitFor({ state: 'visible', timeout: 20000 });
  log('AviationKeepMenu rendered');

  checkDisk(log);
  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT });
  log('screenshot:', SHOT);

  Object.assign(result, await verifyReadBack(page, ids, 'aviation-lens:logbook-report', log));

  // Full page reload → the flight is still in the logbook.
  checkDisk(log);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  // Navigate back to EFB → Logbook.
  await efbTab.waitFor({ state: 'visible', timeout: 90000 });
  // The EFB tab button may have shifted after reload; re-query.
  const efbTab2 = page.getByRole('button', { name: /^EFB$/ }).first();
  await efbTab2.click();
  await page.waitForTimeout(1000);
  const recordsNav2 = page.getByRole('button', { name: /Logbook & tracks/i }).first();
  await recordsNav2.waitFor({ state: 'visible', timeout: 30000 });
  await recordsNav2.click();
  await page.waitForTimeout(500);
  const logbookSubTab2 = page.getByRole('button', { name: /^Logbook$/ }).first();
  await logbookSubTab2.waitFor({ state: 'visible', timeout: 15000 });
  await logbookSubTab2.click();
  await page.waitForTimeout(1000);
  await page.locator('body', { hasText: `${FROM}→${TO}` }).first().waitFor({ state: 'visible', timeout: 60000 });
  result.survivedReload = true;
  log('after full reload the flight is still in the logbook:', `${FROM}→${TO}`);

  checkDisk(log);
  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('aviation-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('aviation-failed.png') }); log('failure screenshot: aviation-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}