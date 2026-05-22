import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/lib/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { RxPriceCompare, type PharmacyPrice } from '@/components/healthcare/RxPriceCompare';

const prices: PharmacyPrice[] = [
  { pharmacy: 'CVS', address: '1 Main St', distanceMi: 1.2, cashPrice: 45.5, withInsuranceCopay: 10, couponCode: 'SAVE10', inStock: true },
  { pharmacy: 'Walgreens', address: '2 Oak Ave', distanceMi: 3.4, cashPrice: 12.99, inStock: false },
];

describe('RxPriceCompare', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders the empty state initially', () => {
    render(<RxPriceCompare />);
    expect(screen.getByText(/No prices found/)).toBeInTheDocument();
  });

  it('does not compare when the drug field is cleared', () => {
    render(<RxPriceCompare />);
    fireEvent.change(screen.getByPlaceholderText(/Drug name/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /Compare/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('renders sorted prices with cheapest tag and savings banner', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { prices } } });
    render(<RxPriceCompare />);
    fireEvent.click(screen.getByRole('button', { name: /Compare/ }));
    await waitFor(() => expect(screen.getByText('Walgreens')).toBeInTheDocument());
    // cheapest first
    expect(screen.getByText('cheapest')).toBeInTheDocument();
    expect(screen.getByText('out of stock')).toBeInTheDocument();
    expect(screen.getByText(/You could save up to/)).toBeInTheDocument();
    expect(screen.getByText('$12.99')).toBeInTheDocument();
  });

  it('shows the coupon code and copay when present', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { prices: [prices[0]] } } });
    render(<RxPriceCompare />);
    fireEvent.click(screen.getByRole('button', { name: /Compare/ }));
    await waitFor(() => expect(screen.getByText('CVS')).toBeInTheDocument());
    expect(screen.getByText(/code SAVE10/)).toBeInTheDocument();
    expect(screen.getByText(/copay \$10.00/)).toBeInTheDocument();
  });

  it('does not show the savings banner when the spread is small', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { prices: [
      { pharmacy: 'A', address: 'x', distanceMi: 1, cashPrice: 10, inStock: true },
      { pharmacy: 'B', address: 'y', distanceMi: 2, cashPrice: 12, inStock: true },
    ] } } });
    render(<RxPriceCompare />);
    fireEvent.click(screen.getByRole('button', { name: /Compare/ }));
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    expect(screen.queryByText(/You could save/)).not.toBeInTheDocument();
  });

  it('handles a macro error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('fail'));
    render(<RxPriceCompare />);
    fireEvent.click(screen.getByRole('button', { name: /Compare/ }));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it('accepts a ZIP value', () => {
    render(<RxPriceCompare />);
    const zip = screen.getByPlaceholderText('ZIP');
    fireEvent.change(zip, { target: { value: '90210' } });
    expect((zip as HTMLInputElement).value).toBe('90210');
  });
});
