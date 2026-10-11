import { describe, expect, it, vi } from 'vitest';
import { loadPreferenceExport } from '@/lib/settings/export-preferences';

describe('loadPreferenceExport', () => {
  it('exports the preference object settings.get returned', async () => {
    const prefs = { audio_master_volume: 0.42, quality_preset: 'high' };
    const run = vi.fn().mockResolvedValue({ data: { ok: true, result: { prefs }, error: null } });
    const packed = await loadPreferenceExport(run, new Date('2026-10-11T12:00:00Z'));
    expect(run).toHaveBeenCalledWith('settings', 'get', {});
    expect(packed).toMatchObject({
      ok: true,
      filename: 'concord-settings-2026-10-11.json',
      prefs,
    });
    if (packed.ok) expect(JSON.parse(packed.body)).toEqual(prefs);
  });

  it('refuses to invent a file when the read fails or the prefs are missing', async () => {
    const thrown = await loadPreferenceExport(vi.fn().mockRejectedValue(new Error('offline')));
    expect(thrown).toEqual({ ok: false, reason: 'offline' });

    const notOk = await loadPreferenceExport(vi.fn().mockResolvedValue({
      data: { ok: false, result: null, error: 'no_session' },
    }));
    expect(notOk).toEqual({ ok: false, reason: 'no_session' });

    const empty = await loadPreferenceExport(vi.fn().mockResolvedValue({
      data: { ok: true, result: { prefs: [] }, error: null },
    }));
    expect(empty.ok).toBe(false);

    const weird = await loadPreferenceExport(vi.fn().mockRejectedValue('boom'));
    expect(weird).toEqual({ ok: false, reason: 'saved preferences did not load' });
  });
});
