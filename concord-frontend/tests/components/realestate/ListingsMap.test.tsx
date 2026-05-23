import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('next/dynamic', () => ({
  default: () => {
    const MapStub = (props: { center?: number[]; markers?: { lat: number; lng: number; label: string }[]; onMarkerClick?: (m: { lat: number; lng: number }) => void }) => (
      <div data-testid="map-view">
        <span data-testid="map-center">{JSON.stringify(props.center)}</span>
        {(props.markers || []).map((m, i) => (
          <button key={i} data-testid={`marker-${i}`} onClick={() => props.onMarkerClick?.(m)}>
            {m.label}
          </button>
        ))}
      </div>
    );
    return MapStub;
  },
}));

import { ListingsMap } from '@/components/realestate/ListingsMap';

const base = { id: 'x', address: '1 St', city: 'C', state: 'TX', zip: '1', price: 0, beds: 3, baths: 2, sqft: 1800, status: 'for_sale' as const };

describe('ListingsMap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the empty message when no listing has coords', () => {
    render(<ListingsMap listings={[{ ...base, price: 500000 }]} className="cls" />);
    expect(screen.getByText(/Add listings with lat\/lng coords/)).toBeInTheDocument();
  });

  it('renders markers with formatted price labels (M, K, plain)', () => {
    render(
      <ListingsMap
        listings={[
          { ...base, id: 'm', price: 2_500_000, lat: 30, lng: -97 },
          { ...base, id: 'k', price: 450_000, lat: 31, lng: -98 },
          { ...base, id: 'p', price: 800, lat: 32, lng: -99 },
        ]}
      />,
    );
    expect(screen.getByText('$2.50M')).toBeInTheDocument();
    expect(screen.getByText('$450K')).toBeInTheDocument();
    expect(screen.getByText('$800')).toBeInTheDocument();
    expect(screen.getByTestId('map-center').textContent).toBe('[30,-97]');
  });

  it('fires onSelect when a marker is clicked', () => {
    const onSelect = vi.fn();
    render(
      <ListingsMap
        listings={[{ ...base, id: 'sel', price: 600_000, lat: 30, lng: -97 }]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('marker-0'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'sel' }));
  });

  it('does not throw on marker click when onSelect is absent', () => {
    render(<ListingsMap listings={[{ ...base, id: 'q', price: 600_000, lat: 30, lng: -97 }]} />);
    expect(() => fireEvent.click(screen.getByTestId('marker-0'))).not.toThrow();
  });
});
