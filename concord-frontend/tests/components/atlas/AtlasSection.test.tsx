/**
 * AtlasSection — Wave 4 gap-closure coverage for two capability-map items
 * (docs/lens-specs/atlas-capability-map.md):
 *
 *   1. Edit-in-place for a saved place (PlacesPanel) — calls the real
 *      `atlas.places-update` macro with the edited fields.
 *   2. Up/down reorder for a trip's stops (TripsPanel) — calls the real
 *      `atlas.trips-reorder-stops` macro with the full reordered stopIds
 *      array (the macro's actual contract: every stop id exactly once).
 *
 * Both macros already exist server-side (server/domains/atlas.js); this test
 * pins that the newly-added UI actions call them with the right shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('next/dynamic', () => ({ default: () => () => null }));

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Heavier / unrelated sub-panels reached via other nav tabs — inert stubs so
// this file stays scoped to Places + Trips.
vi.mock('@/components/atlas/PlacesGraph', () => ({ PlacesGraph: () => null }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('@/components/atlas/PlaceShareSheet', () => ({ PlaceShareSheet: () => null }));
vi.mock('@/components/atlas/DistanceMatrixPanel', () => ({ DistanceMatrixPanel: () => null }));
vi.mock('@/components/atlas/RegionStatsTool', () => ({ RegionStatsTool: () => null }));
vi.mock('@/components/atlas/BatchGeocodeTool', () => ({ BatchGeocodeTool: () => null }));
vi.mock('@/components/atlas/PlaceDetails', () => ({ PlaceDetails: () => null }));
vi.mock('@/components/atlas/StreetImagery', () => ({ StreetImagery: () => null }));
vi.mock('@/components/atlas/OfflineAreas', () => ({ OfflineAreas: () => null }));
vi.mock('@/components/atlas/LiveTrafficPanel', () => ({ LiveTrafficPanel: () => null }));
vi.mock('@/components/atlas/TransitDirections', () => ({ TransitDirections: () => null }));
vi.mock('@/components/atlas/NavigationMode', () => ({ NavigationMode: () => null }));
vi.mock('@/components/atlas/RouteStops', () => ({ RouteStops: () => null }));
vi.mock('@/components/atlas/AtlasActionPanel', () => ({ AtlasActionPanel: () => null }));

import { AtlasSection } from '@/components/atlas/AtlasSection';

const PLACE = {
  id: 'place_1', number: 'PL-00001', name: 'Old Name', lat: 40.7, lng: -74.0,
  category: 'cafe', address: '1 Old St', notes: 'nice coffee', rating: 4, savedAt: '2026-01-01T00:00:00.000Z',
};

const TRIP = {
  id: 'trip_1', number: 'TR-0001', name: 'Weekend trip', startDate: '', endDate: '',
  stops: [
    { id: 'stop_a', name: 'Alpha', lat: 1, lng: 1, placeId: null, day: 1, notes: '' },
    { id: 'stop_b', name: 'Bravo', lat: 2, lng: 2, placeId: null, day: 1, notes: '' },
    { id: 'stop_c', name: 'Charlie', lat: 3, lng: 3, placeId: null, day: 1, notes: '' },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

function mockRefresh({ places = [PLACE], lists = [], trips = [TRIP] } = {}) {
  lensRunMock.mockImplementation((spec: { domain: string; action: string; input?: Record<string, unknown> }) => {
    if (spec.action === 'places-list') return Promise.resolve({ data: { ok: true, result: { places } } });
    if (spec.action === 'lists-list') return Promise.resolve({ data: { ok: true, result: { lists } } });
    if (spec.action === 'trips-list') return Promise.resolve({ data: { ok: true, result: { trips } } });
    if (spec.action === 'places-update') return Promise.resolve({ data: { ok: true, result: { place: places[0] } } });
    if (spec.action === 'trips-reorder-stops') return Promise.resolve({ data: { ok: true, result: { trip: trips[0] } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('AtlasSection — saved place edit-in-place', () => {
  it('opens an inline edit form and calls atlas.places-update with the edited fields', async () => {
    mockRefresh();
    const { getByText, getByLabelText, getByPlaceholderText } = render(<AtlasSection />);

    await waitFor(() => expect(getByText('Old Name')).toBeInTheDocument());

    fireEvent.click(getByLabelText('Edit'));

    const nameInput = getByPlaceholderText('Name *') as HTMLInputElement;
    expect(nameInput.value).toBe('Old Name');
    fireEvent.change(nameInput, { target: { value: 'New Name' } });

    const notesInput = getByPlaceholderText('Notes') as HTMLInputElement;
    fireEvent.change(notesInput, { target: { value: 'updated notes' } });

    lensRunMock.mockClear();
    fireEvent.click(getByText('Save'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'atlas',
      action: 'places-update',
      input: expect.objectContaining({
        id: 'place_1',
        name: 'New Name',
        notes: 'updated notes',
        category: 'cafe',
        address: '1 Old St',
        rating: 4,
      }),
    })));
  });

  it('cancels without calling places-update', async () => {
    mockRefresh();
    const { getByText, getByLabelText, queryByPlaceholderText } = render(<AtlasSection />);
    await waitFor(() => expect(getByText('Old Name')).toBeInTheDocument());

    fireEvent.click(getByLabelText('Edit'));
    expect(queryByPlaceholderText('Name *')).toBeInTheDocument();

    lensRunMock.mockClear();
    fireEvent.click(getByText('Cancel'));

    expect(queryByPlaceholderText('Name *')).not.toBeInTheDocument();
    expect(lensRunMock).not.toHaveBeenCalled();
  });
});

describe('AtlasSection — trip stop reorder', () => {
  it('moving a stop down calls atlas.trips-reorder-stops with the full reordered stopIds array', async () => {
    mockRefresh();
    const { getByText, getByTitle, getByLabelText, getAllByLabelText } = render(<AtlasSection />);

    await waitFor(() => expect(getByTitle('Trips')).toBeInTheDocument());
    fireEvent.click(getByTitle('Trips'));

    await waitFor(() => expect(getByText('Weekend trip')).toBeInTheDocument());
    fireEvent.click(getByLabelText('Next')); // expand the trip's stop list

    await waitFor(() => expect(getByText('Alpha')).toBeInTheDocument());

    lensRunMock.mockClear();
    const downButtons = getAllByLabelText('Move stop down');
    fireEvent.click(downButtons[0]); // move Alpha (index 0) down past Bravo

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'atlas',
      action: 'trips-reorder-stops',
      input: { tripId: 'trip_1', stopIds: ['stop_b', 'stop_a', 'stop_c'] },
    })));
  });

  it('disables the up arrow on the first stop and the down arrow on the last stop', async () => {
    mockRefresh();
    const { getByText, getByTitle, getByLabelText, getAllByLabelText } = render(<AtlasSection />);
    await waitFor(() => expect(getByTitle('Trips')).toBeInTheDocument());
    fireEvent.click(getByTitle('Trips'));
    await waitFor(() => expect(getByText('Weekend trip')).toBeInTheDocument());
    fireEvent.click(getByLabelText('Next'));
    await waitFor(() => expect(getByText('Alpha')).toBeInTheDocument());

    const upButtons = getAllByLabelText('Move stop up') as HTMLButtonElement[];
    const downButtons = getAllByLabelText('Move stop down') as HTMLButtonElement[];
    expect(upButtons[0].disabled).toBe(true);
    expect(downButtons[downButtons.length - 1].disabled).toBe(true);
    expect(downButtons[0].disabled).toBe(false);
    expect(upButtons[upButtons.length - 1].disabled).toBe(false);
  });
});
