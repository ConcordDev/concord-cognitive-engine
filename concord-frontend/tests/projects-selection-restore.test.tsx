import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/projects/PjBoardPanel', () => ({ PjBoardPanel: () => <div>board</div> }));
vi.mock('@/components/projects/PjBacklogPanel', () => ({ PjBacklogPanel: () => null }));
vi.mock('@/components/projects/PjTimelinePanel', () => ({ PjTimelinePanel: () => null }));
vi.mock('@/components/projects/PjSprintsPanel', () => ({ PjSprintsPanel: () => null }));
vi.mock('@/components/projects/PjReportsPanel', () => ({ PjReportsPanel: () => null }));
vi.mock('@/components/projects/PjPlanningPanel', () => ({ PjPlanningPanel: () => null }));
vi.mock('@/components/projects/PjTeamPanel', () => ({ PjTeamPanel: () => null }));
vi.mock('@/components/projects/PjCollabPanel', () => ({ PjCollabPanel: () => null }));
vi.mock('@/components/projects/PjSettingsPanel', () => ({ PjSettingsPanel: () => null }));
vi.mock('@/components/projects/PjPortfolioPanel', () => ({ PjPortfolioPanel: () => null }));

import { ProjectsSection } from '@/components/projects/ProjectsSection';
import { getLensState } from '@/lib/lens-state-persistence';

const vz = { id: 'prj_vz', name: 'Vantage', key: 'VZ1026', color: 'indigo', status: 'started', health: 'on_track', archived: false };
const br = { id: 'prj_br', name: 'Bridge', key: 'BR', color: 'teal', status: 'planned', health: 'on_track', archived: false };

function renderWithQuery(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

function dashCalls() {
  return lensRunMock.mock.calls.filter((c) => c[1] === 'project-dashboard').map((c) => (c[2] as { projectId?: string })?.projectId);
}

beforeEach(() => {
  window.localStorage.clear();
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_domain: string, action: string) => {
    if (action === 'project-list') return { data: { ok: true, result: { projects: [vz, br] } } };
    if (action === 'project-dashboard') return { data: { ok: true, result: null } };
    if (action === 'my-work') return { data: { ok: true, result: { count: 0 } } };
    if (action === 'triage-queue') return { data: { ok: true, result: { count: 0 } } };
    return { data: { ok: true, result: {} } };
  });
});

// FIX-projects-005 — a reload selected the first project in the list (the
// walk's VZ1026) instead of the project the user had selected. The selection
// now persists through the shared lens UI-state store and is restored on
// mount, the way Linear/Asana restore the last-viewed project.
describe('FIX-projects-005 — last selected project survives a reload', () => {
  it('selecting a project persists it, and a remount restores it instead of list[0]', async () => {
    const first = renderWithQuery(<ProjectsSection />);
    await waitFor(() => expect(screen.getByRole('button', { name: /BR Bridge/ })).toBeTruthy());
    // initial landing is the first project, as before
    await waitFor(() => expect(dashCalls()).toContain('prj_vz'));

    fireEvent.click(screen.getByRole('button', { name: /BR Bridge/ }));
    await waitFor(() => expect(dashCalls()).toContain('prj_br'));
    await waitFor(() => expect(getLensState('projects')?.activeProject).toBe('prj_br'));

    first.unmount();
    lensRunMock.mockClear();
    renderWithQuery(<ProjectsSection />);
    await waitFor(() => expect(screen.getByRole('button', { name: /BR Bridge/ })).toBeTruthy());
    // the restored mount loads Bridge's dashboard and never falls back to VZ1026
    await waitFor(() => expect(dashCalls()).toContain('prj_br'));
    expect(dashCalls()).not.toContain('prj_vz');
  });

  it('a persisted id that no longer exists falls back to the first project', async () => {
    window.localStorage.setItem('concord-lens-ui-state', JSON.stringify({
      projects: { state: { activeProject: 'prj_gone' }, savedAt: Date.now() },
    }));
    renderWithQuery(<ProjectsSection />);
    await waitFor(() => expect(screen.getByRole('button', { name: /BR Bridge/ })).toBeTruthy());
    await waitFor(() => expect(dashCalls()).toContain('prj_vz'));
    expect(dashCalls()).not.toContain('prj_gone');
  });
});
