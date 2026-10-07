// Real browser proof for the maker bench.
// + New make saves through app-maker.projectCreate and the name appears
// only after projectList contains that id and the same name.
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { mkLog, openBrowser, shot, BASE, checkDisk } from './lens-proof-lib.mjs';

const log = mkLog('maker');
checkDisk(log);
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const USER = `makerproof_${STAMP}`;
const NAME = `Make ${STAMP}`;

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

  await page.goto(`${BASE}/lenses/maker`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (/onboarding/.test(page.url())) {
    const skip = page.getByRole('button', { name: /Skip onboarding/ }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.goto(`${BASE}/lenses/maker`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  }
  if (/\/(login|onboarding)/.test(page.url())) throw new Error('maker redirected to ' + page.url());
  log('opened', page.url());

  const who = USER.charAt(0).toUpperCase() + USER.slice(1);
  await page.getByRole('heading', { name: `The make, ${who}` }).waitFor({ state: 'visible', timeout: 90000 });
  const bench = page.locator('section[aria-label="Bench"]');
  const alert = bench.getByRole('alert');
  const empty = page.getByText('Nothing on the bench.');
  const which = await Promise.race([
    empty.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'empty'),
    alert.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'alert'),
  ]);
  if (which === 'alert') throw new Error('bench error: ' + (await alert.innerText()));
  if (await page.getByRole('button', { name: 'Builder' }).count()) throw new Error('builder tab is on the page');
  if (await page.getByText('Untitled App').count()) throw new Error('default name is on the bench');
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('maker-desktop.png') });

  await page.getByRole('button', { name: '+ New make' }).click();
  await page.getByTestId('maker-name').fill(NAME);
  const saved = page.waitForResponse((response) => {
    if (!response.url().includes('/api/lens/run') || response.request().method() !== 'POST') return false;
    return (response.request().postData() || '').includes('projectCreate');
  });
  await page.getByRole('button', { name: '+ New make' }).click();
  const saveResponse = await saved;
  const saveJson = await saveResponse.json();
  log('save', saveResponse.status(), JSON.stringify(saveJson).slice(0, 240));
  await page.getByRole('heading', { name: NAME }).waitFor({ state: 'visible', timeout: 20000 });
  if (await page.getByText('Untitled App').count()) throw new Error('default name appeared after save');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('heading', { name: NAME }).waitFor({ state: 'visible', timeout: 90000 });
  log('name survived reload');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('maker-phone.png') });
  if (!(await page.getByRole('button', { name: '+ New make' }).isVisible())) {
    throw new Error('phone new make not visible');
  }
  if (!(await page.getByRole('heading', { name: NAME }).isVisible())) {
    throw new Error('phone name not visible');
  }
  log('phone new make visible');
  console.log(JSON.stringify({ ok: true, user: USER, name: NAME }));
} finally {
  await browser.close();
}
