// Real browser proof for the narrative trail.
// Begin opens the first authored cinematic, reload shows the same name,
// The next step opens the following sequence. Persistence is localStorage
// (this lens has no server macro). Env: PROOF_BASE_URL (default http://localhost:5399)
import { mkLog, openBrowser, shot, BASE } from './lens-proof-lib.mjs';

const log = mkLog('narrative');
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const USER = `narrproof_${STAMP}`;

const { browser, ctx, page } = await openBrowser(log);
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

  await page.goto(`${BASE}/lenses/narrative-walk`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (/onboarding/.test(page.url())) {
    const skip = page.getByRole('button', { name: /Skip onboarding/ }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.goto(`${BASE}/lenses/narrative-walk`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  }
  if (/\/(login|onboarding)/.test(page.url())) throw new Error('narrative redirected to ' + page.url());
  log('opened', page.url());

  const who = USER.charAt(0).toUpperCase() + USER.slice(1);
  await page.getByRole('heading', { name: `The next step, ${who}` }).waitFor({ state: 'visible', timeout: 90000 });
  const trail = page.locator('section[aria-label="Trail"]');
  const alert = trail.getByRole('alert');
  const empty = page.getByText('No walk open.');
  const which = await Promise.race([
    empty.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'empty'),
    alert.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'alert'),
  ]);
  if (which === 'alert') throw new Error('trail error: ' + (await alert.innerText()));
  if (await page.getByRole('button', { name: 'All chapters' }).count()) {
    throw new Error('chapter filter is on the page');
  }
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('narrative-desktop.png') });

  const started = page.waitForFunction(() => {
    const raw = localStorage.getItem('concordia:narrative-walk:open');
    return raw === 'quest_lattice_realised';
  });
  await page.getByRole('button', { name: 'Begin the walk' }).click();
  await started;
  await page.getByRole('heading', { name: 'Lattice Quest Realised' }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText(/lattice-born quest/).waitFor({ state: 'visible', timeout: 10000 });
  log('opened lattice');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('heading', { name: 'Lattice Quest Realised' }).waitFor({ state: 'visible', timeout: 90000 });
  const stored = await page.evaluate(() => localStorage.getItem('concordia:narrative-walk:open'));
  if (stored !== 'quest_lattice_realised') throw new Error('reload lost the open id: ' + stored);
  log('lattice survived reload');

  await page.getByRole('button', { name: 'The next step' }).click();
  await page.getByRole('heading', { name: 'Ecology Quest Realised' }).waitFor({ state: 'visible', timeout: 20000 });
  const second = await page.evaluate(() => localStorage.getItem('concordia:narrative-walk:open'));
  if (second !== 'quest_ecology_realised') throw new Error('next step did not store ecology: ' + second);
  log('opened ecology');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('narrative-phone.png') });
  if (!(await page.getByRole('button', { name: 'The next step' }).isVisible())) {
    throw new Error('phone next step not visible');
  }
  log('phone next step visible');
  console.log(JSON.stringify({
    ok: true,
    user: USER,
    first: 'quest_lattice_realised',
    second: 'quest_ecology_realised',
  }));
} finally {
  await browser.close();
}
