// §9 Group B — the OKR forms bind to real objective ids.
// Check-ins, Dependencies and the Forecast used to take a free-text
// "goal / objective id"; objective ids (obj_N) are displayed nowhere
// in the lens, so human entries never matched the domain's id-keyed
// derivation and propagation read as dead. The forms now offer the
// caller's objectives as title-labelled selects carrying the real
// ids, and the Scorecard can populate itself from stored objectives.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  apiHelpers: { goals: {} },
  api: { get: async () => ({ data: {} }), delete: async () => ({}) },
}));

import { OKRWorkspace } from '@/components/goals/OKRWorkspace';
import { GoalsAnalyticsTools } from '@/components/goals/GoalsAnalyticsTools';

const FLAT = [
  { id: 'obj_1', title: 'Grow revenue', parentId: null, owner: null, team: null, level: 'company', keyResults: ['KR A', 'KR B'], progress: 60, progressSource: 'checkin', blockedBy: [] },
  { id: 'obj_2', title: 'Ship feature', parentId: null, owner: null, team: null, level: 'team', keyResults: [], progress: null, progressSource: null, blockedBy: [] },
];

function route(action: string, input: Record<string, unknown>) {
  if (action === 'alignmentTree') {
    return { data: { ok: true, result: { tree: [], flat: FLAT, stats: { objectiveCount: 2, rootCount: 2, maxDepth: 1, keyResultsLinked: 2, teams: [] } } } };
  }
  if (action === 'checkin' && input.op === 'list') {
    return { data: { ok: true, result: { checkins: [], stats: { count: 0, avgConfidence: 0, latestStatus: null, statusCounts: {} } } } };
  }
  if (action === 'checkin' && input.op === 'add') {
    return { data: { ok: true, result: { checkins: [{ id: 'chk_1', goalId: input.goalId, status: 'on_track', confidence: 0.7, progress: 40, note: '', period: '2026-10-31' }], objectiveProgress: { progress: 40, progressSource: 'checkin' }, stats: { count: 1, avgConfidence: 0.7, latestStatus: 'on_track', statusCounts: { on_track: 1 } } } } };
  }
  if (action === 'dependencies' && input.op === 'list') {
    return { data: { ok: true, result: { edges: [], blockedGoals: [], readyGoals: [], blockersByGoal: {}, stats: { edgeCount: 0, blockingCount: 0, nodeCount: 0 } } } };
  }
  if (action === 'dependencies' && input.op === 'link') {
    return { data: { ok: true, result: { edges: [{ id: 'dep_1', from: input.from, to: input.to, kind: input.kind }], blockedGoals: [input.to], readyGoals: [input.from], blockersByGoal: { [String(input.to)]: [input.from] }, stats: { edgeCount: 1, blockingCount: 1, nodeCount: 2 } } } };
  }
  if (action === 'progressForecast') {
    return { data: { ok: true, result: { message: 'Need at least 2 historical data points for forecasting.' } } };
  }
  if (action === 'okrScoring') {
    return { data: { ok: true, result: { overallScore: 60, overallStatus: 'yellow', objectives: [] } } };
  }
  return { data: { ok: true, result: {} } };
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation(async (_domain: string, action: string, input: Record<string, unknown>) => route(action, input || {}));
});

describe('Check-ins bind to the objective list', () => {
  it('offers objectives as a select (no free-text id field) and logs against the real id', async () => {
    render(<OKRWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: /Check-ins/ }));
    const select = await screen.findByLabelText('Objective');
    expect(screen.queryByPlaceholderText('Goal / objective id')).toBeNull();
    expect(screen.getByRole('option', { name: 'Grow revenue' })).toBeTruthy();
    fireEvent.change(select, { target: { value: 'obj_1' } });
    const logBtn = screen.getByRole('button', { name: /Log Check-in/ });
    await waitFor(() => expect(logBtn).not.toBeDisabled());
    fireEvent.click(logBtn);
    await waitFor(() => {
      const add = lensRun.mock.calls.find((c) => c[1] === 'checkin' && c[2]?.op === 'add');
      expect(add).toBeTruthy();
      expect(add[2].goalId).toBe('obj_1');
    });
  });
});

describe('Dependencies bind to the objective list', () => {
  it('links blocker -> blocked by real ids chosen from selects', async () => {
    render(<OKRWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: /Dependencies/ }));
    const from = await screen.findByLabelText('Blocker objective');
    const to = screen.getByLabelText('Blocked objective');
    expect(screen.queryByPlaceholderText('Blocker goal id')).toBeNull();
    fireEvent.change(from, { target: { value: 'obj_1' } });
    fireEvent.change(to, { target: { value: 'obj_2' } });
    fireEvent.click(screen.getByRole('button', { name: /Link dependency/ }));
    await waitFor(() => {
      const link = lensRun.mock.calls.find((c) => c[1] === 'dependencies' && c[2]?.op === 'link');
      expect(link).toBeTruthy();
      expect(link[2]).toMatchObject({ from: 'obj_1', to: 'obj_2', kind: 'blocks' });
    });
    // the blocked chip names the objective, not the raw id (the
    // title also appears in the <option>s — require a SPAN match,
    // i.e. the chip / edge row, not just the selects)
    const matches = await screen.findAllByText('Ship feature');
    expect(matches.some((el) => el.tagName === 'SPAN')).toBe(true);
  });
});

describe('Forecast binds to the objective list', () => {
  it('forecasts for the selected objective id', async () => {
    render(<GoalsAnalyticsTools />);
    fireEvent.click(screen.getByRole('button', { name: /Progress Forecast/ }));
    const select = await screen.findByLabelText('Objective');
    expect(screen.queryByPlaceholderText(/objective id \(as used in Check-ins\)/)).toBeNull();
    fireEvent.change(select, { target: { value: 'obj_1' } });
    fireEvent.click(screen.getByRole('button', { name: /^Forecast$/ }));
    await waitFor(() => {
      const fc = lensRun.mock.calls.find((c) => c[1] === 'progressForecast');
      expect(fc).toBeTruthy();
      expect(fc[2].goalId).toBe('obj_1');
    });
  });
});

describe('Scorecard populates from stored objectives', () => {
  it('Load my objectives fills the form with stored titles, KRs and check-in progress', async () => {
    render(<GoalsAnalyticsTools />);
    fireEvent.click(screen.getByRole('button', { name: /OKR Scorecard/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Load my objectives/ }));
    const titleInput = await screen.findByDisplayValue('Grow revenue');
    expect(titleInput).toBeTruthy();
    expect(screen.getByDisplayValue('KR A')).toBeTruthy();
    // KR current is the objective's derived progress (60)
    expect(screen.getAllByDisplayValue('60').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /^Score$/ }));
    await waitFor(() => {
      const sc = lensRun.mock.calls.find((c) => c[1] === 'okrScoring');
      expect(sc).toBeTruthy();
      const payload = sc[2].objectives;
      const grow = payload.find((o: { title: string }) => o.title === 'Grow revenue');
      expect(grow).toBeTruthy();
      expect(grow.keyResults[0]).toMatchObject({ title: 'KR A', current: 60, target: 100 });
    });
  });
});
