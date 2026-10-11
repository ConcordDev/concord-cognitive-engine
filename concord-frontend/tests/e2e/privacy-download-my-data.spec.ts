import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { blockUnmockedApi, mockAuthSuccess, corsFulfill } from './_helpers';

test('Download my data file contains a DTU created during the test', async ({ page }) => {
  const dtuId = `dtu-e2e-${Date.now()}`;

  await blockUnmockedApi(page);
  await mockAuthSuccess(page, { username: 'ramaj' });
  await page.addInitScript(() => {
    try { localStorage.setItem('concord:first-run-tour:privacy', '1'); } catch { /* private mode */ }
  });

  // A privacy-only bundle must not be what the button saves. If the panel
  // still called privacy.dataExport, this body would be the file.
  await page.route('**/api/lens/run', (route) =>
    corsFulfill(route, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: { counts: {}, bundle: { privacyOnly: true }, events: [], totalEvents: 0, byOperation: {} },
      }),
    }),
  );

  await page.route('**/api/account/deletion', (route) =>
    corsFulfill(route, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, scheduled: false }),
    }),
  );

  await page.route('**/api/account/export', (route) =>
    corsFulfill(route, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'usr_ramaj', username: 'ramaj' },
        dtus: [{ id: dtuId, title: 'Created during the test' }],
        chats: { sessions: [], messages: [] },
        sessions: { auth: [], lens: [] },
        settings: { preferences: {} },
        privacy: { spec: 'concord-privacy-export/v1', userId: 'usr_ramaj' },
      }),
    }),
  );

  await page.goto('/lenses/privacy');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const saved = JSON.parse(await readFile(filePath!, 'utf8'));
  expect(saved.dtus.map((d: { id: string }) => d.id)).toContain(dtuId);
  expect(saved.bundle).toBeUndefined();
  expect(saved.privacy.spec).toBe('concord-privacy-export/v1');
});

test('Export desk downloads the vault and not the shared library', async ({ page }) => {
  const dtuId = `dtu-vault-${Date.now()}`;

  await blockUnmockedApi(page);
  await mockAuthSuccess(page, { username: 'ramaj' });
  await page.addInitScript(() => {
    try { localStorage.setItem('concord:first-run-tour:export', '1'); } catch { /* private mode */ }
  });

  await page.route('**/api/dtus/paginated**', (route) => {
    const scope = new URL(route.request().url()).searchParams.get('scope');
    const items = scope === 'all'
      ? [{ id: dtuId, title: 'Mine' }, { id: 'dtu-system', title: 'System feed' }]
      : [{ id: dtuId, title: 'Mine' }];
    return corsFulfill(route, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items,
        pagination: { total: items.length, hasNext: false, page: 1, pageSize: 100 },
      }),
    });
  });

  await page.goto('/lenses/export');
  await expect(page.getByText('1 DTU in your vault.')).toBeVisible();
  await expect(page.getByText('System feed')).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my DTUs' }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const saved = JSON.parse(await readFile(filePath!, 'utf8'));
  expect(saved.dtus.map((d: { id: string }) => d.id)).toEqual([dtuId]);
});
