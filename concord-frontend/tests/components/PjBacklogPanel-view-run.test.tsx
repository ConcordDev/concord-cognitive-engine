// Wave 4 gap-closure: `view-run` (execute a saved custom board/backlog view)
// had a real backend macro (server/domains/projects.js registerLensAction
// "view-run") with no caller anywhere — PjBacklogPanel's `runView` only
// reproduced the view's filters client-side. Pins that clicking a saved view
// now calls the real macro and renders its server-computed task list.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { PjBacklogPanel } from '@/components/projects/PjBacklogPanel';

const projectGetResult = {
  project: { id: 'proj_1' },
  members: [{ id: 'm1', name: 'Ada' }],
  sprints: [], milestones: [], labels: [], customFields: [],
};

const savedView = {
  id: 'vw_1', name: 'My urgent bugs',
  filters: { status: 'todo', assigneeId: null, type: 'bug', priority: 'urgent', label: null, sprintId: null, query: null, sort: 'created' },
};

function mockDefault() {
  lensRun.mockImplementation((domain: string, action: string) => {
    if (domain !== 'projects') return Promise.resolve({ data: { ok: true, result: null } });
    if (action === 'project-get') return Promise.resolve({ data: { ok: true, result: projectGetResult } });
    if (action === 'view-list') return Promise.resolve({ data: { ok: true, result: { views: [savedView], count: 1 } } });
    if (action === 'task-list') return Promise.resolve({ data: { ok: true, result: { tasks: [], count: 0 } } });
    return Promise.resolve({ data: { ok: true, result: null } });
  });
}

describe('PjBacklogPanel — view-run', () => {
  beforeEach(() => lensRun.mockReset());

  it('calls the real view-run macro (not a local re-filter) when a saved view is clicked', async () => {
    mockDefault();
    render(<PjBacklogPanel projectId="proj_1" onChange={() => {}} />);

    const viewButton = await screen.findByRole('button', { name: /My urgent bugs/i });

    lensRun.mockImplementationOnce(() => Promise.resolve({
      data: { ok: true, result: { view: 'My urgent bugs', tasks: [
        { id: 't1', ref: 'PRJ-1', title: 'Fix the thing', status: 'todo', priority: 'urgent', type: 'bug', points: 3, assigneeId: null, rank: 0 },
      ], count: 1 } },
    }));

    fireEvent.click(viewButton);

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('projects', 'view-run', { id: 'vw_1' }));
    expect(await screen.findByText('Fix the thing')).toBeInTheDocument();
    expect(await screen.findByText(/Viewing saved view "My urgent bugs"/i)).toBeInTheDocument();
  });

  it('"Back to filters" clears the active view and re-fetches via task-list', async () => {
    mockDefault();
    render(<PjBacklogPanel projectId="proj_1" onChange={() => {}} />);
    const viewButton = await screen.findByRole('button', { name: /My urgent bugs/i });

    lensRun.mockImplementationOnce(() => Promise.resolve({
      data: { ok: true, result: { view: 'My urgent bugs', tasks: [
        { id: 't1', ref: 'PRJ-1', title: 'Fix the thing', status: 'todo', priority: 'urgent', type: 'bug', points: 3, assigneeId: null, rank: 0 },
      ], count: 1 } },
    }));
    fireEvent.click(viewButton);
    await screen.findByText(/Viewing saved view/i);

    const callsBefore = lensRun.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /Back to filters/i }));

    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(callsBefore));
    await waitFor(() => expect(screen.queryByText(/Viewing saved view/i)).not.toBeInTheDocument());
    const lastTaskListCall = lensRun.mock.calls.filter((c) => c[1] === 'task-list').pop();
    expect(lastTaskListCall).toBeTruthy();
  });
});
