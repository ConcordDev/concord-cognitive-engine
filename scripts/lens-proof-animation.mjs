// Real browser proof for the animation shot.
// + New shot saves through animation.anim-create and the title appears
// only after anim-list contains that id and the same title.
// ANIM_PROOF_PID, when set, is this proof's own API process. After the
// page reload, that process is restarted on the same DB and the title
// must still be on screen.
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkLog, openBrowser, shot, BASE, checkDisk } from './lens-proof-lib.mjs';

const log = mkLog('animation');
checkDisk(log);
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const USER = `animproof_${STAMP}`;
const TITLE = `Shot ${STAMP}`;
const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url));
const DB_PATH = process.env.ANIM_PROOF_DB || '/tmp/concord-animation-proof.db';

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
  const logFd = openSync('/tmp/concord-animation-proof.log', 'a');
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
        JWT_SECRET: process.env.ANIM_PROOF_JWT || 'anim-proof-jwt',
      },
      stdio: ['ignore', logFd, logFd],
      detached: true,
    },
  );
  child.unref();
  return child.pid;
}

async function waitPastOverload(page, ready) {
  const alert = page.locator('section[aria-label="Shot"]').getByRole('alert');
  for (let i = 0; i < 8; i++) {
    const found = await Promise.race([
      ready().then(() => 'ready'),
      alert.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'alert'),
    ]).catch(() => 'timeout');
    if (found === 'ready') return;
    const text = found === 'alert' ? await alert.innerText() : 'timeout';
    log('warming', text.replace(/\s+/g, ' ').slice(0, 100));
    if (found === 'alert' && !/service_overloaded|Could not read|Could not load/.test(text)) {
      throw new Error('shot error: ' + text);
    }
    const retry = page.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible().catch(() => false)) await retry.click();
    await sleep(4000);
  }
  throw new Error('shot did not become ready');
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

  await page.goto(`${BASE}/lenses/animation`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (/onboarding/.test(page.url())) {
    const skip = page.getByRole('button', { name: /Skip onboarding/ }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.goto(`${BASE}/lenses/animation`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  }
  if (/\/(login|onboarding)/.test(page.url())) throw new Error('animation redirected to ' + page.url());
  log('opened', page.url());

  const who = USER.charAt(0).toUpperCase() + USER.slice(1);
  await page.getByRole('heading', { name: `The shot, ${who}` }).waitFor({ state: 'visible', timeout: 90000 });
  const bench = page.locator('section[aria-label="Shot"]');
  const alert = bench.getByRole('alert');
  const empty = page.getByText('No shot open.');
  const which = await Promise.race([
    empty.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'empty'),
    alert.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'alert'),
  ]);
  if (which === 'alert') throw new Error('shot error: ' + (await alert.innerText()));
  if (await page.getByRole('button', { name: 'Studio' }).count()) throw new Error('studio tab is on the page');
  if (await page.getByText('Untitled animation').count()) throw new Error('default title is on the page');
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('animation-desktop.png') });

  await page.getByRole('button', { name: '+ New shot' }).click();
  await page.getByTestId('animation-title').fill(TITLE);
  const saved = page.waitForResponse((response) => {
    if (!response.url().includes('/api/lens/run') || response.request().method() !== 'POST') return false;
    const body = response.request().postData() || '';
    return body.includes('anim-create');
  });
  await page.getByRole('button', { name: '+ New shot' }).click();
  const saveResponse = await saved;
  const saveJson = await saveResponse.json();
  log('save', saveResponse.status(), JSON.stringify(saveJson).slice(0, 280));
  await page.getByRole('heading', { name: TITLE }).waitFor({ state: 'visible', timeout: 20000 });
  if (await page.getByText('Untitled animation').count()) throw new Error('default title appeared after save');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await waitPastOverload(page, () => page.getByRole('heading', { name: TITLE }).waitFor({ state: 'visible', timeout: 20000 }));
  log('title survived reload');

  const proofPid = Number(process.env.ANIM_PROOF_PID || 0);
  if (proofPid) {
    restartedPid = await restartApi(proofPid);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
    await waitPastOverload(page, () => page.getByRole('heading', { name: TITLE }).waitFor({ state: 'visible', timeout: 20000 }));
    log('title survived api restart');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('animation-phone.png') });
  if (!(await page.getByRole('button', { name: '+ New shot' }).isVisible())) {
    throw new Error('phone new shot not visible');
  }
  if (!(await page.getByRole('heading', { name: TITLE }).isVisible())) {
    throw new Error('phone title not visible');
  }
  log('phone new shot visible');
  console.log(JSON.stringify({ ok: true, user: USER, title: TITLE, restarted: Boolean(proofPid) }));
} finally {
  await browser.close();
  if (restartedPid) {
    try { process.kill(restartedPid, 'SIGTERM'); } catch { /* already gone */ }
  }
}
