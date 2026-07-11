/**
 * DraftEditor — scene-editor wiring contract (Wave-3 audit fixes).
 *
 * Pins three real backend-capability wires that were previously dead or
 * partially dead:
 *   1. `biomePalette` is actually threaded from the `biomes` macro result
 *      into <SceneCanvas> for the draft's current biome (was declared on
 *      SceneCanvas's props but never passed by the caller).
 *   2. Zone radius is user-controlled and passed through to `zone-add`
 *      (was hardcoded to 50 regardless of the already-macro-accepted
 *      `radius` param).
 *   3. Prop rotation/scale are editable post-placement via `prop-move`
 *      (previously display-only in the inspector even though `prop-move`
 *      already accepts + clamps both fields server-side).
 *   4. A prop drag that revisits the same integer cell twice fires the
 *      `prop-move` macro only once (network-spam guard on the continuous
 *      mousemove-driven drag path).
 *
 * SceneCanvas and BiomePreview are stubbed to thin, prop-inspecting shells
 * so the test stays on DraftEditor's own state machine, not their internals
 * (SceneCanvas's own rendering is unit-tested implicitly by being a pure,
 * dependency-free SVG plotter with no backend calls of its own).
 */

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

let lastSceneCanvasProps: Record<string, unknown> | null = null;
vi.mock('@/components/world-creator/SceneCanvas', () => ({
  SceneCanvas: (props: Record<string, unknown>) => {
    lastSceneCanvasProps = props;
    const onCanvasClick = props.onCanvasClick as (x: number, z: number) => void;
    const onSelect = props.onSelect as (kind: string, id: string) => void;
    const onMove = props.onMove as (kind: 'prop', id: string, x: number, z: number) => void;
    return React.createElement('div', { 'data-testid': 'scene-canvas' }, [
      React.createElement('button', { key: 'click', 'data-testid': 'click-canvas', onClick: () => onCanvasClick(10, 20) }, 'click'),
      React.createElement('button', { key: 'select', 'data-testid': 'select-prop', onClick: () => onSelect('prop', 'prop_1') }, 'select'),
      React.createElement('button', { key: 'drag', 'data-testid': 'drag-prop', onClick: () => onMove('prop', 'prop_1', 33, 44) }, 'drag'),
      React.createElement('button', { key: 'drag-same', 'data-testid': 'drag-prop-same', onClick: () => onMove('prop', 'prop_1', 33, 44) }, 'drag-same'),
    ]);
  },
}));

import { DraftEditor } from '@/components/world-creator/DraftEditor';

function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const DESERT_PALETTE = ['#c2986a', '#d4a96a', '#e8c98a', '#f0deb0'];
const DRAFT = {
  id: 'draft_1', name: 'Dune Camp', description: '', universeType: 'concordia-hub',
  template: null, biome: 'desert',
  rules: { combatLethality: 1, refusalSensitivity: 1, questDensity: 1, weatherIntensity: 1 },
  props: [{ id: 'prop_1', kind: 'rock', x: 0, z: 0, rotation: 0, scale: 1 }],
  spawnPoints: [{ id: 'spawn_1', name: 'Camp', x: 0, z: 0, isDefault: true }],
  zones: [], npcs: [], factions: [],
  terrain: { seed: 1, roughness: 0.5, waterLevel: 0.3 },
  visibility: 'private', publishedWorldId: null,
};
const BIOMES = [
  { id: 'temperate_forest', label: 'Temperate Forest', palette: ['#2d5016', '#3a6b1f', '#6b8e3a', '#8fa86b'] },
  { id: 'desert', label: 'Arid Desert', palette: DESERT_PALETTE },
];

function routed(overrides: Record<string, (params: Record<string, unknown>) => Promise<unknown>>) {
  return (_domain: string, action: string, params: Record<string, unknown>) => {
    if (overrides[action]) return overrides[action](params);
    if (action === 'draft-get') return reply({ draft: DRAFT });
    if (action === 'biomes') return reply({ biomes: BIOMES });
    return reply({});
  };
}

beforeEach(() => {
  lensRun.mockReset();
  lastSceneCanvasProps = null;
});

