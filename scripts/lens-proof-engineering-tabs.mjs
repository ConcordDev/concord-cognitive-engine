// scripts/lens-proof-engineering-tabs.mjs — REAL browser proof for the
// Engineering Calcs, Multi-physics and Actions tabs (headless Chrome, shared
// proof user). Every button in those tabs is clicked except DM / Publish
// (they message another user / post publicly):
//   Calcs: change inputs and run Structural, Connection, Thermal, Electrical,
//          Transformer, Hydraulic; each section reads "Saved to your account"
//   Multi-physics: Check thermal, Check wind, Run combined case on the user's
//          saved model; build a 9 V divider circuit from an EMPTY start and
//          solve it (N2 must read 6 V); Compute flow; Export 3D scene download
//   Actions: from an EMPTY parts list add two parts → Tolerance; Stress;
//          Convert; Mint (private DTU); Review (shows its own outcome)
//   then a full reload and a kill -9 API restart: all inputs, the circuit,
//   the parts and every result are still there (engineering.workspace-get).
import { execFileSync } from 'node:child_process';
import { mkLog, openBrowser, login, gotoLens, pageLensRun, shot, checkDisk, BASE } from './lens-proof-lib.mjs';

const log = mkLog('engineering-tabs');
const RESTART = '/private/tmp/concord-fitness-proof/restart-5299.sh';
const tab = (page, label) => page.getByRole('button', { name: new RegExp(`^${label}`) }).first();
const CANTILEVER = {
  nodes: [{ id: 'N1', x: 0, y: 0, z: 0 }, { id: 'N2', x: 10, y: 0, z: 0 }],
  members: [{ id: 'M1', nodeI: 'N1', nodeJ: 'N2', area: 8.25, momentI: 82.8, elasticModulus: 29e6, allowableStress: 21600, material: 'A36 Steel' }],
  supports: [{ nodeId: 'N1', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] }],
  loads: [{ nodeId: 'N2', Fy: -1000 }],
};

