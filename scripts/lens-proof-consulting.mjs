// Real Chrome proof for the Consulting practice workspace.
// Exercises the persistent client-work loop, every surviving workspace tool,
// browser reload, same-database API restart, and a mobile viewport.
import { spawn } from 'node:child_process';
import { openSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BASE, chromium, mkLog, gotoLens, pageLensRun, shot, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('consulting');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url));
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const user = `consultingproof_${stamp}`;
const password = 'TestPass123!';
const engagementName = `Operating model ${stamp}`;
const clientName = `Acme ${stamp}`;
const proposalName = `Transformation proposal ${stamp}`;
const consultantName = `Advisor ${stamp}`;
const expenseName = `Workshop travel ${stamp}`;
const retainerName = `Advisory retainer ${stamp}`;
const deliverableName = `Board readout ${stamp}`;
const recordName = `Scope brief ${stamp}`;
const dbPath = `/tmp/concord-consulting-proof-${stamp}.db`;
const logPath = `/tmp/concord-consulting-proof-${stamp}.log`;
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
      JWT_SECRET: 'consulting-proof-jwt',
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

async function waitForApiReady(timeoutMs = 180000) {
  const started = Date.now();
  let consecutive = 0;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch('http://127.0.0.1:5299/api/status');
      consecutive = response.ok ? consecutive + 1 : 0;
      if (consecutive >= 3) return;
    } catch {
      consecutive = 0;
    }
    await sleep(1000);
  }
  throw new Error('Consulting proof API never reached a stable ready state');
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
  const heading = page.getByRole('heading', { name: new RegExp(`^Run the client work, ${user}`, 'i') });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await heading.waitFor({ timeout: 60000 });
      return;
    } catch {
      if (attempt === 2) throw new Error('Consulting workspace stayed on the shell loading screen');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
    }
  }
}

async function openTool(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
}

function assertIncludes(list, predicate, message) {
  if (!Array.isArray(list) || !list.some(predicate)) throw new Error(message);
}

checkDisk(log);
if (await portUp()) throw new Error('port 5299 is occupied; Consulting proof only restarts its own API');
let api = startApi();
await waitForPort(true);
await waitForApiReady();
log('api started', api.pid, dbPath);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const reactWarnings = [];
page.on('console', (message) => {
  if (message.type() === 'error') {
    const text = message.text();
    if (text.includes('same key')) reactWarnings.push(text);
    log('console error:', text.slice(0, 220));
  }
});

