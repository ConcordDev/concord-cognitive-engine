import { describe, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ api: { get } }));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = (props: Record<string, unknown>) => <span data-testid={`icon-${name}`} {...props} />;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import { ContextInspectorPanel } from '@/components/debug/ContextInspectorPanel';

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContextInspectorPanel />
    </QueryClientProvider>,
  );
}

describe('ContextInspectorPanel', () => {
  it('renders numbers from a real inspector 200 payload (no error boundary)', async () => {
    get.mockResolvedValue({
      data: {
        ok: true,
        workingSet: { totalSize: 3 },
        pinnedDtus: [{ dtuId: 'dtu_alpha', title: 'Alpha Claim', score: 0.8, session: 'sess_a' }],
        coActivationPatterns: [{ sessionId: 'sess_a', trackedDtus: 2, queryCount: 1 }],
        userProfiles: [
          {
            label: 'you',
            topDtuCount: 1,
            sessionCount: 2,
            lastSession: '2026-10-14T00:00:00.000Z',
            topDtus: [{ dtuId: 'dtu_alpha', frequency: 1.2, title: 'Alpha Claim' }],
          },
        ],
        engine: { activeSessions: 1, userProfileCount: 1, shadowDtuCount: 0 },
        metrics: {
          queriesProcessed: 4,
          coActivationEdgesProposed: 0,
          profileSeeds: 1,
          contextPanelQueries: 2,
        },
      },
    });

    renderPanel();

    expect(await screen.findByText('Context Inspector')).toBeInTheDocument();
    expect(screen.getByText('Working Set Size').parentElement).toHaveTextContent('3');
    expect(screen.getAllByText('Alpha Claim').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('you')).toBeInTheDocument();
    expect(screen.getByText('Queries Processed').parentElement).toHaveTextContent('4');
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/context/inspector');
  });

  it('shows honest empty labels when the inspector returns empty arrays', async () => {
    get.mockResolvedValue({
      data: {
        ok: true,
        workingSet: { totalSize: 0 },
        pinnedDtus: [],
        coActivationPatterns: [],
        userProfiles: [],
        engine: { activeSessions: 0, userProfileCount: 0, shadowDtuCount: 0 },
        metrics: {
          queriesProcessed: 0,
          coActivationEdgesProposed: 0,
          profileSeeds: 0,
          contextPanelQueries: 1,
        },
      },
    });

    renderPanel();

    expect(await screen.findByText('Context Inspector')).toBeInTheDocument();
    expect(screen.getByText('No pinned DTUs in active sessions')).toBeInTheDocument();
    expect(screen.getByText('No active co-activation tracking')).toBeInTheDocument();
    expect(screen.getByText('No user profiles tracked yet')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('does not leave the panel on a permanent error state after a successful load path', async () => {
    get.mockResolvedValue({
      data: {
        ok: true,
        workingSet: { totalSize: 0 },
        pinnedDtus: [],
        coActivationPatterns: [],
        userProfiles: [],
        engine: { activeSessions: 0, userProfileCount: 0, shadowDtuCount: 0 },
        metrics: { queriesProcessed: 0, coActivationEdgesProposed: 0, profileSeeds: 0, contextPanelQueries: 0 },
      },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.queryByText(/Request failed/i)).not.toBeInTheDocument();
    });
  });
});
