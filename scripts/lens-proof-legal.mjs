// scripts/lens-proof-legal.mjs — REAL browser proof for the Legal lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   0. header depth chip reads "Real" (never "Demo"); no DEMO copy on page
//   1. Practice → Matters → New → real form (name, client, $/hr) → "Open
//      matter" (legal.matters-create) → matter listed (matters-list)
//   2. Time → Manual entry → that matter, 2.5 h, billable → Add
//      (legal.time-entries-create)
//   3. Matters → open the matter → detail (matters-detail) shows the real
//      Unbilled total ($875 = 2.5 h × $350) → "Matter report" card →
//      "Save matter as DTU" (dtu.create + dtu.get read-back in the UI) →
//      "Draft in Thread" (thread.thread-draft citing the DTU) → legal.png
//   4. independent read-back: dtu.get + thread.draft-detail
//   5. full reload → Matters → matter still listed → detail still $875
//   6. /lenses/thread → Composer lists the draft citing the DTU
//
// Run: node scripts/lens-proof-legal.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import {
  mkLog, openBrowser, login, gotoLens, pageLensRun, keepToDtuAndThread, verifyReadBack,
  verifyThreadHandoff, shot, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('legal');
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const NAME = `Proof Matter ${stamp}`;
const result = { matter: NAME };

async function dismissCookie(page) {
  const reject = page.getByRole('button', { name: /^Reject$/ }).first();
  if (await reject.isVisible().catch(() => false)) { await reject.click(); log('cookie notice: Reject'); }
}
async function nav(page, label) {
  await dismissCookie(page);
  const b = page.locator('li > button', { hasText: new RegExp(`^\\s*${label}`) }).first();
  await b.waitFor({ state: 'visible', timeout: 90000 });
  await b.click();
}
async function openMatter(page) {
  await nav(page, 'Matters');
  const li = page.locator('li', { hasText: NAME }).first();
  await li.waitFor({ state: 'visible', timeout: 60000 });
  await li.click();
  await page.locator('span', { hasText: NAME }).first().waitFor({ state: 'visible', timeout: 30000 });
}
const reportCard = (page) => page.locator('h3', { hasText: 'Matter report' }).first().locator('xpath=../..');

const { browser, ctx, page } = await openBrowser(log);
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/legal', log);
  await page.getByText('Real', { exact: true }).first().waitFor({ state: 'visible', timeout: 90000 });
  result.badge = 'Real';
  result.demoChips = await page.getByText('Demo', { exact: true }).count();
  const demoCopy = /DEMO|Honest tier: this lens is DEMO/.test(await page.locator('body').innerText());
  log('header depth chip: Real — "Demo" chips:', result.demoChips, '— DEMO copy:', demoCopy);
  if (result.demoChips !== 0 || demoCopy) throw new Error('Legal still shows a Demo chip or DEMO copy');
  await page.getByRole('button', { name: /^Reject$/ }).first()
    .waitFor({ state: 'visible', timeout: 10000 }).then(() => dismissCookie(page), () => {});

  // 1. Open a matter through the real form.
  await nav(page, 'Matters');
  await page.getByRole('button', { name: /^New$/ }).first().click();
  await page.locator('input[placeholder="Matter name *"]').first().fill(NAME);
  await page.locator('input[placeholder="Client name"]').first().fill('Proof Client LLC');
  await page.locator('input[placeholder="$/hr"]').first().fill('350');
  await page.getByRole('button', { name: /^Open matter$/ }).first().click();
  await page.locator('li', { hasText: NAME }).first().waitFor({ state: 'visible', timeout: 60000 });
  const listed = await pageLensRun(page, 'legal', 'matters-list', {});
  const m = JSON.stringify(listed.result || {}).match(new RegExp(`"id":"(matter_[^"]+)"[^}]*?"name":"${NAME}"`))
    || JSON.stringify(listed.result || {}).match(new RegExp(`"name":"${NAME}"[^}]*?"id":"(matter_[^"]+)"`));
  result.matterId = m?.[1] || null;
  log('matter opened and listed:', NAME, result.matterId);

  // 2. Log 2.5 billable hours against it.
  await nav(page, 'Time');
  await page.getByRole('button', { name: /Manual entry/ }).first().click();
  const sel = page.locator('select').filter({ has: page.locator('option', { hasText: 'Matter *' }) }).last();
  await sel.selectOption({ label: NAME });
  await page.locator('input[placeholder="Hours *"]').first().fill('2.5');
  await page.locator('input[placeholder="Description"]').last().fill('Proof drafting');
  await page.getByRole('button', { name: /^Add$/ }).first().click();
  await page.getByText('Proof drafting').first().waitFor({ state: 'visible', timeout: 60000 });
  log('time entry logged: 2.5 h on', NAME);

  // 3. Open the matter, check the real total, keep it.
  await openMatter(page);
  await page.getByText('$875').first().waitFor({ state: 'visible', timeout: 60000 });
  result.unbilled = '$875 / 2.5 hrs';
  log('matter detail shows Unbilled $875 (2.5 hrs × $350)');
  const card = reportCard(page);
  await card.waitFor({ state: 'visible', timeout: 30000 });
  const ids = await keepToDtuAndThread(page, card, log);
  Object.assign(result, ids);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('legal.png') });
  log('screenshot: legal.png');

  Object.assign(result, await verifyReadBack(page, ids, 'legal-lens:matter-report', log));

  // 5. Reload survival through the UI.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await openMatter(page);
  await page.getByText('$875').first().waitFor({ state: 'visible', timeout: 60000 });
  result.survivedReload = true;
  log('after full reload the matter is listed and its detail still shows $875');

  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('legal-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('legal-failed.png') }); log('failure screenshot: legal-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
