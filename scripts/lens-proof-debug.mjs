// Real Chrome proof for the Debug observability workspace.
// Records authored issues, measured traces, runtime metrics, alert rules, and
// releases, then proves browser reload, same-database backend restart, and mobile.
import { spawn } from 'node:child_process';
import { openSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BASE, chromium, mkLog, gotoLens, pageLensRun, shot, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('debug');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url));
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const user = `debugproof_${stamp}`;
const password = 'TestPass123!';
const issueMessage = `Observed failure ${stamp}`;
const releaseName = `debug-${stamp}`;
const alertName = `Latency guard ${stamp}`;
const dbPath = `/tmp/concord-debug-proof-${stamp}.db`;
const logPath = `/tmp/concord-debug-proof-${stamp}.log`;
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
      JWT_SECRET: 'debug-proof-jwt',
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
  const heading = page.getByRole('heading', { name: new RegExp(`^Observe the system, ${user}`, 'i') });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await heading.waitFor({ timeout: 60000 });
      return;
    } catch {
      if (attempt === 2) throw new Error('Debug workspace stayed on the shell loading screen');
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
if (await portUp()) throw new Error('port 5299 is occupied; Debug proof only restarts its own API');
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
  await gotoLens(page, '/lenses/debug', log);
  await waitForWorkspace(page);
  const acceptCookies = page.getByRole('button', { name: 'Accept', exact: true });
  if (await acceptCookies.isVisible().catch(() => false)) {
    await acceptCookies.click();
    const skipOnboarding = page.getByRole('button', { name: 'Skip onboarding' });
    await skipOnboarding.waitFor({ timeout: 10000 }).catch(() => {});
    if (await skipOnboarding.isVisible().catch(() => false)) await skipOnboarding.click();
  }
  await page.getByRole('navigation', { name: 'Debug tools' }).waitFor({ timeout: 60000 });
  await page.getByRole('heading', { name: 'System Status', exact: true }).waitFor({ timeout: 60000 });

  await openTool(page, 'Issues');
  await page.getByText(/authored issue record/i).waitFor();
  await page.getByPlaceholder('Error type').fill('TypeError');
  await page.getByPlaceholder('Exception message').fill(issueMessage);
  await page.getByPlaceholder('Culprit (file/fn)').fill(`debug-proof-${stamp}.tsx`);
  await page.getByPlaceholder('Release (e.g. v1.2.0)').fill(releaseName);
  await page.getByRole('button', { name: 'Record Exception' }).click();
  await page.getByText(issueMessage, { exact: true }).first().waitFor({ timeout: 60000 });

  await openTool(page, 'Traces');
  await page.getByRole('button', { name: 'Capture Trace' }).click();
  await page.getByText('lens.debug bootstrap', { exact: true }).first().waitFor({ timeout: 60000 });

  await openTool(page, 'Metrics');
  await page.getByRole('button', { name: 'Sample Runtime' }).click();
  await page.getByRole('button', { name: 'macro_latency_ms', exact: true }).waitFor({ timeout: 60000 });
  await page.getByPlaceholder('Rule name').fill(alertName);
  await page.getByPlaceholder('metric').fill('macro_latency_ms');
  await page.getByPlaceholder('threshold').fill('99999');
  await page.getByRole('button', { name: 'Create Alert Rule' }).click();
  await page.getByText(alertName, { exact: true }).waitFor({ timeout: 60000 });

  await openTool(page, 'Releases');
  await page.getByPlaceholder('Version (e.g. v1.4.0)').fill(releaseName);
  await page.getByPlaceholder('Release notes (optional)').fill('Recorded by the real Debug browser proof');
  await page.getByRole('button', { name: 'Track Release' }).click();
  await page.getByText(releaseName, { exact: true }).first().waitFor({ timeout: 60000 });
  await page.getByText('1').first().waitFor();

  await openTool(page, 'Events');
  await page.getByText(/Recent Events/).waitFor({ timeout: 60000 });
  await openTool(page, 'Logs');
  await page.getByText(/System Logs/).waitFor({ timeout: 60000 });

  await openTool(page, 'Inspector');
  await page.getByPlaceholder('Enter entity ID...').fill('missing-proof-object');
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.getByText(/missing-proof-object|not found|error/i).first().waitFor({ timeout: 60000 });

  await openTool(page, 'Context');
  await Promise.race([
    page.getByText('Context Inspector').waitFor({ timeout: 60000 }),
    page.getByRole('alert').waitFor({ timeout: 60000 }),
  ]);

  await openTool(page, 'Inference');
  await page.getByText(/Inference|SLO|Provenance/).first().waitFor({ timeout: 60000 });

  await openTool(page, 'CVE feed');
  await page.getByText('Real-world CVE feed').waitFor({ timeout: 60000 });
  await Promise.race([
    page.locator('a[href*="nvd.nist.gov/vuln/detail"]').first().waitFor({ timeout: 90000 }),
    page.getByText(/NVD API unreachable/).waitFor({ timeout: 90000 }),
  ]);

  await openTool(page, 'Compute');
  await page.getByText('Compute Engine').waitFor({ timeout: 60000 });
  await openTool(page, 'Templates');
  await page.getByRole('heading', { name: 'Lens Template Generator', exact: true }).waitFor({ timeout: 60000 });

  await openTool(page, 'Diagnostics');
  await page.getByText(/Named server diagnostics only/).waitFor();
  await page.getByRole('button', { name: 'DB Status' }).click();
  await page.getByText(/\$ db-status/).waitFor({ timeout: 60000 });
  if (await page.getByPlaceholder(/custom endpoint/i).count()) {
    throw new Error('fake arbitrary endpoint control still rendered');
  }

  await openTool(page, 'Live feed');
  await page.getByText(/not an external APM collector/i).waitFor();
  await page.screenshot({ path: shot('debug-desktop.png'), fullPage: true });

  const issues = await pageLensRun(page, 'debug', 'issue-list', {});
  const traces = await pageLensRun(page, 'debug', 'trace-list', {});
  const metrics = await pageLensRun(page, 'debug', 'metric-series', { metric: 'macro_latency_ms' });
  const alerts = await pageLensRun(page, 'debug', 'alert-list', {});
  const releases = await pageLensRun(page, 'debug', 'release-list', {});
  assertIncludes(issues.result?.issues, (item) => item.message === issueMessage, 'issue read-back failed');
  assertIncludes(traces.result?.traces, (item) => item.name === 'lens.debug bootstrap', 'trace read-back failed');
  if ((metrics.result?.stats?.count || 0) < 1) throw new Error('metric read-back failed');
  assertIncludes(alerts.result?.rules, (item) => item.name === alertName, 'alert read-back failed');
  assertIncludes(releases.result?.releases, (item) => item.version === releaseName, 'release read-back failed');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByText(/not an external APM collector/i).waitFor({ timeout: 90000 });
  log('active tool survived browser reload');

  await sleep(3000);
  await stopApi(api);
  api = startApi();
  await waitForPort(true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await waitForWorkspace(page);
  const afterRestart = await pageLensRun(page, 'debug', 'issue-list', {});
  const persistedIssue = afterRestart.result?.issues?.find((item) => item.message === issueMessage);
  if (!persistedIssue) throw new Error(`backend restart issue read-back failed: ${JSON.stringify(afterRestart).slice(0, 900)}`);
  await openTool(page, 'Issues');
  await page.getByText(issueMessage, { exact: true }).first().waitFor({ timeout: 90000 });
  log('backend restart read-back passed', persistedIssue.id);

  await page.setViewportSize({ width: 393, height: 851 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await waitForWorkspace(page);
  await page.getByRole('navigation', { name: 'Debug tools' }).waitFor({ timeout: 90000 });
  await page.getByText(issueMessage, { exact: true }).first().waitFor({ timeout: 90000 });
  await page.screenshot({ path: shot('debug-mobile.png'), fullPage: true });
  if (reactWarnings.length) throw new Error(`React duplicate-key warning remained: ${reactWarnings[0]}`);

  log('RESULT', JSON.stringify({
    issueId: persistedIssue.id,
    issueMessage,
    releaseName,
    alertName,
    survivedReload: true,
    survivedBackendRestart: true,
    mobile: true,
  }));
} catch (error) {
  log('PROOF FAILED:', error?.message || error);
  try { await page.screenshot({ path: shot('debug-failed.png'), fullPage: true }); } catch {}
  throw error;
} finally {
  await ctx.close();
  await browser.close();
  await stopApi(api);
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, logPath]) {
    try { rmSync(path); } catch {}
  }
}
