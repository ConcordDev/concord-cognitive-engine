// Audit fix sweep (PR #2356) — FIX-world-creator-007 + FIX-world-creator-008:
// creating a blank draft with no name says so in the open instead of silently
// becoming 'Untitled world', and the editor's clamped numeric fields (zone
// radius, prop scale, NPC level) state their ranges next to the field.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/components/world-creator/BiomePreview', () => ({
  BiomePreview: () => null,
}));

vi.mock('@/components/world-creator/SceneCanvas', () => ({
  SceneCanvas: (props: Record<string, unknown>) => {
    const onSelect = props.onSelect as (kind: string, id: string) => void;
    const onCanvasClick = props.onCanvasClick as (x: number, z: number) => void;
    return React.createElement('div', { 'data-testid': 'scene-canvas' }, [
      React.createElement('button', { key: 'select', 'data-testid': 'select-prop', onClick: () => onSelect('prop', 'prop_1') }, 'select'),
      React.createElement('button', { key: 'click', 'data-testid': 'click-canvas', onClick: () => onCanvasClick(10, 20) }, 'click'),
    ]);
  },
}));

import { DraftGallery } from '@/components/world-creator/DraftGallery';
import { DraftEditor } from '@/components/world-creator/DraftEditor';

function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const DRAFT = {
  id: 'draft_1', name: 'Dune Camp', description: '', universeType: 'concordia-hub',
  template: null, biome: 'desert',
  rules: { combatLethality: 1, refusalSensitivity: 1, questDensity: 1, weatherIntensity: 1 },
  props: [{ id: 'prop_1', kind: 'rock', x: 0, z: 0, rotation: 0, scale: 1 }],
  spawnPoints: [{ id: 'spawn_1', name: 'Camp', x: 0, z: 0, isDefault: true }],
  zones: [{ id: 'zone_1', name: 'Haven', kind: 'safe', x: 0, z: 0, radius: 40 }],
  npcs: [{ id: 'npc_1', name: 'Gorman', archetype: 'warrior', x: 0, z: 0, factionId: null, level: 1, backstory: '' }],
  factions: [],
  terrain: { seed: 1, roughness: 0.5, waterLevel: 0.3 },
  visibility: 'private', publishedWorldId: null,
};
const BIOMES = [{ id: 'desert', label: 'Arid Desert', palette: ['#c2986a'] }];

function routed() {
  return (_domain: string, action: string) => {
    if (action === 'draft-get') return reply({ draft: DRAFT });
    if (action === 'biomes') return reply({ biomes: BIOMES });
    if (action === 'draft-list') return reply({ drafts: [] });
    if (action === 'templates') return reply({ templates: [] });
    if (action === 'discover') return reply({ worlds: [] });
    return reply({});
  };
}

beforeEach(() => { lensRun.mockReset(); lensRun.mockImplementation(routed()); });

describe('world-creator validation is stated, not silent', () => {
  it('a blank name on a blank draft is refused in the open — no silent Untitled world', async () => {
    const { getByText, findByRole } = render(<DraftGallery onOpen={() => {}} />);
    fireEvent.click(getByText('Blank draft'));
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('Give your world a name first');
    const createCalls = lensRun.mock.calls.filter(c => c[1] === 'draft-create');
    expect(createCalls.length).toBe(0);
  });

  it('the zone radius field states its 5–250 m range', async () => {
    const { getByText, getByTestId } = render(<DraftEditor draftId="draft_1" onClose={() => {}} />);
    await waitFor(() => getByTestId('scene-canvas'));
    fireEvent.click(getByText('Zone'));
    expect(getByText('5–250 m')).toBeTruthy();
  });

  it('the prop scale field states its 0.25–4× range in the inspector', async () => {
    const { getByText, getByTestId } = render(<DraftEditor draftId="draft_1" onClose={() => {}} />);
    await waitFor(() => getByTestId('scene-canvas'));
    fireEvent.click(getByTestId('select-prop'));
    expect(await waitFor(() => getByText('0.25–4×'))).toBeTruthy();
  });

  it('the NPC level field states its 1–100 range in the placement form', async () => {
    const { getByText, getByTestId } = render(<DraftEditor draftId="draft_1" onClose={() => {}} />);
    await waitFor(() => getByTestId('scene-canvas'));
    fireEvent.click(getByText('NPC'));
    fireEvent.click(getByTestId('click-canvas'));
    expect(await waitFor(() => getByText('1–100'))).toBeTruthy();
  });
});
