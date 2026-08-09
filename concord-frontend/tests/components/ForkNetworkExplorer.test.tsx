import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    dtus: { create: vi.fn() },
    lens: { runDomain: (...args: unknown[]) => runDomain(...args) },
  },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast: vi.fn() }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layoutId: _l, ...rest } = props as Record<string, unknown>;
      void _i; void _a; void _e; void _t; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { ForkNetworkExplorer } from '@/components/fork/ForkNetworkExplorer';

function ok<T>(result: T) {
  return { data: { ok: true, result } };
}
function fail(error: string) {
  return { data: { ok: false, error } };
}

const DAY = 86_400_000;
function daysAgo(n: number) {
  return new Date(Date.now() - n * DAY).toISOString();
}

function fork(overrides: Partial<{ id: number; fullName: string; pushedAt: string; stargazers: number; forks: number; archived: boolean; description: string; language: string; license: string; createdAt: string; openIssues: number }> = {}) {
  return {
    id: 1,
    fullName: 'someone/next.js',
    pushedAt: daysAgo(5),
    stargazers: 10,
    forks: 1,
    ...overrides,
  };
}

function renderExplorer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{<ForkNetworkExplorer />}</QueryClientProvider>);
}

describe('ForkNetworkExplorer', () => {
  beforeEach(() => {
    runDomain.mockReset();
  });
  afterEach(() => cleanup());

  it('seeds vercel/next.js and shows the empty-forks hint before any load', () => {
    renderExplorer();
    expect(screen.getByDisplayValue('vercel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('next.js')).toBeInTheDocument();
    expect(screen.getByText(/No forks yet/i)).toBeInTheDocument();
  });

  it('loads parent + forks in parallel on submit and renders both', async () => {
    runDomain.mockImplementation((_domain: string, action: string) => {
      if (action === 'github-repo') {
        return Promise.resolve(ok({ fullName: 'vercel/next.js', stargazers: 5000, watchers: 100, forks: 200, openIssues: 30, htmlUrl: 'https://github.com/vercel/next.js', language: 'TypeScript', license: 'MIT', archived: false, description: 'The React framework' }));
      }
      return Promise.resolve(ok({ forks: [fork()] }));
    });
    renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: /explore/i }));

    await waitFor(() => expect(screen.getByText('vercel/next.js')).toBeInTheDocument());
    expect(screen.getByText('someone/next.js')).toBeInTheDocument();
    expect(screen.getByText('MIT')).toBeInTheDocument();
    expect(runDomain).toHaveBeenCalledWith('fork', 'github-repo', { input: { owner: 'vercel', repo: 'next.js' } });
    expect(runDomain).toHaveBeenCalledWith('fork', 'github-forks', { input: { owner: 'vercel', repo: 'next.js', sort: 'stargazers', limit: 30 } });
  });

  it('shows an error banner and clears the parent card when the parent lookup fails', async () => {
    runDomain.mockImplementation((_domain: string, action: string) => {
      if (action === 'github-repo') return Promise.resolve(fail('repo not found'));
      return Promise.resolve(ok({ forks: [] }));
    });
    renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: /explore/i }));
    await waitFor(() => expect(screen.getByText('repo not found')).toBeInTheDocument());
  });

  it('bands forks by push freshness: live, recent, stale, dead', async () => {
    runDomain.mockImplementation((_domain: string, action: string) => {
      if (action === 'github-repo') return Promise.resolve(ok({ fullName: 'vercel/next.js' }));
      return Promise.resolve(ok({
        forks: [
          fork({ id: 1, fullName: 'a/live', pushedAt: daysAgo(2) }),
          fork({ id: 2, fullName: 'b/recent', pushedAt: daysAgo(90) }),
          fork({ id: 3, fullName: 'c/stale', pushedAt: daysAgo(400) }),
          fork({ id: 4, fullName: 'd/dead', pushedAt: daysAgo(1000) }),
        ],
      }));
    });
    renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: /explore/i }));
    await waitFor(() => expect(screen.getByText('a/live')).toBeInTheDocument());
    expect(screen.getByText(/^live · 2d$/)).toBeInTheDocument();
    expect(screen.getByText(/^recent · 90d$/)).toBeInTheDocument();
    expect(screen.getByText(/^stale · 400d$/)).toBeInTheDocument();
    expect(screen.getByText(/^dead · 1000d$/)).toBeInTheDocument();
  });

  it('treats a missing pushedAt as dead', async () => {
    runDomain.mockImplementation((_domain: string, action: string) => {
      if (action === 'github-repo') return Promise.resolve(ok({ fullName: 'vercel/next.js' }));
      return Promise.resolve(ok({ forks: [fork({ pushedAt: undefined })] }));
    });
    renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: /explore/i }));
    await waitFor(() => expect(screen.getByText(/^dead · 9999d$/)).toBeInTheDocument());
  });

  it('computes a per-fork health score on demand and renders it', async () => {
    runDomain.mockImplementation((_domain: string, action: string) => {
      if (action === 'github-repo') return Promise.resolve(ok({ fullName: 'vercel/next.js', pushedAt: daysAgo(1) }));
      if (action === 'github-forks') return Promise.resolve(ok({ forks: [fork()] }));
      if (action === 'forkHealth') {
        return Promise.resolve(ok({ name: 'someone/next.js', healthScore: 82, healthLevel: 'healthy', factors: {}, recommendations: ['Sync with upstream'] }));
      }
      return Promise.resolve(fail('unexpected'));
    });
    renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: /explore/i }));
    await waitFor(() => expect(screen.getByText('someone/next.js')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /compute health/i }));
    await waitFor(() => expect(screen.getByText(/82\/100 · healthy/)).toBeInTheDocument());
    expect(screen.getByText(/Sync with upstream/)).toBeInTheDocument();
    const healthCall = runDomain.mock.calls.find(([, action]) => action === 'forkHealth');
    expect(healthCall).toBeTruthy();
    const [, , { input }] = healthCall!;
    expect(input.fork).toMatchObject({ name: 'someone/next.js' });
    expect(input.fork.upstream).toHaveProperty('lastCommitAt');
  });

  it('shows a health-check-failed message when the health macro errors', async () => {
    runDomain.mockImplementation((_domain: string, action: string) => {
      if (action === 'github-repo') return Promise.resolve(ok({ fullName: 'vercel/next.js' }));
      if (action === 'github-forks') return Promise.resolve(ok({ forks: [fork()] }));
      return Promise.resolve(fail('scorer down'));
    });
    renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: /explore/i }));
    await waitFor(() => expect(screen.getByText('someone/next.js')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /compute health/i }));
    await waitFor(() => expect(screen.getByText(/health check failed/i)).toBeInTheDocument());
  });

  it('re-queries forks with the new sort when a sort button is clicked', async () => {
    runDomain.mockImplementation((_domain: string, action: string) => {
      if (action === 'github-repo') return Promise.resolve(ok({ fullName: 'vercel/next.js' }));
      return Promise.resolve(ok({ forks: [] }));
    });
    renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: 'newest' }));
    fireEvent.click(screen.getByRole('button', { name: /explore/i }));
    await waitFor(() =>
      expect(runDomain).toHaveBeenCalledWith('fork', 'github-forks', { input: { owner: 'vercel', repo: 'next.js', sort: 'newest', limit: 30 } }),
    );
  });

  it('disables Explore when owner or repo is blank', () => {
    renderExplorer();
    fireEvent.change(screen.getByDisplayValue('next.js'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: /explore/i })).toBeDisabled();
  });
});
