// concord-frontend/tests/vote-build.test.tsx
//
// Vote full lens build (B2) — pins:
//   F3  an OPEN poll's Results read provisional ("leading"), never the
//       final PASSED / WINNER language
//   F4  a closed tied poll renders the tie — TIE badges, no WINNER
//   F1  a closed zero-ballot poll renders the unresolved state
//   F5  a failed poll-list load renders an error state, never the
//       "No governance polls yet." empty state
//   F6  poll-create carries the signed-in creator's display name
//   F7  IRV elimination rounds render with per-round counts
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GovernanceWorkbench } from '@/components/vote/GovernanceWorkbench';
import { lensRun } from '@/lib/api/client';

vi.mock('@/lib/api/client', () => ({ lensRun: vi.fn() }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));
vi.mock('@/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { user: { id: 'u1', username: 'tester', displayName: 'Tester Person' } } }),
}));

const lensRunMock = vi.mocked(lensRun);

const basePoll = {
  description: null, owner: 'founder1', ownerLabel: 'Founder One',
  createdAt: '2026-11-01T00:00:00Z', deadline: null, closedAt: null,
  quorum: 0, passThreshold: null, eligibility: 'all', eligibleVoters: [],
  weighting: 'equal', scoreMax: 5, creditBudget: 100,
};
const POLL_OPEN: any = { ...basePoll, id: 'p-open', title: 'Open Poll', method: 'plurality', options: ['Opt A', 'Opt B'], status: 'open', ballotCount: 1 };
const POLL_TIED: any = { ...basePoll, id: 'p-tied', title: 'Tied Poll', method: 'approval', options: ['Opt A', 'Opt B'], status: 'closed', ballotCount: 1, closedAt: '2026-11-02T00:00:00Z' };
const POLL_EMPTY: any = { ...basePoll, id: 'p-empty', title: 'Empty Poll', method: 'plurality', options: ['Yes', 'No'], status: 'closed', ballotCount: 0, closedAt: '2026-11-02T00:00:00Z' };
const POLL_RANKED: any = { ...basePoll, id: 'p-ranked', title: 'Ranked Poll', method: 'ranked', options: ['A', 'B', 'C'], status: 'closed', ballotCount: 7, closedAt: '2026-11-02T00:00:00Z' };

function resultsFor(poll: any) {
  const common = { pollId: poll.id, title: poll.title, method: poll.method, delegatedBallots: 0, delegators: [], consensusSeries: [] };
  if (poll.id === 'p-open') {
    return { ...common, status: 'open',
      tally: { method: 'plurality', ranking: [{ option: 'Opt A', votes: 1, share: 1 }, { option: 'Opt B', votes: 0, share: 0 }], winner: 'Opt A', tied: [], rounds: null },
      resolution: { outcome: 'passed', detail: 'Opt A won under plurality voting.', quorumMet: true, quorum: 0, totalBallots: 1 },
      chartData: [{ option: 'Opt A', votes: 1 }, { option: 'Opt B', votes: 0 }] };
  }
  if (poll.id === 'p-tied') {
    return { ...common, status: 'closed',
      tally: { method: 'approval', ranking: [{ option: 'Opt A', votes: 1, share: 1 }, { option: 'Opt B', votes: 1, share: 1 }], winner: null, tied: ['Opt A', 'Opt B'], rounds: null },
      resolution: { outcome: 'tied', detail: 'Opt A and Opt B are tied under approval voting — no winner.', quorumMet: true, quorum: 0, totalBallots: 1 },
      chartData: [{ option: 'Opt A', votes: 1 }, { option: 'Opt B', votes: 1 }] };
  }
  if (poll.id === 'p-empty') {
    return { ...common, status: 'closed',
      tally: { method: 'plurality', ranking: [{ option: 'Yes', votes: 0, share: 0 }, { option: 'No', votes: 0, share: 0 }], winner: null, tied: [], rounds: null },
      resolution: { outcome: 'unresolved', detail: 'No ballots cast — this poll has no outcome.', quorumMet: true, quorum: 0, totalBallots: 0 },
      chartData: [{ option: 'Yes', votes: 0 }, { option: 'No', votes: 0 }] };
  }
  return { ...common, status: 'closed',
    tally: { method: 'ranked', ranking: [{ option: 'C', votes: 5, share: 0.714 }, { option: 'A', votes: 2, share: 0.286 }], winner: 'C', tied: [],
      rounds: [
        { round: 1, tally: [{ option: 'C', votes: 3, share: 0.43 }, { option: 'A', votes: 2, share: 0.29 }, { option: 'B', votes: 2, share: 0.29 }], exhausted: 0 },
        { round: 2, tally: [{ option: 'C', votes: 5, share: 0.71 }, { option: 'A', votes: 2, share: 0.29 }], exhausted: 0 },
      ] },
    resolution: { outcome: 'passed', detail: 'C won under ranked voting.', quorumMet: true, quorum: 0, totalBallots: 7 },
    chartData: [{ option: 'C', votes: 5 }, { option: 'A', votes: 2 }] };
}

