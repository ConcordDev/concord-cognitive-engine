// scripts/lens-proof-energy.mjs — REAL browser proof for the Energy lens.
//
// Drives the actual Next route and Energy macros through installed Chrome:
// meter creation/selection, live reading, usage, device, solar, billing,
// TOU, advisor, insights, EIA honest-failure, calculators, sharing gate,
// every workspace destination, reload, mobile layout, and optional
// post-backend-restart read-back.
//
// Run:
//   PROOF_USER=admin PROOF_PASS='...' node scripts/lens-proof-energy.mjs
//   PROOF_READBACK=1 PROOF_USER=admin PROOF_PASS='...' node scripts/lens-proof-energy.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import {
  BASE, chromium, mkLog, login, gotoLens, pageLensRun, shot, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('energy');
const RESULT_PATH = shot('energy-result.json');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const meterName = `Proof meter ${stamp}`;
const deviceName = `Proof heater ${stamp}`;
const today = new Date().toISOString().slice(0, 10);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('console', (message) => {
  if (message.type() === 'error' && !/EIA API key not configured/.test(message.text())) {
    log('console error:', message.text().slice(0, 220));
  }
});
page.on('response', (response) => {
  if (/\/api\/lens\/run/.test(response.url()) && response.request().method() === 'POST') {
    let action = '';
    try {
      const body = JSON.parse(response.request().postData() || '{}');
      action = `${body.domain}.${body.action}`;
    } catch {}
    response.text()
      .then((text) => log('LENS', response.status(), action, text.slice(0, 140).replace(/\s+/g, ' ')))
      .catch(() => {});
  }
});

async function clickView(label) {
  const button = page.getByRole('button', { name: new RegExp(`^${label}`) }).first();
  await button.waitFor({ state: 'visible', timeout: 60000 });
  await button.click();
  await page.waitForTimeout(350);
}

async function fillLabel(label, value) {
  const input = page.locator('label', { hasText: label }).locator('input').first();
  await input.waitFor({ state: 'visible', timeout: 30000 });
  await input.fill(String(value));
}

async function saveVisibleDtu() {
  const save = page.getByRole('button', { name: 'Save as DTU' }).first();
  await save.waitFor({ state: 'visible', timeout: 30000 });
  await save.click();
  await page.getByRole('button', { name: 'Save DTU' }).click();
  await page.getByRole('button', { name: 'Saved as DTU' }).first().waitFor({ timeout: 60000 });
}

