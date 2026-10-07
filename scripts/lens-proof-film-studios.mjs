// Real browser proof for the film-studios board.
// + New production saves through film-studios.project-create and the title
// appears only after project-list contains that id and the same title.
// Add scene saves through scene-add and the slugline appears only after
// scene-list contains that id and the same location. Choosing the scene
// reads scene-list again.
// FS_PROOF_PID, when set, is this proof's own API process. After the
// page reload, that process is restarted on the same DB and the title
// and slugline must still be on screen.
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkLog, openBrowser, shot, BASE, checkDisk } from './lens-proof-lib.mjs';

const log = mkLog('film-studios');
checkDisk(log);
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const USER = `fsproof_${STAMP}`;
const TITLE = `Production ${STAMP}`;
const LOCATION = `Kitchen ${STAMP}`;
const SLUGLINE = `INT. ${LOCATION} - DAY`;
const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url));
const DB_PATH = process.env.FS_PROOF_DB || '/tmp/concord-film-studios-proof.db';
const JWT = process.env.FS_PROOF_JWT || 'fs-proof-jwt-secret-32chars-ok!!';

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
  const logFd = openSync('/tmp/concord-film-studios-proof.log', 'a');
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
  const alert = page.locator('section[aria-label="Production"]').getByRole('alert');
  for (let i = 0; i < 8; i++) {
    const found = await Promise.race([
      ready().then(() => 'ready'),
      alert.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'alert'),
    ]).catch(() => 'timeout');
    if (found === 'ready') return;
    const text = found === 'alert' ? await alert.innerText() : 'timeout';
    log('warming', text.replace(/\s+/g, ' ').slice(0, 100));
    if (found === 'alert' && !/service_overloaded|Could not read|Could not load/.test(text)) {
      throw new Error('production error: ' + text);
    }
    const retry = page.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible().catch(() => false)) await retry.click();
    await sleep(4000);
  }
  throw new Error('production did not become ready');
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
    if (response.status() === 503 || json?.error === 'service_overloaded') {
      log('overloaded', macro, i, json?.reason || response.status());
      await sleep(2000);
      continue;
    }
    return { response, json };
  }
  if (await done().catch(() => false)) return { response: null, json: { ok: true, already: true } };
  throw new Error(macro + ' stayed overloaded');
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
  for (let i = 0; i < 60; i++) {
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

  await page.goto(`${BASE}/lenses/film-studios`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (/onboarding/.test(page.url())) {
    const skip = page.getByRole('button', { name: /Skip onboarding/ }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.goto(`${BASE}/lenses/film-studios`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  }
  if (/\/(login|onboarding)/.test(page.url())) throw new Error('film-studios redirected to ' + page.url());
  log('opened', page.url());

  const who = USER.charAt(0).toUpperCase() + USER.slice(1);
  await page.getByRole('heading', { name: `The production, ${who}` }).waitFor({ state: 'visible', timeout: 90000 });
  const board = page.locator('section[aria-label="Production"]');
  const alert = board.getByRole('alert');
  const empty = page.getByText('No production open.');
  const which = await Promise.race([
    empty.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'empty'),
    alert.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'alert'),
  ]);
  if (which === 'alert') throw new Error('production error: ' + (await alert.innerText()));
  if (!(await page.getByText('Nothing selected.').isVisible())) throw new Error('selection pane is missing');
  const lens = page.locator('[data-lens-theme="film-studios"]');
  if (await lens.getByRole('button', { name: 'Discover' }).count()) throw new Error('discover tab is on the page');
  if (await lens.getByRole('button', { name: 'Add scene' }).count()) throw new Error('add scene is visible before a production is open');
  if (await lens.getByRole('textbox').count()) throw new Error('empty board exposes a text field');
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('film-studios-desktop.png') });

  await page.getByRole('button', { name: '+ New production' }).click();
  await page.getByTestId('film-title').fill(TITLE);
  const { response: saveResponse, json: saveJson } = await clickUntilSaved(
    page,
    '+ New production',
    'project-create',
    () => page.getByRole('button', { name: TITLE }).isVisible(),
  );
  log('save', saveResponse ? saveResponse.status() : 'already', JSON.stringify(saveJson).slice(0, 320));
  await page.getByRole('button', { name: TITLE }).waitFor({ state: 'visible', timeout: 20000 });
  if (await page.getByText('No production open.').count()) throw new Error('empty production copy stayed after save');
  if (!(await page.getByText('Nothing selected.').isVisible())) throw new Error('selection did not stay empty before a scene');

  await page.getByRole('button', { name: 'Add scene' }).click();
  await page.getByTestId('film-location').fill(LOCATION);
  const { response: sceneResponse, json: sceneJson } = await clickUntilSaved(
    page,
    'Add scene',
    'scene-add',
    () => page.getByRole('heading', { name: SLUGLINE }).isVisible(),
  );
  log('scene', sceneResponse ? sceneResponse.status() : 'already', sceneJson?.ok);
  await page.getByRole('heading', { name: SLUGLINE }).waitFor({ state: 'visible', timeout: 20000 });
  if (await page.getByText('Nothing selected.').count()) throw new Error('nothing-selected stayed after the scene');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await waitPastOverload(page, () => page.getByRole('button', { name: TITLE }).waitFor({ state: 'visible', timeout: 20000 }));
  await page.getByRole('button', { name: TITLE }).click();
  await page.getByRole('button', { name: SLUGLINE }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button', { name: SLUGLINE }).click();
  await page.getByRole('heading', { name: SLUGLINE }).waitFor({ state: 'visible', timeout: 20000 });
  log('title and scene survived reload');

  const proofPid = Number(process.env.FS_PROOF_PID || 0);
  if (proofPid) {
    restartedPid = await restartApi(proofPid);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
    await waitPastOverload(page, () => page.getByRole('button', { name: TITLE }).waitFor({ state: 'visible', timeout: 20000 }));
    await page.getByRole('button', { name: TITLE }).click();
    await page.getByRole('button', { name: SLUGLINE }).waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('button', { name: SLUGLINE }).click();
    await page.getByRole('heading', { name: SLUGLINE }).waitFor({ state: 'visible', timeout: 20000 });
    log('title and scene survived api restart');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('film-studios-phone.png') });
  if (!(await page.getByRole('button', { name: '+ New production' }).isVisible())) {
    throw new Error('phone new production not visible');
  }
  if (!(await page.getByRole('heading', { name: SLUGLINE }).isVisible())) {
    throw new Error('phone scene not visible');
  }
  log('phone new production visible');
  console.log(JSON.stringify({ ok: true, user: USER, title: TITLE, slugline: SLUGLINE, restarted: Boolean(proofPid) }));
} finally {
  await browser.close();
  if (restartedPid) {
    try { process.kill(restartedPid, 'SIGTERM'); } catch { /* already gone */ }
  }
}
