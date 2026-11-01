import React, { Suspense } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// next/dynamic -> React.lazy so the workspace's lazy surfaces resolve under vitest.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<React.ComponentType<unknown>>) => {
    const L = React.lazy(async () => ({ default: await loader() }));
    return (props: Record<string, unknown>) => <Suspense fallback={null}><L {...props} /></Suspense>;
  },
}));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: () => null }));
// The DAW itself is a separate, heavy surface: stand in a marker so we can prove it stays mounted.
vi.mock('@/components/studio/daw/StudioApp', () => ({ StudioApp: () => <div data-testid="daw-stub">DAW</div> }));
const lensRun = vi.fn(async (_d: string, action: string) => {
  if (action === 'project-list') return { data: { ok: true, result: { projects: [{ id: 'p1', name: 'Demo' }] } } };
  if (action === 'project-get') return { data: { ok: true, result: { project: { id: 'p1', timeSignature: '4/4', bpm: 120, tracks: [{ id: 't1', name: 'Vocals', kind: 'audio' }] } } } };
  return { data: { ok: true, result: { markers: [], clips: [], projects: [] } } };
});
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...(a as [string, string])), api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) } }));
vi.mock('@/lib/daw/collab-log', () => ({ logStudioCollabEdit: vi.fn() }));
// StudioActionPanel is a large, separately tested panel; the surface test only needs it to mount.
vi.mock('@/components/studio/StudioActionPanel', () => ({ StudioActionPanel: () => <div data-testid="action-panel-stub" /> }));
// Panels the other tabs would mount are not exercised here.
vi.mock('@/components/studio/ClipsTimelinePanel', () => ({ default: () => <div data-testid="clips-stub" /> }));

import { StudioDawWorkspace } from '@/components/studio/StudioDawWorkspace';

afterEach(cleanup);

describe('Studio lens: second surface (parity workbench)', () => {
  it('opens on the DAW with a surface switch; the workbench is not mounted yet', async () => {
    render(<StudioDawWorkspace />);
    await waitFor(() => expect(screen.getByTestId('daw-stub')).toBeTruthy());
    expect(screen.getByTestId('studio-surface-switch')).toBeTruthy();
    expect(screen.getByTestId('studio-surface-daw').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('studio-surface-workbench').textContent).toBe('Parity workbench');
    expect(screen.queryByTestId('studio-parity-workbench')).toBeNull();
    expect(lensRun).not.toHaveBeenCalled(); // opening the Studio costs nothing extra
  });

  it('Parity workbench: shows the Session workbench on the Arrangement Sketch (Section Marker + Audio Pin), DAW stays mounted', async () => {
    render(<StudioDawWorkspace />);
    fireEvent.click(screen.getByTestId('studio-surface-workbench'));
    await waitFor(() => expect(screen.getByTestId('studio-parity-workbench')).toBeTruthy());
    expect(screen.getByText('Session workbench')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arrangement' })).toBeTruthy();
    // pick a project in the workbench's own picker -> the sketch's tools appear
    await waitFor(() => expect(screen.getAllByRole('combobox')[0].textContent).toMatch(/Demo/));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p1' } });
    await waitFor(() => expect(screen.getByTestId('arrangement-sketch')).toBeTruthy());
    expect(screen.getByText('Arrangement Sketch')).toBeTruthy();
    expect(screen.getByText('Section Marker')).toBeTruthy();
    expect(screen.getByText('Audio Pin')).toBeTruthy();
    expect(screen.getByTestId('arrangement-pin-audio')).toBeTruthy();
    expect(screen.getByTestId('action-panel-stub')).toBeTruthy(); // Studio session actions mounted with it
    // the DAW is hidden, not unmounted
    expect(screen.getByTestId('studio-surface-daw-panel').className).toMatch(/hidden/);
    expect(screen.getByTestId('daw-stub')).toBeTruthy();
    // and the workbench has exactly one project picker for the sketch (the host's)
    expect(screen.queryByTestId('arrangement-project')).toBeNull();
  });

  it('switching back to the DAW hides the workbench but keeps its state mounted', async () => {
    render(<StudioDawWorkspace />);
    fireEvent.click(screen.getByTestId('studio-surface-workbench'));
    await waitFor(() => expect(screen.getByTestId('studio-parity-workbench')).toBeTruthy());
    fireEvent.click(screen.getByTestId('studio-surface-daw'));
    expect(screen.getByTestId('studio-surface-workbench-panel').className).toMatch(/hidden/);
    expect(screen.getByTestId('studio-surface-daw-panel').className).not.toMatch(/hidden/);
    expect(screen.getByTestId('studio-parity-workbench')).toBeTruthy();
  });
});
