import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

let capturedClick: ((e: { latlng: { lat: number; lng: number } }) => void) | null = null;

vi.mock('react-leaflet', () => ({
  MapContainer: (p: { children?: React.ReactNode; center?: number[]; zoom?: number }) => (
    <div data-testid="map" data-center={JSON.stringify(p.center)} data-zoom={p.zoom}>{p.children}</div>
  ),
  TileLayer: () => <div data-testid="tiles" />,
  Marker: (p: { children?: React.ReactNode; position?: number[] }) => (
    <div data-testid="marker" data-pos={JSON.stringify(p.position)}>{p.children}</div>
  ),
  Popup: (p: { children?: React.ReactNode }) => <div data-testid="popup">{p.children}</div>,
  useMapEvents: (handlers: { click: (e: { latlng: { lat: number; lng: number } }) => void }) => {
    capturedClick = handlers.click;
    return null;
  },
}));

vi.mock('leaflet', () => ({
  default: {
    icon: () => ({}),
    divIcon: () => ({}),
    Marker: { prototype: { options: {} } },
  },
}));

vi.mock('leaflet/dist/leaflet.css', () => ({}));

import { PinDropMap } from '@/components/government/PinDropMap';

const EXISTING = [
  { lat: 40, lng: -73, label: 'SR-1', category: 'pot_hole', status: 'in_progress' },
];

describe('PinDropMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedClick = null;
  });

  it('centres on the US default with no pin and no markers', () => {
    render(<PinDropMap existing={[]} pin={null} onPick={vi.fn()} />);
    const map = screen.getByTestId('map');
    expect(map.getAttribute('data-center')).toBe('[39.5,-98.35]');
    expect(map.getAttribute('data-zoom')).toBe('4');
  });

  it('centres on the first existing marker when present', () => {
    render(<PinDropMap existing={EXISTING} pin={null} onPick={vi.fn()} />);
    const map = screen.getByTestId('map');
    expect(map.getAttribute('data-center')).toBe('[40,-73]');
    expect(map.getAttribute('data-zoom')).toBe('12');
    expect(screen.getByText('SR-1')).toBeInTheDocument();
  });

  it('centres on the pin and renders a pin marker', () => {
    render(<PinDropMap existing={EXISTING} pin={{ lat: 51, lng: 0 }} onPick={vi.fn()} />);
    const map = screen.getByTestId('map');
    expect(map.getAttribute('data-center')).toBe('[51,0]');
    expect(screen.getByText('New report location')).toBeInTheDocument();
  });

  it('invokes onPick when the map registers a click', () => {
    const onPick = vi.fn();
    render(<PinDropMap existing={[]} pin={null} onPick={onPick} />);
    expect(capturedClick).toBeTypeOf('function');
    capturedClick!({ latlng: { lat: 12.3, lng: 45.6 } });
    expect(onPick).toHaveBeenCalledWith(12.3, 45.6);
  });
});
