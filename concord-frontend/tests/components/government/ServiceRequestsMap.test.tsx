import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/dynamic', () => ({
  default: () => {
    const MapStub = (props: { center?: number[]; markers?: { lat: number; lng: number; label: string }[] }) => (
      <div data-testid="map-view">
        <span data-testid="map-center">{JSON.stringify(props.center)}</span>
        {(props.markers || []).map((m, i) => (
          <span key={i} data-testid={`marker-${i}`}>{m.label}</span>
        ))}
      </div>
    );
    return MapStub;
  },
}));

import { ServiceRequestsMap } from '@/components/government/ServiceRequestsMap';

const REQS = [
  { id: 'r1', referenceNumber: 'SR-1', category: 'pothole', description: 'hole', lat: 40, lng: -73, address: '1 St', status: 'submitted', priority: 'urgent' as const },
  { id: 'r2', referenceNumber: 'SR-2', category: 'graffiti', description: 'tag', lat: 41, lng: -74, address: '', status: 'closed_resolved', priority: 'low' as const },
];

describe('ServiceRequestsMap', () => {
  it('renders the empty-state message when no geocoded requests', () => {
    render(<ServiceRequestsMap requests={[]} className="h-64" />);
    expect(screen.getByText('No geocoded service requests to map yet.')).toBeInTheDocument();
  });

  it('drops markers for finite-coordinate requests with priority emoji', () => {
    render(<ServiceRequestsMap requests={REQS} className="h-64" />);
    expect(screen.getByTestId('map-view')).toBeInTheDocument();
    expect(screen.getByTestId('marker-0').textContent).toContain('SR-1');
    expect(screen.getByTestId('marker-0').textContent).toContain('🔴');
    // SR-2 has priority 'low' -> white circle
    expect(screen.getByTestId('marker-1').textContent).toContain('⚪');
    expect(screen.getByTestId('map-center').textContent).toBe('[40,-73]');
  });

  it('filters out requests with non-finite coordinates', () => {
    const bad = [
      { ...REQS[0], lat: NaN, lng: -73 },
      REQS[1],
    ];
    render(<ServiceRequestsMap requests={bad} className="h-64" />);
    expect(screen.getByTestId('marker-0').textContent).toContain('SR-2');
    expect(screen.queryByTestId('marker-1')).not.toBeInTheDocument();
  });
});
