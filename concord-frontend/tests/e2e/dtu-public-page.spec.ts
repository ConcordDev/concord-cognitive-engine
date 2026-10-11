import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * /dtu/:id must render for the owner within 5s and 404 for everyone else
 * within 5s. The page fetch is server-side, so this hits the real backend
 * the e2e webServer starts (page.route cannot intercept it).
 */
const BACKEND = process.env.CONCORD_API_BASE || 'http://127.0.0.1:5050';

async function session(request: APIRequestContext) {
  const uniq = `prb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `${uniq}@concord-smoke.test`;
  const password = 'PlaywrightSmoke!9912';
  const loadedAt = Date.now() - 3500;
  const register = await request.post(`${BACKEND}/api/auth/register`, {
    data: { username: uniq, email, password, dateOfBirth: '1990-01-01', _t: loadedAt },
    headers: { 'content-type': 'application/json' },
  });
  if (!register.ok()) throw new Error(`register ${register.status()} ${await register.text()}`);
  const login = await request.post(`${BACKEND}/api/auth/login`, {
    data: { email, password },
    headers: { 'content-type': 'application/json' },
  });
  const rawCookies = (login.headersArray() as Array<{ name: string; value: string }>)
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value);
  if (rawCookies.length === 0) throw new Error(`login cookies missing ${login.status()}`);
  const cookies = rawCookies.map((raw) => {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: 'localhost', path: '/' };
  });
  const created = await request.post(`${BACKEND}/api/dtus`, {
    data: {
      title: `Owner page ${uniq}`,
      content: 'visible to the owner',
      source: 'user',
      visibility: 'private',
    },
    headers: { 'content-type': 'application/json' },
  });
  const body = await created.json();
  const id = body?.dtu?.id || body?.id;
  if (!id) throw new Error(`create failed ${created.status()} ${JSON.stringify(body)}`);
  return { cookies, id, title: `Owner page ${uniq}` };
}

test.describe('public DTU page', () => {
  test('anonymous /dtu/:id is a 404 within 5s', async ({ page }) => {
    const response = await page.goto('/dtu/missing-prb-id', { waitUntil: 'domcontentloaded', timeout: 5000 });
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible({ timeout: 5000 });
  });

  test('the owner sees the title within 5s', async ({ page, request }) => {
    const { cookies, id, title } = await session(request);
    await page.context().addCookies(cookies);
    const response = await page.goto(`/dtu/${id}`, { waitUntil: 'domcontentloaded', timeout: 5000 });
    expect(response?.status()).toBe(200);
    await expect(page.getByText(title)).toBeVisible({ timeout: 5000 });
  });
});
