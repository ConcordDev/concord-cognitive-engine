import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const created = { id: 'prj_9', name: 'Bridge', key: 'BR', color: 'indigo', status: 'planned', health: 'on_track', archived: false };

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string) => {
    if (action === 'project-list') return { data: { ok: true, result: { projects: [] } } };
    if (action === 'project-create') return { data: { ok: true, result: { project: created } } };
    if (action === 'project-dashboard') return { data: { ok: true, result: null } };
    return { data: { ok: true, result: {} } };
  });
});

describe('ProjectsSection create path', () => {
  it('opens from the primary New project event, creates, and the project is still there after a reload', async () => {
    const { unmount } = render(<ProjectsSection />);
    await waitFor(() => expect(screen.getByText(/Nothing in the substrate/)).toBeTruthy());
    expect(screen.queryByLabelText('New project name')).toBeNull();

    fireEvent(window, new Event('projects:new'));
    const name = await screen.findByLabelText('New project name');
    fireEvent.change(name, { target: { value: 'Bridge' } });
    fireEvent.change(screen.getByLabelText('Project key'), { target: { value: 'BR' } });

    let listed = false;
    lensRunMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'project-create') return { data: { ok: true, result: { project: created } } };
      if (action === 'project-list') {
        return { data: { ok: true, result: { projects: listed ? [created] : [] } } };
      }
      return { data: { ok: true, result: null } };
    });
    listed = true;
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /BR Bridge/ })).toBeTruthy());
    const createCall = lensRunMock.mock.calls.find((c) => c[1] === 'project-create');
    expect(createCall?.[2]).toEqual({ name: 'Bridge', key: 'BR' });

    unmount();
    listed = true;
    render(<ProjectsSection />);
    await waitFor(() => expect(screen.getByRole('button', { name: /BR Bridge/ })).toBeTruthy());
  });
});
