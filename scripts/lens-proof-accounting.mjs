// scripts/lens-proof-accounting.mjs — REAL browser proof for the Accounting lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   0. the header depth chip reads "Real" (never "Simulated")
//   1. /lenses/accounting → Workbench → Chart of Accounts → "New account"
//      twice (a Cash asset and a Service Revenue account) via the real form
//      (accounting.coa-create) — the desk opens empty, nothing is seeded
//   2. Post entry → date, memo, Dr Cash 500 / Cr Service Revenue 500 →
//      "Balanced" → "Post entry" (accounting.je-post) → "Posted JE-…"
//   3. AccountingKeepMenu "Keep this journal entry" → "Save entry as DTU"
//      (dtu.create + dtu.get read-back in the UI) → "Draft in Thread"
//      (thread.thread-draft citing the DTU)
//   4. screenshot accounting.png with the DTU + draft ids on screen
//   5. independent read-back: dtu.get + thread.draft-detail
//   6. full page reload → Workbench → Ledger → both lines of the entry are listed
//   7. /lenses/thread → Composer lists the draft citing the DTU
//
// Run: node scripts/lens-proof-accounting.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import {
  mkLog, openBrowser, login, gotoLens, keepToDtuAndThread, verifyReadBack,
  verifyThreadHandoff, shot, keepMenu, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('accounting');
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const CASH = { code: `1${stamp}`, name: `Cash ${stamp}`, category: 'asset' };
const REV = { code: `4${stamp}`, name: `Service Revenue ${stamp}`, category: 'revenue' };
const MEMO = `Proof JE ${stamp}`;
const SHOT = shot('accounting.png');

async function openWorkbench(page) {
  const wb = page.locator('button[title="Open the accounting workbench (W)"]').first();
  await wb.waitFor({ state: 'visible', timeout: 90000 });
  await wb.click();
  await page.getByRole('button', { name: /^Chart of Accounts$/ }).first().waitFor({ state: 'visible', timeout: 30000 });
}

async function createAccount(page, acct) {
  await page.getByRole('button', { name: /New account/ }).first().click();
  await page.locator('input[placeholder="Code (e.g. 6400)"]').first().fill(acct.code);
  await page.locator('input[placeholder="Name"]').first().fill(acct.name);
  await page.locator('input[placeholder="Code (e.g. 6400)"]').locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]')
    .locator('select').first().selectOption(acct.category);
  await page.getByRole('button', { name: /^Save$/ }).first().click();
  await page.getByText(acct.name).first().waitFor({ state: 'visible', timeout: 30000 });
  log('account created:', acct.code, acct.name);
}

const { browser, ctx, page } = await openBrowser(log);
const result = { memo: MEMO };
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/accounting', log);
  // Header depth chip must be the real-data chip, never "Simulated".
  await page.getByText('Real', { exact: true }).first().waitFor({ state: 'visible', timeout: 90000 });
  result.badge = 'Real';
  result.simulatedChips = await page.getByText('Simulated', { exact: true }).count();
  log('header depth chip: Real — "Simulated" chips on page:', result.simulatedChips);
  if (result.simulatedChips !== 0) throw new Error('Accounting still shows a Simulated chip');
  await openWorkbench(page);
  await page.getByRole('button', { name: /^Chart of Accounts$/ }).first().click();
  await createAccount(page, CASH);
  await createAccount(page, REV);

  await page.getByRole('button', { name: /^Post entry$/ }).first().click();
  await page.locator('input[placeholder="Memo (optional)"]').first().fill(MEMO);
  const selects = page.locator('table select');
  await selects.first().waitFor({ state: 'visible', timeout: 20000 });
  await page.locator(`table select option:has-text("${CASH.code}")`).first().waitFor({ state: 'attached', timeout: 30000 });
  await selects.nth(0).selectOption({ label: `${CASH.code} · ${CASH.name}` });
  await selects.nth(1).selectOption({ label: `${REV.code} · ${REV.name}` });
  const rows = page.locator('table tbody tr');
  await rows.nth(0).locator('input[type="number"]').nth(0).fill('500');
  await rows.nth(1).locator('input[type="number"]').nth(1).fill('500');
  await page.getByText('Balanced', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 });
  // The tab button and the submit share the label; the submit is the last one.
  await page.getByRole('button', { name: /^Post entry$/ }).last().click();
  const posted = page.getByText(/^Posted JE-/).first();
  await posted.waitFor({ state: 'visible', timeout: 60000 });
  result.entryNumber = (await posted.innerText()).replace('Posted ', '').trim();
  log('posted', result.entryNumber, MEMO);

  const menu = keepMenu(page, 'Keep this journal entry');
  await menu.waitFor({ state: 'visible', timeout: 20000 });
  log('AccountingKeepMenu rendered');

  checkDisk(log);
  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT });
  log('screenshot:', SHOT);

  Object.assign(result, await verifyReadBack(page, ids, 'accounting-lens:journal-entry-report', log));

  checkDisk(log);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await openWorkbench(page);
  // The Books side nav also has a "Ledger" link — click the workbench tab.
  const wbTabs = page.getByRole('button', { name: /^Chart of Accounts$/ }).first().locator('xpath=..');
  await wbTabs.getByRole('button', { name: /^Ledger$/ }).click();
  // The Ledger renders one row per line (date, entry number, account,
  // debit/credit) — it does not show the memo — so match on this run's
  // uniquely named accounts and the entry number.
  const cashRow = page.locator('tr', { hasText: CASH.name }).filter({ hasText: result.entryNumber }).first();
  await cashRow.waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('tr', { hasText: REV.name }).filter({ hasText: result.entryNumber }).first().waitFor({ state: 'visible', timeout: 10000 });
  log('ledger rows after reload:', (await cashRow.innerText()).replace(/\s+/g, ' '));
  result.survivedReload = true;
  log('after full reload the entry is in the Ledger:', result.entryNumber);

  checkDisk(log);
  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('accounting-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('accounting-failed.png') }); log('failure screenshot: accounting-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
