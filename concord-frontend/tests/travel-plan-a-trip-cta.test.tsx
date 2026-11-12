/**
 * FIX-travel-002 — the travel page's "+ Plan a trip" CTA only switched
 * to the My Trips tab, which is the page's DEFAULT tab: pressed in the
 * state a fresh user is already in, it did nothing at all. The CTA now
 * also fires TRAVEL_NEW_TRIP_EVENT, and the trips section opens its
 * new-trip form on that event (the goals lens's GOALS_NEW_EVENT shape).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/travel/TripWorkspace', () => ({ TripWorkspace: () => null }));

import { TripWorkspaceSection, TRAVEL_NEW_TRIP_EVENT } from '@/components/travel/TripWorkspaceSection';

describe('FIX-travel-002 — Plan a trip opens the new-trip form', () => {
  it('the form is closed at rest and opens on the CTA event', async () => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'trip-list' || action === 'trip-shared-list') {
        return Promise.resolve({ data: { ok: true, result: { trips: [] } } });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<TripWorkspaceSection />);
    await screen.findByRole('button', { name: /new trip/i });
    expect(screen.queryByPlaceholderText('Trip name')).toBeNull();

    fireEvent(window, new CustomEvent(TRAVEL_NEW_TRIP_EVENT));
    await waitFor(() => expect(screen.getByPlaceholderText('Trip name')).toBeTruthy());
    expect(screen.getByPlaceholderText('Destination')).toBeTruthy();
  });
});
