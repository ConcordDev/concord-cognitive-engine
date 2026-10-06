// scripts/lens-proof-crypto.mjs — REAL browser proof for the Crypto lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   0. honesty: no "Demo" chip, no empty "↓ .dtu" export button; Swap tab is
//      quote-only (swap-not-supported label, no "Swap X → Y" execute button)
//      → crypto-swap.png
//   1. /lenses/crypto → Portfolio tab (default) → "Add Holding" → fill the
//      real form (CoinGecko id, ticker, qty, total cost, chain) → "Save lot"
//      (crypto.holdings-add) → the lot renders in the Holdings list
//      (crypto.holdings-list)
//   2. The CryptoKeepMenu "Keep this lot" renders right under the add form
//      after the lot is saved → "Save lot as DTU" (dtu.create + dtu.get
//      read-back in the UI) → "Draft in Thread" (thread.thread-draft citing
//      the DTU)
//   3. screenshot crypto.png with the DTU + draft ids on screen
//   4. independent read-back: dtu.get + thread.draft-detail
//   5. full page reload → Portfolio tab → the holding is still listed
//   6. /lenses/thread → Composer lists the draft citing the DTU (crypto-thread.png)
//
// The depth harness (server/tests/crypto-keep.test.js) proves the macro
// round-trip + DTU + Thread draft + restart survival. This script proves the
// real Next route was opened and the workflow was actually clicked through.
//
// Run: node scripts/lens-proof-crypto.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import {
  mkLog, openBrowser, login, gotoLens, keepToDtuAndThread, verifyReadBack,
  verifyThreadHandoff, shot, keepMenu, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('crypto');
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const TITLE = `Proof Lot ${STAMP}`;
const SHOT = shot('crypto.png');

const { browser, ctx, page } = await openBrowser(log);
const result = { title: TITLE };
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/crypto', log);

  const swapTab = page.getByRole('button', { name: /^Swap\s*s$/ }).first(); // workspace tab: label + shortcut
  await swapTab.waitFor({ state: 'visible', timeout: 90000 });
  await page.getByRole('button', { name: /^Reject$/ }).first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => page.getByRole('button', { name: /^Reject$/ }).first().click(), () => {});
  result.demoChips = await page.getByText('Demo', { exact: true }).count();
  result.emptyDtuExportButtons = await page.getByRole('button', { name: /\.dtu/ }).count();
  // The top "Wallet" preview must not render dead Send/Receive/Swap tiles.
  result.walletPreviewActionTiles = await page.getByTestId('wallet-shell-actions').count();
  if (result.walletPreviewActionTiles) throw new Error('wallet preview still renders unwired action tiles');
  log('"Demo" chips:', result.demoChips, '— "↓ .dtu" export buttons:', result.emptyDtuExportButtons);
  if (result.demoChips || result.emptyDtuExportButtons) throw new Error('Demo chip or empty .dtu export still rendered');
  await swapTab.click();
  const swapNote = page.getByTestId('swap-not-supported');
  await swapNote.waitFor({ state: 'visible', timeout: 30000 });
  result.swapLabel = (await swapNote.innerText()).trim();
  const names = await page.getByRole('button').evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()));
  result.executeSwapButtons = names.filter((n) => /^Swap \S+ →/.test(n)).length;
  if (result.executeSwapButtons) throw new Error('a "Swap X → Y" execute button is still rendered');
  await swapNote.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('crypto-swap.png') });
  log('swap tab label:', result.swapLabel, '— execute buttons: 0 — crypto-swap.png');

  // The PortfolioWorkbench (which owns the "Add Holding" form + the
  // CryptoKeepMenu) lives under the "Holdings" tab, not the default
  // "Portfolio" tab. The tab button text is "Holdings⇧H" (label + shortcut).
  const holdingsTab = page.getByRole('button', { name: /^Holdings/ }).first();
  await holdingsTab.waitFor({ state: 'visible', timeout: 90000 });
  await holdingsTab.click();
  await page.waitForTimeout(800);

  const addBtn = page.getByRole('button', { name: /Add Holding/i }).first();
  await addBtn.waitFor({ state: 'visible', timeout: 30000 });
  await addBtn.click();
  await page.waitForTimeout(800);

  // Fill the real holdings-add form. Use a unique CoinGecko id per run so the
  // holding is distinguishable in the list after reload.
  const cgId = `proof-${STAMP}`;
  await page.locator('input[placeholder="CoinGecko id (bitcoin)"]').first().fill(cgId);
  await page.locator('input[placeholder="Ticker (BTC)"]').first().fill(TITLE);
  await page.locator('input[placeholder="Quantity"]').first().fill('0.5');
  await page.locator('input[placeholder="Total cost (USD)"]').first().fill('30000');
  await page.locator('select').first().selectOption('bitcoin');
  await page.getByRole('button', { name: /Save lot/i }).first().click();

  // Wait for the holding to render in the Holdings list (holdings-list macro).
  const holdingRow = page.locator('body', { hasText: TITLE }).first();
  await holdingRow.waitFor({ state: 'visible', timeout: 60000 });
  log('holding rendered in the list:', TITLE);

  // The CryptoKeepMenu renders under the add-form once the lot is saved.
  const menu = keepMenu(page, 'Keep this lot');
  await menu.waitFor({ state: 'visible', timeout: 20000 });
  log('CryptoKeepMenu rendered');

  checkDisk(log);
  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT });
  log('screenshot:', SHOT);

  Object.assign(result, await verifyReadBack(page, ids, 'crypto-lens:holding-report', log));

  // Full page reload → the holding is still in the Holdings list.
  checkDisk(log);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  const holdingsTab2 = page.getByRole('button', { name: /^Holdings/ }).first();
  await holdingsTab2.waitFor({ state: 'visible', timeout: 90000 });
  await holdingsTab2.click();
  await page.waitForTimeout(800);
  await page.locator('body', { hasText: TITLE }).first().waitFor({ state: 'visible', timeout: 60000 });
  result.survivedReload = true;
  log('after full reload the holding is still listed:', TITLE);

  checkDisk(log);
  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('crypto-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('crypto-failed.png') }); log('failure screenshot: crypto-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}