try {
  await register(ctx);
  await gotoLens(page, '/lenses/consulting', log);
  await waitForWorkspace(page);
  const acceptCookies = page.getByRole('button', { name: 'Accept', exact: true });
  if (await acceptCookies.isVisible().catch(() => false)) {
    await acceptCookies.click();
    const skipOnboarding = page.getByRole('button', { name: 'Skip onboarding' });
    await skipOnboarding.waitFor({ timeout: 10000 }).catch(() => {});
    if (await skipOnboarding.isVisible().catch(() => false)) await skipOnboarding.click();
  }
  await page.getByRole('navigation', { name: 'Consulting tools' }).waitFor({ timeout: 60000 });

  await page.getByPlaceholder('Engagement').fill(engagementName);
  await page.getByPlaceholder('client').fill(clientName);
  await page.getByPlaceholder('$/hr').fill('240');
  await page.getByPlaceholder('budget h').fill('80');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText(engagementName, { exact: true }).first().waitFor({ timeout: 60000 });
  await page.getByText(engagementName, { exact: true }).first().click();
  await page.getByPlaceholder('hours').fill('2.5');
  await page.getByPlaceholder('note').fill('Discovery workshop');
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await page.getByText('2.5h', { exact: true }).waitFor({ timeout: 60000 });

  await openTool(page, 'Timer');
  await page.locator('select').selectOption({ label: engagementName });
  await page.getByPlaceholder('What are you working on?').fill('Executive readout');
  await page.getByRole('button', { name: 'Start Timer' }).click();
  await page.getByRole('button', { name: 'Stop & Log' }).waitFor({ timeout: 60000 });
  await sleep(1200);
  await page.getByRole('button', { name: 'Stop & Log' }).click();
  await page.getByRole('button', { name: 'Start Timer' }).waitFor({ timeout: 60000 });

  await openTool(page, 'Invoices');
  await page.locator('select').selectOption({ label: engagementName });
  await page.getByPlaceholder('0', { exact: true }).fill('5');
  await page.getByPlaceholder('30', { exact: true }).fill('14');
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.getByText(/INV-0001/).waitFor({ timeout: 60000 });

  await openTool(page, 'Proposals');
  await page.getByRole('button', { name: 'New Proposal' }).click();
  await page.getByPlaceholder('Proposal title').fill(proposalName);
  await page.getByPlaceholder('Client').fill(clientName);
  await page.getByPlaceholder('Estimated value ($)').fill('48000');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByText(proposalName, { exact: true }).waitFor({ timeout: 60000 });
  await page.getByText(proposalName, { exact: true }).click();
  const proposalSection = page.getByPlaceholder('Write this section…').first();
  await proposalSection.fill('A measured operating-model redesign with weekly client checkpoints.');
  await proposalSection.blur();
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await page.getByPlaceholder('Signer full name').fill(`Client ${stamp}`);
  await page.getByRole('button', { name: 'Accept & Sign', exact: true }).click();
  await page.getByText('SIGNED', { exact: true }).waitFor({ timeout: 60000 });

  await openTool(page, 'Staffing');
  await page.getByPlaceholder('Consultant name').fill(consultantName);
  await page.getByPlaceholder('role').fill('Principal');
  await page.getByPlaceholder('cap h/wk').fill('40');
  await page.getByPlaceholder('$cost/h').fill('110');
  await page.getByRole('button', { name: 'Add Consultant' }).click();
  await page.locator('p').filter({ hasText: `${consultantName} · Principal` }).waitFor({ timeout: 60000 });
  const staffingSelects = page.locator('select');
  await staffingSelects.nth(0).selectOption({ label: consultantName });
  await staffingSelects.nth(1).selectOption({ label: engagementName });
  await page.getByPlaceholder('2026-W21').fill('2026-W41');
  await page.getByPlaceholder('hours').fill('24');
  await page.getByRole('button', { name: 'Allocate' }).click();
  await page.getByText(/2026-W41/).first().waitFor({ timeout: 60000 });

  await openTool(page, 'Expenses');
  await page.locator('select').selectOption({ label: engagementName });
  await page.getByPlaceholder('description').fill(expenseName);
  await page.getByPlaceholder('category').fill('Travel');
  await page.getByPlaceholder('$ amount').fill('185.50');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText(expenseName, { exact: true }).waitFor({ timeout: 60000 });
  await page.getByLabel('Advance status').click();
  await page.getByText('approved', { exact: true }).waitFor({ timeout: 60000 });

  await openTool(page, 'Retainers');
  await page.getByRole('button', { name: 'New Retainer' }).click();
  await page.getByPlaceholder('Client').fill(clientName);
  await page.getByPlaceholder('Label (optional)').fill(retainerName);
  await page.getByPlaceholder('Amount per period ($)').fill('6000');
  await page.getByPlaceholder('Included hours per period').fill('20');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByText(retainerName, { exact: true }).waitFor({ timeout: 60000 });
  await page.getByText(retainerName, { exact: true }).click();
  await page.getByPlaceholder('hours used').fill('12');
  await page.getByRole('button', { name: 'Bill Period' }).click();
  await page.getByText(/12h used/).waitFor({ timeout: 60000 });

  await openTool(page, 'Client portal');
  await page.getByRole('button', { name: 'Share Deliverable' }).click();
  await page.getByPlaceholder('Deliverable title').fill(deliverableName);
  await page.locator('select').selectOption({ label: engagementName });
  await page.getByPlaceholder('Client').fill(clientName);
  await page.getByPlaceholder('Summary').fill('Board-ready operating model findings.');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByText(deliverableName, { exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Record reply' }).click();
  await page.getByPlaceholder('Responded by').fill(`Client ${stamp}`);
  await page.getByPlaceholder('Note (optional)').fill('Approved after review');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByText('approved', { exact: true }).waitFor({ timeout: 60000 });

  await openTool(page, 'Profitability');
  await page.getByText(engagementName, { exact: true }).waitFor({ timeout: 60000 });

  await openTool(page, 'Fee & scope');
  await page.getByPlaceholder('Client').fill(clientName);
  await page.getByPlaceholder('$/hr').fill('240');
  await page.getByPlaceholder('Deliverable').fill('Operating model');
  await page.getByRole('button', { name: 'Estimate fee' }).click();
  await page.getByText('Grand total', { exact: true }).waitFor({ timeout: 60000 });

  await openTool(page, 'Utilization');
  await page.getByRole('button', { name: 'Calculate', exact: true }).click();
  await page.getByText('75%', { exact: true }).waitFor({ timeout: 60000 });

  await openTool(page, 'Readiness');
  const readinessChecks = page.locator('input[type="checkbox"]');
  await readinessChecks.nth(0).check();
  await readinessChecks.nth(1).check();
  await readinessChecks.nth(2).check();
  await page.getByRole('button', { name: 'Score proposal' }).click();
  await page.getByText('50%', { exact: true }).waitFor({ timeout: 60000 });

  await openTool(page, 'Client health');
  await page.getByPlaceholder('Client').fill(clientName);
  await page.getByRole('button', { name: 'Score client' }).click();
  await page.getByText(/Payment rate/).waitFor({ timeout: 60000 });

  await openTool(page, 'Engagement notes');
  await page.getByRole('button', { name: 'Create First' }).click();
  const recordEditor = page.locator('.fixed.inset-0').last();
  await recordEditor.locator('input').nth(0).fill(recordName);
  await recordEditor.locator('textarea').nth(0).fill('Persistent scope and fee assumptions.');
  await recordEditor.locator('input').nth(1).fill(clientName);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText(recordName, { exact: true }).waitFor({ timeout: 60000 });

  for (const toolName of ['Proposal archive', 'Deliverables', 'Client notes', 'Time records', 'Frameworks', 'Pipeline notes']) {
    await openTool(page, toolName);
    await page.getByText(/No .* items yet/).waitFor({ timeout: 60000 });
  }

  await openTool(page, 'Firm reference');
  await page.getByText(/en\.wikipedia\.org REST/).waitFor({ timeout: 60000 });

  await openTool(page, 'Live feed');
  await page.getByText(/not a client activity collector/i).waitFor();
  await openTool(page, 'Engagements');
  await page.getByText(engagementName, { exact: true }).first().waitFor({ timeout: 60000 });
  await page.screenshot({ path: shot('consulting-desktop.png'), fullPage: true });
  await openTool(page, 'Live feed');
  await page.getByText(/not a client activity collector/i).waitFor();

  const engagements = await pageLensRun(page, 'consulting', 'engagement-list', {});
  const invoices = await pageLensRun(page, 'consulting', 'invoice-list', {});
  const proposals = await pageLensRun(page, 'consulting', 'proposal-list', {});
  const staffing = await pageLensRun(page, 'consulting', 'staffing-plan', {});
  const expenses = await pageLensRun(page, 'consulting', 'expense-list', {});
  const retainers = await pageLensRun(page, 'consulting', 'retainer-list', {});
  const shares = await pageLensRun(page, 'consulting', 'portal-list', {});
  assertIncludes(engagements.result?.engagements, (item) => item.name === engagementName && item.timeEntries.length >= 2, 'engagement/time read-back failed');
  assertIncludes(invoices.result?.invoices, (item) => item.number === 'INV-0001', 'invoice read-back failed');
  assertIncludes(proposals.result?.proposals, (item) => item.title === proposalName && item.status === 'accepted', 'proposal read-back failed');
  assertIncludes(staffing.result?.rows, (item) => item.name === consultantName, 'staffing read-back failed');
  assertIncludes(expenses.result?.expenses, (item) => item.description === expenseName && item.status === 'approved', 'expense read-back failed');
  assertIncludes(retainers.result?.retainers, (item) => item.label === retainerName && item.periods.length === 1, 'retainer read-back failed');
  assertIncludes(shares.result?.shares, (item) => item.title === deliverableName && item.approvalStatus === 'approved', 'portal approval read-back failed');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByText(/not a client activity collector/i).waitFor({ timeout: 90000 });
  log('active tool survived browser reload');

  await sleep(3000);
  await stopApi(api);
  api = startApi();
  await waitForPort(true);
  await waitForApiReady();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await waitForWorkspace(page);
  const afterRestart = await pageLensRun(page, 'consulting', 'engagement-list', {});
  const persisted = afterRestart.result?.engagements?.find((item) => item.name === engagementName);
  if (!persisted || persisted.timeEntries.length < 2) {
    throw new Error(`backend restart engagement read-back failed: ${JSON.stringify(afterRestart).slice(0, 900)}`);
  }
  await openTool(page, 'Engagements');
  await page.getByText(engagementName, { exact: true }).first().waitFor({ timeout: 90000 });
  log('backend restart read-back passed', persisted.id);

  await page.setViewportSize({ width: 393, height: 851 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await waitForWorkspace(page);
  await page.getByRole('navigation', { name: 'Consulting tools' }).waitFor({ timeout: 90000 });
  await page.getByText(engagementName, { exact: true }).first().waitFor({ timeout: 90000 });
  await page.screenshot({ path: shot('consulting-mobile.png'), fullPage: true });
  if (reactWarnings.length) throw new Error(`React duplicate-key warning remained: ${reactWarnings[0]}`);

  log('RESULT', JSON.stringify({
    engagementId: persisted.id,
    engagementName,
    proposalName,
    invoice: 'INV-0001',
    survivedReload: true,
    survivedBackendRestart: true,
    mobile: true,
  }));
} catch (error) {
  log('PROOF FAILED:', error?.message || error);
  try { await page.screenshot({ path: shot('consulting-failed.png'), fullPage: true }); } catch {}
  throw error;
} finally {
  await ctx.close();
  await browser.close();
  await stopApi(api);
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, logPath]) {
    try { rmSync(path); } catch {}
  }
}
