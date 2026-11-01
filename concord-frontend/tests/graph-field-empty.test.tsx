/**
 * GraphField (the Graph lens's default "field" perspective) — empty-state
 * contract. With an empty lattice the view renders an honest empty field:
 * the plain "no nodes yet" cue and nothing invented — no greeting
 * headline (removed in the #1706 rework; the concept art is direction,
 * not copy) and no fabricated nodes.
 *
 * Only the network boundary is mocked: apiHelpers.graph.force resolves a
 * real empty graph in the exact envelope the component consumes.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    graph: {
      force: vi.fn(async () => ({ data: { ok: true, nodes: [], links: [] } })),
      search: vi.fn(async () => ({ data: { ok: true, results: [] } })),
    },
    dtus: { create: vi.fn() },
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ramaj', email: '', role: 'member' }, isLoading: false, isAuthenticated: true, logout: () => {} }),
}));

// The DTU detail overlay is not under test here; keep it inert.
vi.mock('@/components/dtu/DTUDetailView', () => ({ DTUDetailView: () => null }));

import { GraphField } from '@/components/graph/GraphField';

// ResizeObserver: tests/setup.ts already installs a no-op mock (non-configurable), so a
// per-file stub would throw "Cannot redefine property" at load; GraphField uses that one.

describe('GraphField — empty lattice', () => {
  it('shows the honest empty cue with no greeting headline', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const utils = render(
      <QueryClientProvider client={qc}>
        <GraphField />
      </QueryClientProvider>,
    );
    expect(await utils.findByText(/The lattice has no nodes yet/i)).toBeInTheDocument();
    expect(utils.queryByTestId('graph-empty-greeting')).toBeNull();
    expect(utils.queryByText(/How it connects/i)).toBeNull();
  });
});