async function dismiss(page) {
  for (const name of [/^Reject$/, /Skip onboarding/]) {
    const b = page.getByRole('button', { name }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
}
async function waitSaved(page, testId) {
  await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-state') === 'saved', testId, { timeout: 30000 });
}
async function waitLoaded(page, testId) {
  await page.getByTestId(testId).waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-state') !== 'loading', testId, { timeout: 60000 });
}
const field = (page, section, label) => page.locator(`[data-testid="${section}"] label:has-text("${label}") + input`).first();
const firstValue = async (page, section) => (await page.locator(`[data-testid="${section}"] .text-xl`).first().innerText()).replace(/\s+/g, ' ').trim();

const CALCS = [
  { sec: 'calc-structural', label: 'Axial load (kips)', value: '60', button: 'Run Structural Check', at: 'calc-structural-at' },
  { sec: 'calc-structural', label: 'Number of bolts', value: '6', button: 'Check Connection', at: 'calc-connection-at' },
  { sec: 'calc-thermal', label: 'Envelope area (ft²)', value: '640', button: 'Run Thermal Analysis', at: 'calc-thermal-at', extra: ['Design ΔT (°F, shared)', '37'] },
  { sec: 'calc-electrical', label: 'Current (A)', value: '24', button: 'Run Electrical Check', at: 'calc-electrical-at' },
  { sec: 'calc-electrical', label: 'Load (kVA)', value: '150', button: 'Size Transformer', at: 'calc-transformer-at' },
  { sec: 'calc-hydraulic', label: 'Flow rate (GPM, shared)', value: '65', button: 'Run Hydraulic Analysis', at: 'calc-hydraulic-at' },
];
const SECTIONS = ['calc-structural', 'calc-thermal', 'calc-electrical', 'calc-hydraulic'];

async function readCalcs(page) {
  await tab(page, 'Calcs').click();
  for (const s of SECTIONS) await waitLoaded(page, `${s}-save`);
  const out = { inputs: {}, stamps: {}, values: {} };
  for (const c of CALCS) {
    out.inputs[c.label] = await field(page, c.sec, c.label).inputValue();
    out.stamps[c.at] = await page.getByTestId(c.at).isVisible().catch(() => false);
  }
  out.inputs['Design ΔT'] = await field(page, 'calc-thermal', 'Design ΔT (°F, shared)').inputValue();
  for (const s of SECTIONS) out.values[s] = await firstValue(page, s);
  return out;
}
async function readPhysics(page) {
  await tab(page, 'Multi-physics').click();
  await waitLoaded(page, 'physics-save');
  const stamps = {};
  for (const k of ['thermal', 'aero', 'bundle', 'circuit', 'flow']) stamps[k] = await page.getByTestId(`physics-${k}-at`).isVisible().catch(() => false);
  const values = await page.locator('[data-testid="circuit-elements"] input[aria-label="Value"]').evaluateAll((els) => els.map((e) => e.value));
  const n2 = await page.getByText(/^N2: /).first().innerText().catch(() => null);
  const deltaT = await page.locator('label:has-text("Temperature swing") input').first().inputValue();
  return { stamps, values, n2, deltaT };
}
async function readBench(page) {
  await tab(page, 'Actions').click();
  await waitLoaded(page, 'bench-save');
  const parts = await page.locator('[data-testid="tol-parts"] input[placeholder="Part"]').evaluateAll((els) => els.map((e) => e.value));
  const body = await page.locator('body').innerText();
  return {
    parts,
    stack: /Tolerance stack-up/i.test(body),
    stress: /Stress · SF 2\.5/i.test(body),
    unit: /1(\.0+)? in/.test(body),
    minted: await page.getByRole('button', { name: /^Saved/ }).first().isVisible().catch(() => false),
  };
}
async function readAll(page, label) {
  const got = { calcs: await readCalcs(page), physics: await readPhysics(page), bench: await readBench(page) };
  log(label, JSON.stringify(got));
  return got;
}
function sameAsBefore(before, after, label) {
  const problems = [];
  for (const [k, v] of Object.entries(before.calcs.inputs)) if (after.calcs.inputs[k] !== v) problems.push(`input ${k}: ${after.calcs.inputs[k]} != ${v}`);
  for (const [k, v] of Object.entries(after.calcs.stamps)) if (!v) problems.push(`missing ${k}`);
  for (const [k, v] of Object.entries(before.calcs.values)) if (after.calcs.values[k] !== v) problems.push(`value ${k}: ${after.calcs.values[k]} != ${v}`);
  for (const [k, v] of Object.entries(after.physics.stamps)) if (!v) problems.push(`missing physics ${k}`);
  if (JSON.stringify(after.physics.values) !== JSON.stringify(before.physics.values)) problems.push(`circuit ${after.physics.values} != ${before.physics.values}`);
  if (after.physics.n2 !== before.physics.n2) problems.push(`N2 ${after.physics.n2}`);
  if (after.physics.deltaT !== before.physics.deltaT) problems.push(`physics ΔT ${after.physics.deltaT}`);
  if (JSON.stringify(after.bench.parts) !== JSON.stringify(before.bench.parts)) problems.push(`parts ${after.bench.parts}`);
  for (const k of ['stack', 'stress', 'unit', 'minted']) if (!after.bench[k]) problems.push(`bench ${k} missing`);
  if (problems.length) throw new Error(`${label}: ${problems.join('; ')}`);
  log(label, 'matches what was entered and computed before');
}

const { browser, ctx, page } = await openBrowser(log);
const result = {};
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/engineering', log);
  await page.getByText('Real', { exact: true }).first().waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(1500);
  await dismiss(page);

  // Precondition for Multi-physics: the user's saved working model.
  const m = await pageLensRun(page, 'engineering', 'model-get', {});
  if (!m.result?.model?.members?.length) {
    log('no saved model for this user; saving the cantilever first');
    await pageLensRun(page, 'engineering', 'model-save', { model: CANTILEVER });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await dismiss(page);
  } else log('saved working model:', m.result.model.nodes.length, 'nodes,', m.result.model.members.length, 'members');

  // Start from a clean slate so the run shows the empty starting state (the
  // previous proof run's saved work is cleared through the same save action).
  for (const key of ['calcs.structural', 'calcs.thermal', 'calcs.electrical', 'calcs.hydraulic', 'physics', 'bench']) {
    await pageLensRun(page, 'engineering', 'workspace-save', { key, state: {} });
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Real', { exact: true }).first().waitFor({ state: 'visible', timeout: 90000 });
  await dismiss(page);
  log('cleared the saved workspace for a fresh start');

  // ── Calcs ──
  await tab(page, 'Calcs').click();
  for (const s of SECTIONS) await waitLoaded(page, `${s}-save`);
  log('Calcs note:', (await page.getByTestId('calcs-note').innerText()).slice(0, 90));
  for (const c of CALCS) {
    await field(page, c.sec, c.label).fill(c.value);
    if (c.extra) await field(page, c.sec, c.extra[0]).fill(c.extra[1]);
    await page.getByRole('button', { name: c.button }).click();
    await page.getByTestId(c.at).waitFor({ state: 'visible', timeout: 60000 });
    const cardValue = (await page.getByTestId(c.at).locator('xpath=preceding-sibling::div[1]').locator('.text-xl').first().innerText()).replace(/\s+/g, ' ');
    log(`${c.button}: ${c.label} = ${c.value} →`, cardValue);
  }
  for (const s of SECTIONS) await waitSaved(page, `${s}-save`);
  const thermalText = await page.getByTestId('calc-thermal').innerText();
  log('thermal heat load (640 ft² × 37 °F / R-13 = 1,821.5 BTU/h expected):', /1,821\.5/.test(thermalText));
  if (!/1,821\.5/.test(thermalText)) throw new Error('thermal heat load is not 1,821.5 BTU/h');
  await page.screenshot({ path: shot('engineering-calcs.png'), fullPage: true });
  log('screenshot: engineering-calcs.png');

  // ── Multi-physics ──
  await tab(page, 'Multi-physics').click();
  await waitLoaded(page, 'physics-save');
  log('circuit at start:', (await page.getByTestId('circuit-elements').innerText()).slice(0, 80));
  await page.locator('label:has-text("Temperature swing") input').first().fill('35');
  await page.getByRole('button', { name: 'Check thermal' }).click();
  await page.getByTestId('physics-thermal-at').waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Check wind' }).click();
  await page.getByTestId('physics-aero-at').waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Run combined case' }).click();
  await page.getByTestId('physics-bundle-at').waitFor({ timeout: 90000 });
  log('thermal/wind/combined:', (await page.getByTestId('physics-thermal-at').innerText()), '|', (await page.getByTestId('physics-bundle-at').innerText()));
  await page.getByRole('button', { name: /^V$/ }).click();
  await page.getByRole('button', { name: /^R$/ }).click();
  await page.getByRole('button', { name: /^R$/ }).click();
  const rows = page.locator('[data-testid="circuit-elements"] > div');
  await rows.nth(0).locator('input[aria-label="Value"]').fill('9');
  await rows.nth(1).locator('input[aria-label="Node B"]').fill('N2');
  await rows.nth(1).locator('input[aria-label="Value"]').fill('300');
  await rows.nth(2).locator('input[aria-label="Node A"]').fill('N2');
  await rows.nth(2).locator('input[aria-label="Value"]').fill('600');
  await page.getByRole('button', { name: 'Solve circuit' }).click();
  await page.getByTestId('physics-circuit-at').waitFor({ timeout: 60000 });
  const n2 = await page.getByText(/^N2: /).first().innerText();
  log('circuit 9 V, 300 Ω + 600 Ω → N2 =', n2);
  if (!/^N2: 6\.000 V/.test(n2)) throw new Error(`divider wrong: ${n2}`);
  await page.getByRole('button', { name: 'Compute flow' }).click();
  await page.getByTestId('physics-flow-at').waitFor({ timeout: 60000 });
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.getByRole('button', { name: /Export 3D scene/ }).click(),
  ]);
  log('Export 3D scene downloaded:', dl.suggestedFilename());
  result.sceneFile = dl.suggestedFilename();
  await waitSaved(page, 'physics-save');
  await page.screenshot({ path: shot('engineering-physics.png'), fullPage: true });
  log('screenshot: engineering-physics.png');

  // ── Actions bench ──
  const skipTour = page.getByRole('button', { name: /^Skip$/ }).first();
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click().catch(() => {});
  await tab(page, 'Actions').click();
  await waitLoaded(page, 'bench-save');
  log('parts at start:', (await page.getByTestId('tol-parts').innerText()).slice(0, 80));
  // A unique nominal per run: dtu.create refuses an exact repeat of a DTU.
  const pinNom = (6 + (Date.now() % 997) / 100000).toFixed(5);
  result.pinNominal = pinNom;
  for (const [name, nom, tol] of [['Pin OD', pinNom, '0.01'], ['Bore ID', '6.02', '0.008']]) {
    await page.getByRole('button', { name: 'Add part' }).click();
    const r = page.locator('[data-testid="tol-parts"] > div').last();
    await r.locator('input[placeholder="Part"]').fill(name);
    await r.locator('input[placeholder="Nom."]').fill(nom);
    await r.locator('input[placeholder="±Tol"]').fill(tol);
  }
  const act = (label) => page.locator('button', { has: page.locator('div', { hasText: new RegExp(`^${label}$`) }) }).first();
  await act('Tolerance').click();
  await page.getByText('Tolerance stack-up').waitFor({ timeout: 60000 });
  await page.getByPlaceholder('Force N').fill('5000');
  await page.getByPlaceholder('Area mm²').fill('50');
  await page.getByPlaceholder('Yield MPa').fill('250');
  await act('Stress').click();
  await page.getByText(/Stress · SF 2\.5/).waitFor({ timeout: 60000 });
  await page.getByPlaceholder('Value').fill('25.4');
  await act('Convert').click();
  await page.waitForFunction(() => /1(\.0+)? in/.test(document.body.innerText), null, { timeout: 60000 });
  await act('Mint').click();
  await page.getByText(/Design DTU /).first().waitFor({ timeout: 60000 });
  result.mint = (await page.getByText(/Design DTU /).first().innerText()).trim();
  log('Mint:', result.mint);
  await act('Review').click();
  await page.waitForFunction(() => !document.querySelector('button:disabled .animate-spin'), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const fb = await page.locator('.rounded.text-\\[11px\\]').last().innerText().catch(() => '(none)');
  log('Review outcome shown on screen:', fb.slice(0, 160));
  result.review = fb.slice(0, 160);
  await waitSaved(page, 'bench-save');
  await page.screenshot({ path: shot('engineering-actions.png'), fullPage: true });
  log('screenshot: engineering-actions.png');

  const before = await readAll(page, 'before reload:');

  // ── reload ──
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByText('Real', { exact: true }).first().waitFor({ state: 'visible', timeout: 90000 });
  await dismiss(page);
  const afterReload = await readAll(page, 'after full reload:');
  sameAsBefore(before, afterReload, 'after full reload');
  await tab(page, 'Calcs').click();
  await page.screenshot({ path: shot('engineering-tabs-reload.png'), fullPage: true });
  log('screenshot: engineering-tabs-reload.png');

  // ── kill -9 restart ──
  await page.waitForTimeout(8000);
  log('kill -9 restart of the proof API:', execFileSync('/bin/sh', [RESTART], { encoding: 'utf8', timeout: 240000 }).trim().replace(/\n/g, ' | '));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await Promise.race([
    page.waitForURL(/\/login/, { timeout: 90000 }),
    page.getByText('Real', { exact: true }).first().waitFor({ state: 'visible', timeout: 90000 }),
  ]).catch(() => {});
  const me = await page.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).status).catch(() => 0);
  result.sessionSurvived = !/\/login/.test(page.url()) && me === 200;
  log('browser session survived the restart (fixed proof JWT_SECRET):', result.sessionSurvived, `(GET /api/auth/me → ${me})`);
  if (!result.sessionSurvived) { await login(ctx, log); await gotoLens(page, '/lenses/engineering', log); }
  await dismiss(page);
  const afterRestart = await readAll(page, 'after kill -9 restart:');
  sameAsBefore(before, afterRestart, 'after kill -9 restart');
  await tab(page, 'Multi-physics').click();
  await page.screenshot({ path: shot('engineering-tabs-restart.png'), fullPage: true });
  log('screenshot: engineering-tabs-restart.png');
  log('RESULT', JSON.stringify(result));
  log('PASS');
} catch (e) {
  log('FAILED:', e.message);
  await page.screenshot({ path: shot('engineering-tabs-failed.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
void BASE;
