/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// Stub the lens chrome so we exercise the quests page's own data + state logic.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({
  ManifestActionBar: () => null,
}));

// Mock the real backend call (quests.mine macro via lensRun).
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import QuestsLensPage from '@/app/lenses/quests/page';

/** lensRun envelope: { data: { ok, result, error } } */
function questsEnvelope(quests: unknown[]) {
  return { data: { ok: true, result: { ok: true, quests }, error: null } };
}
function errorEnvelope(error: string) {
  return { data: { ok: false, result: null, error } };
}

function fetchJson(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
}

const ACTIVE_QUEST = {
  id: 'q1',
  title: 'Clear the Wolves',
  description: 'The plaza is overrun.',
  status: 'active',
  objectives: [
    { id: 'o1', title: 'Slay 3 wolves', progress: 1, target: 3, complete: false },
    { id: 'o2', title: 'Gather 2 herbs', progress: 2, target: 2, complete: true },
  ],
  reward: { cc: 150, title: 'Wolfsbane' },
};

const COMPLETED_QUEST = {
  id: 'q2',
  title: 'Herbalist Errand',
  description: 'Delivered the herbs.',
  status: 'completed',
  objectives: [
    { id: 'o3', title: 'Deliver herbs', progress: 1, target: 1, complete: true },
  ],
  reward: { cc: 50 },
};

/** Routes lensRun calls to different envelopes by macro name — 'mine' vs 'completed'. */
function mockMineAndCompleted(active: unknown[], completed: unknown[]) {
  lensRun.mockImplementation((domain: string, name: string) => {
    if (domain === 'quests' && name === 'mine') return Promise.resolve(questsEnvelope(active));
    if (domain === 'quests' && name === 'completed') return Promise.resolve(questsEnvelope(completed));
    return Promise.resolve(questsEnvelope([]));
  });
}

beforeEach(() => {
  lensRun.mockReset();
  // No party by default.
  global.fetch = vi.fn(() => fetchJson({ ok: true, party: null })) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/lenses/quests — four UX states', () => {
  it('LOADING: shows the skeleton while the request is in flight', async () => {
    // never-resolving promise keeps it in loading
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<QuestsLensPage />);
    expect(await screen.findByLabelText('Loading quests')).toBeInTheDocument();
  });

  it('EMPTY: honest empty state with guidance when there are no quests', async () => {
    lensRun.mockResolvedValue(questsEnvelope([]));
    render(<QuestsLensPage />);
    expect(await screen.findByText('No active quests')).toBeInTheDocument();
    expect(screen.getByText(/Talk to an NPC/i)).toBeInTheDocument();
  });

  it('ERROR: honest error + working retry that recovers', async () => {
    lensRun.mockResolvedValueOnce(errorEnvelope('quest service down'));
    render(<QuestsLensPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Couldn.t load your quests/i);
    expect(alert).toHaveTextContent('quest service down');

    // retry now succeeds with a populated list
    lensRun.mockResolvedValueOnce(questsEnvelope([ACTIVE_QUEST]));
    fireEvent.click(screen.getByText('Try again'));
    expect(await screen.findByText('Clear the Wolves')).toBeInTheDocument();
  });

  it('POPULATED: renders real active quest with objectives + progress + reward', async () => {
    lensRun.mockResolvedValue(questsEnvelope([ACTIVE_QUEST]));
    render(<QuestsLensPage />);

    expect(await screen.findByText('Clear the Wolves')).toBeInTheDocument();
    expect(screen.getByText('Slay 3 wolves')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.getByText('+150 CC')).toBeInTheDocument();
    expect(screen.getByText(/Title: Wolfsbane/)).toBeInTheDocument();
  });

  it('called the real quests.mine macro (no mock backend)', async () => {
    lensRun.mockResolvedValue(questsEnvelope([]));
    render(<QuestsLensPage />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(lensRun).toHaveBeenCalledWith('quests', 'mine', {});
  });
});

describe('/lenses/quests — party share affordance', () => {
  it('shows a Share button only when the user is in a party', async () => {
    lensRun.mockResolvedValue(questsEnvelope([ACTIVE_QUEST]));
    global.fetch = vi.fn(() =>
      fetchJson({ ok: true, party: { party_id: 'party_9' } }),
    ) as unknown as typeof fetch;

    render(<QuestsLensPage />);
    expect(await screen.findByLabelText(/Share Clear the Wolves with party/i)).toBeInTheDocument();
  });
});

describe('/lenses/quests — completed tab (quests.completed macro)', () => {
  it('calls quests.completed alongside quests.mine on load', async () => {
    mockMineAndCompleted([], []);
    render(<QuestsLensPage />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('quests', 'completed', {}));
  });

  it('renders real completed-quest data under the Completed tab (not filtered from quests.mine)', async () => {
    mockMineAndCompleted([ACTIVE_QUEST], [COMPLETED_QUEST]);
    render(<QuestsLensPage />);

    // Active tab (default) shows the active quest only.
    expect(await screen.findByText('Clear the Wolves')).toBeInTheDocument();
    expect(screen.queryByText('Herbalist Errand')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'completed' }));
    expect(await screen.findByText('Herbalist Errand')).toBeInTheDocument();
    expect(screen.queryByText('Clear the Wolves')).not.toBeInTheDocument();
  });

  it('a completed-but-unclaimed quest shows a Claim button that calls quests.claimRewards', async () => {
    mockMineAndCompleted([], [COMPLETED_QUEST]);
    render(<QuestsLensPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'completed' }));

    const claimBtn = await screen.findByLabelText('Claim rewards for Herbalist Errand');
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: { ok: true, rewards: [{ type: 'gold', amount: 50 }] }, error: null } });
    fireEvent.click(claimBtn);

    expect(await screen.findByText('Rewards claimed.')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('quests', 'claimRewards', { questId: 'q2' });
    // Flips to a "Claimed" badge — the button is gone.
    expect(await screen.findByText('Claimed')).toBeInTheDocument();
    expect(screen.queryByLabelText('Claim rewards for Herbalist Errand')).not.toBeInTheDocument();
  });

  it('a rewarded quest shows a Claimed badge, not a Claim button', async () => {
    mockMineAndCompleted([], [{ ...COMPLETED_QUEST, status: 'rewarded' }]);
    render(<QuestsLensPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'completed' }));

    expect(await screen.findByText('Claimed')).toBeInTheDocument();
    expect(screen.queryByLabelText('Claim rewards for Herbalist Errand')).not.toBeInTheDocument();
  });
});
