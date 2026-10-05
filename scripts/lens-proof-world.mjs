// scripts/lens-proof-world.mjs — REAL browser proof for the World lens.
//
// Chrome via Playwright (channel: 'chrome', headless), shared proof user:
//   1. /lenses/world (Unity shell) → Menu chip → "Advanced OS tools"
//   2. "Share spot" (world.share-link-create) → WorldKeepMenu
//      "Keep this share link" → "Save link as DTU" (dtu.create + dtu.get
//      read-back in the UI) → "Draft in Thread" (thread.thread-draft citing
//      the DTU) → screenshot world.png
//   3. District view (empty "Local sketch (not saved)", no seeded demo
//      district) → Tools → "DSL Editor": opens empty, Run disabled,
//      "not supported yet" label, no fake compiler (world-dsl.png)
//      → "Snap Build": 0 templates, no seeded catalog, "not supported yet"
//      (world-snapbuild.png)
//   4. independent read-back: dtu.get + thread.draft-detail; the link is in
//      world.share-links-list
//   5. full reload → link still in share-links-list
//   6. /mobile companion → Remote and Chat tabs say "Not supported yet" with
//      no fake LIVE feed / local-echo chat (world-mobile.png)
//   7. /lenses/thread → Composer lists the draft citing the DTU
//
// Run: node scripts/lens-proof-world.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import {
  mkLog, openBrowser, login, gotoLens, pageLensRun, keepToDtuAndThread, verifyReadBack,
  verifyThreadHandoff, shot, keepMenu, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('world');
const result = {};

async function openAdvanced(page) {
  const menuBtn = page.getByTestId('world-unity-menu-btn');
  await menuBtn.waitFor({ state: 'visible', timeout: 120000 });
  await menuBtn.click();
  const adv = page.getByTestId('world-unity-menu').getByRole('button', { name: /Advanced OS tools/i });
  await adv.waitFor({ state: 'visible', timeout: 20000 });
  await adv.click();
  await page.locator('button', { hasText: 'Share spot' }).first().waitFor({ state: 'visible', timeout: 240000 });
  log('Advanced OS tools open (Share spot visible)');
}

async function listLinks(page) {
  const r = await pageLensRun(page, 'world', 'share-links-list', {});
  return r.result?.links || [];
}

const { browser, ctx, page } = await openBrowser(log);
try {
  checkDisk?.(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/world', log);
  // Dismiss the cookie notice like a user would (it covers the left sidebar).
  // It slides in a few seconds after load, so wait for it before going on.
  const reject = page.getByRole('button', { name: /^Reject$/ }).first();
  await reject.waitFor({ state: 'visible', timeout: 15000 }).then(() => reject.click()).then(
    () => log('cookie notice: Reject'), () => log('cookie notice: not shown'));
  await openAdvanced(page);

  const before = new Set((await listLinks(page)).map((l) => l.id));
  await page.locator('button', { hasText: 'Share spot' }).first().click();
  const menu = keepMenu(page, 'Keep this share link');
  await menu.waitFor({ state: 'visible', timeout: 60000 });
  log('WorldKeepMenu rendered after Share spot');
  const link = (await listLinks(page)).find((l) => !before.has(l.id));
  if (!link) throw new Error('share-links-list has no new link after Share spot');
  result.linkId = link.id; result.linkUrl = link.url; result.worldId = link.worldId;
  log('share link created:', link.id, link.url);

  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('world.png') });
  log('screenshot: world.png');

  // DSL Editor + Snap Build honesty, clicked through the real tool sidebar.
  await page.getByRole('button', { name: /^District$/ }).first().click();
  await page.getByText('Local sketch (not saved)').first().waitFor({ state: 'visible', timeout: 60000 });
  const bodyD = await page.locator('body').innerText();
  if (/Pioneer Valley|Pop: 2,400|5,000 kW/.test(bodyD)) throw new Error('seeded demo district still shown');
  result.districtHonest = true;
  log('District view: empty "Local sketch (not saved)", no seeded demo district');
  if (await reject.isVisible().catch(() => false)) { await reject.click(); log('cookie notice: Reject (late)'); }
  const toolsBtn = page.locator('button', { hasText: /^Tools$/ }).first();
  await toolsBtn.waitFor({ state: 'visible', timeout: 60000 });
  if (!(await page.locator('button', { hasText: 'DSL Editor' }).first().isVisible().catch(() => false))) {
    await toolsBtn.click();
  }
  await page.locator('button', { hasText: 'DSL Editor' }).first().click();
  const dslNote = page.getByTestId('dsl-not-supported');
  await dslNote.waitFor({ state: 'visible', timeout: 60000 });
  const dslSrc = await page.getByLabel('Concord DSL source').inputValue();
  const runDisabled = await page.getByTestId('dsl-run-disabled').isDisabled();
  if (dslSrc !== '' || !runDisabled) throw new Error(`DSL editor not honest: src=${JSON.stringify(dslSrc)} runDisabled=${runDisabled}`);
  const body1 = await page.locator('body').innerText();
  if (/Compilation successful|AST generated|Published IDs/.test(body1)) throw new Error('fake compiler output on screen');
  result.dslHonest = true;
  await dslNote.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('world-dsl.png') });
  log('DSL editor: empty, Run disabled, not-supported label shown (world-dsl.png)');

  await page.locator('button', { hasText: 'Snap Build' }).first().click();
  const snapNote = page.getByTestId('snap-build-not-supported');
  await snapNote.waitFor({ state: 'visible', timeout: 60000 });
  const body2 = await page.locator('body').innerText();
  if (/@architect_alex|Craftsman House/.test(body2)) throw new Error('seeded snap-build templates on screen');
  if (!/0 templates available/.test(body2)) throw new Error('snap-build count is not 0');
  result.snapBuildHonest = true;
  await snapNote.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('world-snapbuild.png') });
  log('Snap Build: 0 templates, not-supported label shown (world-snapbuild.png)');

  Object.assign(result, await verifyReadBack(page, ids, 'world-lens:share-link-report', log));

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await gotoLens(page, '/lenses/world', log);
  const after = await listLinks(page);
  if (!after.some((l) => l.id === result.linkId)) throw new Error('share link missing after reload');
  result.survivedReload = true;
  log('after full reload the share link is still listed:', result.linkId);

  await gotoLens(page, '/mobile', log);
  // The first-visit onboarding wizard opens over /mobile a few seconds after
  // load; close it like a user (✕ = "Skip onboarding") whenever it shows.
  const skip = page.getByRole('button', { name: 'Skip onboarding' });
  const clickTab = async (name) => {
    for (let i = 0; i < 6; i++) {
      if (await skip.isVisible().catch(() => false)) { await skip.click(); log('onboarding: Skip'); }
      try { await page.getByText(name, { exact: true }).first().click({ timeout: 5000 }); return; } catch {}
    }
    throw new Error(`could not click companion tab ${name}`);
  };
  await skip.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await clickTab('Remote');
  await page.getByTestId('companion-remote-not-supported').waitFor({ state: 'visible', timeout: 60000 });
  if (await page.getByText('LIVE', { exact: true }).count()) throw new Error('fake LIVE camera feed still shown');
  await page.screenshot({ path: shot('world-mobile.png') });
  await clickTab('Chat');
  await page.getByTestId('companion-chat-not-supported').waitFor({ state: 'visible', timeout: 30000 });
  result.mobileHonest = true;
  log('Mobile companion Remote + Chat say not supported yet (world-mobile.png)');

  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('world-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('world-failed.png') }); log('failure screenshot: world-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
