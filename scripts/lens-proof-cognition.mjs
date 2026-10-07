// Real browser proof for the cognition card.
// Open a trace saves through cognition.exportTrace. The title appears
// only after listExports contains that id and the same title. The
// question appears only after getExport returns it on the stored trace.
// CG_PROOF_PID, when set, is this proof's own API process. After the
// page reload, that process is restarted on the same DB and the title
// and question must still be on screen.
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkLog, openBrowser, shot, BASE, checkDisk } from './lens-proof-lib.mjs';

const log = mkLog('cognition');
checkDisk(log);
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const USER = `cgproof_${STAMP}`;
const TITLE = `Trace ${STAMP}`;
const QUESTION = `Question ${STAMP}`;
const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url));
const DB_PATH = process.env.CG_PROOF_DB || '/tmp/concord-cognition-proof.db';
const JWT = process.env.CG_PROOF_JWT || 'cg-proof-jwt-secret-32chars-ok!!';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function portUp() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  try {
    await run('lsof', ['-nP', '-iTCP:5299', '-sTCP:LISTEN']);
    return true;
  } catch {
    return false;
  }
}

function startApi() {
  const logFd = openSync('/tmp/concord-cognition-proof.log', 'a');
  const child = spawn(
    process.execPath,
    ['--max-old-space-size=2048', '--expose-gc', 'server.js'],
    {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        DB_PATH,
        PORT: '5299',
        NODE_ENV: 'development',
        JWT_SECRET: JWT,
      },
      stdio: ['ignore', logFd, logFd],
      detached: true,
    },
  );
  child.unref();
  return child.pid;
}

async function waitPastOverload(page, ready) {
  const alert = page.locator('section[aria-label="Trace"]').getByRole('alert');
  for (let i = 0; i < 12; i++) {
    const found = await Promise.race([
      ready().then(() => 'ready'),
      alert.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'alert'),
    ]).catch(() => 'timeout');
    if (found === 'ready') return;
    const text = found === 'alert' ? await alert.innerText() : 'timeout';
    log('warming', text.replace(/\s+/g, ' ').slice(0, 120));
    if (found === 'alert' && !/service_overloaded|Could not read|Could not load/.test(text)) {
      throw new Error('trace error: ' + text);
    }
    const retry = page.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible().catch(() => false)) await retry.click();
    await sleep(4000);
  }
  throw new Error('trace did not become ready');
}

async function clickUntilSaved(page, buttonName, macro, done) {
  for (let i = 0; i < 8; i++) {
    if (await done().catch(() => false)) return { response: null, json: { ok: true, already: true } };
    await page.waitForFunction((name) => {
      const button = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes(name));
      return Boolean(button && !button.disabled);
    }, buttonName, { timeout: 20000 }).catch(() => {});
    if (await done().catch(() => false)) return { response: null, json: { ok: true, already: true } };
    const pending = page.waitForResponse((response) => {
      if (!response.url().includes('/api/lens/run') || response.request().method() !== 'POST') return false;
      return (response.request().postData() || '').includes(macro);
    }, { timeout: 20000 }).catch(() => null);
    await page.getByRole('button', { name: buttonName }).click({ timeout: 5000 }).catch(() => {});
    const response = await pending;
    if (!response) {
      log('no response', macro, i);
      await sleep(2000);
      continue;
    }
    const json = await response.json().catch(() => ({}));
    if (response.status() === 503 || response.status() >= 500 || json?.error === 'service_overloaded') {
      log('overloaded', macro, i, json?.error || json?.reason || response.status());
      await sleep(2000);
      continue;
    }
    return { response, json };
  }
  if (await done().catch(() => false)) return { response: null, json: { ok: true, already: true } };
  throw new Error(macro + ' stayed overloaded');
}

async function waitUntilList(request) {
  for (let i = 0; i < 30; i++) {
    const response = await request.post(`${BASE}/api/lens/run`, {
      data: { domain: 'cognition', action: 'listExports', input: {} },
      timeout: 30000,
    }).catch(() => null);
    if (!response) {
      log('listExports no response', i);
      await sleep(2000);
      continue;
    }
    const json = await response.json().catch(() => ({}));
    if (response.status() === 200 && json?.ok !== false && json?.error !== 'service_overloaded') {
      log('listExports admitted', i);
      return;
    }
    log('listExports shed', response.status(), json?.reason || json?.error || '', json?.lagMs || '');
    await sleep(2000);
  }
  throw new Error('listExports stayed shed');
}

