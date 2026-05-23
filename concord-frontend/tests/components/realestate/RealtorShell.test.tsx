import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('next/dynamic', () => ({
  default: () => () => React.createElement('div', { 'data-testid': 'listings-map' }, 'map'),
}));

import { RealtorShell } from '@/components/realestate/RealtorShell';
import type { RealtorListing, RealtorActivity } from '@/components/realestate/RealtorShell';

const LISTINGS: RealtorListing[] = [
  { id: 'l1', address: '1 Pine St', city: 'Austin', state: 'TX', zip: '78701', price: 2_500_000, beds: 4, baths: 3, sqft: 3200, status: 'for_sale', daysOnMarket: 3, hotScore: 80, favourited: true, imageUrl: 'https://x/1.jpg' },
  { id: 'l2', address: '2 Oak Ave', price: 450_000, beds: 2, baths: 1, sqft: 900, status: 'pending', daysOnMarket: 40, hotScore: 10, favourited: false },
  { id: 'l3', address: '3 Elm Ct', price: 800, beds: 1, baths: 1, sqft: 400, status: 'sold' },
];
const ACTIVITY: RealtorActivity[] = [
  { id: 'a1', kind: 'favourite', label: 'Favourited 1 Pine St', timestamp: '2026-05-01T00:00:00Z' },
  { id: 'a2', kind: 'tour', label: 'Tour booked', timestamp: '2026-05-02T00:00:00Z' },
  { id: 'a3', kind: 'message', label: 'Agent replied', timestamp: '2026-05-03T00:00:00Z' },
  { id: 'a4', kind: 'price_drop', label: 'Price dropped', timestamp: '2026-05-04T00:00:00Z' },
  { id: 'a5', kind: 'open_house', label: 'Open house added', timestamp: '2026-05-05T00:00:00Z' },
];

describe('RealtorShell', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty listings rail and no activity / no chips', () => {
    render(<RealtorShell query="" listings={[]} totalCount={0} />);
    expect(screen.getByText('No listings match your filters.')).toBeInTheDocument();
    expect(screen.queryByText('Recent activity')).not.toBeInTheDocument();
    expect(screen.getByTestId('listings-map')).toBeInTheDocument();
  });

  it('renders listings with formatted prices, hot badge, and metric tiles', () => {
    render(
      <RealtorShell
        query="austin"
        listings={LISTINGS}
        totalCount={3}
        medianPrice={650_000}
        favouriteCount={1}
        upcomingTourCount={2}
        filterChips={['3+ bd', 'under $1M']}
      />,
    );
    expect(screen.getByText('$2.50M')).toBeInTheDocument();
    expect(screen.getByText('$450K')).toBeInTheDocument();
    expect(screen.getByText('$800')).toBeInTheDocument();
    expect(screen.getByText('🔥 Hot')).toBeInTheDocument();
    expect(screen.getByText('3+ bd')).toBeInTheDocument();
    expect(screen.getByText('$650K')).toBeInTheDocument();
  });

  it('shows a dash for an absent median price', () => {
    render(<RealtorShell query="" listings={[]} totalCount={0} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('fires onSubmitQuery on form submit and onQueryChange on input', () => {
    const onSubmitQuery = vi.fn();
    const onQueryChange = vi.fn();
    render(<RealtorShell query="q" listings={[]} totalCount={0} onSubmitQuery={onSubmitQuery} onQueryChange={onQueryChange} />);
    fireEvent.change(screen.getByPlaceholderText(/Search by city/), { target: { value: 'condo' } });
    expect(onQueryChange).toHaveBeenCalledWith('condo');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onSubmitQuery).toHaveBeenCalled();
  });

  it('fires onSelectListing when an article is clicked', () => {
    const onSelectListing = vi.fn();
    render(<RealtorShell query="" listings={LISTINGS} totalCount={3} onSelectListing={onSelectListing} />);
    fireEvent.click(screen.getByText('1 Pine St'));
    expect(onSelectListing).toHaveBeenCalledWith(expect.objectContaining({ id: 'l1' }));
  });

  it('fires onToggleFavourite without bubbling to the card click', () => {
    const onToggleFavourite = vi.fn();
    const onSelectListing = vi.fn();
    render(<RealtorShell query="" listings={LISTINGS} totalCount={3} onToggleFavourite={onToggleFavourite} onSelectListing={onSelectListing} />);
    fireEvent.click(screen.getByLabelText('Unfavourite'));
    expect(onToggleFavourite).toHaveBeenCalledWith(expect.objectContaining({ id: 'l1' }));
    expect(onSelectListing).not.toHaveBeenCalled();
  });

  it('renders all activity icon kinds', () => {
    render(<RealtorShell query="" listings={[]} totalCount={0} activity={ACTIVITY} />);
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
    expect(screen.getByText('Favourited 1 Pine St')).toBeInTheDocument();
    expect(screen.getByText('Open house added')).toBeInTheDocument();
  });
});
