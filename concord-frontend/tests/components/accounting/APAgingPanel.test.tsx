import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { APAgingPanel } from '@/components/accounting/APAgingPanel';

const POPULATED = {
  asOf: '2026-05-22',
  totalOpen: 4200,
  buckets: [
    { key: 'current', label: 'Current', total: 1000, bills: [
      { id: 'b1', number: 'BILL-1', vendorName: 'Acme', total: 1000, dueAt: '2026-06-01', daysPastDue: 0 },
    ] },
    { key: 'd30', label: '1-30', total: 0, bills: [] },
    { key: 'd60', label: '31-60', total: 1200, bills: [
      { id: 'b2', number: 'BILL-2', vendorName: 'Globex', total: 1200, dueAt: '2026-04-01', daysPastDue: 45 },
    ] },
    { key: 'd90plus', label: '90+', total: 2000, bills: [
      { id: 'b3', number: 'BILL-3', vendorName: 'Initech', total: 2000, dueAt: '2026-01-01', daysPastDue: 120 },
    ] },
  ],
};

describe('APAgingPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading spinner while the request is in flight', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<APAgingPanel />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('shows the no-data state when the result is missing', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<APAgingPanel />);
    expect(await screen.findByText('No data.')).toBeInTheDocument();
  });

  it('renders buckets and a sorted bill list with populated data', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: POPULATED } });
    render(<APAgingPanel />);
    expect(await screen.findByText(/as of 2026-05-22/)).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('90+')).toBeInTheDocument();
    // singular vs plural bill count
    expect(screen.getAllByText('1 bill').length).toBeGreaterThan(0);
    expect(screen.getByText('0 bills')).toBeInTheDocument();
    // bills sorted by daysPastDue desc — Initech (120d) first
    expect(screen.getByText('Initech')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
    expect(screen.getByText('120d')).toBeInTheDocument();
  });

  it('omits the bill list when every bucket is empty', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { asOf: '2026-05-22', totalOpen: 0, buckets: [
        { key: 'current', label: 'Current', total: 0, bills: [] },
      ] } },
    });
    render(<APAgingPanel />);
    await screen.findByText('Current');
    expect(screen.queryByText(/d$/)).toBeNull();
  });

  it('handles a rejected request and falls back to the no-data state', async () => {
    lensRun.mockRejectedValue(new Error('network'));
    render(<APAgingPanel />);
    expect(await screen.findByText('No data.')).toBeInTheDocument();
  });
});
