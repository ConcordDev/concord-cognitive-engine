import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/viz/ChartKit', () => ({
  ChartKit: (p: Record<string, unknown>) => React.createElement('div', { 'data-testid': 'chart', 'data-kind': p.kind }),
}));

import { PropertyDetailPanel } from '@/components/realestate/PropertyDetailPanel';

const DETAIL = {
  listing: { id: 'L1', address: '1 Pine St', city: 'Austin', state: 'TX', zip: '78701', price: 525000, beds: 3, baths: 2, sqft: 1900, yearBuilt: 2008, kind: 'single_family', status: 'for_sale', daysOnMarket: 12 },
  taxHistory: [
    { year: 2024, assessedValue: 480000, taxPaid: 9600, effectiveRatePct: 2.0 },
    { year: 2025, assessedValue: 500000, taxPaid: 10000, effectiveRatePct: 2.0 },
  ],
  lot: { lotSqft: 7200, lotAcres: 0.165, yearBuilt: 2008, ageYears: 18, pricePerSqft: 276, pricePerLotSqft: 73 },
  similarHomes: [
    { id: 'S1', address: '5 Elm Ct', price: 540000, beds: 3, baths: 2, sqft: 1950, pricePerSqft: 277, similarityPct: 92 },
  ],
  photoCount: 1,
};
const DETAIL_EMPTY = { ...DETAIL, taxHistory: [], similarHomes: [], lot: { lotSqft: 0, lotAcres: 0, yearBuilt: null, ageYears: null, pricePerSqft: null, pricePerLotSqft: null }, photoCount: 0 };

describe('PropertyDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
  });

  it('shows the select-a-listing placeholder without a listingId', () => {
    render(<PropertyDetailPanel />);
    expect(screen.getByText(/Select a listing to view its tax history/)).toBeInTheDocument();
  });

  it('shows the no-detail message when the macro returns ok:false', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'x' } });
    render(<PropertyDetailPanel listingId="L1" />);
    expect(await screen.findByText('No detail available for this listing.')).toBeInTheDocument();
  });

  it('renders full detail with tax chart, lot facts, and similar homes', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: DETAIL } });
    render(<PropertyDetailPanel listingId="L1" />);
    expect(await screen.findByText('$525,000')).toBeInTheDocument();
    expect(screen.getByText((_t, n) => n?.textContent === 'Austin, TX · 1 photo')).toBeInTheDocument();
    expect(screen.getByText('7,200 sqft')).toBeInTheDocument();
    expect(screen.getByText('18 yr')).toBeInTheDocument();
    expect(screen.getByTestId('chart')).toHaveAttribute('data-kind', 'bar');
    expect(screen.getByText('5 Elm Ct')).toBeInTheDocument();
    expect(screen.getByText(/92% match/)).toBeInTheDocument();
  });

  it('renders the empty sub-sections when detail has no tax/comp data', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: DETAIL_EMPTY } });
    render(<PropertyDetailPanel listingId="L1" />);
    expect(await screen.findByText('No tax history.')).toBeInTheDocument();
    expect(screen.getByText('No comparable homes in your listings yet.')).toBeInTheDocument();
    expect(screen.getByText((_t, n) => n?.textContent === 'Austin, TX · 0 photos')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('fires onSelect when a similar home is clicked', async () => {
    const onSelect = vi.fn();
    lensRun.mockResolvedValue({ data: { ok: true, result: DETAIL } });
    render(<PropertyDetailPanel listingId="L1" onSelect={onSelect} />);
    await screen.findByText('5 Elm Ct');
    fireEvent.click(screen.getByText('5 Elm Ct'));
    expect(onSelect).toHaveBeenCalledWith({ id: 'S1' });
  });

  it('calls the property-detail macro with the listing id', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: DETAIL } });
    render(<PropertyDetailPanel listingId="L1" />);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'property-detail', input: { listingId: 'L1' } }),
      ),
    );
  });

  it('tolerates a refresh rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<PropertyDetailPanel listingId="L1" />);
    expect(await screen.findByText('No detail available for this listing.')).toBeInTheDocument();
  });
});
