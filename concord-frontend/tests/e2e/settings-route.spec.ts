import { expect, test } from '@playwright/test';
import { corsFulfill, mockAuthSuccess } from './_helpers';

/**
 * `/settings` must land on the lens and show the volumes `settings.get`
 * returned. The old page painted 0.00 for every slider before any read.
 */
test('settings route shows the saved volumes, not zeros', async ({ page }) => {
  await mockAuthSuccess(page, { username: 'ramaj' });
  await page.addInitScript(() => {
    localStorage.setItem('concord:first-run-tour:settings', '1');
  });

  const prefs = {
    audio_master_volume: 0.7,
    audio_music_volume: 0.6,
    audio_sfx_volume: 0.8,
    mouse_sensitivity: 1,
    quality_preset: 'balanced',
    reduced_motion: false,
  };

  await page.route('**/api/lens/run', async (route) => {
    let action = '';
    try {
      action = JSON.parse(route.request().postData() || '{}').action || '';
    } catch { /* ignore */ }
    const result = action === 'list'
      ? {
          sections: ['audio'],
          items: [
            { key: 'audio_master_volume', section: 'audio', label: 'Master volume', type: 'number', default: 0.7, options: null, range: [0, 1] },
            { key: 'audio_music_volume', section: 'audio', label: 'Music volume', type: 'number', default: 0.6, options: null, range: [0, 1] },
            { key: 'audio_sfx_volume', section: 'audio', label: 'SFX volume', type: 'number', default: 0.8, options: null, range: [0, 1] },
          ],
          localeLabels: {},
        }
      : action === 'get'
        ? { prefs, overriddenKeys: ['audio_master_volume'], syncedAt: '2026-10-11T00:00:00Z' }
        : action === 'sessions'
          ? { sessions: [] }
          : action === 'keybindings'
            ? { bindings: [] }
            : action === 'listSnapshots'
              ? { snapshots: [] }
              : {};
    await corsFulfill(route, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, result }),
    });
  });

  await page.route('**/api/**', async (route) => {
    if (route.request().url().includes('/api/lens/run')) return route.fallback();
    await corsFulfill(route, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, user: { username: 'ramaj' }, health: { status: 'ok', uptime: 10 } }),
    });
  });

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/lenses\/settings/);
  await expect(page.getByRole('heading', { name: /Your settings/ })).toBeVisible();
  await page.getByRole('button', { name: 'World & graphics' }).click();
  await expect(page.getByText('0.70').first()).toBeVisible();
  await expect(page.getByText('0.60').first()).toBeVisible();
  await expect(page.getByText('0.80').first()).toBeVisible();
  await expect(page.getByText('0.00')).toHaveCount(0);
});
