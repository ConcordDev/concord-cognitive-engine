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
