// §9 Group C — the Autonomy panel must not swallow its own refusals.
// load() used to clear actionError, and every action handler awaits
// load() right after setting the refusal — so the server's named
// refusal (capacity, blocked-by, role) was erased before render and
// Activate / Delete read as silent no-ops. A successful delete must
// also name what it removed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const goalsApi = vi.hoisted(() => ({
  status: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  activate: vi.fn(),
  remove: vi.fn(),
  evaluate: vi.fn(),
  approve: vi.fn(),
  progress: vi.fn(),
  complete: vi.fn(),
  abandon: vi.fn(),
  create: vi.fn(),
  autoPropose: vi.fn(),
  config: vi.fn(),
}));
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { goals: goalsApi },
  lensRun: async () => ({ data: { ok: true, result: {} } }),
  api: { get: async () => ({ data: {} }), delete: async () => ({}) },
}));

import { AgentAutonomyPanel } from '@/components/goals/AgentAutonomyPanel';

const STATUS = {
  ok: true,
  active: [],
  activeCount: 1,
  proposalCount: 1,
  stats: { proposed: 0, approved: 1, completed: 0, abandoned: 0 },
  config: { maxActiveGoals: 5, maxProposalsQueue: 10, evaluationThreshold: 0.7, autoProposalEnabled: false, founderApprovalRequired: true },
  invariants: {},
};
const GOAL = {
  id: 'goal_1', title: 'Discover patterns among high-value DTUs', type: 'pattern_discovery',
  state: 'approved', priority: 0.6, progress: 0, source: 'autonomous', createdAt: '2026-10-30T00:00:00.000Z',
};
const DETAIL = {
  ...GOAL, description: 'Analyse DTUs', evaluation: null, meta: {},
  deps: { requiredGoals: [], blockedBy: [] },
  progressDetail: { current: 0, target: 1 },
};

beforeEach(() => {
  for (const fn of Object.values(goalsApi)) fn.mockReset();
  goalsApi.status.mockResolvedValue({ data: STATUS });
  goalsApi.list.mockResolvedValue({ data: { ok: true, goals: [GOAL] } });
  goalsApi.get.mockResolvedValue({ data: { ok: true, goal: DETAIL } });
});

async function expandGoal() {
  render(<AgentAutonomyPanel />);
  const row = await screen.findByText('Discover patterns among high-value DTUs');
  fireEvent.click(row);
  await screen.findByRole('button', { name: /Activate/ });
}

describe('AgentAutonomyPanel refusals survive the reload', () => {
  it('an Activate refusal stays visible after the post-action load', async () => {
    goalsApi.activate.mockResolvedValue({ data: { ok: false, error: 'Blocked by incomplete goal: goal_9' } });
    await expandGoal();
    fireEvent.click(screen.getByRole('button', { name: /Activate/ }));
    expect(await screen.findByText(/Blocked by incomplete goal: goal_9/)).toBeTruthy();
    // and it is still there after the follow-up load has settled
    await waitFor(() => expect(goalsApi.list.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByText(/Blocked by incomplete goal: goal_9/)).toBeTruthy();
  });

  it('a Delete refusal stays visible after the post-action load', async () => {
    goalsApi.remove.mockResolvedValue({ data: { ok: false, error: 'Goal deletion requires owner/admin role' } });
    await expandGoal();
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm delete/ }));
    expect(await screen.findByText(/Goal deletion requires owner\/admin role/)).toBeTruthy();
    await waitFor(() => expect(goalsApi.list.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByText(/Goal deletion requires owner\/admin role/)).toBeTruthy();
  });

  it('a successful Delete names the removed goal', async () => {
    goalsApi.remove.mockResolvedValue({ data: { ok: true, deleted: true, goal: { id: 'goal_1', title: 'Discover patterns among high-value DTUs', state: 'approved' } } });
    await expandGoal();
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm delete/ }));
    expect(await screen.findByText(/"Discover patterns among high-value DTUs" deleted\./)).toBeTruthy();
  });
});
