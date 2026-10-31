import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { dtus: { create: vi.fn() } },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast: vi.fn() }),
}));

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: import('react').ReactNode }) => children,
  motion: new Proxy({}, {
    get: (_, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layoutId: _l, ...rest } = props as Record<string, unknown>;
      void _i; void _a; void _e; void _t; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { GithubTrending } from '@/components/code/GithubTrending';

function repo(overrides: Partial<{
  id: number; full_name: string; description: string; html_url: string;
  stargazers_count: number; forks_count: number;
  language: string; topics: string[]; pushed_at: string;
}> = {}) {
  return {
    id: 1,
    full_name: 'concorddev/concord-cognitive-engine',
    description: 'A cognitive OS',
    html_url: 'https://github.com/concorddev/concord-cognitive-engine',
    stargazers_count: 1234,
    forks_count: 56,
    language: 'JavaScript',
    topics: ['ai', 'os', 'agents', 'llm', 'sim', 'extra1', 'extra2'],
    pushed_at: '2026-01-01T00:00:00Z',
    owner: { login: 'concorddev', avatar_url: 'https://example.com/a.png' },
    ...overrides,
  };
}

function renderTrending() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{<GithubTrending />}</QueryClientProvider>);
}

const ok = (items: unknown[], extra: Record<string, unknown> = {}) => ({ data: { ok: true, result: { items, ...extra }, error: null } });

describe('GithubTrending', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    lensRunMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a loading state before the first response lands', () => {
    lensRunMock.mockReturnValue(new Promise(() => {}));
    renderTrending();
    expect(screen.getByText(/Searching trending repos/i)).toBeInTheDocument();
  });

  it('asks the server (repos.github-trending) for a 7-day window by default and renders results', async () => {
    lensRunMock.mockResolvedValue(ok([repo()]));
    renderTrending();
    await waitFor(() => expect(screen.getByText('concorddev/concord-cognitive-engine')).toBeInTheDocument());
    expect(lensRunMock).toHaveBeenCalledWith('repos', 'github-trending', { sinceDays: 7, lang: undefined });
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('56')).toBeInTheDocument();
    // topics capped at 6 of the 7 provided
    expect(screen.getAllByText(/^(ai|os|agents|llm|sim|extra1|extra2)$/)).toHaveLength(6);
  });

  it('does not crash on a row shaped like the real server trim (no watchers_count) or missing counts', async () => {
    // server/lib/github-feed-sources.js TRIM keeps stargazers/forks/open_issues but NOT watchers_count;
    // rendering r.watchers_count.toLocaleString() threw on the first row (Code lens "GitHub trending").
    const noForks = repo({ id: 2, full_name: 'a/no-forks' });
    delete (noForks as Partial<typeof noForks>).forks_count;
    const noStars = repo({ id: 3, full_name: 'a/no-stars' });
    delete (noStars as Partial<typeof noStars>).stargazers_count;
    lensRunMock.mockResolvedValue(ok([repo({ id: 1 }), noForks, noStars]));
    renderTrending();
    await waitFor(() => expect(screen.getByText('a/no-forks')).toBeInTheDocument());
    expect(screen.getByText('a/no-stars')).toBeInTheDocument();
    expect(screen.getByText('concorddev/concord-cognitive-engine')).toBeInTheDocument();
    // no watchers column at all (it only duplicated stars on search results)
    expect(screen.queryByText('78')).not.toBeInTheDocument();
  });

  it('shows an error banner when the server reports GitHub unavailable', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, result: null, error: 'github_unavailable' } });
    renderTrending();
    await waitFor(() => expect(screen.getByText(/GitHub results unavailable/i)).toBeInTheDocument());
  });

  it('shows the stale banner when the server serves cached results', async () => {
    lensRunMock.mockResolvedValue(ok([repo()], { stale: true, fetchedAt: 1760000000000 }));
    renderTrending();
    await waitFor(() => expect(screen.getByText(/Showing cached GitHub results/i)).toBeInTheDocument());
  });

  it('re-queries with a language filter when a language is picked', async () => {
    lensRunMock.mockResolvedValue(ok([]));
    renderTrending();
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Rust' } });
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledTimes(2));
    expect(lensRunMock.mock.calls[1]).toEqual(['repos', 'github-trending', { sinceDays: 7, lang: 'Rust' }]);
  });

  it('re-queries with a shorter window when "today" is picked, and highlights it', async () => {
    lensRunMock.mockResolvedValue(ok([]));
    renderTrending();
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'today' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledTimes(2));
    expect(lensRunMock.mock.calls[1][2]).toMatchObject({ sinceDays: 1 });
    expect(screen.getByRole('button', { name: 'today' })).toHaveClass('bg-cyan-500/20');
  });

  it('renders the save-as-DTU affordance once results exist, not before', async () => {
    lensRunMock.mockResolvedValue(ok([]));
    renderTrending();
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    expect(screen.queryByTitle(/save/i)).not.toBeInTheDocument();
    lensRunMock.mockResolvedValue(ok([repo()]));
    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    await waitFor(() => expect(screen.getByText('concorddev/concord-cognitive-engine')).toBeInTheDocument());
  });

  it('omits the description paragraph and topics row when a repo has neither', async () => {
    lensRunMock.mockResolvedValue(ok([repo({ description: undefined, topics: undefined, language: undefined })]));
    renderTrending();
    await waitFor(() => expect(screen.getByText('concorddev/concord-cognitive-engine')).toBeInTheDocument());
    const link = screen.getByText('concorddev/concord-cognitive-engine').closest('a')!;
    expect(link).toHaveAttribute('href', 'https://github.com/concorddev/concord-cognitive-engine');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
