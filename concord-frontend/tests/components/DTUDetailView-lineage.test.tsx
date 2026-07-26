import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { KeyboardProvider } from '@/lib/keyboard';
import { WorkspaceBusProvider } from '@/components/workspace-bus';

/**
 * EC1 — DTUDetailView "Lineage" tab, backed by the real GET
 * /api/dtus/:id/lineage endpoint (server.js `dtu.lineage` macro, composed
 * from the in-memory parent/child edges + the royalty_lineage citation
 * graph). This test pins two contracts:
 *   1. A real ancestor chain renders as navigable DTU references
 *      (id/title/creator), and clicking one calls onNavigate with that
 *      ancestor's real id.
 *   2. A DTU with no ancestors renders the honest "root thought" empty
 *      state — never a fabricated lineage.
 *
 * Heavy sibling panels are stubbed the same way DTUDetailView.test.tsx
 * (the BD#7 Workspace Bus test) does, so this file only exercises the
 * lineage tab itself.
 */

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

const lineageMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    dtus: {
      get: vi.fn().mockResolvedValue({ data: { dtu: sampleDtu } }),
      lineage: (...args: unknown[]) => lineageMock(...args),
    },
    economy: {
      royaltyCascade: vi.fn().mockResolvedValue({
        data: { ok: true, totalEarned: 0, totalTransactions: 0, ancestors: [], descendantCount: 0 },
      }),
    },
  },
  api: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import { DTUDetailView } from '@/components/dtu/DTUDetailView';

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <KeyboardProvider>
        <WorkspaceBusProvider>{ui}</WorkspaceBusProvider>
      </KeyboardProvider>
    </QueryClientProvider>
  );
}

async function waitForDtuLoaded() {
  await waitFor(async () => {
    expect((await screen.findAllByText('Q3 Revenue Forecast')).length).toBeGreaterThan(0);
  });
}

async function openLineageTab() {
  const tabBtn = await screen.findByRole('button', { name: 'Lineage' });
  fireEvent.click(tabBtn);
}

describe('DTUDetailView — Lineage tab (EC1, real ancestor chain)', () => {
  it('renders a real ancestor chain as navigable DTU references and navigates on click', async () => {
    lineageMock.mockResolvedValueOnce({
      data: {
        ok: true,
        current: { id: 'dtu-42', title: 'Q3 Revenue Forecast', tier: 'regular', ownerId: 'u1' },
        parents: [
          { id: 'dtu-7', title: 'Q2 Revenue Actuals', tier: 'regular', ownerId: 'creator-7' },
        ],
        children: [],
        forks: [],
        citations: [],
        citedBy: [],
        relatedIds: [],
        royaltyCascade: [
          {
            id: 'dtu-7',
            title: 'Q2 Revenue Actuals',
            ownerId: 'creator-7',
            generation: 1,
            royaltyRate: 0.21,
            royaltyPercent: '21.0%',
          },
        ],
      },
    });

    const onNavigate = vi.fn();
    renderWithProviders(<DTUDetailView dtuId="dtu-42" onClose={() => {}} onNavigate={onNavigate} />);

    await waitForDtuLoaded();
    await openLineageTab();

    // Real ancestor reference: title + creator id both render. It appears
    // twice — once in the Parents section, once in the Royalty Cascade
    // section — since both are real, distinct views onto the same graph.
    const ancestorMentions = await screen.findAllByText('Q2 Revenue Actuals');
    expect(ancestorMentions.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('creator-7').length).toBeGreaterThanOrEqual(2);

    // Clicking the Parents-section entry navigates using its REAL id, not a placeholder.
    fireEvent.click(ancestorMentions[0]);
    expect(onNavigate).toHaveBeenCalledWith('dtu-7');

    // The royalty cascade entry (real generation + rate from the citation
    // graph) is also present — distinct evidence this isn't a fabricated list.
    expect(screen.getByText('21.0%')).toBeInTheDocument();
  });

  it('renders the honest empty state for a DTU with no ancestors — never a fabricated lineage', async () => {
    lineageMock.mockResolvedValueOnce({
      data: {
        ok: true,
        current: { id: 'dtu-42', title: 'Q3 Revenue Forecast', tier: 'regular', ownerId: 'u1' },
        parents: [],
        children: [],
        forks: [],
        citations: [],
        citedBy: [],
        relatedIds: [],
        royaltyCascade: [],
      },
    });

    renderWithProviders(<DTUDetailView dtuId="dtu-42" onClose={() => {}} />);

    await waitForDtuLoaded();
    await openLineageTab();

    expect(
      await screen.findByText('No parent DTUs (this is a root thought)')
    ).toBeInTheDocument();
    // No invented ancestor rows anywhere in the Parents section.
    expect(screen.queryByText(/Q2 Revenue Actuals/)).not.toBeInTheDocument();
  });

  it('shows an honest error state (not a fabricated empty lineage) when the lineage fetch fails', async () => {
    lineageMock.mockRejectedValueOnce(new Error('network down'));

    renderWithProviders(<DTUDetailView dtuId="dtu-42" onClose={() => {}} />);

    await waitForDtuLoaded();
    await openLineageTab();

    expect(
      await screen.findByText('Unable to load lineage right now. Try again shortly.')
    ).toBeInTheDocument();
  });
});
