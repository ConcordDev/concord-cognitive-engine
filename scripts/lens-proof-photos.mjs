// Real browser proof for the Photos frame.
// Import a real PNG, require the caption only after mine contains the id,
// reload, require GET /api/photos/mine to still contain that id, and require
// GET /api/photos/:id/image to return PNG bytes. Then open the lightbox,
// share (DTU id must match the next mine row), and delete (id leaves mine).
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkLog, openBrowser, shot, BASE } from './lens-proof-lib.mjs';

const log = mkLog('photos');
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const CAPTION = `Frame ${STAMP}`;
const USER = `photoproof_${STAMP}`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
mkdirSync('/tmp/concord-photos-proof-frames', { recursive: true });
const PNG_PATH = `/tmp/concord-photos-proof-frames/Frame ${STAMP}.png`;
writeFileSync(PNG_PATH, PNG);

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
    const photos = (/\/api\/photos\//.test(url) && !/\/image$/.test(url)) || /\/api\/lens\/run/.test(url);
    if (!photos && status < 400) return;
    response.text().then((text) => {
      log(response.request().method(), status, url.split('?')[0], text.slice(0, 180).replace(/\s+/g, ' '));
    }).catch(() => {});
  });

  await page.goto(`${BASE}/lenses/photos`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (/onboarding/.test(page.url())) {
    const skip = page.getByRole('button', { name: /Skip onboarding/ }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.goto(`${BASE}/lenses/photos`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  }
  if (/\/(login|onboarding)/.test(page.url())) throw new Error('photos redirected to ' + page.url());
  log('opened', page.url());

  const who = USER.charAt(0).toUpperCase() + USER.slice(1);
  await page.getByRole('heading', { name: `The frame, ${who}` }).waitFor({ state: 'visible', timeout: 90000 });
  const frame = page.locator('section[aria-label="Frame"]');
  const alert = frame.getByRole('alert');
  const empty = page.getByText('No frame yet.');
  const which = await Promise.race([
    empty.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'empty'),
    alert.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'alert'),
  ]);
  if (which === 'alert') throw new Error('frame error: ' + (await alert.innerText()));
  if (await page.getByRole('button', { name: /Friends/i }).count()) {
    throw new Error('Friends button is on the page');
  }

  await page.getByLabel('Import photos').setInputFiles(PNG_PATH);
  await page.getByText(CAPTION, { exact: true }).waitFor({ state: 'visible', timeout: 60000 });
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  log('caption on frame', CAPTION);
  await page.screenshot({ path: shot('photos-desktop.png') });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByText(CAPTION, { exact: true }).waitFor({ state: 'visible', timeout: 90000 });
  log('caption survived reload');

  const listed = await page.evaluate(async () => {
    const response = await fetch('/api/photos/mine', { credentials: 'include' });
    return { status: response.status, body: await response.json() };
  });
  const hit = (listed.body?.photos || []).find((row) => row.caption === CAPTION);
  if (listed.status !== 200 || !hit?.id) throw new Error('GET /api/photos/mine did not return ' + CAPTION);
  log('read back', hit.id);

  const image = await page.evaluate(async (id) => {
    const response = await fetch(`/api/photos/${id}/image`, { credentials: 'include' });
    const buf = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, type: response.headers.get('content-type'), bytes: buf.length, magic: Array.from(buf.slice(0, 8)) };
  }, hit.id);
  const pngMagic = [137, 80, 78, 71, 13, 10, 26, 10];
  if (image.status !== 200 || image.bytes < 8 || pngMagic.some((b, i) => image.magic[i] !== b)) {
    throw new Error('image bytes are not a PNG: ' + JSON.stringify(image));
  }
  log('image bytes', image.bytes, image.type);

  await page.getByRole('button', { name: `View photo ${CAPTION}` }).click();
  await page.getByTestId('photo-lightbox-detail').waitFor({ state: 'visible', timeout: 30000 });
  log('lightbox open');
  await page.getByRole('button', { name: 'Close modal' }).click();
  await page.getByTestId('photo-lightbox-detail').waitFor({ state: 'hidden', timeout: 15000 });

  await page.getByRole('button', { name: `Share photo ${CAPTION}` }).click();
  await page.getByText('DTU minted · royalty active').waitFor({ state: 'visible', timeout: 30000 });
  const shared = await page.evaluate(async () => {
    const response = await fetch('/api/photos/mine', { credentials: 'include' });
    return response.json();
  });
  const sharedRow = (shared.photos || []).find((row) => row.caption === CAPTION);
  if (!sharedRow?.dtu_id || !String(sharedRow.dtu_id).startsWith('dtu_photo_')) {
    throw new Error('share did not stamp dtu_id: ' + JSON.stringify(sharedRow));
  }
  log('shared', sharedRow.dtu_id);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('COGNITIVE OPERATING SYSTEM').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('photos-phone.png') });
  if (!(await page.getByRole('button', { name: 'Import' }).isVisible())) throw new Error('phone Import not visible');
  log('phone Import visible');

  await page.getByRole('button', { name: `Delete photo ${CAPTION}` }).click();
  await page.getByText('No frame yet.').waitFor({ state: 'visible', timeout: 30000 });
  const after = await page.evaluate(async () => {
    const response = await fetch('/api/photos/mine', { credentials: 'include' });
    return response.json();
  });
  if ((after.photos || []).some((row) => row.id === hit.id)) throw new Error('delete left the id in mine');
  log('deleted', hit.id);

  console.log(JSON.stringify({ ok: true, caption: CAPTION, id: hit.id, dtuId: sharedRow.dtu_id, imageBytes: image.bytes }));
} finally {
  await browser.close();
}
