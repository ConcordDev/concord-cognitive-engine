// FIX-011 — the Parity workbench's track picker read only the parity
// track store (project.tracks), so a project built in the DAW — whose
// tracks live in the DAW snapshot (project.daw.tracks) — showed
// "pick a track (0)" for a project project-list counted as 2 tracks.
// Pins the merged cascade: snapshot tracks list with their names, and
// their clips come from the snapshot; parity tracks still list and
// still read clips from clips-list.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ lensRun: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ lensRun: h.lensRun }));
vi.mock('@/components/panel-polish', () => ({ usePipeValue: () => null }));

const panelStub = () => null;
vi.mock('@/components/studio/ClipsTimelinePanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/MidiPianoRoll', () => ({ default: panelStub }));
vi.mock('@/components/studio/AutomationLanesPanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/BouncePanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/MarkersPanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/TempoMap', () => ({ default: panelStub }));
vi.mock('@/components/studio/PresetsLibraryPanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/SendsRouting', () => ({ default: panelStub }));
vi.mock('@/components/studio/ScenesLauncher', () => ({ default: panelStub }));
vi.mock('@/components/studio/ClipEditorPanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/DrumRackPanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/FxRackPanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/MidiMapPanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/QuantizePanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/RecordingPanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/ProjectIOPanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/CollabPanel', () => ({ default: panelStub }));
vi.mock('@/components/studio/ArrangementSketch', () => ({ default: panelStub }));

const DAW_PROJECT = {
  id: 'p1', name: 'My Song', tracks: [],
  daw: {
    tracks: [
      { id: 'trk_keys', name: 'Keys', type: 'midi', clips: [{ id: 'clip_1', name: 'Keys riff' }] },
      { id: 'trk_vox', name: 'Vox', type: 'audio', clips: [] },
    ],
  },
};
const PARITY_PROJECT = {
  id: 'p2', name: 'Parity Song', tracks: [{ id: 'trk_par', name: 'Parity Track', kind: 'midi' }], daw: null,
};

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

async function mount() {
  const { DawWorkbenchSection } = await import('../DawWorkbenchSection');
  return render(<DawWorkbenchSection />);
}

function selects() {
  return screen.getAllByRole('combobox') as HTMLSelectElement[];
}

beforeEach(() => {
  h.lensRun.mockReset();
  h.lensRun.mockImplementation(async (_d: string, action: string, input: Record<string, unknown>) => {
    if (action === 'project-list') {
      return { data: { ok: true, error: null, result: { projects: [
        { id: 'p1', name: 'My Song', trackCount: 2 },
        { id: 'p2', name: 'Parity Song', trackCount: 1 },
      ] } } };
    }
    if (action === 'project-get') {
      return { data: { ok: true, error: null, result: { project: input.id === 'p1' ? DAW_PROJECT : PARITY_PROJECT } } };
    }
    if (action === 'clips-list') {
      return { data: { ok: true, error: null, result: { clips: [{ id: 'clip_par', name: 'Parity clip' }] } } };
    }
    return { data: { ok: true, error: null, result: {} } };
  });
});
afterEach(() => { cleanup(); });

describe('DawWorkbenchSection track cascade (FIX-011)', () => {
  it('a DAW-built project lists its snapshot tracks and their clips', async () => {
    await mount();
    await settle();
    fireEvent.change(selects()[0], { target: { value: 'p1' } });
    await settle();
    const trackSelect = selects()[1];
    expect(trackSelect.textContent).toContain('pick a track (2)');
    expect(trackSelect.textContent).toContain('Keys');
    expect(trackSelect.textContent).toContain('Vox');
    fireEvent.change(trackSelect, { target: { value: 'trk_keys' } });
    await settle();
    const clipSelect = selects()[2];
    expect(clipSelect.textContent).toContain('pick a clip (1)');
    expect(clipSelect.textContent).toContain('Keys riff');
    // Snapshot clips never hit the parity clip store.
    expect(h.lensRun.mock.calls.filter((c) => c[1] === 'clips-list')).toHaveLength(0);
  });

  it('a parity project still lists its tracks and reads clips from clips-list', async () => {
    await mount();
    await settle();
    fireEvent.change(selects()[0], { target: { value: 'p2' } });
    await settle();
    const trackSelect = selects()[1];
    expect(trackSelect.textContent).toContain('pick a track (1)');
    expect(trackSelect.textContent).toContain('Parity Track');
    fireEvent.change(trackSelect, { target: { value: 'trk_par' } });
    await settle();
    expect(selects()[2].textContent).toContain('Parity clip');
    expect(h.lensRun.mock.calls.filter((c) => c[1] === 'clips-list')).toHaveLength(1);
  });
});
