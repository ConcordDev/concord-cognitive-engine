// Atlas full-build FE tests (B6, F-C row 12) — S2's frontend half:
// the Places / Lists / Trips / Offline-areas deletes are two-step
// in-page controls. The native confirm() they used before is
// suppressed in the shell, so the buttons read as inert (F2). First
// click arms and must NOT call the server; the confirm click fires;
// window.confirm is never invoked anywhere in the flow.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/atlas/PlacesGraph', () => ({ PlacesGraph: () => null }));
vi.mock('@/components/atlas/AtlasKeepMenu', () => ({ AtlasKeepMenu: () => null }));
vi.mock('@/components/atlas/PlaceShareSheet', () => ({ PlaceShareSheet: () => null }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('@/components/atlas/DistanceMatrixPanel', () => ({ DistanceMatrixPanel: () => null }));
vi.mock('@/components/atlas/RegionStatsTool', () => ({ RegionStatsTool: () => null }));
vi.mock('@/components/atlas/BatchGeocodeTool', () => ({ BatchGeocodeTool: () => null }));
vi.mock('@/components/atlas/PlaceDetails', () => ({ PlaceDetails: () => null }));
vi.mock('@/components/atlas/StreetImagery', () => ({ StreetImagery: () => null }));
vi.mock('@/components/atlas/LiveTrafficPanel', () => ({ LiveTrafficPanel: () => null }));
vi.mock('@/components/atlas/TransitDirections', () => ({ TransitDirections: () => null }));
vi.mock('@/components/atlas/NavigationMode', () => ({ NavigationMode: () => null }));
vi.mock('@/components/atlas/RouteStops', () => ({ RouteStops: () => null }));
vi.mock('@/components/atlas/AtlasActionPanel', () => ({ AtlasActionPanel: () => null }));
vi.mock('@/components/ui', () => ({ Skeleton: () => null }));

import { AtlasSection } from '@/components/atlas/AtlasSection';
import { OfflineAreas } from '@/components/atlas/OfflineAreas';

interface CallShape { domain: string; action: string; input: Record<string, unknown> }
function normalize(args: unknown[]): CallShape {
  const first = args[0] as Record<string, unknown>;
  if (first && typeof first === 'object' && 'action' in first) {
    return { domain: String(first.domain), action: String(first.action), input: (first.input as Record<string, unknown>) || {} };
  }
  return { domain: String(args[0]), action: String(args[1]), input: (args[2] as Record<string, unknown>) || {} };
}
function callsFor(action: string): CallShape[] {
  return lensRunMock.mock.calls.map((c) => normalize(c as unknown[])).filter((c) => c.action === action);
}

const place = { id: 'pl_1', number: 'PL-00001', name: 'Tour Eiffel', lat: 48.8584, lng: 2.2945, category: 'attraction', address: 'Paris', notes: '', rating: 5, savedAt: '2026-10-30' };
const list = { id: 'li_1', number: 'ML-00001', name: 'PR2 Atlas List', description: '', color: '#14b8a6', placeIds: [] as string[], placeCount: 0, places: [] as never[] };
const trip = { id: 'tr_1', number: 'TR-00001', name: 'PR2 Atlas Trip', startDate: '', endDate: '', stops: [] as never[], createdAt: '2026-10-30' };
const area = { id: 'oa_1', number: 'OA-00001', name: 'Home turf', bbox: { south: 41.6, west: -74, north: 41.8, east: -73.8 }, minZoom: 10, maxZoom: 15, tileCount: 662, estimatedSizeMB: 12, status: 'ready' as const, createdAt: '2026-10-30' };

let places = [place];
let lists = [list];
let trips = [trip];
let areas = [area];
const confirmSpy = vi.fn(() => true);

beforeEach(() => {
  places = [place]; lists = [list]; trips = [trip]; areas = [area];
  confirmSpy.mockClear();
  window.confirm = confirmSpy;
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...args: unknown[]) => {
    const { action, input } = normalize(args);
    switch (action) {
      case 'places-list': return { data: { ok: true, result: { places } } };
      case 'lists-list': return { data: { ok: true, result: { lists } } };
      case 'trips-list': return { data: { ok: true, result: { trips } } };
      case 'places-delete': places = places.filter((p) => p.id !== input.id); return { data: { ok: true, result: {} } };
      case 'lists-delete': lists = lists.filter((l) => l.id !== input.id); return { data: { ok: true, result: {} } };
      case 'trips-delete': trips = trips.filter((t) => t.id !== input.id); return { data: { ok: true, result: {} } };
      case 'offline-areas-list': return { data: { ok: true, result: { areas } } };
      case 'offline-areas-delete': areas = areas.filter((a) => a.id !== input.id); return { data: { ok: true, result: {} } };
      default: return { data: { ok: true, result: {} } };
    }
  });
});

describe('atlas S2 — two-step deletes, no native confirm()', () => {
  it('places: first click arms without a server call, confirm click deletes', async () => {
    render(<AtlasSection />);
    await waitFor(() => expect(screen.getByText('Tour Eiffel')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(callsFor('places-delete')).toHaveLength(0);
    const confirmBtn = await screen.findByTestId('place-delete-confirm');
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(callsFor('places-delete')).toHaveLength(1));
    expect(callsFor('places-delete')[0].input.id).toBe('pl_1');
    await waitFor(() => expect(screen.queryByText('Tour Eiffel')).toBeNull());
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('lists: the same two-step shape on the Lists tab', async () => {
    render(<AtlasSection />);
    await waitFor(() => expect(screen.getByText('Tour Eiffel')).toBeTruthy());
    fireEvent.click(document.querySelector('button[title="Lists"]') as HTMLElement);
    await waitFor(() => expect(screen.getByText('PR2 Atlas List')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(callsFor('lists-delete')).toHaveLength(0);
    fireEvent.click(await screen.findByTestId('list-delete-confirm'));
    await waitFor(() => expect(callsFor('lists-delete')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('PR2 Atlas List')).toBeNull());
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('trips: the same two-step shape on the Trips tab', async () => {
    render(<AtlasSection />);
    await waitFor(() => expect(screen.getByText('Tour Eiffel')).toBeTruthy());
    fireEvent.click(document.querySelector('button[title="Trips"]') as HTMLElement);
    await waitFor(() => expect(screen.getByText('PR2 Atlas Trip')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(callsFor('trips-delete')).toHaveLength(0);
    fireEvent.click(await screen.findByTestId('trip-delete-confirm'));
    await waitFor(() => expect(callsFor('trips-delete')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('PR2 Atlas Trip')).toBeNull());
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('offline areas: Delete arms first, the confirm click fires the delete', async () => {
    render(<OfflineAreas />);
    await waitFor(() => expect(screen.getByText('Home turf')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(callsFor('offline-areas-delete')).toHaveLength(0);
    fireEvent.click(await screen.findByTestId('offline-delete-confirm'));
    await waitFor(() => expect(callsFor('offline-areas-delete')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Home turf')).toBeNull());
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
