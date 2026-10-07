// Real Chrome proof for the Emergency Services call board.
// Creates a unit + incident through the UI, dispatches the nearest unit,
// exercises every surviving board tool, reloads, restarts the owned API
// process on the same DB, and reads the CAD records back by id.
import { spawn } from 'node:child_process';
import { openSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BASE, chromium, mkLog, gotoLens, pageLensRun, shot, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('emergency-services');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url));
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const user = `emsproof_${stamp}`;
const password = 'TestPass123!';
const incidentName = `Proof warehouse alarm ${stamp}`;
const unitName = `Engine Proof ${stamp}`;
const agencyName = `Proof Response ${stamp}`;
const dbPath = `/tmp/concord-emergency-services-proof-${stamp}.db`;
const logPath = `/tmp/concord-emergency-services-proof-${stamp}.log`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const child = spawn(process.execPath, ['--max-old-space-size=2048', '--expose-gc', 'server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: '5299',
      NODE_ENV: 'development',
      JWT_SECRET: 'emergency-services-proof-jwt',
    },
    stdio: ['ignore', logFd, logFd],
  });
  return child;
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
  log('registered', user);
}

checkDisk(log);
if (await portUp()) throw new Error('port 5299 is already occupied; Emergency proof only restarts its own API process');
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
  await gotoLens(page, '/lenses/emergency-services', log);
  await page.getByRole('heading', { name: new RegExp(`^The call, ${user}`, 'i') }).waitFor({ timeout: 90000 });
  await page.getByText('No call on the board.').waitFor({ timeout: 90000 });
  await page.screenshot({ path: shot('emergency-services-empty-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Open the board' }).click();
  await page.getByRole('heading', { name: 'Computer-Aided Dispatch' }).waitFor({ timeout: 60000 });

  await page.getByPlaceholder('Call-sign (e.g. Engine 3)').fill(unitName);
  await page.getByPlaceholder('Station').fill('Station 7');
  await page.getByPlaceholder('Lat (map)').fill('35.0000');
  await page.getByPlaceholder('Lng (map)').fill('-80.0000');
  await page.getByRole('button', { name: 'Add to Roster' }).click();
  await page.getByText(unitName).first().waitFor({ timeout: 60000 });

  await page.getByPlaceholder('Incident summary').fill(incidentName);
  await page.getByPlaceholder('Location').fill('Warehouse 12');
  await page.getByPlaceholder('Lat (map pin)').fill('35.0100');
  await page.getByPlaceholder('Lng (map pin)').fill('-80.0100');
  await page.getByRole('button', { name: 'Log Incident' }).click();
  await page.getByText(incidentName).first().waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: incidentName }).first().click();
  const dispatchButton = page.getByRole('button', { name: /Dispatch/ }).first();
  await dispatchButton.waitFor({ state: 'visible', timeout: 60000 });
  await dispatchButton.click();
  await page.getByText(/Unit dispatched/).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: '→ en_route' }).click();
  await page.getByText(/dispatched → en_route/).waitFor({ timeout: 60000 });
  log('real incident created, nearest unit dispatched, lifecycle advanced');

  const incidents = await pageLensRun(page, 'emergency-services', 'incident-list', {});
  const units = await pageLensRun(page, 'emergency-services', 'unit-list', {});
  const incident = incidents.result?.incidents?.find((item) => item.summary === incidentName);
  const unit = units.result?.units?.find((item) => item.name === unitName);
  if (!incident?.id || !unit?.id || unit.status !== 'en_route' || unit.assignedIncidentId !== incident.id) {
    throw new Error(`CAD read-back failed: ${JSON.stringify({ incidents, units }).slice(0, 900)}`);
  }

  await page.getByRole('button', { name: 'Agency' }).click();
  await page.getByPlaceholder('e.g. Riverside Fire & EMS').fill(agencyName);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('span', { hasText: agencyName }).first().waitFor({ state: 'visible', timeout: 60000 });

  await page.getByRole('button', { name: 'Field tools' }).click();
  await page.getByPlaceholder('Sev 1-5').fill('2');
  await page.getByPlaceholder('Pulse').fill('126');
  await page.getByRole('button', { name: /^Triage/ }).click();
  await page.getByText(/YELLOW — Delayed/).first().waitFor({ timeout: 60000 });
  await page.getByPlaceholder('Incident description').fill(incidentName);
  await page.getByPlaceholder('Priority 1-5').fill('2');
  await page.getByPlaceholder('Distance km').fill('1.4');
  await page.getByPlaceholder('Available unit').fill(unitName);
  await page.getByRole('button', { name: /^Dispatch/ }).click();
  await page.getByText(/1 incidents · 1 units/).waitFor({ timeout: 60000 });
  await page.getByPlaceholder('Incident type').fill('fire');
  await page.getByLabel('Incident date and time').fill(new Date().toISOString().slice(0, 16));
  await page.getByPlaceholder('Response minutes').fill('8');
  await page.getByRole('button', { name: /^Log/ }).click();
  await page.getByText(/1 in 24h · avg 8min/).waitFor({ timeout: 60000 });
  await page.getByPlaceholder('Vehicles').fill('4');
  await page.getByPlaceholder('V ready').fill('3');
  await page.getByPlaceholder('Personnel').fill('10');
  await page.getByPlaceholder('P on duty').fill('8');
  await page.getByPlaceholder('Supplies %').fill('90');
  await page.getByRole('button', { name: /^Ready/ }).click();
  await page.getByText(/Readiness/).first().waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: 'Seismic' }).click();
  await page.getByRole('heading', { name: 'Live seismic feed' }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Ingest to substrate' }).click();
  await page.getByText(/Ingested|No new events|Ingest failed|fetch failed|USGS/i).first().waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: 'Call board' }).click();

  await page.screenshot({ path: shot('emergency-services-desktop.png'), fullPage: true });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByText(incidentName).first().waitFor({ timeout: 90000 });
  await page.getByText(unitName).first().waitFor({ timeout: 90000 });
  log('records survived browser reload');

  await sleep(2500);
  await stopApi(api);
  api = startApi();
  await waitForPort(true);
  log('api restarted', api.pid);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  const afterRestartIncidents = await pageLensRun(page, 'emergency-services', 'incident-list', {});
  const afterRestartUnits = await pageLensRun(page, 'emergency-services', 'unit-list', {});
  const persistedIncident = afterRestartIncidents.result?.incidents?.find((item) => item.id === incident.id);
  const persistedUnit = afterRestartUnits.result?.units?.find((item) => item.id === unit.id);
  if (!persistedIncident || persistedUnit?.status !== 'en_route' || persistedUnit?.assignedIncidentId !== incident.id) {
    throw new Error(`backend restart persistence failed: ${JSON.stringify({ afterRestartIncidents, afterRestartUnits }).slice(0, 900)}`);
  }
  await page.getByText(incidentName).first().waitFor({ timeout: 90000 });
  log('backend restart read-back passed', incident.id, unit.id);

  await page.setViewportSize({ width: 393, height: 851 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('navigation', { name: 'Call board tools' }).waitFor({ timeout: 90000 });
  await page.getByText(incidentName).first().waitFor({ timeout: 90000 });
  await page.screenshot({ path: shot('emergency-services-mobile.png'), fullPage: true });
  log('RESULT', JSON.stringify({
    incidentId: incident.id,
    unitId: unit.id,
    unitStatus: persistedUnit.status,
    agencyName,
    survivedReload: true,
    survivedBackendRestart: true,
    mobile: true,
  }));
} catch (error) {
  log('PROOF FAILED:', error?.message || error);
  try { await page.screenshot({ path: shot('emergency-services-failed.png'), fullPage: true }); } catch {}
  throw error;
} finally {
  await ctx.close();
  await browser.close();
  await stopApi(api);
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(`${dbPath}${suffix}`); } catch {}
  }
}
