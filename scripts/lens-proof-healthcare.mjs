// scripts/lens-proof-healthcare.mjs — REAL browser proof for the Healthcare lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   1. /lenses/healthcare → Patients → New → fill the real registration form
//      (first/last name, DOB, sex, insurance) → "Register patient"
//      (healthcare.patients-create) → the chart opens (patients-detail)
//   2. Allergies tab → "Add allergy" → real allergy → Save
//      (healthcare.allergies-add) so the summary carries a chart fact
//   3. HealthcareKeepMenu "Keep this patient summary" → "Save summary as DTU"
//      (dtu.create + dtu.get read-back in the UI) → "Draft in Thread"
//      (thread.thread-draft citing the DTU)
//   4. screenshot healthcare.png with the DTU + draft ids on screen
//   5. independent read-back: dtu.get + thread.draft-detail
//   6. full page reload → Patients → patient still listed → chart reopens
//      with the allergy
//   7. /lenses/thread → Composer lists the draft citing the DTU
//
// Run: node scripts/lens-proof-healthcare.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import {
  mkLog, openBrowser, login, gotoLens, keepToDtuAndThread, verifyReadBack,
  verifyThreadHandoff, shot, keepMenu, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('healthcare');
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const FIRST = 'Proof';
const LAST = `Patient${stamp}`;
const SHOT = shot('healthcare.png');

async function openPatients(page) {
  const nav = page.getByRole('button', { name: /^Patients/ }).first();
  await nav.waitFor({ state: 'visible', timeout: 90000 });
  await nav.click();
  await page.locator('input[placeholder="Search name or MRN…"]').first().waitFor({ state: 'visible', timeout: 30000 });
}

const { browser, ctx, page } = await openBrowser(log);
const result = { patient: `${LAST}, ${FIRST}` };
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/healthcare', log);
  await openPatients(page);

  await page.getByRole('button', { name: /^New$/ }).first().click();
  await page.locator('input[placeholder="First name *"]').first().fill(FIRST);
  await page.locator('input[placeholder="Last name *"]').first().fill(LAST);
  await page.locator('input[type="date"]').first().fill('1980-05-15');
  await page.locator('select').filter({ has: page.locator('option[value="F"]') }).first().selectOption('F');
  await page.locator('input[placeholder="Insurance plan"]').first().fill('Blue Cross');
  await page.getByRole('button', { name: /Register patient/ }).first().click();

  const menu = keepMenu(page, 'Keep this patient summary');
  await menu.waitFor({ state: 'visible', timeout: 60000 });
  await page.getByText(LAST).first().waitFor({ state: 'visible', timeout: 30000 });
  log('patient registered and chart opened:', LAST);

  await page.getByRole('button', { name: /^Allergies/ }).first().click();
  await page.getByRole('button', { name: /Add allergy/ }).first().click();
  await page.locator('input[placeholder="Allergen *"]').first().fill('Penicillin');
  await page.locator('input[placeholder="Reaction (e.g. hives, anaphylaxis)"]').first().fill('hives');
  await page.locator('input[placeholder="Allergen *"]').locator('xpath=..').getByRole('button', { name: /^Save$/ }).click();
  await page.getByRole('button', { name: /^Allergies.*\(1\)/ }).first().waitFor({ state: 'visible', timeout: 30000 });
  log('allergy recorded: Penicillin (hives)');

  checkDisk(log);
  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT });
  log('screenshot:', SHOT);

  Object.assign(result, await verifyReadBack(page, ids, 'healthcare-lens:patient-summary', log));

  checkDisk(log);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await openPatients(page);
  const row = page.locator('li', { hasText: LAST }).first();
  await row.waitFor({ state: 'visible', timeout: 60000 });
  await row.click();
  await page.getByRole('button', { name: /^Allergies.*\(1\)/ }).first().waitFor({ state: 'visible', timeout: 60000 });
  result.survivedReload = true;
  log('after full reload the patient is listed and the chart reopens with 1 allergy');

  checkDisk(log);
  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('healthcare-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('healthcare-failed.png') }); log('failure screenshot: healthcare-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
