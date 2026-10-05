// scripts/lens-proof-engineering.mjs — REAL browser proof for the Engineering lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   0. header chip reads "Real" (never "Simulated"), no SIM_GRADE copy; the
//      Model view starts EMPTY (no sample portal frame); Run FEA on the empty
//      model says what is missing instead of solving a sample
//   1. build a real cantilever in the UI: + Node ×2 (N2 at X = 10 in),
//      + Member (N1–N2), fix N1, Loads → + Load on N2 (Fy −1000); the Model
//      header reads "Saved to your account" (engineering.model-save)
//   1a. full reload → the model is still there (2 nodes, N2 X = 10, N1 fixed,
//      member M1, load on N2), read back from engineering.model-get
//   1b. kill -9 the proof API, restart it, reload → the model is still there
//   2. Run FEA (engineering.runFEA → sim job) → Results → "Keep this FEA run"
//      → "Save FEA as DTU" (dtu.create + dtu.get read-back) → "Draft in
//      Thread" (thread.thread-draft citing the DTU) → engineering.png
//   3. independent read-back: dtu.get + thread.draft-detail; listSimJobs has the job
//   4. full reload → Results → Simulation History still shows the run
//   5. /lenses/thread → Composer lists the draft citing the DTU (engineering-thread.png)
//
// Run: node scripts/lens-proof-engineering.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import { execFileSync } from 'node:child_process';
import {
  mkLog, openBrowser, login, gotoLens, pageLensRun, keepToDtuAndThread, keepMenu, verifyReadBack,
  verifyThreadHandoff, shot, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('engineering');
const result = {};

async function dismiss(page) {
  for (const name of [/^Reject$/, /Skip onboarding/]) {
    const b = page.getByRole('button', { name }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
}
const tab = (page, label) => page.getByRole('button', { name: new RegExp(`^${label}`) }).first();
const runFea = (page) => page.getByRole('button', { name: /Run FEA/ }).first();
const RESTART = '/private/tmp/concord-fitness-proof/restart-5299.sh';
const EMPTY = { nodes: [], members: [], loads: [], supports: [] };

// The Model + Loads views show the cantilever built in step 1.
async function expectModel(page, label) {
  await tab(page, 'Model').click();
  const saveState = page.getByTestId('model-save-state');
  await saveState.waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="model-save-state"]')?.getAttribute('data-state') !== 'loading', null, { timeout: 60000 });
  const nodesPanel = page.locator('.panel', { has: page.locator('h3', { hasText: 'Nodes' }) }).first();
  const rows = await nodesPanel.locator('tbody tr').count();
  const n2x = await nodesPanel.locator('tbody tr').nth(1).locator('input').nth(1).inputValue().catch(() => null);
  const fixed = await page.getByRole('button', { name: /^N1 ⊥ Fixed$/ }).isVisible().catch(() => false);
  const membersPanel = page.locator('.panel', { has: page.locator('h3', { hasText: 'Members' }) }).first();
  const members = await membersPanel.locator('tbody tr').count();
  const saveText = (await saveState.innerText().catch(() => '')).trim();
  await tab(page, 'Loads').click();
  const loadsPanel = page.locator('.panel', { has: page.locator('h3', { hasText: 'Point Loads' }) }).first();
  await loadsPanel.waitFor({ state: 'visible', timeout: 30000 });
  const loadNode = await loadsPanel.locator('tbody tr').first().locator('select').inputValue().catch(() => null);
  const got = { rows, n2x, fixed, members, loadNode, saveState: saveText };
  log(label, JSON.stringify(got));
  await tab(page, 'Model').click();
  if (rows !== 2 || n2x !== '10' || !fixed || members !== 1 || loadNode !== 'N2') {
    throw new Error(`${label}: model not restored ${JSON.stringify(got)}`);
  }
  return got;
}

const { browser, ctx, page } = await openBrowser(log);
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/engineering', log);
  await page.getByText('Real', { exact: true }).first().waitFor({ state: 'visible', timeout: 90000 });
  await page.getByRole('button', { name: /^Reject$/ }).first()
    .waitFor({ state: 'visible', timeout: 10000 }).then(() => dismiss(page), () => {});
  await dismiss(page);
  result.badge = 'Real';
  result.simulatedChips = await page.getByText('Simulated', { exact: true }).count();
  const body = await page.locator('body').innerText();
  log('header chip: Real — "Simulated" chips:', result.simulatedChips, '— SIM_GRADE copy:', /SIM_GRADE|Not real data/.test(body));
  if (result.simulatedChips || /SIM_GRADE|Not real data/.test(body)) throw new Error('Engineering still shows a Simulated chip / SIM_GRADE copy');

  // 0. Start from an empty saved model (a rerun leaves the last proof's model
  // stored for this user), then check the honest refusal.
  const cleared = await pageLensRun(page, 'engineering', 'model-save', { model: EMPTY });
  if (!cleared.ok) throw new Error('could not clear the stored model: ' + JSON.stringify(cleared));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await dismiss(page);
  const nodesPanel = page.locator('.panel', { has: page.locator('h3', { hasText: 'Nodes' }) }).first();
  await nodesPanel.waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="model-save-state"]')?.getAttribute('data-state') !== 'loading', null, { timeout: 60000 });
  result.startingNodes = await nodesPanel.locator('tbody tr').count();
  result.coordHeader = (await nodesPanel.locator('th').nth(1).innerText()).trim();
  if (result.coordHeader !== 'X (in)') throw new Error('node coordinate header is ' + result.coordHeader);
  log('model starts with', result.startingNodes, 'nodes');
  if (result.startingNodes !== 0) throw new Error('model is pre-filled with a sample structure');
  await runFea(page).click();
  const refusal = page.getByText(/nothing to solve yet\. In Model, add at least two nodes\./).first();
  await refusal.waitFor({ state: 'visible', timeout: 15000 });
  log('Run FEA on the empty model:', (await refusal.innerText()).trim());

  // 1. Build a cantilever.
  await dismiss(page);
  await nodesPanel.getByRole('button', { name: /^Node$/ }).click();
  await nodesPanel.getByRole('button', { name: /^Node$/ }).click();
  await nodesPanel.locator('tbody tr').nth(1).locator('input').nth(1).fill('10');
  const membersPanel = page.locator('.panel', { has: page.locator('h3', { hasText: 'Members' }) }).first();
  await membersPanel.getByRole('button', { name: /^Member$/ }).click();
  await page.getByRole('button', { name: /^N1 ○ Free$/ }).click();
  await page.getByRole('button', { name: /^N1 ⊥ Fixed$/ }).waitFor({ state: 'visible', timeout: 10000 });
  await tab(page, 'Loads').click();
  const loadsPanel = page.locator('.panel', { has: page.locator('h3', { hasText: 'Point Loads' }) }).first();
  await loadsPanel.getByRole('button', { name: /^Load$/ }).click();
  await loadsPanel.locator('tbody tr').first().locator('select').selectOption('N2');
  log('built: N1(0,0,0) fixed — M1 — N2(10,0,0) in, load Fy −1000 lb on N2');
  await tab(page, 'Model').click();
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="model-save-state"]');
    return el?.getAttribute('data-state') === 'saved';
  }, null, { timeout: 30000 });
  const stored = await pageLensRun(page, 'engineering', 'model-get', {});
  const sm = stored.result?.model;
  result.storedModel = sm ? { nodes: sm.nodes.length, members: sm.members.length, supports: sm.supports.length, loads: sm.loads.length, updatedAt: stored.result.updatedAt } : null;
  log('engineering.model-get after the edits:', JSON.stringify(result.storedModel));
  if (!sm || sm.nodes.length !== 2 || sm.members.length !== 1 || sm.supports.length !== 1 || sm.loads.length !== 1) {
    throw new Error('model was not saved server-side');
  }

  // 1a. Reload survival of the working model.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await dismiss(page);
  result.modelAfterReload = await expectModel(page, 'after full reload the model is');
  await page.screenshot({ path: shot('engineering-model-reload.png') });
  log('screenshot: engineering-model-reload.png');

  // 1b. kill -9 restart survival. State saves coalesce in a 5 s window, so let
  // that window close before the hard kill.
  await page.waitForTimeout(8000);
  log('kill -9 restart of the proof API:', execFileSync('/bin/sh', [RESTART], { encoding: 'utf8', timeout: 240000 }).trim().replace(/\n/g, ' | '));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  // The login redirect (if the session didn't come back) happens client-side,
  // so wait for either the lens or the login page before deciding.
  await Promise.race([
    page.waitForURL(/\/login/, { timeout: 90000 }),
    page.locator('.panel', { has: page.locator('h3', { hasText: 'Nodes' }) }).first().waitFor({ state: 'visible', timeout: 90000 }),
  ]).catch(() => {});
  if (/\/login/.test(page.url())) {
    log('session did not survive the restart; logging in again');
    await login(ctx, log);
    await gotoLens(page, '/lenses/engineering', log);
  }
  await dismiss(page);
  result.modelAfterRestart = await expectModel(page, 'after kill -9 restart the model is');
  await page.screenshot({ path: shot('engineering-model-restart.png') });
  log('screenshot: engineering-model-restart.png');

  // 2. Solve and keep.
  await runFea(page).click();
  await page.getByText('Analysis complete').first().waitFor({ state: 'visible', timeout: 90000 });
  const jobs = await pageLensRun(page, 'engineering', 'listSimJobs', {});
  const job = (jobs.result?.jobs || [])[0];
  result.jobId = job?.id || null;
  result.maxDisplacement = job?.summary?.maxDisplacement ?? null;
  result.maxUtilization = job?.summary?.maxUtilization ?? null;
  result.allPass = job?.summary?.allPass ?? null;
  if (!result.jobId || job?.summary?.memberCount !== 1) throw new Error('sim job not recorded: ' + JSON.stringify(job));
  log('solved: job', result.jobId, 'max disp', result.maxDisplacement, 'max util', result.maxUtilization, 'all pass', result.allPass);
  result.stressHeader = (await page.locator('th', { hasText: /^\s*Stress/ }).first().innerText()).trim();
  if (result.stressHeader !== 'Stress (psi)') throw new Error('stress column header is ' + result.stressHeader);
  log('results stress column:', result.stressHeader);
  const menu = keepMenu(page, 'Keep this FEA run');
  await menu.waitFor({ state: 'visible', timeout: 30000 });
  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('engineering.png') });
  log('screenshot: engineering.png');
  Object.assign(result, await verifyReadBack(page, ids, 'engineering-lens:fea-report', log));

  // 4. Reload survival: the run is in Simulation History.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await tab(page, 'Results').waitFor({ state: 'visible', timeout: 90000 });
  await dismiss(page);
  await tab(page, 'Results').click();
  const disp = `${Number(result.maxDisplacement).toFixed(4)}"`;
  await page.getByText('Simulation History').first().waitFor({ state: 'visible', timeout: 60000 });
  const row = page.locator('tr', { hasText: 'FEA run' }).filter({ hasText: disp }).first();
  await row.waitFor({ state: 'visible', timeout: 60000 });
  const histJobs = await pageLensRun(page, 'engineering', 'listSimJobs', {});
  if ((histJobs.result?.jobs || [])[0]?.id !== result.jobId) throw new Error('newest sim job after reload is not ' + result.jobId);
  result.survivedReload = true;
  log('after full reload Simulation History still lists the run (max disp', disp + ')');

  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('engineering-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('engineering-failed.png') }); log('failure screenshot: engineering-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
