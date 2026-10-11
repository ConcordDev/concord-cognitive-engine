import { test, expect } from '@playwright/test';
import { blockUnmockedApi, corsFulfill, mockAuthSuccess } from './_helpers';

/**
 * New DTU is a visible button. Creating adds a row. Delete confirms,
 * sends DELETE, and the row stays gone after reload. A 403 leaves the row.
 */
test.describe('DTU browser create and delete', () => {
  test('New DTU creates a row and Delete removes it across reload', async ({ page }) => {
    const rows: Array<Record<string, unknown>> = [];

    await blockUnmockedApi(page);
    await mockAuthSuccess(page);
    await page.addInitScript(() => {
      try { localStorage.setItem('concord:first-run-tour:dtus', '1'); } catch { /* private mode */ }
    });

    await page.route('**/api/dtus/paginated**', (route) =>
      corsFulfill(route, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          items: rows,
          dtus: rows,
          total: rows.length,
          pagination: { total: rows.length, hasNext: false },
        }),
      }),
    );
    await page.route('**/api/dtus', async (route) => {
      if (route.request().method() === 'OPTIONS') return corsFulfill(route, { status: 204 });
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON() as { title?: string; content?: string };
      const dtu = {
        id: 'dtu-e2e-1',
        title: body.title || 'Untitled',
        content: body.content || '',
        summary: body.content || '',
        tier: 'regular',
        tags: [],
        createdAt: '2020-01-02T03:04:05.000Z',
        ownerId: 'usr_testuser',
      };
      rows.push(dtu);
      return corsFulfill(route, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, dtu }),
      });
    });
    await page.route('**/api/dtus/dtu-e2e-1', async (route) => {
      if (route.request().method() === 'OPTIONS') return corsFulfill(route, { status: 204 });
      if (route.request().method() !== 'DELETE') return route.fallback();
      rows.splice(0, rows.length);
      return corsFulfill(route, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/lenses/dtus', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);

    await page.getByRole('button', { name: 'Views' }).click();
    await expect(page.getByRole('navigation', { name: 'DTU views' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Workbench/ })).toBeVisible();

    await page.getByRole('button', { name: 'New DTU' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create New DTU' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('A descriptive title for this thought...').fill('Reload note');
    await dialog.getByPlaceholder('The thought content...').fill('created from the button');
    await dialog.getByRole('button', { name: 'Create DTU' }).click();

    await expect(page.getByText('Reload note')).toBeVisible();
    await expect(page.getByText('Showing 1–1 of 1')).toBeVisible();

    await page.getByRole('button', { name: 'More options' }).click();
    const deleted = page.waitForRequest((req) => req.method() === 'DELETE' && req.url().includes('/api/dtus/dtu-e2e-1'));
    await page.getByText('Delete', { exact: true }).click();
    await deleted;
    await expect(page.getByText('Reload note')).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Reload note')).toHaveCount(0);
    await expect(page.getByText('0 DTUs')).toBeVisible();
  });

  test('another account delete returns 403 and the row stays', async ({ page }) => {
    const row = {
      id: 'dtu-other',
      title: 'Not mine',
      content: 'owned elsewhere',
      summary: 'owned elsewhere',
      tier: 'regular',
      tags: [],
      createdAt: '2020-01-02T03:04:05.000Z',
      ownerId: 'someone-else',
    };

    await blockUnmockedApi(page);
    await mockAuthSuccess(page);
    await page.addInitScript(() => {
      try { localStorage.setItem('concord:first-run-tour:dtus', '1'); } catch { /* private mode */ }
    });
    await page.route('**/api/dtus/paginated**', (route) =>
      corsFulfill(route, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          items: [row],
          total: 1,
          pagination: { total: 1, hasNext: false },
        }),
      }),
    );
    await page.route('**/api/dtus/dtu-other', (route) => {
      if (route.request().method() === 'OPTIONS') return corsFulfill(route, { status: 204 });
      return corsFulfill(route, {
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'unauthorized: you can only delete your own DTUs' }),
      });
    });

    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/lenses/dtus', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Not mine')).toBeVisible();
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByText('Delete', { exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/only delete your own/i);
    await expect(page.getByText('Not mine')).toBeVisible();
  });
});
