// scripts/lens-proof-hvac.mjs — REAL browser proof for the HVAC lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   0. header chip reads "Real" (never "Simulated"), no SIM_GRADE copy; the
//      desk has no dead "Activate" button and no "Efficiency Avg" stat
//   1. Jobs desk: + New → a real job (lens artifact) is listed
//   2. Loads tab (not "Manual J"): 1800 sf, 2 stories, good, hot-humid →
//      Calculate load → hvac.loadCalculation saves it (load_…) to the account
//   3. full reload → the job is listed and Loads restores the same estimate
//   4. kill -9 restart of the proof API → reload → both still there
//   5. Keep this load → Save load as DTU (dtu.create + read-back; title carries
//      the load id) → Draft in Thread → hvac.png; dtu.get + thread.draft-detail
//   6. /lenses/thread → Composer lists the draft citing the DTU (hvac-thread.png)
//
// Run: node scripts/lens-proof-hvac.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import { execFileSync } from 'node:child_process';
import {
  mkLog, openBrowser, login, gotoLens, pageLensRun, keepToDtuAndThread, keepMenu, verifyReadBack,
  verifyThreadHandoff, shot, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('hvac');
const result = {};
const RESTART = '/private/tmp/concord-fitness-proof/restart-5299.sh';
const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
const JOB = `Proof HVAC Job ${stamp}`;

async function dismiss(page) {
  for (const name of [/^Reject$/, /Skip onboarding/]) {
    const b = page.getByRole('button', { name }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
}
const tab = (page, label) => page.getByRole('button', { name: new RegExp(`^${label}`) }).first();

async function expectState(page, label) {
  await tab(page, 'Jobs').click();
  const jobRow = page.getByText(JOB, { exact: true }).first();
  await jobRow.waitFor({ state: 'visible', timeout: 60000 });
  await tab(page, 'Loads').click();
  const saved = page.getByTestId('load-saved');
  await saved.waitFor({ state: 'visible', timeout: 60000 });
  const savedText = (await saved.innerText()).trim();
  const cooling = await page.getByText('55,688', { exact: true }).first().isVisible().catch(() => false);
  const sqft = await page.getByPlaceholder('e.g. 1800').first().inputValue();
  const got = { job: true, savedText, cooling, sqft };
  log(label, JSON.stringify(got));
  if (!savedText.includes(result.loadId) || !cooling || sqft !== '1800') throw new Error(`${label}: state not restored ${JSON.stringify(got)}`);
  return got;
}

const { browser, ctx, page } = await openBrowser(log);
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/hvac', log);
  await page.getByText('Real', { exact: true }).first().waitFor({ state: 'visible', timeout: 90000 });
  await page.getByRole('button', { name: /^Reject$/ }).first()
    .waitFor({ state: 'visible', timeout: 10000 }).then(() => dismiss(page), () => {});
  await dismiss(page);
  result.badge = 'Real';
  result.simulatedChips = await page.getByText('Simulated', { exact: true }).count();
  const body = await page.locator('body').innerText();
  log('header chip: Real — "Simulated" chips:', result.simulatedChips, '— SIM_GRADE copy:', /SIM_GRADE|Not real data/.test(body));
  if (result.simulatedChips || /SIM_GRADE|Not real data/.test(body)) throw new Error('HVAC still shows a Simulated chip / SIM_GRADE copy');

  // 1. A real job on the desk.
  await page.getByRole('button', { name: /^New$/ }).first().click();
  const modal = page.locator('div.fixed.inset-0').last();
  await modal.locator('input').first().fill(JOB);
  await modal.getByText('Client', { exact: true }).locator('xpath=..').locator('input').fill('Proof Client');
  await modal.getByRole('button', { name: /^Save$/ }).click();
  await page.getByText(JOB, { exact: true }).first().waitFor({ state: 'visible', timeout: 60000 });
  result.job = JOB;
  log('job created and listed:', JOB);
  result.activateButtons = await page.getByRole('button', { name: 'Activate' }).count();
  result.efficiencyStat = await page.getByText('Efficiency Avg').count();
  result.recordStat = await page.getByText('Job records').first().isVisible().catch(() => false);
  log('desk: Activate buttons', result.activateButtons, '— "Efficiency Avg"', result.efficiencyStat, '— "Job records" stat', result.recordStat);
  if (result.activateButtons || result.efficiencyStat || !result.recordStat) throw new Error('desk still shows dead/mislabelled controls');

  // 2. A saved load estimate.
  result.manualJTabs = await page.getByRole('button', { name: /^Manual J/ }).count();
  if (result.manualJTabs) throw new Error('tab is still labelled Manual J');
  await tab(page, 'Loads').click();
  await page.getByText(/Not an ACCA Manual J room-by-room calculation/).first().waitFor({ state: 'visible', timeout: 30000 });
  const loadCard = page.locator('div.rounded-xl', { has: page.getByText('Load estimate', { exact: true }) }).first();
  await loadCard.getByPlaceholder('e.g. 1800').fill('1800');
  await loadCard.locator('input[type="number"]').nth(1).fill('2');
  await loadCard.locator('select').nth(0).selectOption('good');
  await loadCard.locator('select').nth(1).selectOption('hot-humid');
  const before = ((await pageLensRun(page, 'hvac', 'load-list', {})).result?.loads || []).length;
  await loadCard.getByRole('button', { name: 'Calculate load' }).click();
  const savedLine = page.getByTestId('load-saved');
  await page.waitForFunction((n) => {
    const el = document.querySelector('[data-testid="load-saved"]');
    return el && /load_/.test(el.textContent || '') && document.querySelectorAll('[data-testid="load-history"] li').length >= Math.min(8, n + 1);
  }, before, { timeout: 60000 });
  result.loadId = ((await savedLine.innerText()).match(/(load_[a-z0-9_]+)/) || [])[1];
  const list = await pageLensRun(page, 'hvac', 'load-list', {});
  const top = (list.result?.loads || [])[0];
  if (!result.loadId || top?.id !== result.loadId) throw new Error('load estimate not saved: ' + JSON.stringify(top));
  result.coolingBTU = top.result.coolingBTU;
  result.heatingBTU = top.result.heatingBTU;
  result.tonnage = top.result.tonnageRecommended;
  log('load saved:', result.loadId, '— cool', result.coolingBTU, 'heat', result.heatingBTU, result.tonnage, top.result.equipmentSize);
  if (result.coolingBTU !== 55688) throw new Error('unexpected cooling load ' + result.coolingBTU);

  // 3. Reload survival.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await dismiss(page);
  await tab(page, 'Jobs').waitFor({ state: 'visible', timeout: 90000 });
  result.afterReload = await expectState(page, 'after full reload:');
  await page.screenshot({ path: shot('hvac-reload.png') });
  log('screenshot: hvac-reload.png');

  // 4. kill -9 restart survival (state saves coalesce in a 5 s window).
  await page.waitForTimeout(8000);
  log('kill -9 restart of the proof API:', execFileSync('/bin/sh', [RESTART], { encoding: 'utf8', timeout: 240000 }).trim().replace(/\n/g, ' | '));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await Promise.race([
    page.waitForURL(/\/login/, { timeout: 90000 }),
    tab(page, 'Jobs').waitFor({ state: 'visible', timeout: 90000 }),
  ]).catch(() => {});
  // The proof API runs without JWT_SECRET, so it mints a new signing secret on
  // every boot and the old session cookie stops working. The lens can render
  // for a moment before the client-side redirect to /login, so give it a beat.
  await page.waitForTimeout(6000);
  if (/\/login/.test(page.url())) {
    log('session did not survive the restart (new JWT secret per boot); logging in again');
    await login(ctx, log);
    await gotoLens(page, '/lenses/hvac', log);
  }
  await dismiss(page);
  await tab(page, 'Jobs').waitFor({ state: 'visible', timeout: 90000 });
  result.afterRestart = await expectState(page, 'after kill -9 restart:');
  await page.screenshot({ path: shot('hvac-restart.png') });
  log('screenshot: hvac-restart.png');

  // 5. Keep → DTU → Thread.
  const menu = keepMenu(page, 'Keep this load');
  await menu.waitFor({ state: 'visible', timeout: 30000 });
  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('hvac.png') });
  log('screenshot: hvac.png');
  Object.assign(result, await verifyReadBack(page, ids, 'hvac-lens:load-report', log));
  const dtu = await pageLensRun(page, 'dtu', 'get', { id: ids.dtuId });
  result.dtuTitle = dtu.result?.dtu?.title || dtu.result?.title || '';
  log('DTU title:', result.dtuTitle);
  if (!result.dtuTitle.includes(result.loadId)) throw new Error('DTU title does not carry the load id');

  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('hvac-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('hvac-failed.png') }); log('failure screenshot: hvac-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
