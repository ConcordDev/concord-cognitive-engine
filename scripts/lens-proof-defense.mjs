// Real Chrome proof for the Defense brief workspace.
// Creates one record in every persistent C2 store, exercises the structured
// calculators and transient allocator, then proves reload + API restart.
import { spawn } from 'node:child_process';
import { openSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BASE, chromium, mkLog, gotoLens, pageLensRun, shot, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('defense');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url));
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const user = `defenseproof_${stamp}`;
const password = 'TestPass123!';
const markerName = `North corridor ${stamp}`;
const missionName = `Secure bridgehead ${stamp}`;
const assetName = `Falcon ${stamp}`;
const threatName = `Storm front ${stamp}`;
const personName = `Analyst ${stamp}`;
const supplyName = `Medical kits ${stamp}`;
const messageBody = `Corridor verified ${stamp}`;
const dbPath = `/tmp/concord-defense-proof-${stamp}.db`;
const logPath = `/tmp/concord-defense-proof-${stamp}.log`;

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
      JWT_SECRET: 'defense-proof-jwt',
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

async function waitForWorkspace(page) {
  const heading = page.getByRole('heading', { name: new RegExp(`^The brief, ${user}`, 'i') });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await heading.waitFor({ timeout: 60000 });
      return;
    } catch {
      if (attempt === 2) throw new Error('Defense workspace stayed on the shell loading screen');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
    }
  }
}

