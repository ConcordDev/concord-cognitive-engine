/**
 * Tier-2 frontend test for GlyphCastHUD (findings #36, #37, #38).
 *
 * Three independent `/api/lens/run` call sites, no shared helper:
 *   - list spells   (glyph_spells.list_for_user)      — finding #36
 *   - play as chord (sonic_glyph.spell_to_chord)       — finding #37
 *   - cast          (glyph_spells.cast)                — finding #38
 *
 * All three used to read fields straight off the top-level response
 * instead of `.result`, so the spellbook never opened, chord playback
 * always reported "Sonic failed", and casting always showed
 * "Failed: unknown" even on a successful cast.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';

import GlyphCastHUD from '@/components/world/GlyphCastHUD';

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body });
}

const ONE_SPELL = {
  id: 1,
  name: 'Emberlight',
  components_json: JSON.stringify([{ element: 'fire' }]),
};

class FakeGainParam {
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
}
class FakeGainNode {
  gain = new FakeGainParam();
  connect = vi.fn();
}
class FakeOscillatorNode {
  type = 'sine';
  frequency = { value: 0 };
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createOscillator() { return new FakeOscillatorNode(); }
  createGain() { return new FakeGainNode(); }
}

describe('GlyphCastHUD', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists spells from the nested result payload (finding #36)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
      ok: true,
      result: { ok: true, spells: [ONE_SPELL] },
    })));

    const { container } = render(<GlyphCastHUD worldId="concordia-hub" playerPos={{ x: 1, z: 1 }} />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(container.textContent).toMatch(/1 spell/);
  });


  it('plays a chord from the nested result payload (finding #37)', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.domain === 'glyph_spells' && body.name === 'list_for_user') {
        return jsonResponse({ ok: true, result: { ok: true, spells: [ONE_SPELL] } });
      }
      if (body.domain === 'sonic_glyph' && body.name === 'spell_to_chord') {
        return jsonResponse({
          ok: true,
          result: {
            ok: true,
            note_count: 1,
            duration_ms: 600,
            chord: { notes: [{ freq: 220, offset_ms: 0, duration_ms: 600, velocity: 0.5 }], waveform: 'sine' },
          },
        });
      }
      return jsonResponse({ ok: true, result: { ok: false } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container, getByTitle } = render(
      <GlyphCastHUD worldId="concordia-hub" playerPos={{ x: 1, z: 1 }} />
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    fireEvent.click(container.querySelector('button')!); // open spellbook
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(getByTitle('Play spell as chord'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/Played 1-note chord/);
    expect(container.textContent).not.toMatch(/Sonic failed/);
  });

  it('reports a successful cast from the nested result payload (finding #38)', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.domain === 'glyph_spells' && body.name === 'list_for_user') {
        return jsonResponse({ ok: true, result: { ok: true, spells: [ONE_SPELL] } });
      }
      if (body.domain === 'glyph_spells' && body.name === 'cast') {
        return jsonResponse({
          ok: true,
          result: { ok: true, element: 'fire', feedbackApplied: 2 },
        });
      }
      return jsonResponse({ ok: true, result: { ok: false } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container, getByText } = render(
      <GlyphCastHUD worldId="concordia-hub" playerPos={{ x: 1, z: 1 }} />
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    fireEvent.click(container.querySelector('button')!); // open spellbook
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(getByText('cast'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/Cast fire \(2 channels\)/);
    expect(container.textContent).not.toMatch(/Failed: unknown/);
  });
});
