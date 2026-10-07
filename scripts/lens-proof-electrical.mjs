// Real Chrome proof for the Electrical job workspace.
// Creates a real job, panel/circuit, estimate/invoice, diagram, checklist,
// and material through the UI; exercises every surviving tool; then proves
// browser reload and backend-restart read-back against the same database.
import { spawn } from 'node:child_process';
import { openSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BASE, chromium, mkLog, gotoLens, pageLensRun, shot, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('electrical');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url));
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const user = `electricalproof_${stamp}`;
const password = 'TestPass123!';
const jobName = `Service upgrade ${stamp}`;
const panelName = `Main ${stamp}`;
const estimateTitle = `Upgrade estimate ${stamp}`;
const diagramName = `Service one-line ${stamp}`;
const checklistName = `Service inspection ${stamp}`;
const materialName = `Proof breaker ${stamp}`;
const dbPath = `/tmp/concord-electrical-proof-${stamp}.db`;
const logPath = `/tmp/concord-electrical-proof-${stamp}.log`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function portUp() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    await promisify(execFile)('lsof', ['-nP', '-iTCP:5299', '-sTCP:LISTEN']);
    return true;
  } catch {
    return false;
  }
}

function startApi() {
  const logFd = openSync(logPath, 'a');
  return spawn(process.execPath, ['--max-old-space-size=2048', '--expose-gc', 'server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: '5299',
      NODE_ENV: 'development',
      JWT_SECRET: 'electrical-proof-jwt',
    },
    stdio: ['ignore', logFd, logFd],
  });
}

async function waitForPort(expected, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if ((await portUp()) === expected) return;
    await sleep(500);
  }
  throw new Error(`API port 5299 did not become ${expected ? 'ready' : 'free'}`);
}

async function stopApi(child) {
  if (!child || child.exitCode !== null) return;
  process.kill(child.pid, 'SIGTERM');
  await waitForPort(false, 30000).catch(async () => {
    process.kill(child.pid, 'SIGKILL');
    await waitForPort(false, 10000);
  });
}

async function register(ctx) {
  const response = await ctx.request.post(`${BASE}/api/auth/register`, {
    data: {
      username: user,
      email: `${user}@example.com`,
      password,
      dateOfBirth: '1990-01-01',
    },
    timeout: 120000,
  });
  const body = await response.json().catch(() => ({}));
  if (!body?.ok) throw new Error(`register failed: ${body?.error || response.status()}`);
}

async function openArtifactEditor(page, toolName) {
  await page.getByRole('button', { name: toolName, exact: true }).click();
  await page.getByRole('button', { name: /New|Create First/ }).first().click();
  await page.getByText(/^New /).waitFor({ timeout: 30000 });
}

async function fillEditorField(page, label, value) {
  const field = page.getByText(label, { exact: true }).locator('..').locator('input, textarea').first();
  await field.fill(value);
}

checkDisk(log);
if (await portUp()) throw new Error('port 5299 is occupied; Electrical proof only restarts its own API');
let api = startApi();
await waitForPort(true);
log('api started', api.pid, dbPath);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') log('console error:', message.text().slice(0, 200));
});

