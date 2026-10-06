// scripts/lens-proof-astronomy.mjs — REAL browser proof for the Astronomy lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   1. /lenses/astronomy → "Observing Log" tab → "Targets" sub-tab → "Add"
//      → fill the real target form (name, type, constellation) → "Add target"
//      (astronomy.target-add) → target renders in the list
//   2. Click the target to open its detail → fill the observation form
//      (conditions, rating, notes) → "Log observation" (astronomy.observation-log)
//      → observation renders in the target's observation list
//   3. The AstronomyKeepMenu "Keep this observation" renders under the form
//      → "Save observation as DTU" (dtu.create + dtu.get read-back) →
//      "Draft in Thread" (thread.thread-draft citing the DTU)
//   4. screenshot astronomy.png with the DTU + draft ids on screen
//   5. independent read-back: dtu.get + thread.draft-detail
//   6. full page reload → Observing Log → Targets → open the target → the
//      observation is still listed
//   7. /lenses/thread → Composer lists the draft citing the DTU (astronomy-thread.png)
//
// Run: node scripts/lens-proof-astronomy.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import {
  mkLog, openBrowser, login, gotoLens, keepToDtuAndThread, verifyReadBack,
  verifyThreadHandoff, shot, keepMenu, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('astronomy');
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const TARGET = `Proof Galaxy ${STAMP}`;
const SHOT = shot('astronomy.png');

const { browser, ctx, page } = await openBrowser(log);
const result = { target: TARGET };
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/astronomy', log);

  // Navigate to the "Observing Log" tab.
  const obsLogTab = page.getByRole('button', { name: /Observing Log/i }).first();
  await obsLogTab.waitFor({ state: 'visible', timeout: 90000 });
  await obsLogTab.click();
  await page.waitForTimeout(1000);

  // Click the "Targets" sub-tab.
  const targetsTab = page.getByRole('button', { name: /^Targets$/ }).first();
  await targetsTab.waitFor({ state: 'visible', timeout: 30000 });
  await targetsTab.click();
  await page.waitForTimeout(500);

  // Click "Add" to open the target form.
  const addBtn = page.getByRole('button', { name: /^Add$/i }).first();
  await addBtn.waitFor({ state: 'visible', timeout: 15000 });
  await addBtn.click();
  await page.waitForTimeout(500);

  // Fill the target-add form.
  await page.locator('input[placeholder="Object name"]').first().fill(TARGET);
  await page.locator('input[placeholder="Constellation"]').first().fill('Andromeda');
  await page.getByRole('button', { name: /Add target/i }).first().click();
  await page.waitForTimeout(2000);
  log('target added:', TARGET);

  // Click the target to open its detail view.
  const targetRow = page.locator('button', { hasText: TARGET }).first();
  await targetRow.waitFor({ state: 'visible', timeout: 30000 });
  await targetRow.click();
  await page.waitForTimeout(1000);

  // Fill the observation form.
  await page.locator('input[placeholder="Conditions"]').first().fill('clear');
  await page.locator('input[placeholder="Notes"]').first().fill('bright core');
  // The rating select defaults to 4 stars — set it to 5.
  const ratingSelect = page.locator('select').first();
  await ratingSelect.selectOption('5');
  await page.getByRole('button', { name: /Log observation/i }).first().click();
  await page.waitForTimeout(2000);
  log('observation logged');

  // The AstronomyKeepMenu renders under the form once the observation is saved.
  const menu = keepMenu(page, 'Keep this observation');
  await menu.waitFor({ state: 'visible', timeout: 20000 });
  log('AstronomyKeepMenu rendered');

  checkDisk(log);
  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT });
  log('screenshot:', SHOT);

  Object.assign(result, await verifyReadBack(page, ids, 'astronomy-lens:observation-report', log));

  // Full page reload → the observation is still in the target's list.
  checkDisk(log);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  // Navigate back to the target detail.
  const obsLogTab2 = page.getByRole('button', { name: /Observing Log/i }).first();
  await obsLogTab2.waitFor({ state: 'visible', timeout: 90000 });
  await obsLogTab2.click();
  await page.waitForTimeout(1000);
  const targetsTab2 = page.getByRole('button', { name: /^Targets$/ }).first();
  await targetsTab2.waitFor({ state: 'visible', timeout: 30000 });
  await targetsTab2.click();
  await page.waitForTimeout(500);
  const targetRow2 = page.locator('button', { hasText: TARGET }).first();
  await targetRow2.waitFor({ state: 'visible', timeout: 30000 });
  await targetRow2.click();
  await page.waitForTimeout(1500);
  // The observation should be listed — check for "bright core" in the page.
  await page.locator('body', { hasText: 'bright core' }).first().waitFor({ state: 'visible', timeout: 30000 });
  result.survivedReload = true;
  log('after full reload the observation is still listed');

  checkDisk(log);
  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('astronomy-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('astronomy-failed.png') }); log('failure screenshot: astronomy-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}