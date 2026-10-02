/**
 * Creator through Council north stars. Rows come from the mocked envelope.
 * Empty copy is not a stand-in for a balance, a paper, a run, or a quorum.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeyboardProvider } from '@/lib/keyboard';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'ramaj', email: 'r@x', role: 'owner' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));

const lensRunMock = vi.fn();
const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

import { WhatYouMade } from '@/components/creator/WhatYouMade';
import { TheWallet } from '@/components/crypto/TheWallet';
import { WhatYouRead } from '@/components/research/WhatYouRead';
import { TheExperiment } from '@/components/lab/TheExperiment';
import { TheBeam } from '@/components/frontier/TheBeam';
import { WhoIsWorking } from '@/components/agents/WhoIsWorking';
import { WhoWrote } from '@/components/message/WhoWrote';
import { WhatsMoving } from '@/components/social/WhatsMoving';
import { TheQuestion } from '@/components/council/TheQuestion';

function actionOf(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') return String(args[1] || '');
  return String((first as { action?: string; name?: string })?.action || (first as { name?: string })?.name || '');
}

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function renderInShell(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KeyboardProvider>{ui}</KeyboardProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  lensRunMock.mockReset();
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockResolvedValue({ data: { ok: true, artifacts: [] } });
  apiPost.mockResolvedValue({ data: { ok: true } });
});

describe('create family north stars', () => {
  it('creator stays on no listing until the studio returns one, and does not invent drift', async () => {
    apiGet.mockImplementation((url: string) => {
      if (String(url).includes('influence-drift')) return Promise.resolve({ data: { ok: true, drift: [] } });
      if (String(url).includes('royalty-flow')) return Promise.resolve({ data: { ok: true, totalCC: 4 } });
      return Promise.resolve({ data: { ok: true, userId: 'u1', recentListings: [], recentDTUs: [] } });
    });
    renderInShell(<WhatYouMade onOpenDesk={() => {}} />);
    expect(screen.getByRole('heading', { name: 'What you made, Ramaj' })).toBeTruthy();
    expect(await screen.findByText('No listing yet')).toBeTruthy();
    expect(screen.queryByText(/Drift this week/)).toBeNull();
    expect(screen.queryByText(/CC/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Gallery' }).getAttribute('href')).toBe('/lenses/gallery');
  });

  it('crypto prints the wallet total only after portfolio-summary answers', async () => {
    let resolveSummary: (value: unknown) => void = () => {};
    lensRunMock.mockImplementation(() => new Promise((resolve) => { resolveSummary = resolve; }));
    apiGet.mockResolvedValue({ data: { artifacts: [] } });
    renderInShell(<TheWallet onOpenDesk={() => {}} />);
    expect(screen.getByRole('heading', { name: 'The wallet, Ramaj' })).toBeTruthy();
    expect(screen.getByTestId('wallet-balance').textContent).toBe('—');
    resolveSummary(ok({ totalValueUsd: 0, lotCount: 0, unrealizedPnlPct: 0 }));
    expect(await screen.findByText('$0.00')).toBeTruthy();
    expect(screen.queryByText(/Unrealized/)).toBeNull();
    expect(screen.queryByText(/24h/)).toBeNull();
  });

  it('research shows the library count and one paper only after search', async () => {
    lensRunMock.mockImplementation((...args: unknown[]) => {
      if (actionOf(args) === 'reference-list') {
        return Promise.resolve(ok({ references: [{ id: 'r1', title: 'On beams' }] }));
      }
      return Promise.resolve(ok({ references: 3 }));
    });
    renderInShell(<WhatYouRead onOpenDesk={() => {}} />);
    expect(await screen.findByText('3 in the library')).toBeTruthy();
    expect(screen.queryByText('On beams')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'beams' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('On beams')).toBeTruthy();
    const call = lensRunMock.mock.calls.find((c) => actionOf(c) === 'reference-list');
    expect((call?.[2] as { query?: string })?.query).toBe('beams');
  });

  it('lab says no run until run-list returns one', async () => {
    lensRunMock.mockImplementation((...args: unknown[]) => {
      if (actionOf(args) === 'protocol-list') return Promise.resolve(ok({ protocols: [{ id: 'p1', name: 'Titration', stepCount: 1 }] }));
      if (actionOf(args) === 'protocol-create') return Promise.resolve(ok({ protocol: { id: 'p2', name: 'New' } }));
      return Promise.resolve(ok({ runs: [] }));
    });
    renderInShell(<TheExperiment onOpenDesk={() => {}} />);
    expect(await screen.findByText('Titration')).toBeTruthy();
    expect(screen.getByText('No run')).toBeTruthy();
    expect(screen.queryByTestId('lab-run')).toBeNull();
    expect(screen.getByRole('link', { name: 'Chem' }).getAttribute('href')).toBe('/lenses/chem');
  });

  it('frontier does not paint a check until Compute', async () => {
    lensRunMock.mockImplementation((...args: unknown[]) => {
      if (actionOf(args) === 'durabilityCheck') {
        return Promise.resolve(ok({ lawUsed: 'Paris', firstFailureYear: null, samples: [{ year: 0, utilization: 0.2 }] }));
      }
      return Promise.resolve(ok({ materials: [{ material: 'steel-a36', known: true }] }));
    });
    renderInShell(<TheBeam onOpenDesk={() => {}} />);
    expect(screen.getByRole('heading', { name: 'The beam, Ramaj' })).toBeTruthy();
    expect(screen.queryByTestId('beam-result')).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Compute' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    expect(await screen.findByTestId('beam-result')).toBeTruthy();
    expect(screen.getByText('Paris')).toBeTruthy();
    expect(screen.getByText('First failure year: —')).toBeTruthy();
  });

  it('agents treats a dormant row as nobody working', async () => {
    apiGet.mockResolvedValue({
      data: { ok: true, artifacts: [{ id: 'a1', title: 'Scout', data: { name: 'Scout', status: 'dormant', successRate: 0 } }] },
    });
    renderInShell(<WhoIsWorking onOpenDesk={() => {}} />);
    expect(await screen.findByText('None running')).toBeTruthy();
    expect(screen.queryByText('Scout')).toBeNull();
    expect(screen.queryByText(/0%/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Personas' }).getAttribute('href')).toBe('/lenses/personas');
  });

  it('messages stays empty when the inbox has no thread', async () => {
    apiGet.mockResolvedValue({ data: { conversations: [] } });
    renderInShell(<WhoWrote onOpenDesk={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Who wrote, Ramaj' })).toBeTruthy();
    expect(await screen.findByText('No thread.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mail' }).getAttribute('href')).toBe('/lenses/mail');
  });

  it('social does not invent a post', async () => {
    lensRunMock.mockImplementation((...args: unknown[]) => {
      if (actionOf(args) === 'createPost') return Promise.resolve(ok({ post: { id: 'p1', body: 'hello' } }));
      return Promise.resolve(ok({ posts: [] }));
    });
    renderInShell(<WhatsMoving onOpenDesk={() => {}} />);
    expect(await screen.findByText('Nothing posted.')).toBeTruthy();
    expect(screen.queryByTestId('social-post')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    fireEvent.change(screen.getByLabelText('Post'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => actionOf(c) === 'createPost')).toBe(true));
  });

  it('council does not claim quorum when the table is empty', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, artifacts: [] } });
    renderInShell(<TheQuestion onOpenDesk={() => {}} />);
    expect(await screen.findByText('No proposal on the table')).toBeTruthy();
    expect(screen.queryByText(/Quorum/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Votes' }).getAttribute('href')).toBe('/lenses/vote');
    fireEvent.click(screen.getByRole('button', { name: 'Start a debate' }));
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Raise the toll?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Put it on the table' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const body = apiPost.mock.calls[0][1] as { title?: string; type?: string };
    expect(body.title).toBe('Raise the toll?');
    expect(body.type).toBe('proposal');
  });
});
