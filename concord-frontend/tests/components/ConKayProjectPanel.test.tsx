/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/tests/components/ConKayProjectPanel.test.tsx
//
// V1.2 Wave B (Deep ConKay Agency) — pins ConKayProjectPanel's honest
// guarantees against the REAL macro shapes it calls (`agent_projects.list` /
// `.create` / `.get` / `.touch_opened`, server/domains/agent-projects.js):
//   - an empty project list renders the canonical EmptyState, never a
//     fabricated sample project;
//   - creating a project calls agent_projects.create with the typed name
//     and only adds the row once the backend confirms;
//   - a real project list renders each row's name + marathon-link count;
//   - Resume calls agent_projects.touch_opened, optimistically bumps the
//     "opened" state, then reconciles with the real returned project AND
//     expands the row to fetch + show the linked goal/marathon/memory state
//     via agent_projects.get;
//   - a rejected Resume rolls back to the exact prior list — no fake
//     "resumed" state left standing;
//   - the expanded detail view reports a dangling goal tree / vanished
//     marathon session plainly, matching lib/project-thread.js's honest
//     shapes, never hiding or inventing them.
//
// `lensRun` is the one mock surface — no fabricated data, matching the
// pattern already used by ConKayMemoryPanel.test.tsx (this panel's direct
// sibling in the same cockpit-lane registry).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ConKayProjectPanel, type ConKayProjectSummary } from '@/components/conkay/ConKayProjectPanel';

type MacroResponse = { data: { ok: boolean; result: unknown; error: string | null } };

const PROJECT: ConKayProjectSummary = {
  id: 'proj_abc123',
  name: 'Ship the R&D engine',
  goalTreeId: 'gt_1',
  createdAt: 1700000000,
  updatedAt: 1700000000,
  lastOpenedAt: null,
  marathonCount: 1,
};

