// Real browser proof for the vault cabinet.
// Open the vault saves through vault.submit and the title appears
// only after my_submissions contains that id and the same title.
// The row stays Submitted. Browse does not admit it.
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { mkLog, openBrowser, shot, BASE, checkDisk } from './lens-proof-lib.mjs';

const log = mkLog('thevault');
checkDisk(log);
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const USER = `vaultproof_${STAMP}`;
const TITLE = `Vault ${STAMP}`;

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

  await page.goto(`${BASE}/lenses/vault`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (/onboarding/.test(page.url())) {
    const skip = page.getByRole('button', { name: /Skip onboarding/ }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.goto(`${BASE}/lenses/vault`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  }
  if (/\/(login|onboarding)/.test(page.url())) throw new Error('vault redirected to ' + page.url());
  log('opened', page.url());

  const who = USER.charAt(0).toUpperCase() + USER.slice(1);
  await page.getByRole('heading', { name: `The vault, ${who}` }).waitFor({ state: 'visible', timeout: 90000 });
  const cabinet = page.locator('section[aria-label="Cabinet"]');
  const alert = cabinet.getByRole('alert');
  const empty = page.getByText('Nothing unlocked.');
  const which = await Promise.race([
    empty.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'empty'),
    alert.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'alert'),
  ]);
  if (which === 'alert') throw new Error('cabinet error: ' + (await alert.innerText()));
  await page.getByText('Nothing selected.').waitFor({ state: 'visible', timeout: 20000 });
  if (await page.getByText('Admitted').count()) throw new Error('admitted copy is on an empty cabinet');
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('thevault-desktop.png') });

  await page.getByRole('button', { name: 'Open the vault' }).click();
  await page.getByTestId('vault-title').fill(TITLE);
  const saved = page.waitForResponse((response) => {
    if (!response.url().includes('/api/lens/run') || response.request().method() !== 'POST') return false;
    const body = response.request().postData() || '';
    return body.includes('submit') && body.includes('vault');
  });
  await page.getByRole('button', { name: 'Open the vault' }).click();
  const saveResponse = await saved;
  const saveJson = await saveResponse.json();
  log('save', saveResponse.status(), JSON.stringify(saveJson).slice(0, 320));
  const row = page.getByRole('button', { name: TITLE });
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText('Submitted').waitFor({ state: 'visible', timeout: 20000 });
  if (await page.getByText('Nothing unlocked.').count()) throw new Error('empty copy stayed after a read-back');
  if (await page.getByText('Admitted').count()) throw new Error('submission was labeled admitted');
  await page.getByText('Nothing selected.').waitFor({ state: 'visible' });

  await row.click();
  await page.getByRole('heading', { name: TITLE }).waitFor({ state: 'visible', timeout: 20000 });
  if (await page.getByText('Nothing selected.').count()) throw new Error('selection did not fill the record');
  if (await page.getByText('Admitted').count()) throw new Error('selected row was labeled admitted');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('button', { name: TITLE }).waitFor({ state: 'visible', timeout: 90000 });
  await page.getByText('Submitted').waitFor({ state: 'visible', timeout: 20000 });
  log('title survived reload');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('thevault-phone.png') });
  if (!(await page.getByRole('button', { name: 'Open the vault' }).isVisible())) {
    throw new Error('phone open is not visible');
  }
  if (!(await page.getByRole('button', { name: TITLE }).isVisible())) {
    throw new Error('phone title is not visible');
  }
  log('phone open visible');
  console.log(JSON.stringify({ ok: true, user: USER, title: TITLE }));
} finally {
  await browser.close();
}
