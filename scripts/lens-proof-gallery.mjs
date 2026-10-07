// Real browser proof for the gallery wall.
// Hang a work saves through gallery.artwork-save and the title appears
// only after collection-detail contains the id. Reload shows the same title.
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { mkLog, openBrowser, shot, BASE, checkDisk } from './lens-proof-lib.mjs';

const log = mkLog('gallery');
checkDisk(log);
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const USER = `galproof_${STAMP}`;
const TITLE = `Study ${STAMP}`;

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

  await page.goto(`${BASE}/lenses/gallery`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (/onboarding/.test(page.url())) {
    const skip = page.getByRole('button', { name: /Skip onboarding/ }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.goto(`${BASE}/lenses/gallery`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  }
  if (/\/(login|onboarding)/.test(page.url())) throw new Error('gallery redirected to ' + page.url());
  log('opened', page.url());

  const who = USER.charAt(0).toUpperCase() + USER.slice(1);
  await page.getByRole('heading', { name: `The wall, ${who}` }).waitFor({ state: 'visible', timeout: 90000 });
  const wall = page.locator('section[aria-label="Wall"]');
  const alert = wall.getByRole('alert');
  const empty = page.getByText('The wall is empty.');
  const which = await Promise.race([
    empty.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'empty'),
    alert.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'alert'),
  ]);
  if (which === 'alert') throw new Error('wall error: ' + (await alert.innerText()));
  if (await page.getByRole('button', { name: 'Browse' }).count()) throw new Error('browse tab is on the page');
  if (await page.getByText('Sigil gallery').count()) throw new Error('sigil gallery is on the page');
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('gallery-desktop.png') });

  await page.getByRole('button', { name: 'Hang a work' }).click();
  await page.getByTestId('gallery-title').fill(TITLE);
  const saved = page.waitForResponse((response) => {
    if (!response.url().includes('/api/lens/run') || response.request().method() !== 'POST') return false;
    return (response.request().postData() || '').includes('artwork-save');
  });
  await page.getByRole('button', { name: 'Hang a work' }).click();
  const saveResponse = await saved;
  const saveJson = await saveResponse.json();
  log('save', saveResponse.status(), JSON.stringify(saveJson).slice(0, 240));
  await page.getByRole('heading', { name: TITLE }).waitFor({ state: 'visible', timeout: 20000 });
  if (await page.getByText('Unknown').count()) throw new Error('default artist is on the wall');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('heading', { name: TITLE }).waitFor({ state: 'visible', timeout: 90000 });
  log('title survived reload');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('gallery-phone.png') });
  if (!(await page.getByRole('button', { name: 'Hang a work' }).isVisible())) {
    throw new Error('phone hang button not visible');
  }
  if (!(await page.getByRole('heading', { name: TITLE }).isVisible())) {
    throw new Error('phone title not visible');
  }
  log('phone hang visible');
  console.log(JSON.stringify({ ok: true, user: USER, title: TITLE }));
} finally {
  await browser.close();
}