try {
  await register(ctx);
  await gotoLens(page, '/lenses/electrical', log);
  await page.getByRole('heading', { name: new RegExp(`^The job, ${user}`, 'i') }).waitFor({ timeout: 90000 });
  await page.getByText('No job open.').waitFor({ timeout: 60000 });
  await page.screenshot({ path: shot('electrical-empty-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: '+ New job', exact: true }).click();
  await page.getByText('New Job', { exact: true }).waitFor({ timeout: 30000 });
  await fillEditorField(page, 'Name', jobName);
  await fillEditorField(page, 'Description', '200A residential service upgrade');
  await fillEditorField(page, 'Client', `Client ${stamp}`);
  await fillEditorField(page, 'Address', '430 Proof Avenue');
  await fillEditorField(page, 'Labor Hours', '8');
  await fillEditorField(page, 'Labor Rate', '95');
  await fillEditorField(page, 'Material Cost', '1250');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText(jobName, { exact: true }).waitFor({ timeout: 60000 });
  log('real job created');

  await page.getByRole('button', { name: 'Panel', exact: true }).click();
  await page.getByRole('button', { name: 'New panel' }).click();
  await page.getByPlaceholder('e.g. Main Distribution').fill(panelName);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByText(new RegExp(`^${panelName}`)).first().waitFor({ timeout: 60000 });
  await page.getByPlaceholder('Circuit name').fill('Kitchen receptacles');
  await page.getByPlaceholder('Watts').fill('1800');
  await page.getByPlaceholder('Bkr').fill('20');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('Kitchen receptacles', { exact: true }).waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'Size', exact: true }).click();
  await page.getByRole('button', { name: 'Add conductor' }).click();
  await page.getByRole('button', { name: 'Size conduit' }).click();
  await page.getByPlaceholder('e.g. 18').fill('22');
  await page.getByRole('button', { name: 'Verify box fill' }).click();
  await page.getByPlaceholder('e.g. 40').fill('35');
  await page.getByRole('button', { name: 'Size wire' }).click();
  await page.getByText(/Recommended wire/i).waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'NEC', exact: true }).click();
  await page.getByPlaceholder('e.g. Kitchen receptacles').fill('Range');
  await page.getByPlaceholder('e.g. Kitchen receptacles').locator('..').locator('input[type="number"]').fill('7200');
  await page.getByRole('button', { name: 'Calculate load' }).click();
  await page.getByPlaceholder('e.g. 15').fill('20');
  await page.getByPlaceholder('e.g. 100').fill('80');
  await page.getByRole('button', { name: 'Calculate drop' }).click();
  await page.getByPlaceholder('Circuit #1').fill('Kitchen 1');
  await page.getByPlaceholder('Kitchen', { exact: true }).fill('Kitchen');
  await page.getByPlaceholder('receptacles, lights').fill('range,receptacles');
  await page.getByPlaceholder('ft').fill('80');
  await page.getByRole('button', { name: /Map circuits/ }).click();
  await page.getByPlaceholder('Inspection item').fill('GFCI protection');
  await page.getByPlaceholder('NEC 210.8').fill('210.8');
  await page.getByRole('button', { name: /Run inspection/ }).click();
  await page.getByText(/PASS|FAIL/).first().waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'Estimate', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByPlaceholder('Client name').fill(`Client ${stamp}`);
  await page.getByPlaceholder('Job title').fill(estimateTitle);
  await page.getByPlaceholder('Service address').fill('430 Proof Avenue');
  await page.getByPlaceholder('Tax %').fill('7');
  await page.getByRole('button', { name: 'Create estimate', exact: true }).click();
  await page.getByText(new RegExp(`^${estimateTitle} —`)).first().waitFor({ timeout: 60000 });
  await page.getByPlaceholder('Labor description').fill('Service replacement');
  await page.getByPlaceholder('Hrs').fill('8');
  await page.getByPlaceholder('Rate').fill('95');
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.getByPlaceholder('Qty').fill('1');
  await page.getByPlaceholder('$/unit').fill('1250');
  await page.getByRole('button', { name: 'Add', exact: true }).last().click();
  await page.getByRole('button', { name: /Convert to invoice/ }).click();
  await page.getByRole('button', { name: 'Invoices', exact: true }).click();
  await page.getByRole('button', { name: 'Mark paid' }).click();

  await page.getByRole('button', { name: 'One-line', exact: true }).click();
  await page.getByPlaceholder('Diagram name').fill(diagramName);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByPlaceholder('Label').fill('Utility service');
  await page.getByPlaceholder('200A').fill('200A');
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByText('Utility service', { exact: true }).first().waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.getByPlaceholder('e.g. 123 Oak St — Rough-In').fill(checklistName);
  await page.getByRole('button', { name: 'Create checklist' }).click();
  await page.getByText(checklistName, { exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Pass', exact: true }).first().click();
  await page.getByRole('button', { name: 'Fail', exact: true }).nth(1).click();
  await page.getByPlaceholder('Notes…').first().fill('Verified in field');

  await page.getByRole('button', { name: 'Materials', exact: true }).click();
  await page.getByPlaceholder('Material name').fill(materialName);
  await page.getByPlaceholder('unit').fill('each');
  await page.getByPlaceholder('$ price').fill('18.75');
  await page.getByRole('button').filter({ has: page.locator('svg.lucide-plus') }).last().click();
  await page.getByText(materialName, { exact: true }).waitFor({ timeout: 60000 });

  await openArtifactEditor(page, 'Code notes');
  await fillEditorField(page, 'Name', `GFCI note ${stamp}`);
  await page.getByPlaceholder('e.g. 210.8(A)').fill('210.8(A)');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await openArtifactEditor(page, 'CRM');
  await fillEditorField(page, 'Name', `Client ${stamp}`);
  await fillEditorField(page, 'Address', '430 Proof Avenue');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await openArtifactEditor(page, 'Certs');
  await fillEditorField(page, 'Name', `License ${stamp}`);
  await fillEditorField(page, 'License / Cert Number', `EL-${stamp}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await page.getByRole('button', { name: 'Hardware', exact: true }).click();
  await page.getByRole('heading', { name: 'Real-world open-hardware pulse' }).waitFor({ timeout: 30000 });
  await page.locator('select').first().selectOption('open-hardware');
  await page.screenshot({ path: shot('electrical-desktop.png'), fullPage: true });

  const panels = await pageLensRun(page, 'electrical', 'panelList', {});
  const estimates = await pageLensRun(page, 'electrical', 'estimateList', {});
  const diagrams = await pageLensRun(page, 'electrical', 'diagramList', {});
  const checklists = await pageLensRun(page, 'electrical', 'checklistList', {});
  const prices = await pageLensRun(page, 'electrical', 'priceListGet', {});
  const panel = panels.result?.panels?.find((item) => item.name === panelName);
  if (!panel?.circuits?.some((item) => item.name === 'Kitchen receptacles')) throw new Error('panel/circuit read-back failed');
  if (!estimates.result?.estimates?.some((item) => item.title === estimateTitle)) throw new Error('estimate read-back failed');
  if (!diagrams.result?.diagrams?.some((item) => item.name === diagramName)) throw new Error('diagram read-back failed');
  if (!checklists.result?.checklists?.some((item) => item.jobName === checklistName)) throw new Error('checklist read-back failed');
  if (!prices.result?.materials?.some((item) => item.name === materialName)) throw new Error('price-list read-back failed');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('navigation', { name: 'Electrical job tools' }).waitFor({ timeout: 90000 });
  log('workspace survived browser reload');

  await sleep(2500);
  await stopApi(api);
  api = startApi();
  await waitForPort(true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  const afterRestartPanels = await pageLensRun(page, 'electrical', 'panelList', {});
  const persistedPanel = afterRestartPanels.result?.panels?.find((item) => item.id === panel.id);
  if (!persistedPanel?.circuits?.some((item) => item.name === 'Kitchen receptacles')) {
    throw new Error(`backend restart panel read-back failed: ${JSON.stringify(afterRestartPanels).slice(0, 900)}`);
  }
  await page.getByRole('button', { name: 'Panel', exact: true }).click();
  await page.getByText(new RegExp(`^${panelName}`)).first().waitFor({ timeout: 90000 });
  log('backend restart read-back passed', panel.id);

  await page.setViewportSize({ width: 393, height: 851 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('navigation', { name: 'Electrical job tools' }).waitFor({ timeout: 90000 });
  await page.screenshot({ path: shot('electrical-mobile.png'), fullPage: true });
  log('RESULT', JSON.stringify({
    jobName,
    panelId: panel.id,
    estimateTitle,
    diagramName,
    checklistName,
    materialName,
    survivedReload: true,
    survivedBackendRestart: true,
    mobile: true,
  }));
} catch (error) {
  log('PROOF FAILED:', error?.message || error);
  try { await page.screenshot({ path: shot('electrical-failed.png'), fullPage: true }); } catch {}
  throw error;
} finally {
  await ctx.close();
  await browser.close();
  await stopApi(api);
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(`${dbPath}${suffix}`); } catch {}
  }
}
