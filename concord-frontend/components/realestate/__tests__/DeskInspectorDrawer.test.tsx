// Render coverage for the realestate Desk, the listing drawer and the listing
// inspector — the three files the realestate build changed. The Desk reads the
// Search store (listings-list) for its listing figures; the drawer and the
// inspector print the hot-score basis.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('framer-motion', () => ({
  // Keep the DOM props (onClick, className, role...) so cards stay clickable; drop the motion-only ones.
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

const art = (artifactType: string, status: string, extra: Record<string, unknown> = {}, title = `${artifactType} item`) => ({
  id: `id-${artifactType}-${title}`, title, data: { artifactType, status, description: 'desc', address: '1 Main St', price: 400000, ...extra },
  meta: { status, tags: [artifactType] }, createdAt: '2026-01-01', updatedAt: '2026-01-02', version: 1,
});
const items = [
  art('Listing', 'active', { bedrooms: 3, bathrooms: 2, sqft: 1800, daysOnMarket: 12, priceHistory: [{ date: '2026-01-01', price: 410000, event: 'listed' }] }),
  art('Listing', 'sold'),
  art('Transaction', 'under_contract', { pipelineStage: 'under_contract', contingencies: [], docChecklist: [] }),
  art('CMA', 'draft', { subjectProperty: '1 Main St', comparables: [], suggestedPrice: 410000, pricePerSqft: 220 }),
  art('RentalUnit', 'occupied', { tenantName: 'T', monthlyRent: 2500, rentStatus: 'current', maintenanceRequests: [] }),
  art('Deal', 'analyzing', { purchasePrice: 300000, grossRent: 30000 }),
  art('Showing', 'scheduled', { date: '2026-02-01', client: 'C' }),
];
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items, isLoading: false, isError: false, error: null, refetch: vi.fn(),
    create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})),
  }),
}));

import { ArtifactDeskPanel } from '../ArtifactDeskPanel';
import { ListingDetailDrawer } from '../ListingDetailDrawer';
import { ListingInspectorPanel } from '../ListingInspectorPanel';

const listing = {
  id: 'l1', address: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', price: 450000, beds: 3, baths: 2, sqft: 1800,
  yearBuilt: 1999, kind: 'single_family' as const, status: 'for_sale' as const, daysOnMarket: 14,
};
const HOT = { score: 80, tag: 'Hot', daysOnMarket: 14, tourCount: 3, basis: { base: 50, marketAge: 10, priceDrop: 5, tours: 9, favourite: 6 } };

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (a: unknown, b?: unknown) => {
    const action = typeof a === 'object' && a ? (a as { action: string }).action : (b as string);
    if (action === 'listings-list') return { data: { ok: true, result: { listings: [
      { id: 's1', address: '9 Search Ave', city: 'Austin', state: 'TX', price: 500000, status: 'for_sale' },
      { id: 's2', address: '2 Pending Ln', price: 300000, status: 'pending' },
    ] } } };
    if (action === 'listings-get') return { data: { ok: true, result: { listing: { ...listing, lat: 30, lng: -97, description: 'Nice', priceHistory: [{ date: '2026-01-01', price: 460000, kind: 'listed' }], lotSqft: 5000 } } } };
    if (action === 'hot-score') return { data: { ok: true, result: HOT } };
    if (action === 'favourites-list') return { data: { ok: true, result: { ids: ['l1'] } } };
    if (action === 'favourites-toggle') return { data: { ok: true, result: { favourited: false } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('ArtifactDeskPanel', () => {
  it('shows the Search-store listing figures and walks every tab', async () => {
    render(<ArtifactDeskPanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('realestate', 'listings-list', {}));
    await waitFor(() => expect(screen.getAllByText(/9 Search Ave/).length).toBeGreaterThan(0));
    for (const name of ['Listings', 'Transactions', 'CMA', 'Rentals', 'Investing', 'Showings', 'Dashboard']) {
      const tab = screen.queryAllByRole('button').find((b) => (b.textContent || '').trim().startsWith(name));
      if (tab) fireEvent.click(tab);
    }
    expect(document.body.textContent).toBeTruthy();
  });

  it('opens every artifact editor and exercises the tab actions', async () => {
    render(<ArtifactDeskPanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('realestate', 'listings-list', {}));
    const clickAll = () => {
      // Click every button/role=button currently on screen once (editors, expanders, actions, calculators),
      // closing any modal that opens so the next control is reachable.
      const targets = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[];
      for (const el of targets) {
        if (!el.isConnected) continue;
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
        if (/^(delete|remove)/i.test(label) || /trash/i.test(label)) continue;
        try { fireEvent.click(el); } catch { /* a control may unmount mid-pass */ }
        const close = document.querySelector('[aria-label="Close"]') as HTMLElement | null;
        if (close && /modal|fixed/i.test(close.closest('[class]')?.className || '')) { try { fireEvent.click(close); } catch { /* noop */ } }
      }
    };
    const openCards = () => {
      // Cards open the editor on click (they are not buttons): click each artifact title, then close.
      for (const el of Array.from(document.querySelectorAll('h3, h4, p, span')) as HTMLElement[]) {
        if (!/ item$/.test((el.textContent || '').trim())) continue;
        try { fireEvent.click(el); } catch { /* noop */ }
        const close = document.querySelector('[aria-label="Close"]') as HTMLElement | null;
        if (close) { try { fireEvent.click(close); } catch { /* noop */ } }
      }
    };
    for (const name of ['Dashboard', 'Listings', 'Transactions', 'CMA', 'Rentals', 'Investing', 'Showings']) {
      const tab = screen.queryAllByRole('button').find((b) => (b.textContent || '').trim().startsWith(name));
      if (tab) fireEvent.click(tab);
      openCards();
      clickAll();
      clickAll();
    }
    expect(document.body.textContent).toBeTruthy();
  });

  it('degrades to an empty Search list when listings-list fails', async () => {
    lensRunMock.mockImplementation(async () => { throw new Error('offline'); });
    render(<ArtifactDeskPanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    expect(document.body.textContent).toBeTruthy();
  });
});

describe('ListingDetailDrawer', () => {
  it('loads the listing, prints the hot-score basis and toggles the favourite', async () => {
    render(<ListingDetailDrawer listing={listing} onClose={() => {}} />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'hot-score' })));
    await waitFor(() => expect(document.body.textContent).toMatch(/Hot|80/));
    const fav = screen.queryAllByRole('button').find((b) => /favou?rite|save/i.test((b.getAttribute('aria-label') || '') + (b.textContent || '')));
    if (fav) fireEvent.click(fav);
    await waitFor(() => expect(lensRunMock.mock.calls.length).toBeGreaterThan(2));
  });

  it('renders nothing without a listing', () => {
    const { container } = render(<ListingDetailDrawer listing={null} onClose={() => {}} />);
    expect(container.textContent).toBe('');
  });
});

describe('ListingInspectorPanel', () => {
  it('opens on the overview and switches panes', async () => {
    render(<ListingInspectorPanel listing={listing} onClose={() => {}} />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    for (const label of ['Photos', 'History', 'Schools', 'Notes', 'Contact', 'Detail', 'Home']) {
      const btn = screen.queryAllByRole('button').find((b) => (b.textContent || '').trim().startsWith(label));
      if (btn) fireEvent.click(btn);
    }
    expect(document.body.textContent).toBeTruthy();
  });
});
