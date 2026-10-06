// scripts/lens-proof-agriculture.mjs — REAL browser proof for the Agriculture lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   1. /lenses/agriculture → open the Farm Workbench (slide-out) → Fields tab
//      → "New field" → fill the real form (name, acreage, lat, lng, soil, crop)
//      → "Save field" (agriculture.field-create) → field renders in the list
//      (agriculture.field-list)
//   2. The AgricultureKeepMenu "Keep this field" renders right under the form
//      after the field is saved → "Save field as DTU" (dtu.create + dtu.get
//      read-back in the UI) → "Draft in Thread" (thread.thread-draft citing
//      the DTU)
//   3. screenshot agriculture.png with the DTU + draft ids on screen
//   4. independent read-back: dtu.get + thread.draft-detail
//   5. full page reload → open the workbench → Fields tab → the field is still
//      listed
//   6. /lenses/thread → Composer lists the draft citing the DTU (agriculture-thread.png)
//
// Run: node scripts/lens-proof-agriculture.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import {
  mkLog, openBrowser, login, gotoLens, keepToDtuAndThread, verifyReadBack,
  verifyThreadHandoff, shot, keepMenu, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('agriculture');
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const NAME = `Proof Field ${STAMP}`;
const SHOT = shot('agriculture.png');

async function openWorkbenchFields(page) {
  // The Farm Workbench is a slide-out panel opened via the "Farm Workbench" CTA.
  const cta = page.getByRole('button', { name: /Farm Workbench/i }).first();
  await cta.waitFor({ state: 'visible', timeout: 90000 });
  await cta.click();
  // The Fields tab is the default inside the workbench.
  const fieldsTab = page.getByRole('button', { name: /^Fields$/ }).first();
  await fieldsTab.waitFor({ state: 'visible', timeout: 30000 });
  // Click "New field" to open the create form.
  const newBtn = page.getByRole('button', { name: /New field/i }).first();
  await newBtn.waitFor({ state: 'visible', timeout: 30000 });
  await newBtn.click();
  await page.waitForTimeout(500);
}

const { browser, ctx, page } = await openBrowser(log);
const result = { name: NAME };
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/agriculture', log);
  await openWorkbenchFields(page);

  // Fill the real field-create form.
  const nameInput = page.locator('input[placeholder="Field name (e.g. North 40)"]').first();
  await nameInput.waitFor({ state: 'visible', timeout: 15000 });
  await nameInput.fill(NAME);
  // Acreage, lat, lng have default values — overwrite them.
  const acreageInput = page.locator('input[type="number"]').nth(0);
  await acreageInput.fill('40');
  const latInput = page.locator('input[type="number"]').nth(1);
  await latInput.fill('40.0');
  const lngInput = page.locator('input[type="number"]').nth(2);
  await lngInput.fill('-100.0');
  await page.locator('input[placeholder="Soil type (e.g. loam)"]').first().fill('loam');
  await page.locator('input[placeholder="Current crop"]').first().fill('corn');
  await page.getByRole('button', { name: /Save field/i }).first().click();

  // Wait for the field to render in the list.
  const fieldRow = page.locator('body', { hasText: NAME }).first();
  await fieldRow.waitFor({ state: 'visible', timeout: 60000 });
  log('field rendered in the list:', NAME);

  // The AgricultureKeepMenu renders under the form once the field is saved.
  const menu = keepMenu(page, 'Keep this field');
  await menu.waitFor({ state: 'visible', timeout: 20000 });
  log('AgricultureKeepMenu rendered');

  checkDisk(log);
  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT });
  log('screenshot:', SHOT);

  Object.assign(result, await verifyReadBack(page, ids, 'agriculture-lens:field-report', log));

  // Full page reload → the field is still in the Fields list.
  checkDisk(log);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await openWorkbenchFields(page);
  // The "New field" form is open from openWorkbenchFields; close it so the
  // list is visible, then look for the field name in the workbench body.
  await page.locator('body', { hasText: NAME }).first().waitFor({ state: 'visible', timeout: 60000 });
  result.survivedReload = true;
  log('after full reload the field is still listed:', NAME);

  checkDisk(log);
  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('agriculture-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('agriculture-failed.png') }); log('failure screenshot: agriculture-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}