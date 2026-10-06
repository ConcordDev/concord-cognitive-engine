// scripts/lens-proof-retail.mjs — REAL browser proof for the Retail lens.
//
// Chrome via Playwright (channel: 'chrome'), shared proof user:
//   1. /lenses/retail → "Retail Workbench" → Catalog → "Add product" → fill
//      the real form (SKU, name, price, stock, category, supplier, lead
//      time, daily sales rate) → Save (retail.product-upsert) → the product
//      renders from retail.product-list
//   1b. the Storefront "Catalog (N)" card (LivePosTerminal, same real
//      retail.product-list) picks up the new product without a reload
//   2. click Keep on that product (aria-label "Keep <name>") → the row
//      expands and RetailKeepMenu renders "Keep this product"
//   3. "Save product as DTU" (dtu.create + dtu.get read-back in the UI)
//      → "Draft in Thread" (thread.thread-draft citing the DTU)
//   4. screenshot retail.png with the DTU + draft ids on screen
//   5. independent read-back: dtu.get + thread.draft-detail
//   6. full page reload → Storefront catalog card lists the product →
//      reopen the workbench Catalog → product still listed
//   7. /lenses/thread → Composer lists the draft citing the DTU (retail-thread.png)
//
// Run: node scripts/lens-proof-retail.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import {
  mkLog, openBrowser, login, gotoLens, keepToDtuAndThread, verifyReadBack,
  verifyThreadHandoff, shot, keepMenu, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('retail');
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const SKU = `PRF-${stamp}`;
const NAME = `Proof Widget ${stamp}`;
const SHOT = shot('retail.png');

function storefrontCatalog(page) {
  return page.locator('div.rounded-md', { has: page.locator('span', { hasText: /^Catalog \(\d+\)$/ }) }).first();
}

async function storefrontCount(page) {
  const t = await storefrontCatalog(page).locator('span', { hasText: /^Catalog \(\d+\)$/ }).first().innerText();
  return Number((t.match(/\((\d+)\)/) || [])[1]);
}

async function openCatalog(page) {
  const wb = page.getByRole('button', { name: /Retail Workbench/i }).first();
  await wb.waitFor({ state: 'visible', timeout: 60000 });
  await wb.click();
  const catalog = page.getByRole('button', { name: /^Catalog$/ }).first();
  await catalog.waitFor({ state: 'visible', timeout: 20000 });
  await catalog.click();
  await page.getByRole('button', { name: /Add product/i }).first().waitFor({ state: 'visible', timeout: 60000 });
}

const { browser, ctx, page } = await openBrowser(log);
const result = { sku: SKU, name: NAME };
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/retail', log);
  await storefrontCatalog(page).waitFor({ state: 'attached', timeout: 60000 });
  await page.waitForTimeout(2000);
  result.storefrontBefore = await storefrontCount(page);
  log('storefront catalog count before add:', result.storefrontBefore);
  await openCatalog(page);

  await page.getByRole('button', { name: /Add product/i }).first().click();
  await page.locator('input[placeholder="SKU"]').first().fill(SKU);
  await page.locator('input[placeholder="Product name"]').first().fill(NAME);
  await page.locator('input[placeholder="Price"]').first().fill('29.99');
  await page.locator('input[placeholder="Stock"]').first().fill('150');
  await page.locator('input[placeholder="Category"]').first().fill('Electronics');
  await page.locator('input[placeholder="Supplier"]').first().fill('Acme Corp');
  await page.locator('input[placeholder="Lead time (days)"]').first().fill('14');
  await page.locator('input[placeholder="Daily sales rate"]').first().fill('3');
  await page.getByRole('button', { name: /^Save$/ }).first().click();

  const card = page.locator('div.group', { hasText: SKU }).first();
  await card.waitFor({ state: 'visible', timeout: 60000 });
  log('product rendered in catalog:', SKU, NAME);
  await storefrontCatalog(page).getByRole('button', { name: new RegExp(NAME) }).first().waitFor({ state: 'attached', timeout: 30000 });
  result.storefrontAfterAdd = await storefrontCount(page);
  log('storefront catalog now lists', NAME, '— count', result.storefrontAfterAdd);
  if (!(result.storefrontAfterAdd > result.storefrontBefore)) throw new Error('storefront count did not grow');

  await card.hover();
  const keepToggle = card.getByRole('button', { name: `Keep ${NAME}` });
  await keepToggle.click();
  const menu = keepMenu(card, 'Keep this product');
  await menu.waitFor({ state: 'visible', timeout: 20000 });
  log('RetailKeepMenu rendered');

  checkDisk(log);
  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  // Bring the Storefront catalog card (behind the drawer, left side) into view
  // so one shot shows the new product in both places plus the keep result.
  await storefrontCatalog(page).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await storefrontCatalog(page).getByRole('button', { name: new RegExp(NAME) }).first()
    .evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOT });
  log('screenshot:', SHOT);

  Object.assign(result, await verifyReadBack(page, ids, 'retail-lens:product-report', log));

  checkDisk(log);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await storefrontCatalog(page).getByRole('button', { name: new RegExp(NAME) }).first().waitFor({ state: 'attached', timeout: 90000 });
  result.storefrontAfterReload = await storefrontCount(page);
  log('after full reload the storefront catalog lists', NAME, '— count', result.storefrontAfterReload);
  await openCatalog(page);
  await page.locator('div.group', { hasText: SKU }).first().waitFor({ state: 'visible', timeout: 60000 });
  result.survivedReload = true;
  log('after full reload the product is still in the catalog');

  checkDisk(log);
  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('retail-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('retail-failed.png') }); log('failure screenshot: retail-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
