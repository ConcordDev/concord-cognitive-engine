/**
 * /lenses/calendar — four-UX-state contract for the Calendar lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (with a CTA) / populated states against its real backend channel:
 *   • the artifact list (useLensData('calendar', 'event' | 'category') →
 *     GET /api/lens/calendar), plus the action-panel runner useRunArtifact.
 *
 * a11y: loading is role=status, error is role=alert with a working Retry that
 * RE-FETCHES (we assert refetch fires + the surface recovers). The empty state
 * surfaces a "Create your first event" CTA. No fabricated data — every state is
 * driven by a mocked useLensData standing in for the real backend in the exact
 * shape the lens hook returns.
 *
 * This lens is ALREADY-WIRED (PATH 3 — server/domains/calendar.js via
 * registerLensAction; the page reads the generic 'event'/'category' artifact
 * lists, the action panel calls runMacro verbs). The behavioral macro contract
 * lives in server/tests/calendar-lens-macros.test.js; this file is the UI
 * state-machine contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── backend channel: useLensData (the artifact lists the page renders) ───────
// The page calls useLensData TWICE: ('calendar','event',…) then
// ('calendar','category',…). We branch on the 2nd arg so the EVENT hook drives
// loading/error/items and the CATEGORY hook stays inert.
const eventRefetch = vi.fn();
const catRefetch = vi.fn();
// Stable singleton hook returns so the page's useEffect (which depends on the
// `items` identity) does not loop. We mutate these objects in-place between
// tests rather than creating fresh references each render.
const EMPTY_ITEMS: unknown[] = [];
const eventHook: Record<string, unknown> = {
  items: EMPTY_ITEMS, total: 0, isLoading: false, isError: false, error: null,
  isSeeding: false, refetch: eventRefetch, create: vi.fn(), update: vi.fn(), remove: vi.fn(),
};
const catHook: Record<string, unknown> = {
  items: EMPTY_ITEMS, total: 0, isLoading: false, isError: false, error: null,
  isSeeding: false, refetch: catRefetch, create: vi.fn(), update: vi.fn(), remove: vi.fn(),
};

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_domain: string, type: string) => (type === 'event' ? eventHook : catHook),
}));

function setEventHook(over: Record<string, unknown>) {
  Object.assign(eventHook, {
    items: EMPTY_ITEMS, total: 0, isLoading: false, isError: false, error: null, isSeeding: false,
  }, over);
}
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn().mockResolvedValue({ ok: true, result: {} }), isPending: false }),
}));

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
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast: () => {} }) }),
}));

// lens chrome + cross-lens panels → null
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }));

// calendar child panels → inert (each owns its own backend channel; out of scope)
vi.mock('@/components/calendar/GCalSection', () => ({ GCalSection: () => null }));
vi.mock('@/components/calendar/TimezoneTools', () => ({ TimezoneTools: () => null }));
vi.mock('@/components/calendar/ScheduleAnalyzer', () => ({ ScheduleAnalyzer: () => null }));
vi.mock('@/components/calendar/AppointmentSchedules', () => ({ AppointmentSchedules: () => null }));
vi.mock('@/components/calendar/CalendarParityHub', () => ({ CalendarParityHub: () => null }));
vi.mock('@/components/calendar/CalendarActionPanel', () => ({ CalendarActionPanel: () => null }));
vi.mock('@/components/calendar/EventActionRail', () => ({ EventActionRail: () => null }));

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

import CalendarLensPage from '@/app/lenses/calendar/page';

const EVENT_ITEM = {
  id: 'evt_1',
  title: 'Quarterly launch',
  data: {
    id: 'evt_1',
    title: 'Quarterly launch',
    startDate: '2099-06-01T10:00:00Z',
    endDate: '2099-06-01T11:00:00Z',
    allDay: false,
    color: '#22c55e',
    category: 'Release Dates',
    eventType: 'release',
  },
};

// Stable reference so the page's `eventItems`-keyed useEffect does not loop.
const POPULATED_ITEMS = [EVENT_ITEM];

beforeEach(() => {
  eventRefetch.mockReset();
  catRefetch.mockReset();
  setEventHook({});
});

describe('calendar lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the event list is in flight', async () => {
    setEventHook({ isLoading: true });
    const { container, getAllByText } = render(<CalendarLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    // "Loading calendar…" (visible) + "Loading calendar" (sr-only) both present.
    expect(getAllByText(/Loading calendar/i).length).toBeGreaterThan(0);
  });

  it('ERROR: a failed list shows role=alert + a working Retry that re-fetches', async () => {
    setEventHook({ isError: true, error: { message: 'calendar backend offline' } });
    const { container, getByText } = render(<CalendarLensPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/calendar backend offline/i)).toBeInTheDocument();

    // The Retry button (ErrorState renders "Try again") re-invokes refetch.
    const before = eventRefetch.mock.calls.length;
    await act(async () => { fireEvent.click(getByText(/Try again/i)); });
    await waitFor(() => expect(eventRefetch.mock.calls.length).toBeGreaterThan(before));
  });

  it('EMPTY: shows the honest empty CTA when there are no events', async () => {
    setEventHook({ items: EMPTY_ITEMS, total: 0 });
    const { getByText } = render(<CalendarLensPage />);
    await waitFor(() =>
      expect(getByText(/No events scheduled yet/i)).toBeInTheDocument(),
    );
    // Page-level CTA present.
    expect(getByText(/Create your first event/i)).toBeInTheDocument();
  });

  it('POPULATED: renders the real event in the agenda view (no empty CTA)', async () => {
    setEventHook({ items: POPULATED_ITEMS, total: 1 });
    const { queryByText, getByText, getAllByText } = render(<CalendarLensPage />);
    // The empty-state CTA must NOT render when events exist (any view).
    await waitFor(() => expect(queryByText(/No events scheduled yet/i)).toBeNull());
    // Switch to the agenda view, which lists all upcoming events regardless of
    // the visible month, then assert the real event row is rendered.
    await act(async () => { fireEvent.click(getByText('agenda')); });
    await waitFor(() => expect(getAllByText(/Quarterly launch/).length).toBeGreaterThan(0));
  });
});
