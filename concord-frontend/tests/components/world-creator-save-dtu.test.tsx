// Audit fix sweep (PR #2356) — FIX-world-creator-015: World Creator
// had no Save-as-DTU for the world being authored (its only
// SaveAsDtuButton saved Reddit inspiration posts). The DraftEditor
// header now saves the draft itself as a private DTU via the standing
// dtu.create path — full draft in the machine payload, the author's
// own-work provenance (no public-data source) — verified by read-back
// before the save is claimed, with failures in the editor's alert.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
  apiHelpers: {},
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/world-creator/SceneCanvas', () => ({ SceneCanvas: () => null }));
vi.mock('@/components/world-creator/BiomePreview', () => ({ BiomePreview: () => null }));

import { DraftEditor } from '@/components/world-creator/DraftEditor';

const DRAFT = {
  id: 'draft1', name: 'Test World', description: 'a small world', universeType: 'fantasy',
  template: null, biome: 'forest', rules: {},
  props: [{ id: 'p1', kind: 'tree', x: 1, z: 2, rotation: 0, scale: 1 }],
  spawnPoints: [], zones: [], npcs: [], factions: [],
  terrain: { seed: 7, roughness: 0.5, waterLevel: 0.2 },
  visibility: 'private', publishedWorldId: null,
};

let createResult: { data: { ok: boolean; error?: string; result?: unknown } } =
  { data: { ok: true, result: { dtu: { id: 'dtu_test1' } } } };

beforeEach(() => {
  lensRunMock.mockReset();
  createResult = { data: { ok: true, result: { dtu: { id: 'dtu_test1' } } } };
  lensRunMock.mockImplementation(async (domain: string, action: string) => {
    if (domain === 'world-creator' && action === 'draft-get') return { data: { ok: true, result: { draft: DRAFT } } };
    if (domain === 'world-creator' && action === 'biomes') return { data: { ok: true, result: { biomes: [] } } };
    if (domain === 'dtu' && action === 'create') return createResult;
    if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_test1' } } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('DraftEditor Save as DTU (FIX-world-creator-015)', () => {
  it('the editor header offers Save as DTU for the draft', async () => {
    render(<DraftEditor draftId="draft1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save as DTU' })).toBeTruthy());
  });

  it('saves the draft as a private DTU with the draft in the machine payload, then reads it back', async () => {
    render(<DraftEditor draftId="draft1" onClose={() => {}} />);
    const btn = await screen.findByRole('button', { name: 'Save as DTU' });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(/Saved as DTU dtu_test1/)).toBeTruthy());
    const createCall = lensRunMock.mock.calls.find((c) => c[0] === 'dtu' && c[1] === 'create');
    expect(createCall).toBeTruthy();
    const params = createCall![2] as { title: string; source: string; meta: { visibility: string }; machine: { kind: string; draft: { id: string } } };
    expect(params.title).toBe('Test World');
    expect(params.source).toBe('world-creator:draft');
    expect(params.meta.visibility).toBe('private');
    expect(params.machine.kind).toBe('world_creator_draft');
    expect(params.machine.draft.id).toBe('draft1');
    expect(lensRunMock.mock.calls.some((c) => c[0] === 'dtu' && c[1] === 'get')).toBe(true);
  });

  it('a refused save lands in the alert and claims nothing', async () => {
    createResult = { data: { ok: false, error: 'record store refused' } };
    render(<DraftEditor draftId="draft1" onClose={() => {}} />);
    const btn = await screen.findByRole('button', { name: 'Save as DTU' });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('record store refused'));
    expect(screen.queryByText(/Saved as DTU/)).toBeNull();
  });
});
