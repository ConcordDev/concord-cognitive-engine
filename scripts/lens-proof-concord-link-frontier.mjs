// Real browser proof for the frontier link.
// Open, set a bearing, edit it, and mark the link through
// concord-link-frontier link-open, link-bearing, and link-mark.
// The bearing and the mark appear only after link-detail. A second
// link stays on the board. CLF_PROOF_PID, when set, is this proof's
// own API process. After the worker flow, that process is restarted
// on the same DB and the board must still be on screen.
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkLog, openBrowser, shot, BASE, checkDisk } from './lens-proof-lib.mjs';

const log = mkLog('concord-link-frontier');
checkDisk(log);
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const USER = `clfproof_${STAMP}`;
const NAME = `Gate ${STAMP}`;
const BEARING = `North ${STAMP}`;
const EDITED = `Moved ${STAMP}`;
const NAME_B = `Span ${STAMP}`;
const MARK = `Hinge ${STAMP}`;
const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url));
const DB_PATH = process.env.CLF_PROOF_DB || '/tmp/concord-link-frontier-proof.db';
const JWT = process.env.CLF_PROOF_JWT || 'clf-proof-jwt-secret-32chars-ok!!';

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
  const logFd = openSync('/tmp/concord-link-frontier-proof.log', 'a');
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
  const alert = page.locator('section[aria-label="Link"]').getByRole('alert');
  for (let i = 0; i < 12; i++) {
    const found = await Promise.race([
      ready().then(() => 'ready'),
      alert.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'alert'),
    ]).catch(() => 'timeout');
    if (found === 'ready') return;
    const text = found === 'alert' ? await alert.innerText() : 'timeout';
    log('warming', text.replace(/\s+/g, ' ').slice(0, 120));
    if (found === 'alert' && !/service_overloaded|Could not read|Could not load/.test(text)) {
      throw new Error('link error: ' + text);
    }
    const retry = page.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible().catch(() => false)) await retry.click();
    await sleep(4000);
  }
  throw new Error('frontier link did not become ready');
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
    await page.getByRole('button', { name: buttonName, exact: true }).click({ timeout: 5000 }).catch(() => {});
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
      data: { domain: 'concord-link-frontier', action: 'link-list', input: {} },
      timeout: 30000,
    }).catch(() => null);
    if (!response) {
      log('link-list no response', i);
      await sleep(2000);
      continue;
    }
    const json = await response.json().catch(() => ({}));
    if (response.status() === 200 && json?.ok !== false && json?.error !== 'service_overloaded') {
      log('link-list admitted', i);
      return;
    }
    log('link-list shed', response.status(), json?.reason || json?.error || '', json?.lagMs || '');
    await sleep(2000);
  }
  throw new Error('link-list stayed shed');
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
      await page.goto(`${BASE}/lenses/concord-link-frontier`, { waitUntil: 'domcontentloaded', timeout: 180000 });
      return;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      log('reload retry', i, last.slice(0, 160));
      await sleep(2000);
    }
  }
  throw new Error(last);
}

