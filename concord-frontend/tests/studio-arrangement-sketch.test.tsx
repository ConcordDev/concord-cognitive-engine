import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

type Row = Record<string, unknown>;
const db = { markers: [] as Row[], clips: [] as Row[], tracks: [] as Row[], timeSignature: '4/4', calls: [] as string[], fail: '' };
let seq = 0;

const ok = (result: unknown) => ({ data: { ok: true, result, error: null } });
const refuse = (error: string) => ({ data: { ok: false, result: null, error } });

const lensRun = vi.fn(async (domain: string, action: string, input: Row = {}) => {
  db.calls.push(`${domain}.${action}`);
  if (domain !== 'studio') return ok({});
  if (db.fail === action) return refuse('server said no');
  switch (action) {
    case 'project-list': return ok({ projects: [{ id: 'p1', name: 'Demo' }] });
    case 'project-get': return ok({ project: { id: 'p1', timeSignature: db.timeSignature, bpm: 120, tracks: db.tracks } });
    case 'markers-list': return ok({ markers: [...db.markers].sort((a, b) => (a.timeBeats as number) - (b.timeBeats as number)) });
    case 'markers-add': { const m = { id: `m${++seq}`, projectId: 'p1', colour: '#fff', ...input }; db.markers.push(m); return ok({ marker: m }); }
    case 'markers-update': { const m = db.markers.find((x) => x.id === input.id)!; Object.assign(m, input); return ok({ marker: m }); }
    case 'markers-delete': db.markers = db.markers.filter((x) => x.id !== input.id); return ok({ id: input.id, deleted: true });
    case 'clips-list': return ok({ clips: db.clips });
    case 'clips-create': { const c = { id: `c${++seq}`, ...input }; db.clips.push(c); return ok({ clip: c }); }
    case 'clips-delete': db.clips = db.clips.filter((x) => x.id !== input.id); return ok({ id: input.id });
    default: return ok({});
  }
});
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...(a as [string, string, Row?])) }));
vi.mock('@/lib/daw/collab-log', () => ({ logStudioCollabEdit: vi.fn() }));

import { ArrangementSketch } from '@/components/studio/ArrangementSketch';

beforeEach(() => {
  db.markers = []; db.clips = []; db.calls = []; db.fail = ''; db.timeSignature = '4/4'; seq = 0;
  db.tracks = [{ id: 't1', name: 'Vocals', kind: 'audio' }, { id: 't2', name: 'Keys', kind: 'midi' }];
  lensRun.mockClear();
});
afterEach(cleanup);

const names = () => Array.from(document.querySelectorAll('[data-testid^="sketch-section-"]')).map((e) => e.querySelector('span')!.textContent);
const waitSketch = async () => { render(<ArrangementSketch lens="music" />); await waitFor(() => expect(screen.getByTestId('arrangement-project')).toHaveValue('p1')); await waitFor(() => expect(screen.getByTestId('arrangement-summary')).toBeTruthy()); };

