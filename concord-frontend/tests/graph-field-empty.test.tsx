/**
 * GraphField (the Graph lens's default "field" perspective) — empty-state
 * contract. With an empty lattice the view renders an honest empty field:
 * the northstar concept greeting ("How it connects, Ramaj" —
 * docs/lens-northstar/16-graph-northstar-concept.jpg) addressed to the
 * signed-in user, over the plain "no nodes yet" cue. No fabricated nodes.
 *
 * Only the network boundary is mocked: apiHelpers.graph.force resolves a
 * real empty graph in the exact envelope the component consumes.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
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

beforeAll(() => {
  // jsdom has no ResizeObserver; GraphField observes its canvas box.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

describe('GraphField — empty lattice', () => {
  it('greets the signed-in user by name over the honest empty cue', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const utils = render(
      <QueryClientProvider client={qc}>
        <GraphField />
      </QueryClientProvider>,
    );
    const greeting = await utils.findByTestId('graph-empty-greeting');
    expect(greeting.textContent).toBe('How it connects, Ramaj');
    expect(utils.getByText(/The lattice has no nodes yet/i)).toBeInTheDocument();
  });
});
