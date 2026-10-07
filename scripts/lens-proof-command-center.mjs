// Real browser proof for the command center alert desk.
// File, edit, and acknowledge round-trip through command-center
// alert-file, alert-edit, and alert-acknowledge. The line and the
// note appear only after alert-detail. Refresh re-reads. CC_PROOF_PID,
// when set, is this proof's own API process. After the worker flow,
// that process is restarted on the same DB and the queue must still
// be on screen.
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkLog, openBrowser, shot, BASE, checkDisk } from './lens-proof-lib.mjs';

const log = mkLog('command-center');
checkDisk(log);
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const USER = `ccproof_${STAMP}`;
const TITLE = `Alert ${STAMP}`;
const LINE = `Line ${STAMP}`;
const EDITED = `Edited ${STAMP}`;
const TITLE_B = `Next ${STAMP}`;
const LINE_B = `Queue ${STAMP}`;
const NOTE = `Ack ${STAMP}`;
const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url));
const DB_PATH = process.env.CC_PROOF_DB || '/tmp/concord-command-center-proof.db';
const JWT = process.env.CC_PROOF_JWT || 'cc-proof-jwt-secret-32chars-ok!!';

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
  const logFd = openSync('/tmp/concord-command-center-proof.log', 'a');
  const child = spawn(
    process.execPath,
    ['--max-old-space-size=2048', '--expose-gc', 'server.js'],
    {
      cwd: SERVER_DIR,
      env: { ...process.env, DB_PATH, PORT: '5299', NODE_ENV: 'development', JWT_SECRET: JWT },
      stdio: ['ignore', logFd, logFd],
      detached: true,
    },
  );
  child.unref();
  return child.pid;
}

async function waitPastOverload(page, ready) {
  const alert = page.locator('section[aria-label="Alert"]').getByRole('alert');
  for (let i = 0; i < 12; i++) {
    const found = await Promise.race([
      ready().then(() => 'ready'),
      alert.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'alert'),
    ]).catch(() => 'timeout');
    if (found === 'ready') return;
    const text = found === 'alert' ? await alert.innerText() : 'timeout';
    log('warming', text.replace(/\s+/g, ' ').slice(0, 120));
    if (found === 'alert' && !/service_overloaded|Could not read|Could not load/.test(text)) {
      throw new Error('alert error: ' + text);
    }
    const retry = page.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible().catch(() => false)) await retry.click();
    await sleep(4000);
  }
  throw new Error('alert desk did not become ready');
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
      data: { domain: 'command-center', action: 'alert-list', input: {} },
      timeout: 30000,
    }).catch(() => null);
    if (!response) {
      log('alert-list no response', i);
      await sleep(2000);
      continue;
    }
    const json = await response.json().catch(() => ({}));
    if (response.status() === 200 && json?.ok !== false && json?.error !== 'service_overloaded') {
      log('alert-list admitted', i);
      return;
    }
    log('alert-list shed', response.status(), json?.reason || json?.error || '', json?.lagMs || '');
    await sleep(2000);
  }
  throw new Error('alert-list stayed shed');
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

async function openLens(page) {
  let last = 'reload failed';
  for (let i = 0; i < 6; i++) {
    try {
      await page.goto(`${BASE}/lenses/command-center`, { waitUntil: 'domcontentloaded', timeout: 180000 });
      return;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      log('reload retry', i, last.slice(0, 160));
      await sleep(2000);
    }
  }
  throw new Error(last);
}