function mockList(projects: ConKayProjectSummary[]) {
  lensRunMock.mockImplementation(
    (domain: string, action: string): Promise<MacroResponse> => {
      if (domain === 'agent_projects' && action === 'list') {
        return Promise.resolve({ data: { ok: true, result: { projects }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    },
  );
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('ConKayProjectPanel', () => {
  it('renders the canonical EmptyState when the user has no projects yet', async () => {
    mockList([]);

    render(<ConKayProjectPanel />);

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('agent_projects', 'list', {}));
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Empty state' })).toBeInTheDocument();
    expect(screen.queryByTestId('ck-project-list')).not.toBeInTheDocument();
  });

  it('renders a real project row with its name and marathon-link count', async () => {
    mockList([PROJECT]);

    render(<ConKayProjectPanel />);

    expect(await screen.findByTestId(`ck-project-row-${PROJECT.id}`)).toBeInTheDocument();
    expect(screen.getByText(PROJECT.name)).toBeInTheDocument();
    expect(screen.getByText('1 marathon')).toBeInTheDocument();
    expect(screen.getByText('never opened')).toBeInTheDocument();
  });

  it('creating a project calls agent_projects.create with the typed name and only adds the row on backend confirmation', async () => {
    mockList([]);
    const created: ConKayProjectSummary = {
      id: 'proj_new1', name: 'New thread', goalTreeId: null,
      createdAt: 1700000100, updatedAt: 1700000100, lastOpenedAt: null, marathonCount: 0,
    };
    lensRunMock.mockImplementation(
      (domain: string, action: string, input?: Record<string, unknown>): Promise<MacroResponse> => {
        if (domain === 'agent_projects' && action === 'list') {
          return Promise.resolve({ data: { ok: true, result: { projects: [] }, error: null } });
        }
        if (domain === 'agent_projects' && action === 'create') {
          expect(input?.name).toBe('New thread');
          return Promise.resolve({ data: { ok: true, result: { project: created }, error: null } });
        }
        return Promise.resolve({ data: { ok: true, result: {}, error: null } });
      },
    );

    render(<ConKayProjectPanel />);
    await screen.findByText('No projects yet');

    fireEvent.change(screen.getByLabelText('New project name'), { target: { value: 'New thread' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('agent_projects', 'create', { name: 'New thread' }),
    );
    expect(await screen.findByTestId(`ck-project-row-${created.id}`)).toBeInTheDocument();
    expect(screen.getByText('New thread')).toBeInTheDocument();
  });

  it('Resume calls agent_projects.touch_opened, then fetches + expands the real linked state via agent_projects.get', async () => {
    const resumed = { ...PROJECT, lastOpenedAt: 1700005000, updatedAt: 1700005000 };
    const detail = {
      ok: true,
      project: resumed,
      goalTree: {
        ok: true,
        tree: { id: 'gt_1', title: 'Two-step goal', description: '', status: 'active', root: null },
        progress: 0.5, total: 2, done: 1,
      },
      marathons: [
        { sessionId: 'mar_1', linkedAt: 1699999000, status: 'paused', title: 'Refactor pass', goal: 'refactor', totalTurns: 12, maxTurns: 200 },
      ],
      memory: { available: true, items: [{ id: 'convmem_1', kind: 'conversation_memory', title: 'Rocket telemetry chat', topics: ['rocket'], insights: ['discussed telemetry'], relevance: 2, updatedAt: null }] },
    };
    lensRunMock.mockImplementation(
      (domain: string, action: string, input?: Record<string, unknown>): Promise<MacroResponse> => {
        if (domain === 'agent_projects' && action === 'list') {
          return Promise.resolve({ data: { ok: true, result: { projects: [PROJECT] }, error: null } });
        }
        if (domain === 'agent_projects' && action === 'touch_opened') {
          expect(input?.projectId).toBe(PROJECT.id);
          return Promise.resolve({ data: { ok: true, result: { project: resumed }, error: null } });
        }
        if (domain === 'agent_projects' && action === 'get') {
          expect(input?.projectId).toBe(PROJECT.id);
          return Promise.resolve({ data: { ok: true, result: detail, error: null } });
        }
        return Promise.resolve({ data: { ok: true, result: {}, error: null } });
      },
    );

    render(<ConKayProjectPanel />);
    await screen.findByTestId(`ck-project-row-${PROJECT.id}`);

    fireEvent.click(screen.getByRole('button', { name: `Resume ${PROJECT.name}` }));

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('agent_projects', 'touch_opened', { projectId: PROJECT.id }),
    );
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('agent_projects', 'get', { projectId: PROJECT.id }),
    );
    // Reconciled with the REAL server timestamp, not the optimistic guess.
    await waitFor(() => expect(screen.getByText(/opened /)).toBeInTheDocument());
    // Resuming expands the row to show the real linked state.
    const detailEl = await screen.findByTestId(`ck-project-detail-${PROJECT.id}`);
    expect(detailEl).toHaveTextContent('Two-step goal');
    expect(detailEl).toHaveTextContent('1/2 done');
    expect(detailEl).toHaveTextContent('paused');
    expect(detailEl).toHaveTextContent('Refactor pass');
    expect(detailEl).toHaveTextContent('Rocket telemetry chat');
  });

  it('a rejected Resume rolls back to the exact prior list — no fake "resumed" state left standing', async () => {
    lensRunMock.mockImplementation(
      (domain: string, action: string): Promise<MacroResponse> => {
        if (domain === 'agent_projects' && action === 'list') {
          return Promise.resolve({ data: { ok: true, result: { projects: [PROJECT] }, error: null } });
        }
        if (domain === 'agent_projects' && action === 'touch_opened') {
          return Promise.resolve({ data: { ok: false, result: null, error: 'not_owned' } });
        }
        return Promise.resolve({ data: { ok: true, result: {}, error: null } });
      },
    );

    render(<ConKayProjectPanel />);
    await screen.findByTestId(`ck-project-row-${PROJECT.id}`);

    fireEvent.click(screen.getByRole('button', { name: `Resume ${PROJECT.name}` }));

    expect(await screen.findByTestId(`ck-project-row-error-${PROJECT.id}`)).toHaveTextContent('not_owned');
    // Rolled back to "never opened" — the optimistic bump did not stick.
    expect(screen.getByText('never opened')).toBeInTheDocument();
  });

  it('reports a dangling goal tree and a vanished marathon session plainly, never hiding or inventing them', async () => {
    const detail = {
      ok: true,
      project: PROJECT,
      goalTree: { ok: false, reason: 'tree_not_found', treeId: 'gt_1' },
      marathons: [{ sessionId: 'mar_gone', linkedAt: 1699999000, status: 'missing', reason: 'session_not_found' }],
      memory: { available: false, reason: 'no_state', items: [] },
    };
    lensRunMock.mockImplementation(
      (domain: string, action: string): Promise<MacroResponse> => {
        if (domain === 'agent_projects' && action === 'list') {
          return Promise.resolve({ data: { ok: true, result: { projects: [PROJECT] }, error: null } });
        }
        if (domain === 'agent_projects' && action === 'get') {
          return Promise.resolve({ data: { ok: true, result: detail, error: null } });
        }
        return Promise.resolve({ data: { ok: true, result: {}, error: null } });
      },
    );

    render(<ConKayProjectPanel />);
    const row = await screen.findByTestId(`ck-project-row-${PROJECT.id}`);
    fireEvent.click(row.querySelector('button')!);

    const detailEl = await screen.findByTestId(`ck-project-detail-${PROJECT.id}`);
    await waitFor(() => expect(detailEl).toHaveTextContent('Linked goal tree is gone (tree_not_found)'));
    expect(detailEl).toHaveTextContent('missing');
    expect(detailEl).toHaveTextContent('Not available in this session.');
  });
});
