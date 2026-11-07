/**
 * Affect S-AFF-5 — one event store.
 *
 * F7: LiveAffectStream invented its own session id (localStorage
 * 'concord:active-session-id' or a generated affect-<ts>) and polled
 * that — a different, always-baseline session than the context session
 * the rest of the lens uses — so the stream froze and its event count
 * contradicted the Event Log. F8: the Event Log's dimension filter
 * never looked at the events' `delta` map and fell through to
 * `return true`, filtering nothing.
 *
 * Pins:
 *  - the stream renders the shared hook's state/events (context session);
 *  - the stream no longer creates the localStorage session key;
 *  - filtering by a dimension keeps only events whose delta moved it;
 *  - an event with no delta information fails the filter honestly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

type QState = { data: unknown; isLoading: boolean; isError: boolean; error: unknown };
const q: Record<string, QState> = {};
const refetch = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const key = String((opts.queryKey || [])[0] || '');
    const st = q[key] || { data: null, isLoading: false, isError: false, error: null };
    return { ...st, refetch };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    affect: {
      state: vi.fn(), policy: vi.fn(), health: vi.fn(), events: vi.fn(), reset: vi.fn(), emit: vi.fn(),
    },
  },
  lensRun: vi.fn(),
}));

vi.mock('@/components/common/EmptyState', () => ({
  ErrorState: () => null,
}));

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => null,
}));

import { LiveAffectStream } from '@/components/affect/LiveAffectStream';
import { EventLogPanel } from '@/components/affect/EventLogPanel';
import { AffectSessionProvider } from '@/components/affect/AffectSessionContext';

const EVENTS = [
  { id: 'e1', type: 'FEEDBACK', intensity: 1, polarity: 1, delta: { v: 0.04, f: -0.01 } },
  { id: 'e2', type: 'SUCCESS', intensity: 0.8, polarity: 1, delta: { g: 0.12 } },
  { id: 'e3', type: 'USER_MESSAGE', intensity: 0.5, polarity: 0 },
];

beforeEach(() => {
  window.localStorage.clear();
  q['affect-state'] = {
    data: { state: { v: 0.9, a: 0.25, s: 0.8, c: 0.8, g: 0.7, t: 0.7, f: 0.2 } },
    isLoading: false, isError: false, error: null,
  };
  q['affect-policy'] = { data: { policy: {} }, isLoading: false, isError: false, error: null };
  q['affect-health'] = { data: { healthy: true }, isLoading: false, isError: false, error: null };
  q['affect-events'] = { data: { events: EVENTS }, isLoading: false, isError: false, error: null };
});

describe('Affect S-AFF-5 — the stream reads the one store', () => {
  it('renders the context session state and the shared event list', () => {
    const { getByText } = render(
      <AffectSessionProvider>
        <LiveAffectStream />
      </AffectSessionProvider>
    );
    expect(getByText('0.90')).toBeTruthy();
    expect(getByText('Event timeline (3)')).toBeTruthy();
    expect(getByText('FEEDBACK')).toBeTruthy();
  });

  it('never creates the old localStorage session key', () => {
    render(
      <AffectSessionProvider>
        <LiveAffectStream />
      </AffectSessionProvider>
    );
    expect(window.localStorage.getItem('concord:active-session-id')).toBeNull();
  });
});

describe('Affect S-AFF-5 — the dimension filter reads delta', () => {
  it('keeps only events whose delta moved the dimension', () => {
    const { container, getByText } = render(
      <AffectSessionProvider>
        <EventLogPanel />
      </AffectSessionProvider>
    );
    expect(getByText('Showing 3 of 3 events')).toBeTruthy();
    expect(container.querySelectorAll('.lens-card').length).toBe(3);
    const selects = container.querySelectorAll('select');
    fireEvent.change(selects[1], { target: { value: 'v' } });
    expect(getByText('Showing 1 of 3 events')).toBeTruthy();
    // Exactly one row survives: e1 (delta.v ≠ 0). e2 moved only agency;
    // e3 carries no delta at all and must not fall through the filter.
    expect(container.querySelectorAll('.lens-card').length).toBe(1);
  });

  it('a zero delta entry does not count as moving the dimension', () => {
    q['affect-events'] = {
      data: { events: [{ id: 'e9', type: 'TICK', intensity: 0, polarity: 0, delta: { v: 0, a: 0 } }] },
      isLoading: false, isError: false, error: null,
    };
    const { container, getByText } = render(
      <AffectSessionProvider>
        <EventLogPanel />
      </AffectSessionProvider>
    );
    const selects = container.querySelectorAll('select');
    fireEvent.change(selects[1], { target: { value: 'v' } });
    expect(getByText('Showing 0 of 1 events')).toBeTruthy();
    expect(getByText('No events match the current filters.')).toBeTruthy();
  });
});
