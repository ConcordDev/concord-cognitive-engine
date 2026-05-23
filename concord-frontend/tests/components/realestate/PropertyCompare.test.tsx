import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { PropertyCompare } from '@/components/realestate/PropertyCompare';

const LISTINGS = [
  { id: 'a', address: '1 Pine St', price: 400000 },
  { id: 'b', address: '2 Birch Rd', price: 600000 },
];
const ROWS = [
  { field: 'Price', values: [400000, 600000] },
  { field: 'Beds', values: [3, 3] },
  { field: 'Garage', values: ['yes', null] },
];

describe('PropertyCompare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: [], rows: [] } } });
  });

  it('shows the pick-more prompt with fewer than 2 ids', () => {
    render(<PropertyCompare ids={['a']} />);
    expect(screen.getByText('Pick at least 2 listings from the browser to compare.')).toBeInTheDocument();
    expect(screen.getByText('1 picked')).toBeInTheDocument();
  });

  it('renders the comparison table with min/max highlighting', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: LISTINGS, rows: ROWS } } });
    render(<PropertyCompare ids={['a', 'b']} />);
    expect(await screen.findByText('1 Pine St')).toBeInTheDocument();
    expect(screen.getByText('2 Birch Rd')).toBeInTheDocument();
    expect(screen.getByText('400,000')).toBeInTheDocument();
    expect(screen.getByText('600,000')).toBeInTheDocument();
    expect(screen.getByText('yes')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows an error when compare returns ok:false', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'too many' } });
    render(<PropertyCompare ids={['a', 'b']} />);
    expect(await screen.findByText('too many')).toBeInTheDocument();
  });

  it('handles a rejected compare call', async () => {
    lensRun.mockRejectedValue(new Error('boom'));
    render(<PropertyCompare ids={['a', 'b']} />);
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('fires onClear when Clear is clicked', () => {
    const onClear = vi.fn();
    render(<PropertyCompare ids={['a']} onClear={onClear} />);
    fireEvent.click(screen.getByText('Clear'));
    expect(onClear).toHaveBeenCalled();
  });

  it('fires onRemove from a column header', async () => {
    const onRemove = vi.fn();
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: LISTINGS, rows: ROWS } } });
    render(<PropertyCompare ids={['a', 'b']} onRemove={onRemove} />);
    await screen.findByText('1 Pine St');
    fireEvent.click(screen.getAllByText('remove')[0]);
    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('calls compare with the picked ids', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: LISTINGS, rows: ROWS } } });
    render(<PropertyCompare ids={['a', 'b']} />);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'compare', input: { ids: ['a', 'b'] } }),
      ),
    );
  });
});
