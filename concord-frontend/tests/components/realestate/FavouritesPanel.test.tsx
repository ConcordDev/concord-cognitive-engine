import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { FavouritesPanel } from '@/components/realestate/FavouritesPanel';

const FAVS = [
  { id: 'f1', address: '1 Oak St', city: 'Austin', state: 'TX', zip: '78701', price: 450000, beds: 3, baths: 2, sqft: 1800, yearBuilt: 2010, kind: 'single_family', status: 'for_sale', daysOnMarket: 4 },
  { id: 'f2', address: '2 Elm Ave', city: 'Dallas', state: 'TX', zip: '75201', price: 620000, beds: 4, baths: 3, sqft: 2400, yearBuilt: 2015, kind: 'condo', status: 'pending', daysOnMarket: 20 },
];

describe('FavouritesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { favourites: [] } } });
  });

  it('shows the empty state when there are no favourites', async () => {
    render(<FavouritesPanel />);
    expect(await screen.findByText('Heart a listing to save it here.')).toBeInTheDocument();
  });

  it('renders favourite listings with details', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { favourites: FAVS } } });
    render(<FavouritesPanel />);
    expect(await screen.findByText('$450,000')).toBeInTheDocument();
    expect(screen.getByText('1 Oak St')).toBeInTheDocument();
    expect(screen.getByText('2 Elm Ave')).toBeInTheDocument();
  });

  it('fires onSelect when a favourite is clicked', async () => {
    const onSelect = vi.fn();
    lensRun.mockResolvedValue({ data: { ok: true, result: { favourites: FAVS } } });
    render(<FavouritesPanel onSelect={onSelect} />);
    await screen.findByText('1 Oak St');
    fireEvent.click(screen.getByText('1 Oak St'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
  });

  it('removes a favourite when the heart button is clicked', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { favourites: FAVS } } });
    render(<FavouritesPanel />);
    await screen.findByText('1 Oak St');
    fireEvent.click(screen.getAllByLabelText('Remove')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'favourites-toggle', input: { id: 'f1' } }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('1 Oak St')).not.toBeInTheDocument());
  });

  it('tolerates a rejected unfavourite call', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'favourites-list') return Promise.resolve({ data: { ok: true, result: { favourites: FAVS } } });
      return Promise.reject(new Error('x'));
    });
    render(<FavouritesPanel />);
    await screen.findByText('1 Oak St');
    fireEvent.click(screen.getAllByLabelText('Remove')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'favourites-toggle' })));
    expect(screen.getByText('1 Oak St')).toBeInTheDocument();
  });

  it('tolerates a rejected list call', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<FavouritesPanel />);
    expect(await screen.findByText('Heart a listing to save it here.')).toBeInTheDocument();
  });
});