let pollsFixture: any[] = [];
let listFails = false;
function installLensRun() {
  lensRunMock.mockImplementation(async (_domain: string, verb: string, params?: { pollId?: string }) => {
    const ok = (result: unknown) => ({ data: { ok: true, result } });
    switch (verb) {
      case 'poll-list': return listFails ? { data: { ok: false, error: 'backend exploded' } } : ok({ polls: pollsFixture, count: pollsFixture.length });
      case 'poll-results': {
        const poll = pollsFixture.find((p) => p.id === params?.pollId) || pollsFixture[0];
        return ok(resultsFor(poll));
      }
      case 'poll-create': return ok({ poll: { ...POLL_OPEN, id: 'p-new' } });
      default: return ok({});
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  pollsFixture = [];
  listFails = false;
  installLensRun();
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

async function openResults() {
  fireEvent.click(await screen.findByRole('button', { name: /Results/ }));
}

describe('Vote build', () => {
  it('F3: an open poll reads provisional — leading, not passed', async () => {
    pollsFixture = [POLL_OPEN];
    installLensRun();
    wrap(<GovernanceWorkbench />);
    await openResults();
    expect(await screen.findByText(/Provisional — voting still open/)).toBeTruthy();
    expect(screen.getByText(/Opt A is leading under plurality voting/)).toBeTruthy();
    expect(screen.getByText('LEADING')).toBeTruthy();
    expect(screen.queryByText('WINNER')).toBeNull();
    expect(screen.queryByText(/Opt A won under/)).toBeNull();
  });

  it('F4: a closed tied poll renders the tie, not a winner', async () => {
    pollsFixture = [POLL_TIED];
    installLensRun();
    wrap(<GovernanceWorkbench />);
    await openResults();
    expect(await screen.findByText(/are tied under approval voting/)).toBeTruthy();
    expect(screen.getAllByText('TIE')).toHaveLength(2);
    expect(screen.queryByText('WINNER')).toBeNull();
  });

  it('F1: a closed zero-ballot poll renders the unresolved state', async () => {
    pollsFixture = [POLL_EMPTY];
    installLensRun();
    wrap(<GovernanceWorkbench />);
    await openResults();
    expect(await screen.findByText(/No ballots cast — this poll has no outcome\./)).toBeTruthy();
    expect(screen.queryByText('WINNER')).toBeNull();
  });

  it('F5: a failed list load is an error state, never an empty state', async () => {
    listFails = true;
    installLensRun();
    wrap(<GovernanceWorkbench />);
    expect(await screen.findByText('Polls could not be loaded.')).toBeTruthy();
    expect(screen.queryByText('No governance polls yet.')).toBeNull();
  });

  it('F6: poll-create carries the signed-in creator name', async () => {
    pollsFixture = [];
    installLensRun();
    wrap(<GovernanceWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /New Poll/ }));
    fireEvent.change(await screen.findByPlaceholderText('What is being decided?'), { target: { value: 'Ship it?' } });
    fireEvent.change(screen.getByPlaceholderText('Option 1'), { target: { value: 'Yes' } });
    fireEvent.change(screen.getByPlaceholderText('Option 2'), { target: { value: 'No' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Poll' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('vote', 'poll-create', expect.objectContaining({ ownerLabel: 'Tester Person' })));
  });

  it('F7: IRV elimination rounds render with per-round counts', async () => {
    pollsFixture = [POLL_RANKED];
    installLensRun();
    wrap(<GovernanceWorkbench />);
    await openResults();
    expect(await screen.findByText(/Instant-runoff elimination rounds/)).toBeTruthy();
    expect(screen.getByText('Round 1')).toBeTruthy();
    expect(screen.getByText('Round 2')).toBeTruthy();
    expect(screen.getByText('C: 3 (43%)')).toBeTruthy();
    expect(screen.getByText('WINNER')).toBeTruthy();
  });
});
