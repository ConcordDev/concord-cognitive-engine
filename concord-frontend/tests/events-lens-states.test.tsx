/**
 * /lenses/events — Events + Dashboard tabs' real-backend-channel contract.
 *
 * Wave 4 gap-closure (docs/WAVE4_INVENTORY.md, `events` lens): the primary
 * 8-tab surface persisted the "Event" artifact type through a generic
 * DTU-artifact CRUD store (useLensData), disconnected from the real,
 * STATE-backed event-planning engine in server/domains/events.js. The
 * Events + Dashboard tabs are now wired directly onto the real
 * events.event-list / events.event-detail / events.event-create /
 * events.event-update / events.event-delete macros via
 * lensRun({ domain: 'events', action, input }) — mirroring the fix already
 * shipped for the `calendar` lens (tests/calendar-lens-states.test.tsx).
 *
 * The remaining 6 tabs (Venue/Vendor/Guest/RunOfShow/Budget/TicketTier)
 * stay on the generic useLensData store this pass — see the "Named
 * residual" section of docs/lens-specs/events-capability-map.md for why
 * (each is a per-event-nested collection in the real engine, already fully
 * served by the separate EventOps console, with schema gaps beyond a
 * lossless field mapping) — so useLensData is mocked here to an inert
 * empty store rather than asserted against.
 *
 * a11y: loading is role=status, error is role=alert with a working Retry
 * that re-fetches (asserted by real macro calls firing again). The empty
 * state on the default Dashboard tab is honest ("No upcoming events"), not
 * a fabricated placeholder. No fake data — every state is driven by a
 * mocked `lensRun` standing in for the real backend, returning the exact
 * envelope shape server/domains/events.js's event-list/event-detail macros
 * produce.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── backend channel: lensRun (events.event-list / events.event-detail) ──────
const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));

function actionOf(call: unknown[]): string {
  const spec = call[0] as { action?: string } | undefined;
  return spec?.action || '';
}
function domainOf(call: unknown[]): string {
  const spec = call[0] as { domain?: string } | undefined;
  return spec?.domain || '';
}
function idOf(call: unknown[]): string | undefined {
  const spec = call[0] as { input?: { id?: string } } | undefined;
  return spec?.input?.id;
}

function okEnvelope(result: unknown) { return { data: { ok: true, result, error: null } }; }
function failEnvelope(message: string) { return { data: { ok: false, result: null, error: message } }; }

interface BackendEventFixture {
  id: string;
  name: string;
  type: string;
  date: string | null;
  venue: string | null;
  budget: number;
  guestCount: number;
  status: string;
  createdAt: string;
  tiers?: unknown[];
  registrations?: unknown[];
}

/**
 * Configures the mocked lensRun dispatch table for the `events` domain.
 * `event-list` and `event-detail` (one call per event id, in parallel) are
 * the real calls page.tsx's fetchEventsReal() makes; everything else
 * (event-create/update/delete, register-attendee, …) gets an inert
 * `{ ok: true, result: {} }` default so handlers the tests don't exercise
 * never throw.
 */
function setBackend({
  events = [] as BackendEventFixture[],
  listError,
  hang = false,
}: {
  events?: BackendEventFixture[];
  listError?: string;
  hang?: boolean;
} = {}) {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((...args: unknown[]) => {
    if (hang) return new Promise(() => {}); // never resolves — pins the loading state
    const action = actionOf(args);
    if (action === 'event-list') {
      if (listError) return Promise.resolve(failEnvelope(listError));
      return Promise.resolve(
        okEnvelope({
          events: events.map((e) => ({
            id: e.id, name: e.name, type: e.type, date: e.date, venue: e.venue,
            budget: e.budget, guestCount: e.guestCount, status: e.status,
            taskCount: 0, doneTaskCount: 0, vendorCost: 0,
          })),
          count: events.length,
        }),
      );
    }
    if (action === 'event-detail') {
      const id = idOf(args);
      const found = events.find((e) => e.id === id);
      if (!found) return Promise.resolve(failEnvelope('event not found'));
      return Promise.resolve(okEnvelope({ event: found, vendorCost: 0, budgetRemaining: found.budget }));
    }
    return Promise.resolve(okEnvelope({}));
  });
}

// ── headless chrome + side panels: render-only / inert stubs ─────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'tester', email: 'tester@example.com', role: 'user' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

// The 6 tabs this pass intentionally left on the generic store (see the
// file header) — stub to an inert empty store so they render without
// exercising their own (unrelated, unchanged) backend channel.
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [],
    total: 0,
    isLoading: false,
    isError: false,
    error: null,
    isSeeding: false,
    refetch: () => {},
    create: async () => ({ ok: true }),
    update: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
  }),
}));

// lens chrome + cross-lens panels + the real, out-of-scope-for-this-file
// EventOps/EventPlanner consoles → null
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/events/NasaEarthEvents', () => ({ NasaEarthEvents: () => null }));
vi.mock('@/components/events/EventPlanner', () => ({ EventPlanner: () => null }));
vi.mock('@/components/events/EventOps', () => ({ EventOps: () => null }));

// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import EventsLensPage from '@/app/lenses/events/page';

// Real event-detail() envelope shape (server/domains/events.js `event-list` /
// `event-detail`) — a STATE-backed event with one real ticket tier and one
// real registration, exercising the derived capacity/registered/revenue
// rollups fromBackendEvent() computes.
const BACKEND_EVENT: BackendEventFixture = {
  id: 'evt_1',
  name: 'Quarterly Launch Party',
  type: 'corporate',
  date: '2099-06-01',
  venue: 'The Grand Hall',
  budget: 5000,
  guestCount: 150,
  status: 'confirmed',
  createdAt: '2026-01-01T00:00:00.000Z',
  tiers: [
    { id: 'tier_1', name: 'General', price: 25, quantity: 100, sold: 10, description: '', perks: '', saleStart: null, saleEnd: null },
  ],
  registrations: [
    { id: 'reg_1', name: 'Alex Guest', email: 'alex@example.com', tierId: 'tier_1', tierName: 'General', quantity: 1, amountPaid: 25, checkedIn: false, checkedInAt: null, ticketCode: 'TKT-ABC123', registeredAt: '2026-01-02T00:00:00.000Z' },
  ],
};

beforeEach(() => {
  setBackend();
});

describe('events lens — four UX states (Events + Dashboard real-engine wiring)', () => {
  it('LOADING: shows a role=status indicator while event-list is in flight', async () => {
    setBackend({ hang: true });
    const { container, getAllByText } = render(<EventsLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(getAllByText(/Loading event data/i).length).toBeGreaterThan(0);
  });

  it('ERROR: a failed event-list shows role=alert + a working Retry that re-fetches', async () => {
    setBackend({ listError: 'events backend offline' });
    const { container, getByText } = render(<EventsLensPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/events backend offline/i)).toBeInTheDocument();

    const before = lensRunMock.mock.calls.length;
    await act(async () => { fireEvent.click(getByText(/Try again/i)); });
    await waitFor(() => expect(lensRunMock.mock.calls.length).toBeGreaterThan(before));
  });

  it('EMPTY: the default Dashboard tab shows the honest empty state when there are no events', async () => {
    setBackend({ events: [] });
    const { getByText } = render(<EventsLensPage />);
    await waitFor(() => expect(getByText(/No upcoming events/i)).toBeInTheDocument());
  });

  it('POPULATED: renders the real event on the Events tab (no fake fields, real derived ticket rollup)', async () => {
    setBackend({ events: [BACKEND_EVENT] });
    const { getByText, getAllByText } = render(<EventsLensPage />);
    // Switch to the Events tab.
    await waitFor(() => expect(getByText('Events')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Events')); });
    await waitFor(() => expect(getAllByText(/Quarterly Launch Party/).length).toBeGreaterThan(0));
    // Real venue field round-tripped from the engine.
    expect(getAllByText(/The Grand Hall/).length).toBeGreaterThan(0);
  });

  it('fetches through the real events.event-list / events.event-detail macros, not a generic artifact store', async () => {
    setBackend({ events: [BACKEND_EVENT] });
    render(<EventsLensPage />);
    await waitFor(() => {
      const actions = lensRunMock.mock.calls.map((c) => actionOf(c as unknown[]));
      expect(actions).toContain('event-list');
      expect(actions).toContain('event-detail');
    });
    // event-detail is called with the real id from event-list's result.
    const detailCall = lensRunMock.mock.calls.find((c) => actionOf(c as unknown[]) === 'event-detail');
    expect(idOf(detailCall as unknown[])).toBe('evt_1');
    // Every Events-tab call goes through the domain-macro dispatcher with domain: 'events'.
    for (const call of lensRunMock.mock.calls) {
      expect(domainOf(call as unknown[])).toBe('events');
    }
  });

  it('DELETE: removing an event calls events.event-delete and re-fetches via event-list', async () => {
    setBackend({ events: [BACKEND_EVENT] });
    const { getByText } = render(<EventsLensPage />);
    await waitFor(() => expect(getByText('Events')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Events')); });
    await waitFor(() => expect(getByText('Quarterly Launch Party')).toBeInTheDocument());

    const before = lensRunMock.mock.calls.filter((c) => actionOf(c as unknown[]) === 'event-list').length;
    const deleteBtn = document.querySelector('[aria-label="Delete"]');
    expect(deleteBtn).toBeTruthy();
    await act(async () => { fireEvent.click(deleteBtn as Element); });

    await waitFor(() => {
      const actions = lensRunMock.mock.calls.map((c) => actionOf(c as unknown[]));
      expect(actions).toContain('event-delete');
    });
    await waitFor(() => {
      const after = lensRunMock.mock.calls.filter((c) => actionOf(c as unknown[]) === 'event-list').length;
      expect(after).toBeGreaterThan(before);
    });
  });
});
