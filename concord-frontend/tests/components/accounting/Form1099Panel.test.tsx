import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { Form1099Panel } from '@/components/accounting/Form1099Panel';

const YEAR = new Date().getFullYear();
const POPULATED = {
  year: YEAR, threshold: 600,
  vendors: [
    { vendorId: 'v1', vendorName: 'Acme', taxId: '12-3456789', total: 5000, billCount: 4, reportable: true },
    { vendorId: 'v2', vendorName: 'Globex', taxId: '', total: 200, billCount: 1, reportable: false },
  ],
};

describe('Form1099Panel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<Form1099Panel />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('shows the no-data state when the result is null', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<Form1099Panel />);
    expect(await screen.findByText('No data.')).toBeInTheDocument();
  });

  it('shows the no-vendors-paid state when the vendor list is empty', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { year: YEAR, threshold: 600, vendors: [] } } });
    render(<Form1099Panel />);
    expect(await screen.findByText(/No 1099 vendors paid/)).toBeInTheDocument();
  });

  it('renders reportable and below-threshold tables', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: POPULATED } });
    render(<Form1099Panel />);
    expect(await screen.findByText(/Reportable \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Below threshold \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('12-3456789')).toBeInTheDocument();
    expect(screen.getByText('$5000.00')).toBeInTheDocument();
    // vendor with no taxId renders the "missing" marker
    expect(screen.getByText('missing')).toBeInTheDocument();
    expect(screen.getByText(/threshold ≥ \$600/)).toBeInTheDocument();
  });

  it('only renders the reportable table when nothing is below threshold', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { year: YEAR, threshold: 600, vendors: [POPULATED.vendors[0]] } },
    });
    render(<Form1099Panel />);
    expect(await screen.findByText(/Reportable \(1\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Below threshold/)).toBeNull();
  });

  it('refetches when the year selector changes', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: POPULATED } });
    render(<Form1099Panel />);
    await screen.findByText('Acme');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: String(YEAR - 1) } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'summary-1099', input: { year: YEAR - 1 } }),
      ),
    );
  });

  it('falls back to the no-data state on a rejected request', async () => {
    lensRun.mockRejectedValue(new Error('boom'));
    render(<Form1099Panel />);
    expect(await screen.findByText('No data.')).toBeInTheDocument();
  });
});
