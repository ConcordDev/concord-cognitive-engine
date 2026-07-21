// UGC-rendering-fidelity audit (2026-07-21) — GlyphCastHUD.tsx's cast()
// is a real world-effect macro (glyph_spells.cast writes embodied signal
// deltas at the cast cell + spell_cast_log), but a successful cast produced
// NO visual result at all in the 3D scene — only a text status string
// ("Cast fire (2 channels)"). Fixed by playing the same cast_channel
// archetype + element-keyed VFX (skill-motion.ts) GlyphSpellComposer's mint
// already uses, so casting a composed spell into the world is now a real,
// watchable action instead of a silent macro call with a toast.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import GlyphCastHUD from '@/components/world/GlyphCastHUD';

const playActionAtPlayer = vi.fn();
vi.mock('@/lib/concordia/play-action', () => ({
  playActionAtPlayer: (...args: unknown[]) => playActionAtPlayer(...args),
}));

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const SPELL = { id: 7, name: 'Ember Lance', components_json: '[{"element":"fire"}]' };

describe('GlyphCastHUD — real avatar/VFX feedback on cast (was silent)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    playActionAtPlayer.mockClear();
    fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      const body = opts?.body ? JSON.parse(String(opts.body)) : {};
      if (url === '/api/lens/run' && body.name === 'list_for_user') {
        return jsonResponse({ result: { ok: true, spells: [SPELL] } });
      }
      if (url === '/api/lens/run' && body.name === 'cast') {
        return jsonResponse({ result: { ok: true, element: 'fire', feedbackApplied: 2 } });
      }
      return jsonResponse({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('plays a real cast animation with the spell\'s element on a successful cast', async () => {
    const { getByText } = render(<GlyphCastHUD worldId="w1" playerPos={{ x: 10, z: 20 }} />);

    await waitFor(() => { expect(getByText(/1 spell/)).toBeTruthy(); });
    fireEvent.click(getByText(/1 spell/));

    await waitFor(() => { expect(getByText('Ember Lance')).toBeTruthy(); });
    fireEvent.click(getByText('Ember Lance'));

    await waitFor(() => {
      expect(playActionAtPlayer).toHaveBeenCalledWith('cast', { element: 'fire' });
    });
  });

  it('does not play an animation when the cast fails (e.g. sanctuary zone refusal)', async () => {
    const { getByText } = render(<GlyphCastHUD worldId="w1" playerPos={{ x: 10, z: 20 }} />);
    await waitFor(() => { expect(getByText(/1 spell/)).toBeTruthy(); });
    fireEvent.click(getByText(/1 spell/));
    await waitFor(() => { expect(getByText('Ember Lance')).toBeTruthy(); });

    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      const body = opts?.body ? JSON.parse(String(opts.body)) : {};
      if (body.name === 'cast') return jsonResponse({ result: { ok: false, reason: 'zone_combat_refusal' } });
      return jsonResponse({ result: { ok: true, spells: [SPELL] } });
    });

    fireEvent.click(getByText('Ember Lance'));

    await waitFor(() => { expect(getByText(/Failed:/)).toBeTruthy(); });
    expect(playActionAtPlayer).not.toHaveBeenCalled();
  });
});