checkDisk(log);
if (await portUp()) throw new Error('port 5299 is occupied; Defense proof only restarts its own API');
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
  await gotoLens(page, '/lenses/defense', log);
  await waitForWorkspace(page);
  await page.getByText('No brief open.').waitFor({ timeout: 60000 });
  await page.screenshot({ path: shot('defense-empty-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open a brief' }).click();
  await page.getByRole('navigation', { name: 'Defense brief tools' }).waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByPlaceholder('Marker label').fill(markerName);
  await page.getByPlaceholder('Lat').fill('38.91');
  await page.getByPlaceholder('Lon').fill('-77.04');
  await page.getByPlaceholder('Note (optional)').fill('Browser-proof marker');
  await page.getByRole('button', { name: 'Plot', exact: true }).click();
  await page.getByText(markerName, { exact: true }).first().waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'Missions', exact: true }).click();
  await page.getByPlaceholder('Task name').fill(missionName);
  await page.getByPlaceholder('Owner').fill(`Ops ${stamp}`);
  await page.getByPlaceholder('Hours').fill('6');
  await page.getByRole('button', { name: 'Add Task', exact: true }).click();
  await page.getByText(missionName, { exact: true }).first().waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await page.getByRole('button', { name: 'Add Asset' }).click();
  await page.getByPlaceholder('Designation').fill(assetName);
  await page.getByPlaceholder('Readiness %').fill('88');
  await page.getByPlaceholder('Assigned unit').fill(`Unit ${stamp}`);
  await page.getByRole('button', { name: 'Save Asset' }).click();
  await page.getByText(assetName, { exact: true }).first().waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'Threats', exact: true }).click();
  await page.getByPlaceholder('Threat name').fill(threatName);
  await page.getByPlaceholder('Category').fill('weather');
  await page.getByPlaceholder('Region').fill('north');
  await page.getByPlaceholder('Note (optional)').fill('Observed by authored report');
  await page.getByRole('button', { name: 'Add Threat' }).click();
  await page.getByText(threatName, { exact: true }).first().waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'Personnel', exact: true }).click();
  await page.getByRole('button', { name: 'Add Personnel' }).click();
  await page.getByPlaceholder('Name').fill(personName);
  await page.getByPlaceholder('Rank').fill('CIV');
  await page.getByPlaceholder('Role / MOS').fill('Planning');
  await page.getByPlaceholder('Unit').fill(`Cell ${stamp}`);
  await page.getByPlaceholder('Assignment').fill(missionName);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText(personName, { exact: true }).first().waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'Logistics', exact: true }).click();
  await page.getByRole('button', { name: 'New Request' }).click();
  await page.getByPlaceholder('Item').fill(supplyName);
  await page.getByPlaceholder('Quantity').fill('12');
  await page.getByPlaceholder('Destination').fill('North corridor');
  await page.getByPlaceholder('Requested by').fill(personName);
  await page.getByRole('button', { name: 'Submit Request' }).click();
  await page.getByText(new RegExp(supplyName)).first().waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'Comms log', exact: true }).click();
  await page.getByText('Classification labels are records, not encryption or clearance enforcement.').waitFor();
  await page.getByPlaceholder('Channel').fill('ops');
  await page.getByPlaceholder('Sender (callsign)').fill(`proof-${stamp}`);
  await page.getByPlaceholder('Message body…').fill(messageBody);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.getByText(messageBody, { exact: true }).waitFor({ timeout: 60000 });
  await page.getByTitle('Acknowledge').click();

  await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  await page.getByPlaceholder('Threat name').fill(`Flooding ${stamp}`);
  await page.getByPlaceholder('Category').fill('environment');
  await page.getByPlaceholder('Likelihood %').fill('70');
  await page.getByPlaceholder('Impact %').fill('80');
  await page.getByPlaceholder('Mitigation').fill('Reroute convoy');
  await page.getByRole('button', { name: 'Assess threat' }).click();
  await page.getByText(`Flooding ${stamp}`, { exact: true }).first().waitFor({ timeout: 60000 });
  await page.getByPlaceholder('P ready').fill('18');
  await page.getByPlaceholder('P total').fill('20');
  await page.getByPlaceholder('E ready').fill('8');
  await page.getByPlaceholder('E total').fill('10');
  await page.getByPlaceholder('Training %').fill('85');
  await page.getByPlaceholder('Supply %').fill('75');
  await page.getByRole('button', { name: 'Calculate readiness' }).click();
  await page.getByText(/Readiness ·/).waitFor({ timeout: 60000 });
  await page.getByPlaceholder('Incident type').fill('bridge closure');
  await page.getByPlaceholder('Location (optional)').fill('North corridor');
  await page.getByPlaceholder('Reporter (optional)').fill(personName);
  await page.getByRole('button', { name: 'Build response protocol' }).click();
  await page.getByText('bridge closure', { exact: true }).waitFor({ timeout: 60000 });
  await page.getByPlaceholder(/Fireteam Alpha/i).fill('Response team');
  await page.getByLabel('Add resource unit').click();
  await page.getByPlaceholder('Mission name').fill('Hold corridor');
  await page.getByLabel('Add mission').click();
  await page.getByRole('button', { name: 'Run Allocation' }).click();
  await page.getByText('Fully allocated').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Save private DTU' }).click();
  await page.getByText(/Private DTU saved/).waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'Contracts', exact: true }).click();
  await page.getByPlaceholder(/Keyword/).fill('aircraft maintenance');
  await page.getByPlaceholder(/Keyword/).press('Enter');
  await Promise.race([
    page.getByText(/across \\d+ awards/).waitFor({ timeout: 120000 }),
    page.getByRole('alert').waitFor({ timeout: 120000 }),
  ]);

  await page.getByRole('button', { name: 'Live feed', exact: true }).click();
  await page.getByText('Platform events only; this is not authenticated military telemetry.').waitFor();
  await page.screenshot({ path: shot('defense-desktop.png'), fullPage: true });

  const cop = await pageLensRun(page, 'defense', 'cop-map', {});
  const missions = await pageLensRun(page, 'defense', 'mission-plan', {});
  const assets = await pageLensRun(page, 'defense', 'asset-rollup', {});
  const threats = await pageLensRun(page, 'defense', 'threat-board', {});
  const personnel = await pageLensRun(page, 'defense', 'personnel-roster', {});
  const supply = await pageLensRun(page, 'defense', 'supply-board', {});
  const comms = await pageLensRun(page, 'defense', 'comms-log', {});
  if (!cop.result?.markers?.some((item) => item.label === markerName)) throw new Error('COP marker read-back failed');
  if (!missions.result?.tasks?.some((item) => item.name === missionName)) throw new Error('mission read-back failed');
  if (!assets.result?.assets?.some((item) => item.designation === assetName)) throw new Error('asset read-back failed');
  if (!threats.result?.threats?.some((item) => item.name === threatName)) throw new Error('threat read-back failed');
  if (!personnel.result?.roster?.some((item) => item.name === personName)) throw new Error('personnel read-back failed');
  if (!supply.result?.requests?.some((item) => item.item === supplyName)) throw new Error('supply read-back failed');
  if (!comms.result?.messages?.some((item) => item.body === messageBody && item.acknowledged)) throw new Error('communications read-back failed');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('navigation', { name: 'Defense brief tools' }).waitFor({ timeout: 90000 });
  log('brief survived browser reload');

  await sleep(2500);
  await stopApi(api);
  api = startApi();
  await waitForPort(true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  const afterRestart = await pageLensRun(page, 'defense', 'asset-rollup', {});
  const persistedAsset = afterRestart.result?.assets?.find((item) => item.designation === assetName);
  if (!persistedAsset) throw new Error(`backend restart asset read-back failed: ${JSON.stringify(afterRestart).slice(0, 900)}`);
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await page.getByText(assetName, { exact: true }).waitFor({ timeout: 90000 });
  log('backend restart read-back passed', persistedAsset.id);

  await page.setViewportSize({ width: 393, height: 851 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('navigation', { name: 'Defense brief tools' }).waitFor({ timeout: 90000 });
  await page.screenshot({ path: shot('defense-mobile.png'), fullPage: true });
  log('RESULT', JSON.stringify({
    markerName, missionName, assetId: persistedAsset.id, threatName, personName,
    supplyName, messageBody, survivedReload: true, survivedBackendRestart: true, mobile: true,
  }));
} catch (error) {
  log('PROOF FAILED:', error?.message || error);
  try { await page.screenshot({ path: shot('defense-failed.png'), fullPage: true }); } catch {}
  throw error;
} finally {
  await ctx.close();
  await browser.close();
  await stopApi(api);
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, logPath]) {
    try { rmSync(path); } catch {}
  }
}
