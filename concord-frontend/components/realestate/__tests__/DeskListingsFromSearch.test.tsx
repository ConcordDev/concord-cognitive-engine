// Audit fix sweep (PR #2356) — FIX-realestate-002: the Desk Listings
// tab rendered only the panel's artifact-store Listing records, so a
// listing created via Search > Add listing (the canonical store the
// dashboard already counts) never appeared there. The tab now renders
// the canonical rows in a "From Search" group, and a row can be
// removed from the store from the Desk (two-step confirm).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('framer-motion', () => ({
  motion: (() => {
    const Stable = (props: Record<string, unknown>) => {
      const { initial, animate, exit, transition, whileHover, whileTap, layout, variants, children, ...dom } = props;
      void initial; void animate; void exit; void transition; void whileHover; void whileTap; void layout; void variants;
      return <div {...(dom as Record<string, unknown>)}>{children as React.ReactNode}</div>;
    };
    return new Proxy({}, { get: () => Stable });
  })(),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => <textarea data-testid="drafted" /> }));
vi.mock('@/components/realestate/NeighborhoodStats', () => ({ NeighborhoodStats: () => <div /> }));
vi.mock('@/components/realestate/RealEstateActionPanel', () => ({ RealEstateActionPanel: () => <div /> }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})), isPending: false }) }));
vi.mock('./../ListingPhotoGallery', () => ({ default: () => <div /> }));
vi.mock('./../PriceHistoryPanel', () => ({ default: () => <div /> }));
vi.mock('./../SchoolWalkPanel', () => ({ default: () => <div /> }));
vi.mock('./../PropertyNotes', () => ({ default: () => <div /> }));
vi.mock('./../ContactAgentForm', () => ({ default: () => <div /> }));
vi.mock('./../PropertyDetailPanel', () => ({ default: () => <div /> }));

// No artifact-store Listing records at all — the Desk's own store is
// empty of listings; the only listing lives in the Search store.
const items = [
  { id: 'id-tx', title: 'Transaction item', data: { artifactType: 'Transaction', status: 'under_contract', description: 'desc', address: '1 Main St', price: 400000, pipelineStage: 'under_contract', contingencies: [], docChecklist: [] }, meta: { status: 'under_contract', tags: ['Transaction'] }, createdAt: '2026-01-01', updatedAt: '2026-01-02', version: 1 },
];
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items, isLoading: false, isError: false, error: null, refetch: vi.fn(),
    create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})),
  }),
}));

import { ArtifactDeskPanel } from '../ArtifactDeskPanel';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (a: unknown, b?: unknown) => {
    const action = typeof a === 'object' && a ? (a as { action: string }).action : (b as string);
    if (action === 'listings-list') return { data: { ok: true, result: { listings: [
      { id: 's1', address: '9 Search Ave', city: 'Austin', state: 'TX', price: 500000, status: 'for_sale', beds: 3, baths: 2, sqft: 1800 },
    ] } } };
    return { data: { ok: true, result: {} } };
  });
});

function openListingsTab() {
  const tab = screen.queryAllByRole('button').find((b) => (b.textContent || '').trim().startsWith('Listings'));
  if (tab) fireEvent.click(tab);
}

describe('ArtifactDeskPanel — Desk Listings shows Search-created listings', () => {
  it('renders the canonical listing in the Listings tab instead of the empty state', async () => {
    render(<ArtifactDeskPanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('realestate', 'listings-list', {}));
    openListingsTab();
    await waitFor(() => expect(screen.getAllByText(/9 Search Ave/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/No listings found/)).toBeNull();
    expect(screen.getAllByText('From Search').length).toBeGreaterThan(0);
  });

  it('removes a Search listing from the Desk after a two-step confirm', async () => {
    render(<ArtifactDeskPanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('realestate', 'listings-list', {}));
    openListingsTab();
    const removeBtn = await screen.findByRole('button', { name: 'Remove' });
    fireEvent.click(removeBtn);
    expect(lensRunMock).not.toHaveBeenCalledWith('realestate', 'listings-delete', expect.anything());
    const confirmBtn = await screen.findByRole('button', { name: 'Remove' });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('realestate', 'listings-delete', { id: 's1' }));
  });
});
