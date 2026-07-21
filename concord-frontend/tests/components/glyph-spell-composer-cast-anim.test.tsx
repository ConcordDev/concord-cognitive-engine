// Animation-coverage audit (2026-07-21) — GlyphSpellComposer only ever
// fired milestoneJuice('ui_glyph_mint') (a screen-flash, no avatar motion)
// on a successful mint. A cast_channel archetype ('cast'/'compose_spell')
// already existed in action-biomechanics.ts but had zero call sites — dead
// code. Fixed by calling playActionAtPlayer('compose_spell', ...) so the
// player visibly channels the glyph they just composed, carrying the
// composed element (fire/ice/lightning/...) through so the cast amplitude/
// VFX modulate per play-action.ts's `element` option.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { GlyphSpellComposer } from '@/components/world/GlyphSpellComposer';

const playActionAtPlayer = vi.fn();
vi.mock('@/lib/concordia/play-action', () => ({
  playActionAtPlayer: (...args: unknown[]) => playActionAtPlayer(...args),
}));

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const COMPONENTS = [
  { id: 'c1', glyph: '⟐', element: 'fire', name: 'Ember Seed' },
  { id: 'c2', glyph: '⊚', element: 'fire', name: 'Ember Core' },
];

describe('GlyphSpellComposer — real avatar feedback on mint (was UI-only juice)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    playActionAtPlayer.mockClear();
    fetchMock = vi.fn((url: string) => {
      if (url === '/api/glyph-spells/components') return jsonResponse({ ok: true, components: COMPONENTS });
      if (url === '/api/glyph-spells/compose') {
        return jsonResponse({ ok: true, composed_glyph: '⟐⊚', element: 'fire', max_damage: 20, range_m: 8, costs: { mana: 5 } });
      }
      if (url === '/api/glyph-spells/mint') return jsonResponse({ ok: true, spellId: 'spell-1' });
      return jsonResponse({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('plays compose_spell with the composed element on a successful mint', async () => {
    const { getByTitle, getByText } = render(
      <GlyphSpellComposer
        building={{ id: 'b1', building_type: 'glyph_altar', x: 0, z: 0, name: 'Glyph Altar' }}
        worldId="w1"
        onClose={() => {}}
      />,
    );

    await waitFor(() => { expect(getByTitle('Ember Seed')).toBeTruthy(); });
    fireEvent.click(getByTitle('Ember Seed'));
    fireEvent.click(getByTitle('Ember Core'));

    await waitFor(() => { expect(getByText('Mint')).not.toHaveProperty('disabled', true); });
    fireEvent.click(getByText('Mint'));

    await waitFor(() => {
      expect(playActionAtPlayer).toHaveBeenCalledWith('compose_spell', { element: 'fire' });
    });
  });
});
