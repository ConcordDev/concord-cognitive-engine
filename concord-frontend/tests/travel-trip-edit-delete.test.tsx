/**
 * TripWorkspace — trip edit/delete and itinerary-item edit go through the
 * real travel macros (trip-detail / trip-update / trip-delete /
 * itinerary-update), and the header reflects the saved values.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/common/MapView', () => ({ default: () => null }));
vi.mock('@/components/travel/GmailSyncPanel', () => ({ GmailSyncPanel: () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) => {
      const { layoutId: _l, transition: _t, initial: _i, animate: _a, exit: _e, ...dom } = props;
      return React.createElement('div', dom, props.children as React.ReactNode);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { TripWorkspace, type WorkspaceTrip } from '@/components/travel/TripWorkspace';

const TRIP: WorkspaceTrip = { id: 'trip1', name: 'Lisbon trip', destination: 'Lisbon', startDate: '2026-08-01', endDate: '2026-08-10' };

let tripName = 'Lisbon trip';

beforeEach(() => {
  tripName = 'Lisbon trip';
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string, input: Record<string, unknown>) => {
    const results: Record<string, unknown> = {
      'itinerary-list': { items: [{ id: 'i1', title: 'Museum', day: '2026-08-02', time: '10:00', category: 'sightseeing', location: 'Belém', note: '' }] },
      'itinerary-map': { points: [], routeKm: 0, ungeocoded: 0 },
      'itinerary-agenda': { agenda: [], unscheduled: [] },
      'booking-list': { bookings: [], totalCost: 0 },
      'checklist-list': { items: [] },
      'trip-detail': { trip: { id: 'trip1', name: tripName, destination: 'Lisbon', startDate: '2026-08-01', endDate: '2026-08-10', travelers: 2, notes: null, durationDays: 10 }, itineraryCount: 1, bookedCost: 0, checklistOpen: 0 },
    };
    if (action === 'trip-update') { tripName = String(input.name); return Promise.resolve({ data: { ok: true, result: { trip: {} } } }); }
    if (action === 'trip-delete' || action === 'itinerary-update') return Promise.resolve({ data: { ok: true, result: {} } });
    return Promise.resolve({ data: { ok: true, result: results[action] } });
  });
});

describe('TripWorkspace — trip edit/delete', () => {
  it('shows live trip detail and saves an edited name through trip-update', async () => {
    render(<TripWorkspace trip={TRIP} onBack={() => {}} />);
    await screen.findByText(/2 travelers · 10 days/);
    fireEvent.click(screen.getByRole('button', { name: /edit trip/i }));
    fireEvent.change(screen.getByLabelText('Trip name'), { target: { value: 'Lisbon & Porto' } });
    fireEvent.click(screen.getByRole('button', { name: /^save trip$/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('travel', 'trip-update', expect.objectContaining({ id: 'trip1', name: 'Lisbon & Porto', travelers: 2 })));
    await screen.findByRole('heading', { name: 'Lisbon & Porto' });
  });

  it('deletes only after the in-place confirmation, then returns to the trip list', async () => {
    const onBack = vi.fn();
    render(<TripWorkspace trip={TRIP} onBack={onBack} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete trip' }));
    expect(lensRunMock).not.toHaveBeenCalledWith('travel', 'trip-delete', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: /delete trip and its plans/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('travel', 'trip-delete', { id: 'trip1' }));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
  });

  it('edits an itinerary item through itinerary-update', async () => {
    render(<TripWorkspace trip={TRIP} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /edit itinerary item/i }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Jerónimos Monastery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('travel', 'itinerary-update', expect.objectContaining({ tripId: 'trip1', id: 'i1', title: 'Jerónimos Monastery', location: 'Belém' })));
  });
});
