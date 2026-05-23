import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { RealEstateWorkbench } from '@/components/realestate/RealEstateWorkbench';

const MORTGAGE = {
  monthly: { total: 3120, principalAndInterest: 2660, tax: 458, insurance: 100, pmi: 0, hoa: 0 },
  ltvPercent: 80, totalCostOverTerm: 1123200, totalInterest: 557000,
};
const AFFORD = { maxHomePrice: 540000, maxPITI: 3100, band: 'comfortable' };
const RENTBUY = {
  breakEvenYear: 6, verdict: 'Buying wins after year 6',
  chartPoints: [
    { year: 1, buyNet: -40000, rentNet: -30000 },
    { year: 7, buyNet: 60000, rentNet: 90000 },
  ],
};

function route(impl: (action: string) => unknown) {
  lensRun.mockImplementation((spec: { action: string }) => Promise.resolve(impl(spec.action)));
}

describe('RealEstateWorkbench', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: null } });
  });

  it('renders nothing when closed', () => {
    const { container } = render(<RealEstateWorkbench open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the panel with the mortgage tab by default', async () => {
    route((action) => (action === 'calc-mortgage' ? { data: { result: MORTGAGE } } : { data: { result: null } }));
    render(<RealEstateWorkbench open onClose={() => {}} />);
    expect(screen.getByText('Real Estate Workbench')).toBeInTheDocument();
    expect(await screen.findByText('Compute PITI')).toBeInTheDocument();
    expect(await screen.findByText('$3,120')).toBeInTheDocument();
  });

  it('fires onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<RealEstateWorkbench open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('switches to the Afford tab and shows the band', async () => {
    route((action) => (action === 'calc-affordability' ? { data: { result: AFFORD } } : { data: { result: null } }));
    render(<RealEstateWorkbench open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Afford/ }));
    expect(await screen.findByText('$540,000')).toBeInTheDocument();
    expect(screen.getByText('comfortable')).toBeInTheDocument();
  });

  it('switches to the Rent vs Buy tab and renders chart rows', async () => {
    route((action) => (action === 'calc-rent-vs-buy' ? { data: { result: RENTBUY } } : { data: { result: null } }));
    render(<RealEstateWorkbench open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Rent vs Buy/ }));
    expect(await screen.findByText('Buying wins after year 6')).toBeInTheDocument();
    expect(screen.getByText('Break-even: year 6')).toBeInTheDocument();
  });

  it('recomputes the mortgage when an input changes and Compute PITI is clicked', async () => {
    route((action) => (action === 'calc-mortgage' ? { data: { result: MORTGAGE } } : { data: { result: null } }));
    render(<RealEstateWorkbench open onClose={() => {}} />);
    await screen.findByText('$3,120');
    const priceInput = screen.getAllByRole('spinbutton')[0];
    fireEvent.change(priceInput, { target: { value: '650000' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Compute PITI'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'calc-mortgage', input: expect.objectContaining({ price: 650000 }) }),
      ),
    );
  });

  it('Searches tab: shows empty state, creates and removes a search', async () => {
    const SEARCHES = [{ id: 'sv1', name: 'My search', alertCadence: 'weekly', createdAt: '2026-05-01', filters: {} }];
    let listed = false;
    route((action) => {
      if (action === 'saved-searches-list') {
        const res = listed ? SEARCHES : [];
        listed = true;
        return { data: { result: { searches: res } } };
      }
      return { data: { ok: true } };
    });
    render(<RealEstateWorkbench open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Saved/ }));
    expect(await screen.findByText('No saved searches.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New search/ }));
    fireEvent.change(screen.getByPlaceholderText(/Search name/), { target: { value: 'My search' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'save-search', input: expect.objectContaining({ name: 'My search' }) }),
      ),
    );
    expect(await screen.findByText('My search')).toBeInTheDocument();
    const delBtns = document.querySelectorAll('.group button');
    fireEvent.click(delBtns[delBtns.length - 1]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete-search', input: { id: 'sv1' } })),
    );
  });

  it('tolerates a calc rejection on the mortgage tab', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<RealEstateWorkbench open onClose={() => {}} />);
    expect(await screen.findByText('Compute PITI')).toBeInTheDocument();
  });
});
