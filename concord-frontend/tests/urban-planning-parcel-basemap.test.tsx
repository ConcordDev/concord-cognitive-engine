/**
 * urban-planning ParcelManager — live OpenStreetMap basemap.
 *
 * Pins the "live parcel/GIS basemap" gap closure named in
 * docs/lens-specs/urban-planning-capability-map.md ("CityMap is a legitimate
 * local-coordinate schematic, not a georeferenced basemap"). ParcelManager
 * now ALSO mounts the platform-wide MapLibre/OSM basemap
 * (components/common/MapView, lib/maplibre/osm.ts) alongside the existing
 * schematic CityMap.
 *
 * Honesty contract under test:
 *   1. Only parcels with a real, non-zero (lat, lng) on file become basemap
 *      markers — a parcel added without coordinates is never plotted.
 *   2. The basemap still renders (pannable/zoomable) with zero markers when
 *      no parcel has coordinates — an honest empty state, not a hidden panel.
 *   3. No parcel-boundary polygon is drawn or fabricated — the caption says
 *      so explicitly (there is no honest free national cadastral-boundary
 *      source), only point markers.
 *
 * maplibre-gl needs a real WebGL/DOM context jsdom can't provide, so it's
 * mocked at the same surface as tests/components/MapView.test.tsx (Map /
 * Marker / Popup / NavigationControl). next/dynamic is resolved via a real
 * React.lazy + Suspense passthrough (the tests/daily-rituals-wiring.test.tsx
 * pattern) so the REAL MapView component (not a stub) is what's under test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — ParcelManager's single backend channel ──────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── maplibre-gl mock (mirrors tests/components/MapView.test.tsx) ───────────
const mapInstances: any[] = [];
const markerInstances: any[] = [];

function makeMockMap() {
  const listeners: Record<string, (() => void)[]> = {};
  const map = {
    addControl: vi.fn(),
    remove: vi.fn(),
    isStyleLoaded: vi.fn().mockReturnValue(true),
    once: vi.fn((evt: string, fn: () => void) => {
      (listeners[evt] ??= []).push(fn);
    }),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    _fireOnce: (evt: string) => listeners[evt]?.forEach((fn) => fn()),
  };
  mapInstances.push(map);
  return map;
}

function makeMockMarker() {
  const element = document.createElement('div');
  const marker: any = {
    _element: element,
    setLngLat: vi.fn().mockReturnThis(),
    setPopup: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    getElement: vi.fn(() => element),
    remove: vi.fn(),
  };
  markerInstances.push(marker);
  return marker;
}

vi.mock('maplibre-gl', () => ({
  default: {
    Map: vi.fn().mockImplementation(() => makeMockMap()),
    Marker: vi.fn().mockImplementation(() => makeMockMarker()),
    Popup: vi.fn().mockImplementation(() => ({ setHTML: vi.fn().mockReturnThis() })),
    NavigationControl: vi.fn().mockImplementation(() => ({})),
  },
}));

// next/dynamic → real React.lazy + Suspense passthrough so the real MapView
// (using the mocked maplibre-gl above) is what actually mounts.
vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
    const Lazy = React.lazy(loader);
    const Dyn = (props: Record<string, unknown>) =>
      React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
    return Dyn;
  },
}));

import { ParcelManager } from '@/components/urban-planning/ParcelManager';

function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

beforeEach(() => {
  lensRun.mockReset();
  mapInstances.length = 0;
  markerInstances.length = 0;
});
afterEach(() => cleanup());

describe('urban-planning ParcelManager — live OpenStreetMap basemap', () => {
  it('mounts the real MapView basemap section alongside the schematic CityMap', async () => {
    lensRun.mockImplementation(() => reply({ parcels: [] }));
    const { getByText } = render(<ParcelManager />);
    await waitFor(() => expect(getByText('Live Basemap (OpenStreetMap)')).toBeInTheDocument());
    expect(getByText('Parcel Map')).toBeInTheDocument(); // schematic CityMap still present
    await waitFor(() => expect(mapInstances).toHaveLength(1)); // real MapView actually mounted
  });

  it('plots a marker only for a parcel with a real non-zero coordinate on file', async () => {
    lensRun.mockImplementation(() =>
      reply({
        parcels: [
          {
            id: 'p1', apn: 'APN-001', address: '123 Main St', zoneType: 'residential',
            lotSizeSqFt: 5000, lat: 37.7749, lng: -122.4194, owner: '', district: '', createdAt: '',
          },
          {
            id: 'p2', apn: 'APN-002', address: 'no coords on file', zoneType: 'commercial',
            lotSizeSqFt: 8000, lat: 0, lng: 0, owner: '', district: '', createdAt: '',
          },
          {
            id: 'p3', apn: 'APN-003', address: 'null coords', zoneType: 'mixed',
            lotSizeSqFt: 3000, lat: null, lng: null, owner: '', district: '', createdAt: '',
          },
        ],
      }),
    );
    const { getByText } = render(<ParcelManager />);
    await waitFor(() => expect(mapInstances).toHaveLength(1));
    // Only APN-001 has a real coordinate — the (0,0) and null-coordinate
    // parcels must never be fabricated onto the live basemap.
    await waitFor(() => expect(markerInstances).toHaveLength(1));
    expect(getByText(/1 parcel with coordinates on file/)).toBeInTheDocument();
  });

  it('shows the honest no-coordinates note (basemap still live) when no parcel has coordinates', async () => {
    lensRun.mockImplementation(() =>
      reply({
        parcels: [
          {
            id: 'p1', apn: 'APN-001', address: 'no coords', zoneType: 'residential',
            lotSizeSqFt: 5000, lat: 0, lng: 0, owner: '', district: '', createdAt: '',
          },
        ],
      }),
    );
    const { getByText } = render(<ParcelManager />);
    await waitFor(() => expect(mapInstances).toHaveLength(1));
    expect(markerInstances).toHaveLength(0);
    await waitFor(() =>
      expect(getByText(/No parcels with coordinates on file yet/)).toBeInTheDocument(),
    );
  });

  it('never draws or claims parcel-boundary polygons — states the honest sourcing gap', async () => {
    lensRun.mockImplementation(() => reply({ parcels: [] }));
    const { getByText } = render(<ParcelManager />);
    await waitFor(() =>
      expect(getByText(/no honest free national GIS source/)).toBeInTheDocument(),
    );
  });
});
