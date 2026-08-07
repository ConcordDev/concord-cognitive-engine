import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import React from 'react';

// ShipmentsMap drives the real maplibre-gl WebGL renderer (jsdom can't run
// WebGL) — mocked the same way tests/components/TrackMap.test.tsx mocks it.

const mapInstances: any[] = [];
const markerInstances: any[] = [];

function makeMockMap() {
  const listeners: Record<string, (() => void)[]> = {};
  const sources: Record<string, { setData: ReturnType<typeof vi.fn> }> = {};
  const map = {
    remove: vi.fn(),
    isStyleLoaded: vi.fn().mockReturnValue(true),
    once: vi.fn((evt: string, fn: () => void) => {
      (listeners[evt] ??= []).push(fn);
    }),
    getSource: vi.fn((id: string) => sources[id]),
    addSource: vi.fn((id: string) => {
      sources[id] = { setData: vi.fn() };
    }),
    addLayer: vi.fn(),
    _fireOnce: (evt: string) => listeners[evt]?.forEach((fn) => fn()),
  };
  mapInstances.push(map);
  return map;
}

function makeMockMarker() {
  const marker: any = {
    setLngLat: vi.fn().mockReturnThis(),
    setPopup: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  };
  markerInstances.push(marker);
  return marker;
}

vi.mock('maplibre-gl', () => ({
  Map: vi.fn().mockImplementation(() => makeMockMap()),
  Marker: vi.fn().mockImplementation(() => makeMockMarker()),
  Popup: vi.fn().mockImplementation(() => ({ setHTML: vi.fn().mockReturnThis() })),
  NavigationControl: vi.fn().mockImplementation(() => ({})),
}));

import * as maplibregl from 'maplibre-gl';
import { ShipmentsMap } from '@/components/logistics/ShipmentsMap';

function shipment(overrides: Partial<{ id: string; trackingNumber: string; origin: string; destination: string; status: string; mode: string }> = {}) {
  return {
    id: 's1',
    trackingNumber: 'TRK1',
    origin: 'Austin, TX',
    destination: 'Boston, MA',
    status: 'in_transit',
    mode: 'ground',
    ...overrides,
  };
}

describe('ShipmentsMap', () => {
  beforeEach(() => {
    mapInstances.length = 0;
    markerInstances.length = 0;
  });
  afterEach(() => cleanup());

  it('shows the empty-state hint when no shipment geocodes to known cities', () => {
    render(<ShipmentsMap shipments={[shipment({ origin: 'Nowhereville', destination: 'Notarealplace' })]} />);
    expect(screen.getByText(/Add shipments with recognisable city names/i)).toBeInTheDocument();
    expect(mapInstances).toHaveLength(0);
  });

  it('plots a route for shipments with exact-match city coords and draws solid + dashed layers', () => {
    render(<ShipmentsMap shipments={[shipment()]} />);
    expect(mapInstances).toHaveLength(1);
    expect(mapInstances[0].addSource).toHaveBeenCalledWith('routes', expect.objectContaining({ type: 'geojson' }));
    expect(mapInstances[0].addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'routes-solid' }));
    expect(mapInstances[0].addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'routes-dashed' }));
  });

  it('geocodes via the city-only substring fallback when the exact "city, state" key misses', () => {
    render(
      <ShipmentsMap
        shipments={[shipment({ origin: 'Austin metro area', destination: 'Greater Boston region' })]}
      />,
    );
    expect(mapInstances).toHaveLength(1);
    expect(markerInstances).toHaveLength(2);
  });

  it('drops a shipment when either origin or destination fails to geocode, and keeps the rest', () => {
    render(
      <ShipmentsMap
        shipments={[shipment(), shipment({ id: 's2', origin: 'Nowhereville', destination: 'Also nowhere' })]}
      />,
    );
    expect(markerInstances).toHaveLength(2); // only the one resolvable shipment's 2 markers
  });

  it('marks delivered routes solid (dashed:0) and in-flight routes dashed (dashed:1), colour-keyed by status', () => {
    render(
      <ShipmentsMap
        shipments={[shipment({ status: 'delivered' }), shipment({ id: 's2', status: 'exception' })]}
      />,
    );
    const [, sourceOpts] = mapInstances[0].addSource.mock.calls[0];
    const props = sourceOpts.data.features.map((f: any) => f.properties);
    expect(props).toContainEqual(expect.objectContaining({ dashed: 0, color: '#34d399' }));
    expect(props).toContainEqual(expect.objectContaining({ dashed: 1, color: '#fb7185' }));
  });

  it('falls back to the default line colour for an unrecognised status', () => {
    render(<ShipmentsMap shipments={[shipment({ status: 'some_unknown_status' })]} />);
    const [, sourceOpts] = mapInstances[0].addSource.mock.calls[0];
    expect(sourceOpts.data.features[0].properties.color).toBe('#22d3ee');
  });

  it('rebuilds the map when the shipments prop changes', () => {
    const { rerender } = render(<ShipmentsMap shipments={[shipment()]} />);
    const first = mapInstances[0];
    rerender(<ShipmentsMap shipments={[shipment({ id: 's2', trackingNumber: 'TRK2' })]} />);
    expect(first.remove).toHaveBeenCalled();
    expect(mapInstances).toHaveLength(2);
  });

  it('takes the setData branch on a repeat draw against the same map instance', () => {
    (maplibregl.Map as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const map = makeMockMap();
      map.isStyleLoaded.mockReturnValue(false);
      return map;
    });
    render(<ShipmentsMap shipments={[shipment()]} />);
    const map = mapInstances[0];
    map._fireOnce('load');
    expect(map.addSource).toHaveBeenCalledTimes(1);
    map._fireOnce('load');
    expect(map.getSource('routes').setData).toHaveBeenCalledTimes(1);
  });

  it('removes the map instance on unmount', () => {
    const { unmount } = render(<ShipmentsMap shipments={[shipment()]} />);
    unmount();
    expect(mapInstances[0].remove).toHaveBeenCalled();
  });
});
