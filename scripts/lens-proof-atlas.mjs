// scripts/lens-proof-atlas.mjs — REAL browser proof for the Atlas lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   1. /lenses/atlas → map view (default) → Places nav (default) → "+"
//      Add → fill the real place form (name, lat, lng, category, notes) →
//      "Save place" (atlas.places-save) → place renders in the list
//      (atlas.places-list)
//   2. The AtlasKeepMenu "Keep this place" renders under the form →
//      "Save place as DTU" (dtu.create + dtu.get read-back) → "Draft in
//      Thread" (thread.thread-draft citing the DTU)
//   3. screenshot atlas.png with the DTU + draft ids on screen
//   4. independent read-back: dtu.get + thread.draft-detail
//   5. full page reload → Places nav → the place is still listed
//   6. /lenses/thread → Composer lists the draft citing the DTU (atlas-thread.png)
//
// Run: node scripts/lens-proof-atlas.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import {
  mkLog, openBrowser, login, gotoLens, keepToDtuAndThread, verifyReadBack,
  verifyThreadHandoff, shot, keepMenu, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('atlas');
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const NAME = `Proof Tower ${STAMP}`;
const SHOT = shot('atlas.png');

const { browser, ctx, page } = await openBrowser(log);
const result = { name: NAME };
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/atlas', log);

  // The map view is the default; PlacesPanel is the default nav.
  // Click the "+" Add button to open the create form.
  const addBtn = page.locator('button[aria-label="Add"]').first();
  await addBtn.waitFor({ state: 'visible', timeout: 90000 });
  await addBtn.click();
  await page.waitForTimeout(500);

  // Fill the places-save form.
  await page.locator('input[placeholder="Name *"]').first().fill(NAME);
  await page.locator('input[placeholder="Lat *"]').first().fill('48.8584');
  await page.locator('input[placeholder="Lng *"]').first().fill('2.2945');
  // Select category "attraction" from the select.
  const catSelect = page.locator('select').first();
  await catSelect.selectOption('attraction');
  await page.locator('input[placeholder="Notes"]').first().fill('iconic landmark');
  await page.getByRole('button', { name: /Save place/i }).first().click();
  await page.waitForTimeout(2000);
  log('place saved:', NAME);

  // Wait for the place to render in the list.
  await page.locator('body', { hasText: NAME }).first().waitFor({ state: 'visible', timeout: 60000 });
  log('place rendered in the list');

  // The AtlasKeepMenu renders under the form once the place is saved.
  const menu = keepMenu(page, 'Keep this place');
  await menu.waitFor({ state: 'visible', timeout: 20000 });
  log('AtlasKeepMenu rendered');

  checkDisk(log);
  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT });
  log('screenshot:', SHOT);

  Object.assign(result, await verifyReadBack(page, ids, 'atlas-lens:place-report', log));

  // Full page reload → the place is still in the list.
  checkDisk(log);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('body', { hasText: NAME }).first().waitFor({ state: 'visible', timeout: 60000 });
  result.survivedReload = true;
  log('after full reload the place is still listed:', NAME);

  checkDisk(log);
  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('atlas-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('atlas-failed.png') }); log('failure screenshot: atlas-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}