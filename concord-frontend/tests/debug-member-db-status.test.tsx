import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const get = vi.fn();
const dbStatus = vi.fn();
const perfMetrics = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => get(...a) },
  apiHelpers: {
    db: { status: (...a: unknown[]) => dbStatus(...a) },
    perf: { metrics: (...a: unknown[]) => perfMetrics(...a) },
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));
let role = 'member';
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', role }, isAuthenticated: true }) }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/lib/hooks/use-lens-data', () => ({ useLensData: () => ({ items: [], isLoading: false, refetch: vi.fn() }) }));
vi.mock('@/components/debug/AnalysisActionsPanel', () => ({ AnalysisActionsPanel: () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: (_t, tag: string) => (p: Record<string, unknown> & { children?: React.ReactNode }) => {
    const { initial: _i, animate: _a, transition: _tr, exit: _e, ...rest } = p as Record<string, unknown>; void _i; void _a; void _tr; void _e;
    return React.createElement(tag, rest, p.children);
  } }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { StatusPanel } from '@/components/debug/StatusPanel';

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <StatusPanel />
  </QueryClientProvider>,
);

describe('Debug lens: /api/db/status is admin-only', () => {
  beforeEach(() => {
    get.mockReset(); dbStatus.mockReset(); perfMetrics.mockReset();
    get.mockResolvedValue({ data: { ok: true, version: '1.0', active: 0, events: [] } });
    dbStatus.mockResolvedValue({ data: { ok: true, engine: 'sqlite' } });
    perfMetrics.mockResolvedValue({ data: { memory: { heapUsed: 1048576 } } });
  });
  afterEach(() => cleanup());

  it('a member opening the lens fires no db-status call and shows no Database card', async () => {
    role = 'member';
    wrap();
    await waitFor(() => expect(screen.getByText('System')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 30));
    expect(dbStatus).not.toHaveBeenCalled();
    expect(screen.queryByText('Database')).not.toBeInTheDocument();
    expect(screen.getByText('Jobs')).toBeInTheDocument();
  });

  it('an admin still gets the Database card from /api/db/status', async () => {
    role = 'admin';
    wrap();
    await waitFor(() => expect(screen.getByText('Database')).toBeInTheDocument());
    expect(dbStatus).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('sqlite')).toBeInTheDocument());
  });
});