describe('DraftEditor — scene wiring (Wave-3 audit fixes)', () => {
  it('threads the current biome palette into SceneCanvas (was declared-but-unwired)', async () => {
    lensRun.mockImplementation(routed({}));
    render(<DraftEditor draftId="draft_1" onClose={() => {}} />);
    await waitFor(() => expect(lastSceneCanvasProps).toBeTruthy());
    await waitFor(() => expect(lastSceneCanvasProps?.biomePalette).toEqual(DESERT_PALETTE));
  });

  it('zone-add uses the user-set radius, not a hardcoded 50', async () => {
    lensRun.mockImplementation(routed({}));
    const { getByText, getByLabelText, getByTestId } = render(<DraftEditor draftId="draft_1" onClose={() => {}} />);
    await waitFor(() => getByTestId('scene-canvas'));

    fireEvent.click(getByText('Zone'));
    const radiusInput = getByLabelText('Zone radius in meters');
    fireEvent.change(radiusInput, { target: { value: '120' } });

    lensRun.mockClear();
    lensRun.mockImplementation(routed({
      'zone-add': (params) => { expect(params.radius).toBe(120); return reply({ zone: { id: 'z1' }, zoneCount: 1 }); },
    }));
    fireEvent.click(getByTestId('click-canvas'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('world-creator', 'zone-add',
      expect.objectContaining({ draftId: 'draft_1', kind: 'safe', x: 10, z: 20, radius: 120 })));
  });

  it('prop rotation/scale edits in the inspector call prop-move with the new value', async () => {
    lensRun.mockImplementation(routed({}));
    const { getByTestId, getByLabelText } = render(<DraftEditor draftId="draft_1" onClose={() => {}} />);
    await waitFor(() => getByTestId('scene-canvas'));

    fireEvent.click(getByTestId('select-prop'));
    const rotationInput = await waitFor(() => getByLabelText('Prop rotation in degrees'));

    lensRun.mockClear();
    lensRun.mockImplementation(routed({
      'prop-move': (params) => { expect(params).toMatchObject({ draftId: 'draft_1', propId: 'prop_1', rotation: 180 }); return reply({ prop: { ...DRAFT.props[0], rotation: 180 } }); },
    }));
    fireEvent.change(rotationInput, { target: { value: '180' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('world-creator', 'prop-move',
      expect.objectContaining({ draftId: 'draft_1', propId: 'prop_1', rotation: 180 })));
  });

  it('dragging a prop to the same integer cell twice fires prop-move only once (dedupe)', async () => {
    lensRun.mockImplementation(routed({
      'prop-move': () => reply({ prop: { ...DRAFT.props[0], x: 33, z: 44 } }),
    }));
    const { getByTestId } = render(<DraftEditor draftId="draft_1" onClose={() => {}} />);
    await waitFor(() => getByTestId('scene-canvas'));

    lensRun.mockClear();
    fireEvent.click(getByTestId('drag-prop'));
    fireEvent.click(getByTestId('drag-prop-same'));
    await waitFor(() => expect(lensRun.mock.calls.filter((c) => c[1] === 'prop-move').length).toBe(1));
  });
});

describe('DraftEditor — Wave-4 gap closure (npc-place form + zone/spawn naming)', () => {
  it('NPC placement opens an inline form (not window.prompt) and sends name+backstory+level to npc-place', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    lensRun.mockImplementation(routed({}));
    const { getByText, getByTestId, getByLabelText } = render(<DraftEditor draftId="draft_1" onClose={() => {}} />);
    await waitFor(() => getByTestId('scene-canvas'));

    fireEvent.click(getByText('NPC'));
    fireEvent.click(getByTestId('click-canvas'));

    // the click must NOT immediately call npc-place, nor use window.prompt —
    // it should open the inline form instead.
    expect(promptSpy).not.toHaveBeenCalled();
    expect(lensRun.mock.calls.some((c) => c[1] === 'npc-place')).toBe(false);

    const nameInput = await waitFor(() => getByLabelText('NPC name'));
    fireEvent.change(nameInput, { target: { value: 'Old Seam' } });
    fireEvent.change(getByLabelText('NPC backstory'), { target: { value: 'A quiet keeper of the plaza well.' } });
    fireEvent.change(getByLabelText('NPC level'), { target: { value: '12' } });

    lensRun.mockClear();
    lensRun.mockImplementation(routed({
      'npc-place': (params) => {
        expect(params).toMatchObject({
          draftId: 'draft_1', name: 'Old Seam', backstory: 'A quiet keeper of the plaza well.',
          level: 12, archetype: 'warrior', x: 10, z: 20,
        });
        return reply({ npc: { id: 'npc_1' }, npcCount: 1 });
      },
    }));
    fireEvent.click(getByText('+ Place NPC'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('world-creator', 'npc-place',
      expect.objectContaining({ name: 'Old Seam', backstory: 'A quiet keeper of the plaza well.', level: 12 })));

    promptSpy.mockRestore();
  });

  it('cancelling the NPC form discards the pending placement without calling npc-place', async () => {
    lensRun.mockImplementation(routed({}));
    const { getByText, getByTestId } = render(<DraftEditor draftId="draft_1" onClose={() => {}} />);
    await waitFor(() => getByTestId('scene-canvas'));

    fireEvent.click(getByText('NPC'));
    fireEvent.click(getByTestId('click-canvas'));
    await waitFor(() => getByText('✕ cancel'));

    lensRun.mockClear();
    fireEvent.click(getByText('✕ cancel'));
    expect(lensRun.mock.calls.some((c) => c[1] === 'npc-place')).toBe(false);
  });

  it('zone-add sends the user-set zone name instead of always relying on the server default', async () => {
    lensRun.mockImplementation(routed({}));
    const { getByText, getByTestId, getByLabelText } = render(<DraftEditor draftId="draft_1" onClose={() => {}} />);
    await waitFor(() => getByTestId('scene-canvas'));

    fireEvent.click(getByText('Zone'));
    fireEvent.change(getByLabelText('Zone name'), { target: { value: 'Northgate Sanctuary' } });

    lensRun.mockClear();
    lensRun.mockImplementation(routed({
      'zone-add': (params) => { expect(params.name).toBe('Northgate Sanctuary'); return reply({ zone: { id: 'z1' }, zoneCount: 1 }); },
    }));
    fireEvent.click(getByTestId('click-canvas'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('world-creator', 'zone-add',
      expect.objectContaining({ name: 'Northgate Sanctuary' })));
  });

  it('leaving the zone name blank still places a zone (server default fallback preserved)', async () => {
    lensRun.mockImplementation(routed({}));
    const { getByText, getByTestId } = render(<DraftEditor draftId="draft_1" onClose={() => {}} />);
    await waitFor(() => getByTestId('scene-canvas'));

    fireEvent.click(getByText('Zone'));
    lensRun.mockClear();
    lensRun.mockImplementation(routed({
      'zone-add': (params) => { expect(params.name).toBe(''); return reply({ zone: { id: 'z1' }, zoneCount: 1 }); },
    }));
    fireEvent.click(getByTestId('click-canvas'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('world-creator', 'zone-add',
      expect.objectContaining({ name: '' })));
  });

  it('spawn-add sends the user-set spawn name instead of always relying on the server default', async () => {
    lensRun.mockImplementation(routed({}));
    const { getByText, getByTestId, getByLabelText } = render(<DraftEditor draftId="draft_1" onClose={() => {}} />);
    await waitFor(() => getByTestId('scene-canvas'));

    fireEvent.click(getByText('Spawn point'));
    fireEvent.change(getByLabelText('Spawn point name'), { target: { value: 'Riverbend Camp' } });

    lensRun.mockClear();
    lensRun.mockImplementation(routed({
      'spawn-add': (params) => { expect(params.name).toBe('Riverbend Camp'); return reply({ spawn: { id: 's1' }, spawnCount: 1 }); },
    }));
    fireEvent.click(getByTestId('click-canvas'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('world-creator', 'spawn-add',
      expect.objectContaining({ name: 'Riverbend Camp' })));
  });
});