async function normalProof() {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/energy', log);
  await page.getByRole('heading', { name: /The load/i }).waitFor({ timeout: 90000 });

  await page.getByRole('button', { name: 'Choose a meter' }).first().click();
  await page.getByLabel('Add a meter').fill(meterName);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText(meterName).first().waitFor({ timeout: 60000 });
  log('meter created and selected:', meterName);

  await page.getByLabel('Watts now').fill('725');
  await page.getByRole('button', { name: /Sample/i }).click();
  await page.getByText('725').first().waitFor({ timeout: 30000 });
  log('live reading reconciled: 725 W');

  await clickView('Usage');
  const usageBefore = await pageLensRun(page, 'energy', 'reading-history', { days: 30 });
  const totalBefore = Number(usageBefore.result?.totalKwh || 0);
  await page.getByPlaceholder('kWh used').fill('12.5');
  await page.locator('input[type="date"]').first().fill(today);
  const readingLogged = page.waitForResponse((response) => {
    if (!/\/api\/lens\/run/.test(response.url()) || response.request().method() !== 'POST') return false;
    try {
      const body = JSON.parse(response.request().postData() || '{}');
      return body.domain === 'energy' && body.action === 'reading-log';
    } catch {
      return false;
    }
  });
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await readingLogged;
  const usageAfter = await pageLensRun(page, 'energy', 'reading-history', { days: 30 });
  const expectedTotal = Math.round((totalBefore + 12.5) * 100) / 100;
  if (usageAfter.result?.totalKwh !== expectedTotal) {
    throw new Error(`usage mutation did not add 12.5 kWh: ${JSON.stringify({ usageBefore, usageAfter }).slice(0, 700)}`);
  }
  await page.getByText(new RegExp(`${String(expectedTotal).replace('.', '\\.')} kWh`)).first().waitFor({ timeout: 30000 });

  await clickView('Devices');
  await page.getByRole('button', { name: /^Add$/ }).click();
  await page.getByPlaceholder('Device name').fill(deviceName);
  await page.locator('select').first().selectOption('hvac');
  await page.getByPlaceholder('Watts').fill('1800');
  await page.getByRole('button', { name: 'Add device' }).click();
  const deviceCard = page.locator('li', {
    has: page.getByRole('button', { name: 'Delete' }),
    hasText: deviceName,
  });
  await deviceCard.waitFor({ state: 'visible', timeout: 30000 });
  await deviceCard.getByRole('button', { name: /Log reading/i }).click();
  await deviceCard.getByPlaceholder('kWh').fill('4.2');
  await deviceCard.getByRole('button', { name: 'Save' }).click();
  await deviceCard.getByText(/4\.2 kWh logged/i).waitFor({ timeout: 30000 });

  await clickView('Solar');
  await page.getByPlaceholder('kWh produced').fill('6.4');
  await page.locator('input[type="date"]').first().fill(today);
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await fillLabel('Roof area', 1600);
  await fillLabel('Peak sun hours', 5.4);
  await fillLabel('Monthly usage', 700);
  await fillLabel('Electricity', 700);
  await fillLabel('Nat. gas', 20);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await page.getByText(/tons CO₂\/yr/i).waitFor({ timeout: 30000 });
  await saveVisibleDtu();

  await clickView('Billing');
  await page.getByPlaceholder('$/kWh').fill('0.21');
  await page.getByPlaceholder('Utility').fill('Proof utility');
  await page.getByRole('button', { name: /Save rate/i }).click();
  await page.getByPlaceholder('Label').fill(`October target ${stamp}`);
  await page.getByPlaceholder('Target kWh').fill('500');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await fillLabel('Peak $/kWh', 0.31);
  await fillLabel('Off-peak $/kWh', 0.12);
  await fillLabel('Peak start', 16);
  await fillLabel('Peak end', 21);
  await page.getByRole('button', { name: /Save plan|Update plan/ }).click();
  await page.getByRole('button', { name: 'Find cheapest window' }).click();
  await page.getByText(/Cheapest window|No rate data available/i).first().waitFor({ timeout: 30000 });

  await clickView('Insights');
  for (const range of ['7d', '30d', '90d']) {
    const button = page.getByRole('button', { name: range, exact: true });
    if (await button.count()) await button.click();
  }

  await clickView('Rates');
  await page.getByRole('button', { name: 'Load rates' }).click();
  await page.getByRole('button', { name: 'Load mix' }).click();
  await page.getByText(/EIA_API_KEY|EIA API key/i).first().waitFor({ timeout: 30000 });
  log('EIA operational gate surfaced honestly');

  await clickView('Grid');
  const gridInputs = page.locator('section').last().locator('input');
  if (await gridInputs.count()) {
    await fillLabel('Cost per kWh', 0.21);
    await fillLabel('Demand', 41000);
    await fillLabel('Capacity', 55000);
    await fillLabel('Renewable', 32);
    await fillLabel('Frequency', 60);
  }
  await page.getByRole('button', { name: 'Analyze' }).click();
  await page.getByText(/kWh total/i).waitFor({ timeout: 30000 });
  await saveVisibleDtu();

  await clickView('Share');
  await page.getByRole('button', { name: 'Load rate', exact: true }).click();
  await page.getByText(/EIA_API_KEY|EIA API key/i).first().waitFor({ timeout: 30000 });
  for (const label of ['Mint snapshot', 'DM household', 'Publish tips', 'Optimize (agent)', 'Copy CSV']) {
    const control = page.getByRole('button', { name: new RegExp(label, 'i') });
    if (await control.count()) {
      if (!(await control.isDisabled())) throw new Error(`${label} must stay disabled when live EIA data is unavailable`);
    }
  }

  await clickView('Now');
  await page.getByRole('button', { name: 'Change meter' }).click();
  await page.getByRole('button', { name: 'Close meter picker' }).click();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByText(meterName).first().waitFor({ timeout: 60000 });
  await page.getByText('725').first().waitFor({ timeout: 60000 });

  const devices = await pageLensRun(page, 'energy', 'device-list', {});
  const meter = devices.result?.devices?.find((device) => device.name === meterName);
  if (!meter?.id || meter.category !== 'meter') {
    throw new Error(`meter read-back failed: ${JSON.stringify(devices).slice(0, 400)}`);
  }
  const stream = await pageLensRun(page, 'energy', 'live-stream', { deviceId: meter.id, minutes: 120 });
  if (stream.result?.current !== 725) {
    throw new Error(`live stream read-back failed: ${JSON.stringify(stream).slice(0, 400)}`);
  }

  await page.screenshot({ path: shot('energy-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 393, height: 851 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('navigation', { name: 'Energy workspace' }).waitFor({ timeout: 60000 });
  await page.screenshot({ path: shot('energy-mobile.png'), fullPage: true });

  const result = { meterId: meter.id, meterName, watts: 725, survivedReload: true, allViewsVisited: true };
  writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  log('RESULT', JSON.stringify(result));
}

async function restartReadBack() {
  checkDisk(log);
  const expected = JSON.parse(readFileSync(RESULT_PATH, 'utf8'));
  await login(ctx, log);
  await gotoLens(page, '/lenses/energy', log);
  const devices = await pageLensRun(page, 'energy', 'device-list', {});
  const meter = devices.result?.devices?.find((device) => device.id === expected.meterId);
  if (!meter || meter.name !== expected.meterName || meter.category !== 'meter') {
    throw new Error(`meter did not survive backend restart: ${JSON.stringify(devices).slice(0, 500)}`);
  }
  const stream = await pageLensRun(page, 'energy', 'live-stream', { deviceId: meter.id, minutes: 360 });
  if (stream.result?.current !== expected.watts) {
    throw new Error(`reading did not survive backend restart: ${JSON.stringify(stream).slice(0, 500)}`);
  }
  log('RESTART READ-BACK PASSED', meter.id, stream.result.current);
}

try {
  if (process.env.PROOF_READBACK === '1') await restartReadBack();
  else await normalProof();
} catch (error) {
  log('PROOF FAILED:', error?.message || error);
  try { await page.screenshot({ path: shot('energy-failed.png'), fullPage: true }); } catch {}
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
