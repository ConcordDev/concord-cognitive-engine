import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { KeyboardProvider } from '@/lib/keyboard';
import { WorkspaceBusProvider, useWorkspaceBus, type WorkspaceBusEntry } from '@/components/workspace-bus';

// DTUDetailView pulls in a wide tree of badges/panels that each fetch their
// own data. None of them are relevant to the Workspace Bus wiring under
// test, so they're stubbed out the same way app/lenses/chat's own test does
// for this component (see page.conkay-backport.test.tsx).
vi.mock('@/components/dtu/DTUIntegrityBadge', () => ({ DTUIntegrityBadge: () => null }));
vi.mock('@/components/dtu/ProvenanceBadge', () => ({ ProvenanceBadge: () => null }));
vi.mock('@/components/dtu/ProvenanceTrail', () => ({ ProvenanceTrail: () => null }));
vi.mock('@/components/dtu/DownstreamBadge', () => ({ DownstreamBadge: () => null }));
vi.mock('@/components/artifact/ArtifactRenderer', () => ({ ArtifactRenderer: () => null }));
vi.mock('@/components/platform/ScopeControls', () => ({ ScopeBadge: () => null }));
vi.mock('@/components/scope/PromoteDialog', () => ({ PromoteDialog: () => null }));
vi.mock('@/hooks/useOfflineFirst', () => ({
  useOfflineFirstDTU: () => ({ data: null, loading: false, source: 'server', stale: false }),
}));

// vi.mock factories are hoisted above module-scope const declarations, so
// the sample DTU has to be built with vi.hoisted (mirrors the pattern used
// elsewhere in this suite for mocks that need shared fixture data).
const { sampleDtu } = vi.hoisted(() => ({
  sampleDtu: {
    id: 'dtu-42',
    title: 'Q3 Revenue Forecast',
    summary: 'A forecast DTU.',
    tier: 'regular',
    domain: 'finance',
    source: 'user',
    timestamp: new Date().toISOString(),
    ownerId: 'u1',
    tags: ['finance'],
    meta: {},
  },
}));

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    dtus: {
      get: vi.fn().mockResolvedValue({ data: { dtu: sampleDtu } }),
      lineage: vi.fn().mockResolvedValue({ data: { ok: true } }),
    },
    economy: {
      royaltyCascade: vi.fn().mockResolvedValue({ data: { ok: true, totalEarned: 0, totalTransactions: 0, ancestors: [], descendantCount: 0 } }),
    },
  },
  api: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import { DTUDetailView } from '@/components/dtu/DTUDetailView';

let latestHistory: WorkspaceBusEntry[] = [];
function HistoryProbe() {
  const bus = useWorkspaceBus();
  latestHistory = bus.history;
  return null;
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <KeyboardProvider>
        <WorkspaceBusProvider>
          {ui}
          <HistoryProbe />
        </WorkspaceBusProvider>
      </KeyboardProvider>
    </QueryClientProvider>
  );
}

describe('DTUDetailView — Workspace Bus "send to bus" action', () => {
  it('renders the send-to-bus action once the DTU has loaded', async () => {
    renderWithProviders(<DTUDetailView dtuId="dtu-42" onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByLabelText('Send to Workspace Bus')).toBeInTheDocument();
    });
  });

  it('does not render the action while the DTU is still loading (no dead button on an empty state)', () => {
    renderWithProviders(<DTUDetailView dtuId="dtu-42" onClose={() => {}} />);
    // Immediately after mount, before the query resolves, there is no DTU yet.
    expect(screen.queryByLabelText('Send to Workspace Bus')).not.toBeInTheDocument();
  });

  it('pushes the loaded DTU onto the Workspace Bus history on click', async () => {
    latestHistory = [];
    renderWithProviders(<DTUDetailView dtuId="dtu-42" onClose={() => {}} />);

    const btn = await screen.findByLabelText('Send to Workspace Bus');
    expect(latestHistory).toHaveLength(0);

    fireEvent.click(btn);

    expect(latestHistory).toHaveLength(1);
    expect(latestHistory[0].dtu.id).toBe('dtu-42');
    expect(latestHistory[0].dtu.title).toBe('Q3 Revenue Forecast');
  });
});