async function openOne(page, name) {
  await page.getByRole('button', { name: 'Open the link', exact: true }).click();
  await page.getByTestId('clf-name').fill(name);
  const saved = await clickUntilSaved(
    page,
    'Open this',
    'link-open',
    () => page.getByRole('heading', { name, level: 2 }).isVisible(),
  );
  log('open', name, saved.response ? saved.response.status() : 'already', JSON.stringify(saved.json).slice(0, 240));
  await page.getByRole('heading', { name, level: 2 }).waitFor({ state: 'visible', timeout: 20000 });
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
  if (/\/(login|onboarding)/.test(page.url())) throw new Error('frontier redirected to ' + page.url());
  log('opened', page.url());

  const who = USER.charAt(0).toUpperCase() + USER.slice(1);
  await page.getByRole('heading', { name: `The frontier link, ${who}` }).waitFor({ state: 'visible', timeout: 90000 });
  await waitPastOverload(page, () => page.getByText('No link open.').waitFor({ state: 'visible', timeout: 20000 }));
  const lens = page.locator('[data-lens-theme="concord-link-frontier"]');
  if (await lens.getByRole('textbox').count()) throw new Error('empty card exposes a text field');
  if (await lens.getByText('Royalty flow').count()) throw new Error('royalty ledger is on the card');
  if (await lens.getByText('Cross-world feed').count()) throw new Error('feed is on the card');
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});

  await openOne(page, NAME);
  if (await page.getByText('No link open.').count()) throw new Error('empty copy stayed after open');
  if (await page.getByTestId('clf-bearing').count()) throw new Error('bearing showed before it was set');

  await page.getByRole('button', { name: 'Set the bearing' }).click();
  await page.getByTestId('clf-bearing-input').fill(BEARING);
  const set = await clickUntilSaved(
    page,
    'Save the bearing',
    'link-bearing',
    () => page.getByText(BEARING).isVisible(),
  );
  log('bearing', set.response ? set.response.status() : 'already');
  await page.getByText(BEARING).waitFor({ state: 'visible', timeout: 20000 });

  await page.getByRole('button', { name: 'Edit the bearing' }).click();
  await page.getByTestId('clf-bearing-input').fill(EDITED);
  const edited = await clickUntilSaved(
    page,
    'Save the bearing',
    'link-bearing',
    () => page.getByText(EDITED).isVisible(),
  );
  log('edit', edited.response ? edited.response.status() : 'already');
  await page.getByText(EDITED).waitFor({ state: 'visible', timeout: 20000 });
  if (await page.getByText(BEARING).count()) throw new Error('old bearing stayed after edit');

  await page.getByRole('button', { name: 'Mark the link' }).click();
  await page.getByTestId('clf-mark-input').fill(MARK);
  const marked = await clickUntilSaved(
    page,
    'Save the mark',
    'link-mark',
    () => page.getByText(MARK).isVisible(),
  );
  log('mark', marked.response ? marked.response.status() : 'already');
  await page.getByText(MARK).waitFor({ state: 'visible', timeout: 20000 });

  await openOne(page, NAME_B);
  await page.getByRole('button', { name: NAME }).click();
  await page.getByText(EDITED).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText(MARK).waitFor({ state: 'visible', timeout: 20000 });
  if (!(await page.getByRole('button', { name: NAME_B }).isVisible())) throw new Error('second link left the board');
  log('worker flow read back');

  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('concord-link-frontier-desktop.png') });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 }).catch(async (err) => {
    log('reload failed', String(err).slice(0, 160));
    await openLens(page);
  });
  await waitPastOverload(page, () => page.getByRole('button', { name: NAME_B }).waitFor({ state: 'visible', timeout: 30000 }));
  await page.getByRole('button', { name: NAME }).click();
  await page.getByText(EDITED).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText(MARK).waitFor({ state: 'visible', timeout: 20000 });
  log('board survived reload');

  const proofPid = Number(process.env.CLF_PROOF_PID || 0);
  if (proofPid) {
    restartedPid = await restartApi(proofPid);
    await waitUntilList(ctx.request);
    await openLens(page);
    await waitPastOverload(page, () => page.getByRole('button', { name: NAME_B }).waitFor({ state: 'visible', timeout: 30000 }));
    await page.getByRole('button', { name: NAME }).click();
    await page.getByText(EDITED).waitFor({ state: 'visible', timeout: 20000 });
    await page.getByText(MARK).waitFor({ state: 'visible', timeout: 20000 });
    log('board survived api restart');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('concord-link-frontier-phone.png') });
  if (!(await page.getByRole('button', { name: 'Open the link', exact: true }).isVisible())) throw new Error('phone Open the link not visible');
  if (!(await page.getByText(EDITED).isVisible())) throw new Error('phone bearing not visible');
  if (!(await page.getByText(MARK).isVisible())) throw new Error('phone mark not visible');
  if (!(await page.getByRole('button', { name: NAME_B }).isVisible())) throw new Error('phone second link not visible');
  log('phone Open the link visible');
  console.log(JSON.stringify({
    ok: true,
    user: USER,
    name: NAME,
    edited: EDITED,
    next: NAME_B,
    mark: MARK,
    restarted: Boolean(proofPid),
  }));
} finally {
  await browser.close();
  if (restartedPid) {
    try { process.kill(restartedPid, 'SIGTERM'); } catch { /* already gone */ }
  }
}
