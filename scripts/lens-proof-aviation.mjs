// scripts/lens-proof-aviation.mjs — REAL browser proof for the Aviation lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   0. header depth chip reads "Real" (never "Demo"); no DEMO copy; EFB →
//      Moving map → "Filing record" says sending to ATC isn't supported yet
//      (no "File with ATC" button, no "Simulated DUATS" caption) → aviation-filing.png
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
  await page.getByText('Real', { exact: true }).first().waitFor({ state: 'visible', timeout: 90000 });
  result.badge = 'Real';
  result.demoChips = await page.getByText('Demo', { exact: true }).count();
  const demoCopy = /\bDEMO\b|Simulated DUATS/.test(await page.locator('body').innerText());
  log('header depth chip: Real — "Demo" chips:', result.demoChips, '— DEMO copy:', demoCopy);
  if (result.demoChips !== 0 || demoCopy) throw new Error('Aviation still shows a Demo chip or DEMO copy');
  await page.getByRole('button', { name: /^Reject$/ }).first()
    .waitFor({ state: 'visible', timeout: 10000 }).then((b) => page.getByRole('button', { name: /^Reject$/ }).first().click(), () => {});
  await efbTab.click();
  await page.waitForTimeout(1000);

  // Honest filing panel: ATC submission is labelled not supported yet.
  await page.getByRole('button', { name: /^Moving map$/ }).first().click();
  await page.getByRole('button', { name: /^Filing record$/ }).first().click();
  const notSupported = page.getByTestId('efb-filing-not-supported');
  await notSupported.waitFor({ state: 'visible', timeout: 30000 });
  result.filingLabel = (await notSupported.innerText()).trim();
  result.fileWithAtcButtons = await page.getByRole('button', { name: /File with ATC/ }).count();
  if (result.fileWithAtcButtons !== 0) throw new Error('a "File with ATC" button is still rendered');
  await notSupported.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('aviation-filing.png') });
  log('filing panel label:', result.filingLabel, '— "File with ATC" buttons: 0 — aviation-filing.png');

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
  const lb = await pageLensRun(page, 'aviation', 'logbook-list', {});
  const entries = lb?.result?.entries || lb?.result?.logbook || [];
  const mine = entries.find((e) => e.from === FROM && e.to === TO); // newest first
  result.entryId = mine?.id || null;
  result.routeRows = entries.filter((e) => e.from === FROM && e.to === TO).length;
  if (!result.entryId) throw new Error('new flight not in aviation.logbook-list');
  const routeRows = page.locator('li', { hasText: `${FROM}→${TO}` });
  for (let i = 0; i < 30 && (await routeRows.count()) < result.routeRows; i++) await page.waitForTimeout(500);
  log('logbook-list entry id:', result.entryId, '— route rows (server/UI):', result.routeRows, await routeRows.count());

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
  await page.locator('li', { hasText: `${FROM}→${TO}` }).first().waitFor({ state: 'visible', timeout: 60000 });
  const after = await page.locator('li', { hasText: `${FROM}→${TO}` }).count();
  if (after !== result.routeRows) throw new Error(`logbook rows for ${FROM}→${TO} after reload: ${after}, expected ${result.routeRows}`);
  log('after reload the UI lists', after, `${FROM}→${TO} rows (matches logbook-list incl. ${result.entryId})`);
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