// Real browser proof for the crafting bench.
// Desktop and phone: open /lenses/crafting, click + Start a piece, name it,
// save, require the title on screen, reload, require it still there, and
// require GET /api/crafting/recipes to contain that title.
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { mkLog, openBrowser, shot, BASE } from './lens-proof-lib.mjs';

const log = mkLog('crafting');
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const TITLE = `Bench ${STAMP}`;
const USER = `craftproof_${STAMP}`;

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
  page.on('response', (response) => {
    const url = response.url();
    const status = response.status();
    const crafting = /\/api\/crafting\/(design|recipes)/.test(url);
    if (!crafting && status < 400) return;
    response.text().then((text) => {
      log(response.request().method(), status, url.split('?')[0], text.slice(0, 240).replace(/\s+/g, ' '));
    }).catch(() => {});
  });

  await page.goto(`${BASE}/lenses/crafting`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (/onboarding/.test(page.url())) {
    const skip = page.getByRole('button', { name: /Skip onboarding/ }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.goto(`${BASE}/lenses/crafting`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  }
  if (/\/(login|onboarding)/.test(page.url())) throw new Error('crafting redirected to ' + page.url());
  log('opened', page.url());
  await page.getByRole('heading', { name: /The piece on the bench/ }).waitFor({ state: 'visible', timeout: 90000 });
  const bench = page.locator('section[aria-label="Bench"]');
  const alert = bench.getByRole('alert');
  const ready = page.getByText('The bench is clear.').or(bench.locator('li').first());
  const which = await Promise.race([
    ready.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'ready'),
    alert.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'alert'),
  ]);
  if (which === 'alert') throw new Error('bench error: ' + (await alert.innerText()));
  const start = page.getByRole('button', { name: '+ Start a piece' });
  await start.click({ timeout: 20000 });
  const name = page.getByLabel('Piece name');
  await name.waitFor({ state: 'visible', timeout: 15000 });
  await name.fill(TITLE);
  await start.click();
  await page.getByText(TITLE, { exact: true }).waitFor({ state: 'visible', timeout: 60000 });
  log('title on bench', TITLE);
  await page.screenshot({ path: shot('crafting-desktop.png') });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByText(TITLE, { exact: true }).waitFor({ state: 'visible', timeout: 90000 });
  log('title survived reload');

  const listed = await page.evaluate(async () => {
    const response = await fetch('/api/crafting/recipes', { credentials: 'include' });
    return response.json();
  });
  const hit = (listed.recipes || []).find((row) => row.title === TITLE);
  if (!hit?.id) throw new Error('GET /api/crafting/recipes did not return ' + TITLE);
  log('read back', hit.id, hit.type);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: shot('crafting-phone.png') });
  const phoneStart = page.getByRole('button', { name: '+ Start a piece' });
  if (!(await phoneStart.isVisible())) throw new Error('phone CTA not visible');
  log('phone CTA visible');
  console.log(JSON.stringify({ ok: true, title: TITLE, id: hit.id, type: hit.type }));
} finally {
  await browser.close();
}
