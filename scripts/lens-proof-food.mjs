// scripts/lens-proof-food.mjs — REAL browser proof for the Food lens.
//
// Chrome via Playwright (channel: 'chrome'), shared proof user:
//   1. /lenses/food → Nutrition → Recipes → + → fill the real recipe form
//      → "Add recipe" (food.recipe-add) → recipe renders (food.recipe-list)
//   2. expand the recipe row → click Keep (data-testid
//      food-recipe-keep-toggle; the old script looked for button text and
//      never found it) → FoodKeepMenu renders "Keep this recipe"
//   3. "Save recipe as DTU" (dtu.create then dtu.get read-back in the UI)
//      → "Draft in Thread" (thread.thread-draft citing the DTU)
//   4. screenshot food.png with the DTU + draft ids on screen
//   5. independent read-back from the page session: dtu.get + thread.draft-detail
//   6. full page reload → recipe is still in the library
//   7. /lenses/thread → Composer lists the draft citing the DTU (food-thread.png)
//
// Run: node scripts/lens-proof-food.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import {
  mkLog, openBrowser, login, gotoLens, keepToDtuAndThread, verifyReadBack,
  verifyThreadHandoff, shot, keepMenu,
} from './lens-proof-lib.mjs';

const log = mkLog('food');
const TITLE = `Proof Carbonara ${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
const SHOT = shot('food.png');

async function openRecipes(page) {
  const nutritionTab = page.getByRole('button', { name: /^Nutrition$/i }).first();
  await nutritionTab.waitFor({ state: 'visible', timeout: 60000 });
  await nutritionTab.click();
  await page.locator('text=Nutrition & Recipe Workbench').first().waitFor({ state: 'visible', timeout: 30000 });
  // NorthStarFrame also has a "Recipes" tab; the panel's sub-tab is the 2nd.
  const recipesTab = page.locator('button:has-text("Recipes")').nth(1);
  await recipesTab.waitFor({ state: 'visible', timeout: 15000 });
  await recipesTab.click();
  await page.locator('button[title="Add recipe"]').first().waitFor({ state: 'visible', timeout: 60000 });
}

const { browser, ctx, page } = await openBrowser(log);
const result = { title: TITLE };
try {
  await login(ctx, log);
  await gotoLens(page, '/lenses/food', log);
  await openRecipes(page);

  await page.locator('button[title="Add recipe"]').first().click();
  const titleInput = page.locator('input[placeholder="Recipe title"]').first();
  await titleInput.waitFor({ state: 'visible', timeout: 10000 });
  await titleInput.fill(TITLE);
  await page.locator('select').first().selectOption('Dinner');
  await page.locator('input[placeholder="Servings"]').first().fill('4');
  await page.locator('input[placeholder="Calories/serving"]').first().fill('580');
  await page.locator('input[placeholder="Protein g"]').first().fill('22');
  await page.locator('input[placeholder="Carbs g"]').first().fill('65');
  await page.locator('input[placeholder="Fat g"]').first().fill('24');
  await page.locator('button.bg-cyan-500:has-text("Add recipe")').first().click();
  const row = page.locator('li', { hasText: TITLE }).first();
  await row.waitFor({ state: 'visible', timeout: 60000 });
  log('recipe rendered in library:', TITLE);

  await row.locator('button', { hasText: TITLE }).first().click();
  const keepToggle = row.getByTestId('food-recipe-keep-toggle');
  await keepToggle.waitFor({ state: 'visible', timeout: 20000 });
  await keepToggle.click();
  const menu = keepMenu(row, 'Keep this recipe');
  await menu.waitFor({ state: 'visible', timeout: 20000 });
  log('FoodKeepMenu rendered');

  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT });
  log('screenshot:', SHOT);

  Object.assign(result, await verifyReadBack(page, ids, 'food-lens:recipe-report', log));

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await openRecipes(page);
  await page.locator('li', { hasText: TITLE }).first().waitFor({ state: 'visible', timeout: 60000 });
  result.survivedReload = true;
  log('after full reload the recipe is still in the library');

  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('food-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('food-failed.png') }); log('failure screenshot: food-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
