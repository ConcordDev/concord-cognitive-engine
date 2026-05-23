import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));
vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, ...p }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLDivElement>) =>
      React.createElement('div', { ...p, ref }, children)),
  },
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: (p: Record<string, unknown>) => React.createElement('button', { 'data-testid': 'save-dtu' }, String(p.title)),
}));

import { NeighborhoodStats } from '@/components/realestate/NeighborhoodStats';

const STATS = {
  ok: true,
  result: {
    address: '1 Apple Park Way, Cupertino, CA',
    matchedAddress: '1 Apple Park Way, Cupertino, CA 95014',
    coords: { lat: 37.3349, lng: -122.0090 },
    tract: { state: '06', county: '085', tract: '5081', name: 'Census Tract 5081' },
    demographics: { totalPopulation: 4231, medianAge: 38.4, bachelorsOrHigherPct: 62.1 },
    economics: { medianHouseholdIncome: 165000, medianIncomeUSD: '$165,000' },
  },
};

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('NeighborhoodStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {} } } });
  });

  it('renders the form with the default address and no stats', () => {
    renderWithClient(<NeighborhoodStats />);
    expect(screen.getByText('Neighborhood Stats')).toBeInTheDocument();
    expect((screen.getByPlaceholderText(/Street address/) as HTMLInputElement).value)
      .toContain('1600 Pennsylvania');
    expect(screen.queryByTestId('save-dtu')).not.toBeInTheDocument();
  });

  it('looks up stats and renders the result cells', async () => {
    runDomain.mockResolvedValue({ data: STATS });
    renderWithClient(<NeighborhoodStats />);
    fireEvent.submit(screen.getByPlaceholderText(/Street address/).closest('form')!);
    expect(await screen.findByText('1 Apple Park Way, Cupertino, CA 95014')).toBeInTheDocument();
    expect(screen.getByText('$165,000')).toBeInTheDocument();
    expect(screen.getByText('4,231')).toBeInTheDocument();
    expect(screen.getByText('38.4 yr')).toBeInTheDocument();
    expect(screen.getByText('62.1%')).toBeInTheDocument();
    expect(screen.getByTestId('save-dtu')).toBeInTheDocument();
  });

  it('shows an error when the lookup returns ok:false', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'address not found' } } });
    renderWithClient(<NeighborhoodStats />);
    fireEvent.submit(screen.getByPlaceholderText(/Street address/).closest('form')!);
    expect(await screen.findByText('address not found')).toBeInTheDocument();
  });

  it('shows the generic error when the envelope is empty', async () => {
    runDomain.mockResolvedValue({ data: { ok: false } });
    renderWithClient(<NeighborhoodStats />);
    fireEvent.submit(screen.getByPlaceholderText(/Street address/).closest('form')!);
    expect(await screen.findByText('lookup failed')).toBeInTheDocument();
  });

  it('does not submit when the address field is cleared', () => {
    renderWithClient(<NeighborhoodStats />);
    fireEvent.change(screen.getByPlaceholderText(/Street address/), { target: { value: '   ' } });
    const btn = screen.getByRole('button', { name: /Lookup/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('updates the address input on change', () => {
    renderWithClient(<NeighborhoodStats />);
    const input = screen.getByPlaceholderText(/Street address/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5 Market St, SF, CA' } });
    expect(input.value).toBe('5 Market St, SF, CA');
  });
});
