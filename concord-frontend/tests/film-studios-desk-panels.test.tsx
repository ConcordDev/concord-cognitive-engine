// Behavior test for FIX-film-studios-002: opening a production must
// expose the production desk — script, screenplay, shots, schedule,
// budget, edit/timeline, media — whose panels shipped but were
// mounted on no screen (the page's own header said so). Pins: no
// desk before a production opens; the tab strip appears once one is
// open; switching tabs swaps the mounted panel (the shots tab asks
// the server for the production's scenes/shots). The api client is
// mocked at the network boundary.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  api: { post: vi.fn(), get: vi.fn(), delete: vi.fn(), put: vi.fn() },
}));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import FilmStudiosPage from '@/app/lenses/film-studios/page';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation((_d: string, action: string) => {
    if (action === 'project-list') return ok({ projects: [{ id: 'prod_1', title: 'Harbour Lights', format: 'feature' }] });
    if (action === 'scene-list') return ok({ scenes: [{ id: 'sc_1', location: 'PIER', intExt: 'EXT', timeOfDay: 'DAY', number: '1', slugline: 'EXT. PIER - DAY', breakdownElements: [], pages: 1 }] });
    if (action === 'shot-list') return ok({ shots: [{ id: 'sh_1', sceneId: 'sc_1', shotType: 'WS', description: 'Opening wide', size: 'WS', angle: 'EYE_LEVEL', movement: 'STATIC' }] });
    // every other desk macro gets a benign empty superset shape
    return ok({ scenes: [], revisions: [], shots: [], items: [], rows: [], entries: [], sequences: [], versions: [], assets: [], days: [], cast: [], crew: [], scenesCount: 0 });
  });
});

describe('film studios production desk (FIX-film-studios-002)', () => {
  it('mounts the desk panels for the open production', async () => {
    render(<FilmStudiosPage />);
    // roster loads; no desk until a production is open
    const title = await screen.findByText('Harbour Lights');
    expect(screen.queryByTestId('film-desk-tab-shots')).toBeNull();
    fireEvent.click(title);
    // desk appears with the full workflow tab set
    expect(await screen.findByTestId('film-desk-tab-script')).toBeTruthy();
    expect(screen.getByTestId('film-desk-tab-screenplay')).toBeTruthy();
    expect(screen.getByTestId('film-desk-tab-shots')).toBeTruthy();
    expect(screen.getByTestId('film-desk-tab-schedule')).toBeTruthy();
    expect(screen.getByTestId('film-desk-tab-budget')).toBeTruthy();
    expect(screen.getByTestId('film-desk-tab-edit')).toBeTruthy();
    expect(screen.getByTestId('film-desk-tab-media')).toBeTruthy();
    // switching to Shots mounts the shots panel, which reads the
    // production's scenes and (with a scene active) its shot list
    fireEvent.click(screen.getByTestId('film-desk-tab-shots'));
    await waitFor(() => {
      const actions = lensRun.mock.calls.map((c) => c[1]);
      expect(actions).toContain('shot-list');
    });
    const shotCall = lensRun.mock.calls.find((c) => c[1] === 'shot-list');
    expect(shotCall![2]).toEqual(expect.objectContaining({ sceneId: 'sc_1' }));
  });
});