async function fileOne(page, title, lineText) {
  await page.getByRole('button', { name: 'File an alert' }).click();
  await page.getByTestId('cc-title').fill(title);
  await page.getByTestId('cc-line-input').fill(lineText);
  const saved = await clickUntilSaved(
    page,
    'Put it in front',
    'alert-file',
    () => page.getByRole('heading', { name: title, level: 2 }).isVisible(),
  );
  log('file', title, saved.response ? saved.response.status() : 'already', JSON.stringify(saved.json).slice(0, 240));
  await page.getByRole('heading', { name: title, level: 2 }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText(lineText).waitFor({ state: 'visible', timeout: 20000 });
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

  await openLens(page);
  if (/onboarding/.test(page.url())) {
    const skip = page.getByRole('button', { name: /Skip onboarding/ }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await openLens(page);
  }
  if (/\/(login|onboarding)/.test(page.url())) throw new Error('command center redirected to ' + page.url());
  log('opened', page.url());

  const who = USER.charAt(0).toUpperCase() + USER.slice(1);
  await page.getByRole('heading', { name: `The one alert, ${who}` }).waitFor({ state: 'visible', timeout: 90000 });
  await waitPastOverload(page, () => page.getByText('No alert in front of you.').waitFor({ state: 'visible', timeout: 20000 }));
  const lens = page.locator('[data-lens-theme="command-center"]');
  if (await lens.getByRole('textbox').count()) throw new Error('empty card exposes a text field');
  if (await lens.getByText('Ops Cockpit').count()) throw new Error('ops cockpit is on the card');
  if (await lens.getByText('Vitals').count()) throw new Error('vitals tab is on the card');
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('command-center-desktop.png') });

  await fileOne(page, TITLE, LINE);
  if (await page.getByText('No alert in front of you.').count()) throw new Error('empty copy stayed after file');

  await page.getByRole('button', { name: 'Edit the line' }).click();
  await page.getByTestId('cc-edit-line').fill(EDITED);
  const edited = await clickUntilSaved(
    page,
    'Save the line',
    'alert-edit',
    () => page.getByText(EDITED).isVisible(),
  );
  log('edit', edited.response ? edited.response.status() : 'already');
  await page.getByText(EDITED).waitFor({ state: 'visible', timeout: 20000 });
  if (await page.getByText(LINE).count()) throw new Error('old line stayed after edit');

  await fileOne(page, TITLE_B, LINE_B);
  await page.getByRole('heading', { name: TITLE, level: 2 }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button', { name: TITLE }).click();
  await page.getByText(EDITED).waitFor({ state: 'visible', timeout: 20000 });

  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await page.getByTestId('cc-ack-input').fill(NOTE);
  const acked = await clickUntilSaved(
    page,
    'Save the acknowledgement',
    'alert-acknowledge',
    () => page.getByText(NOTE).isVisible(),
  );
  log('ack', acked.response ? acked.response.status() : 'already');
  await page.getByText(NOTE).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText('Acknowledged').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('cc-front').waitFor({ state: 'visible', timeout: 20000 });
  const frontText = await page.getByTestId('cc-front').innerText();
  if (frontText.trim() !== TITLE_B) throw new Error('front stayed on the acknowledged alert: ' + frontText);

  await page.getByRole('button', { name: 'Refresh' }).click();
  await waitPastOverload(page, () => page.getByTestId('cc-front').waitFor({ state: 'visible', timeout: 20000 }));
  if ((await page.getByTestId('cc-front').innerText()).trim() !== TITLE_B) throw new Error('refresh lost the front alert');
  await page.getByRole('button', { name: TITLE }).click();
  await page.getByText(EDITED).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText(NOTE).waitFor({ state: 'visible', timeout: 20000 });
  log('worker flow read back');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 }).catch(async (err) => {
    log('reload failed', String(err).slice(0, 160));
    await openLens(page);
  });
  await waitPastOverload(page, () => page.getByTestId('cc-front').waitFor({ state: 'visible', timeout: 30000 }));
  if ((await page.getByTestId('cc-front').innerText()).trim() !== TITLE_B) throw new Error('reload lost the front alert');
  await page.getByRole('button', { name: TITLE }).click();
  await page.getByText(EDITED).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText(NOTE).waitFor({ state: 'visible', timeout: 20000 });
  log('queue survived reload');

  const proofPid = Number(process.env.CC_PROOF_PID || 0);
  if (proofPid) {
    restartedPid = await restartApi(proofPid);
    await waitUntilList(ctx.request);
    await openLens(page);
    await waitPastOverload(page, () => page.getByTestId('cc-front').waitFor({ state: 'visible', timeout: 30000 }));
    if ((await page.getByTestId('cc-front').innerText()).trim() !== TITLE_B) throw new Error('restart lost the front alert');
    await page.getByRole('button', { name: TITLE }).click();
    await page.getByText(EDITED).waitFor({ state: 'visible', timeout: 20000 });
    await page.getByText(NOTE).waitFor({ state: 'visible', timeout: 20000 });
    await page.getByText('Acknowledged').waitFor({ state: 'visible', timeout: 20000 });
    log('queue survived api restart');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('command-center-phone.png') });
  if (!(await page.getByRole('button', { name: 'Refresh' }).isVisible())) throw new Error('phone refresh not visible');
  if (!(await page.getByTestId('cc-front').isVisible())) throw new Error('phone front not visible');
  if (!(await page.getByText(NOTE).isVisible())) throw new Error('phone note not visible');
  log('phone refresh visible');
  console.log(JSON.stringify({
    ok: true,
    user: USER,
    title: TITLE,
    edited: EDITED,
    next: TITLE_B,
    note: NOTE,
    restarted: Boolean(proofPid),
  }));
} finally {
  await browser.close();
  if (restartedPid) {
    try { process.kill(restartedPid, 'SIGTERM'); } catch { /* already gone */ }
  }
}
