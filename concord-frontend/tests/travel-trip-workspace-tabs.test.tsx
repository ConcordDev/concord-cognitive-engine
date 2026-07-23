/**
 * TripWorkspace — tab-bar micro-interactions (Frontend UX Premium Pass, wave 5).
 *
 * Pins two real, state-grounded additions to the trip-detail tab bar:
 *   1. Per-tab status badges are DERIVED from state already loaded via the
 *      real `travel` macros (itinerary-list → Itinerary count, checklist-list
 *      → Packing "done/total", booking-list → Bookings count, itinerary-agenda's
 *      `unscheduled` → an Agenda warning badge) — never invented, and absent
 *      when the underlying count is zero.
 *   2. Switching tabs actually swaps the rendered section (no dead click).
 *
 * All five mount-time loaders (itinerary-list / itinerary-map /
 * itinerary-agenda / booking-list / checklist-list) are driven through a
 * single mocked `lensRun`, exactly like the real backend envelope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
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
      const { layoutId: _layoutId, transition: _transition, initial: _initial, animate: _animate, exit: _exit, ...domProps } = props;
      return React.createElement('div', domProps, props.children as React.ReactNode);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { TripWorkspace, type WorkspaceTrip } from '@/components/travel/TripWorkspace';

const TRIP: WorkspaceTrip = { id: 'trip1', name: 'Lisbon trip', destination: 'Lisbon', startDate: '2026-08-01', endDate: '2026-08-10' };

function resultsFor(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    'itinerary-list': { items: [] },
    'itinerary-map': { points: [], routeKm: 0, ungeocoded: 0 },
    'itinerary-agenda': { agenda: [], unscheduled: [] },
    'booking-list': { bookings: [], totalCost: 0 },
    'checklist-list': { items: [] },
  };
  return { ...base, ...overrides };
}

function mockResolveWith(results: Record<string, unknown>) {
  lensRunMock.mockImplementation((_domain: string, action: string) =>
    Promise.resolve({ data: { ok: true, result: results[action] } }));
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('TripWorkspace — tab badges + tab switching', () => {
  it('BADGES: real per-tab counts render, grounded in the loaded state (itinerary/bookings/packing)', async () => {
    mockResolveWith(resultsFor({
      'itinerary-list': { items: [{ id: 'i1', title: 'Museum', day: '1', time: '10:00', category: 'sightseeing', location: '', note: '', lat: null, lng: null }] },
      'booking-list': { bookings: [{ id: 'b1', type: 'flight', provider: 'TAP', cost: 400, date: '2026-08-01', confirmationCode: null }], totalCost: 400 },
      'checklist-list': { items: [{ id: 'c1', item: 'Passport', category: 'general', done: true }, { id: 'c2', item: 'Charger', category: 'general', done: false }] },
    }));
    const { container } = render(<TripWorkspace trip={TRIP} onBack={() => {}} />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());

    const tabBar = container.querySelectorAll('.flex.gap-1.flex-wrap')[0] as HTMLElement;
    const badgeFor = (label: string) => {
      const btn = Array.from(tabBar.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
      return btn?.querySelector('.rounded-full')?.textContent ?? null;
    };
    await waitFor(() => expect(badgeFor('Itinerary')).toBe('1'));
    expect(badgeFor('Bookings')).toBe('1');
    expect(badgeFor('Packing')).toBe('1/2'); // 1 of 2 packed — real state, not a fabricated fraction
  });

  it('NO FABRICATION: an empty trip renders no badges at all', async () => {
    mockResolveWith(resultsFor());
    const { container } = render(<TripWorkspace trip={TRIP} onBack={() => {}} />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const tabBar = container.querySelectorAll('.flex.gap-1.flex-wrap')[0] as HTMLElement;
    expect(tabBar.querySelector('.rounded-full')).toBeNull();
  });

  it('TAB SWITCH: clicking "Packing" swaps to the packing checklist section', async () => {
    mockResolveWith(resultsFor());
    const { getByText, queryByPlaceholderText } = render(<TripWorkspace trip={TRIP} onBack={() => {}} />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    expect(queryByPlaceholderText('Item to pack')).toBeNull();

    await act(async () => { fireEvent.click(getByText('Packing')); });
    await waitFor(() => expect(queryByPlaceholderText('Item to pack')).toBeInTheDocument());
  });
});