describe('ArrangementSketch (Section Marker, Audio Pin, Arrangement Sketch)', () => {
  it('names the three tools and picks the first studio project on its own (Music mount)', async () => {
    await waitSketch();
    expect(screen.getByTestId('arrangement-sketch').getAttribute('data-lens-host')).toBe('music');
    expect(screen.getByText('Arrangement Sketch')).toBeTruthy();
    expect(screen.getByText('Section Marker')).toBeTruthy();
    expect(screen.getByText('Audio Pin')).toBeTruthy();
    expect(screen.getByTestId('arrangement-summary').textContent).toMatch(/0 sections · 0 bars · 4\/4 · 120 BPM/);
    expect(screen.getByText(/No sections yet/)).toBeTruthy();
  });

  it('Section Marker: presets append real section markers back to back, with lengths', async () => {
    await waitSketch();
    fireEvent.click(screen.getByTestId('arrangement-add-intro')); // 4 bars
    await waitFor(() => expect(names()).toEqual(['Intro']));
    fireEvent.click(screen.getByTestId('arrangement-add-verse')); // 8 bars
    await waitFor(() => expect(names()).toEqual(['Intro', 'Verse']));
    expect(db.markers.map((m) => [m.name, m.kind, m.timeBeats, m.lengthBeats])).toEqual([
      ['Intro', 'section', 0, 16],
      ['Verse', 'section', 16, 32],
    ]);
    expect(screen.getByTestId('arrangement-summary').textContent).toMatch(/2 sections · 12 bars/);
  });

  it('bars follow the project time signature (3/4 → 3 beats per bar)', async () => {
    db.timeSignature = '3/4';
    await waitSketch();
    fireEvent.click(screen.getByTestId('arrangement-add-intro'));
    await waitFor(() => expect(db.markers[0]?.lengthBeats).toBe(12)); // 4 bars × 3 beats
  });

  it('re-order, resize and delete re-lay-out the stored markers (no gaps, no overlaps)', async () => {
    await waitSketch();
    for (const t of ['intro', 'verse', 'chorus']) { fireEvent.click(screen.getByTestId(`arrangement-add-${t}`)); await waitFor(() => expect(db.markers.length).toBe(['intro', 'verse', 'chorus'].indexOf(t) + 1)); }
    await waitFor(() => expect(names()).toEqual(['Intro', 'Verse', 'Chorus']));

    fireEvent.click(screen.getByRole('button', { name: 'Move Verse earlier' }));
    await waitFor(() => expect(names()).toEqual(['Verse', 'Intro', 'Chorus']));
    const by = (n: string) => db.markers.find((m) => m.name === n)!;
    expect([by('Verse').timeBeats, by('Intro').timeBeats, by('Chorus').timeBeats]).toEqual([0, 32, 48]);

    fireEvent.click(screen.getByRole('button', { name: 'Intro one bar longer' })); // 4 -> 5 bars
    await waitFor(() => expect(by('Intro').lengthBeats).toBe(20));
    expect(by('Chorus').timeBeats).toBe(52); // shifted by one bar

    fireEvent.click(screen.getByRole('button', { name: 'Delete Verse' }));
    await waitFor(() => expect(names()).toEqual(['Intro', 'Chorus']));
    expect([by('Intro').timeBeats, by('Chorus').timeBeats]).toEqual([0, 20]); // gap closed
  });

  it('Audio Pin: pins a real audio clip at a bar on an audio track and lists it; the pin can be removed', async () => {
    await waitSketch();
    expect(screen.getByRole('combobox', { name: 'Pin track' }).textContent).toMatch(/Vocals/);
    expect(screen.getByRole('combobox', { name: 'Pin track' }).textContent).not.toMatch(/Keys/); // midi track excluded
    fireEvent.change(screen.getByLabelText('Pin name'), { target: { value: 'Verse vocal take 3' } });
    fireEvent.change(screen.getByLabelText('Pin at bar'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Pin length in bars'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('arrangement-pin-audio'));
    await waitFor(() => expect(db.clips.length).toBe(1));
    expect(db.clips[0]).toMatchObject({ name: 'Verse vocal take 3', kind: 'audio', trackId: 't1', startBeats: 16, lengthBeats: 8 });
    await waitFor(() => expect(screen.getByTestId(`audio-pin-${db.clips[0].id}`)).toBeTruthy());
    expect(screen.getByTestId(`audio-pin-${db.clips[0].id}`).getAttribute('title')).toMatch(/bar 5 · no audio attached/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove pin Verse vocal take 3' }));
    await waitFor(() => expect(db.clips.length).toBe(0));
  });

  it('with no audio track it says so instead of offering a pin that cannot be made', async () => {
    db.tracks = [{ id: 't2', name: 'Keys', kind: 'midi' }];
    await waitSketch();
    expect(screen.getByTestId('audio-pin-no-track')).toBeTruthy();
    expect(screen.queryByTestId('arrangement-pin-audio')).toBeNull();
  });

  it('a refused write shows the server reason in an alert and changes nothing', async () => {
    await waitSketch();
    db.fail = 'markers-add';
    fireEvent.click(screen.getByTestId('arrangement-add-intro'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/server said no/));
    expect(db.markers.length).toBe(0);
  });

  it('with no studio project it says how to get one, and writes nothing', async () => {
    lensRun.mockImplementationOnce(async () => ok({ projects: [] }));
    render(<ArrangementSketch lens="music" />);
    await waitFor(() => expect(screen.getByTestId('arrangement-empty')).toBeTruthy());
    expect(within(screen.getByTestId('arrangement-sketch')).queryByTestId('arrangement-add-intro')).toBeNull();
  });

  it('host-picked mode (Studio workbench) renders no second project picker', async () => {
    render(<ArrangementSketch projectId="p1" hostPicksProject lens="studio" />);
    await waitFor(() => expect(screen.getByTestId('arrangement-add-intro')).toBeTruthy());
    expect(screen.queryByTestId('arrangement-project')).toBeNull();
    expect(db.calls).not.toContain('studio.project-list');
  });
});