async function restartApi(pid) {
  if (!pid) throw new Error('no proof server pid to restart');
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 40; i++) {
    if (!(await portUp())) break;
    await sleep(250);
  }
  if (await portUp()) {
    process.kill(pid, 'SIGKILL');
    for (let i = 0; i < 20; i++) {
      if (!(await portUp())) break;
      await sleep(250);
    }
  }
  if (await portUp()) throw new Error('5299 still listening after stopping the proof server');
  const next = startApi();
  log('restarted api', next);
  for (let i = 0; i < 90; i++) {
    if (await portUp()) return next;
    await sleep(2000);
  }
  throw new Error('restarted api did not listen');
}

const { browser, ctx, page } = await openBrowser(log);
let restartedPid = null;
try {
  const reg = await ctx.request.post(`${BASE}/api/auth/register`, {
    data: {
      username: USER,
      email: `${USER}@example.com`,
      password: 'TestPass123!',
      dateOfBirth: '1990-01-01',
    },
    timeout: 120000,
  });
  const regBody = await reg.json().catch(() => ({}));
  log('register', reg.status(), regBody?.ok, regBody?.error || '');
  if (!regBody?.ok) throw new Error('register failed: ' + (regBody?.error || reg.status()));
  await waitUntilList(ctx.request);

  await page.goto(`${BASE}/lenses/cognition`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (/onboarding/.test(page.url())) {
    const skip = page.getByRole('button', { name: /Skip onboarding/ }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.goto(`${BASE}/lenses/cognition`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  }
  if (/\/(login|onboarding)/.test(page.url())) throw new Error('cognition redirected to ' + page.url());
  log('opened', page.url());

  const who = USER.charAt(0).toUpperCase() + USER.slice(1);
  await page.getByRole('heading', { name: `The trace, ${who}` }).waitFor({ state: 'visible', timeout: 90000 });
  const empty = page.getByText('No trace yet.');
  await waitPastOverload(page, () => empty.waitFor({ state: 'visible', timeout: 20000 }));
  const lens = page.locator('[data-lens-theme="cognition"]');
  if (await lens.getByRole('button', { name: 'Reasoning' }).count()) throw new Error('reasoning tab is on the page');
  if (await lens.getByRole('button', { name: 'Drift' }).count()) throw new Error('drift tab is on the page');
  if (await lens.getByRole('textbox').count()) throw new Error('empty card exposes a text field');
  if ((await page.getByTestId('cg-rule').count()) !== 3) throw new Error('empty card is missing its three rules');
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('cognition-desktop.png') });

  await page.getByRole('button', { name: 'Open a trace' }).click();
  await page.getByTestId('cg-title').fill(TITLE);
  await page.getByTestId('cg-question-input').fill(QUESTION);
  const { response: saveResponse, json: saveJson } = await clickUntilSaved(
    page,
    'Open a trace',
    'exportTrace',
    () => page.getByRole('heading', { name: TITLE }).isVisible(),
  );
  log('save', saveResponse ? saveResponse.status() : 'already', JSON.stringify(saveJson).slice(0, 400));
  await page.getByRole('heading', { name: TITLE }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText(QUESTION).waitFor({ state: 'visible', timeout: 20000 });
  if (await page.getByText('No trace yet.').count()) throw new Error('empty copy stayed after save');
  if (await page.getByText('abductive').count()) throw new Error('mode default is on the card');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await waitPastOverload(page, () => page.getByRole('heading', { name: TITLE }).waitFor({ state: 'visible', timeout: 20000 }));
  await page.getByText(QUESTION).waitFor({ state: 'visible', timeout: 20000 });
  log('title and question survived reload');

  const proofPid = Number(process.env.CG_PROOF_PID || 0);
  if (proofPid) {
    restartedPid = await restartApi(proofPid);
    await waitUntilList(ctx.request);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
    await waitPastOverload(page, () => page.getByRole('heading', { name: TITLE }).waitFor({ state: 'visible', timeout: 30000 }));
    await page.getByText(QUESTION).waitFor({ state: 'visible', timeout: 20000 });
    log('title and question survived api restart');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('cognition-phone.png') });
  if (!(await page.getByRole('button', { name: 'Open a trace' }).isVisible())) {
    throw new Error('phone open trace not visible');
  }
  if (!(await page.getByRole('heading', { name: TITLE }).isVisible())) {
    throw new Error('phone title not visible');
  }
  if (!(await page.getByText(QUESTION).isVisible())) {
    throw new Error('phone question not visible');
  }
  log('phone open trace visible');
  console.log(JSON.stringify({ ok: true, user: USER, title: TITLE, question: QUESTION, restarted: Boolean(proofPid) }));
} finally {
  await browser.close();
  if (restartedPid) {
    try { process.kill(restartedPid, 'SIGTERM'); } catch { /* already gone */ }
  }
}
