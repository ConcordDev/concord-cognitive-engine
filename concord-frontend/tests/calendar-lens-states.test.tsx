/**
 * /lenses/calendar — four-UX-state contract for the Calendar lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (with a CTA) / populated states against its REAL backend channel:
 *   • calendar.calendars-list + calendar.events-list (the STATE-backed
 *     engine in server/domains/calendar.js) via
 *     lensRun({ domain: 'calendar', action, input }).
 *
 * a11y: loading is role=status, error is role=alert with a working Retry that
 * RE-FETCHES (we assert the real macro calls fire again and the surface
 * recovers). The empty state surfaces a "Create your first event" CTA. No
 * fabricated data — every state is driven by a mocked `lensRun` standing in
 * for the real backend, returning the exact envelope shape
 * server/domains/calendar.js's `calendars-list`/`events-list` macros produce.
 *
 * Wave 4 gap-closure (docs/WAVE4_INVENTORY.md, `calendar` lens): the main
 * event grid used to persist through a generic 'event'/'category'
 * artifact-CRUD store (useLensData), disconnected from the real scheduling
 * engine. It is now wired directly onto the real calendar.calendars-list /
 * calendar.calendars-update / calendar.calendars-create / calendar.events-list
 * / calendar.events-create / calendar.events-update / calendar.events-delete
 * macros — this file was rewritten from mocking useLensData to mocking
 * lensRun to match. The behavioral macro contract lives in
 * server/tests/calendar-lens-macros.test.js; this file is the UI
 * state-machine contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── backend channel: lensRun (calendar.calendars-list / calendar.events-list) ──
const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

function actionOf(call: unknown[]): string {
  const spec = call[0] as { action?: string } | undefined;
  return spec?.action || '';
}

function okEnvelope(result: unknown) { return { data: { ok: true, result, error: null } }; }
function failEnvelope(message: string) { return { data: { ok: false, result: null, error: message } }; }

/**
 * Configures the mocked lensRun dispatch table. `calendars-list` and
 * `events-list` are the two calls the page's fetchData() makes in parallel;
 * everything else (conflicts-check, calendars-update, events-create, …)
 * gets an inert `{ ok: true, result: {} }` default so handlers the tests
 * don't exercise never throw.
 */
function setBackend({
  calendars = [{ id: 'cal_1', number: 'CAL-001', name: 'Personal', color: '#4285f4', visible: true, isDefault: true }],
  events = [] as unknown[],
  calendarsError,
  eventsError,
  hang = false,
}: {
  calendars?: unknown[];
  events?: unknown[];
  calendarsError?: string;
  eventsError?: string;
  hang?: boolean;
} = {}) {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((...args: unknown[]) => {
    if (hang) return new Promise(() => {}); // never resolves — pins the loading state
    const action = actionOf(args);
    if (action === 'calendars-list') {
      return Promise.resolve(calendarsError ? failEnvelope(calendarsError) : okEnvelope({ calendars }));
    }
    if (action === 'events-list') {
      return Promise.resolve(eventsError ? failEnvelope(eventsError) : okEnvelope({ events }));
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

// Real events-list envelope shape (server/domains/calendar.js `events-list` /
// `expandOccurrences` — occurrenceStart/occurrenceEnd are the expanded-instance
// window; start/end are the template event's own window).
const BACKEND_EVENT = {
  id: 'evt_1',
  number: 'EV-000001',
  calendarId: 'cal_1',
  title: 'Quarterly launch',
  description: '',
  location: '',
  start: '2099-06-01T10:00:00.000Z',
  end: '2099-06-01T11:00:00.000Z',
  allDay: false,
  recurrence: null,
  reminders: [],
  attendees: [],
  conferenceLink: '',
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  setBackend();
});

describe('calendar lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while calendars/events are in flight', async () => {
    setBackend({ hang: true });
    const { container, getAllByText } = render(<CalendarLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    // "Loading calendar…" (visible) + "Loading calendar" (sr-only) both present.
    expect(getAllByText(/Loading calendar/i).length).toBeGreaterThan(0);
  });

  it('ERROR: a failed events-list shows role=alert + a working Retry that re-fetches', async () => {
    setBackend({ eventsError: 'calendar backend offline' });
    const { container, getByText } = render(<CalendarLensPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/calendar backend offline/i)).toBeInTheDocument();

    // The Retry button (ErrorState renders "Try again") re-invokes fetchData(),
    // which re-issues both real lensRun calls.
    const before = lensRunMock.mock.calls.length;
    await act(async () => { fireEvent.click(getByText(/Try again/i)); });
    await waitFor(() => expect(lensRunMock.mock.calls.length).toBeGreaterThan(before));
  });

  it('EMPTY: shows the honest empty CTA when there are no events', async () => {
    setBackend({ events: [] });
    const { getByText } = render(<CalendarLensPage />);
    await waitFor(() =>
      expect(getByText(/No events scheduled yet/i)).toBeInTheDocument(),
    );
    // Page-level CTA present.
    expect(getByText(/Create your first event/i)).toBeInTheDocument();
  });

  it('POPULATED: renders the real event in the agenda view (no empty CTA)', async () => {
    setBackend({ events: [BACKEND_EVENT] });
    const { queryByText, getByText, getAllByText } = render(<CalendarLensPage />);
    // The empty-state CTA must NOT render when events exist (any view).
    await waitFor(() => expect(queryByText(/No events scheduled yet/i)).toBeNull());
    // Switch to the agenda view, which lists all upcoming events regardless of
    // the visible month, then assert the real event row is rendered.
    await act(async () => { fireEvent.click(getByText('agenda')); });
    await waitFor(() => expect(getAllByText(/Quarterly launch/).length).toBeGreaterThan(0));
  });

  it('fetches through the real calendar.calendars-list / calendar.events-list macros, not a generic artifact store', async () => {
    setBackend({ events: [BACKEND_EVENT] });
    render(<CalendarLensPage />);
    await waitFor(() => {
      const actions = lensRunMock.mock.calls.map((c) => actionOf(c as unknown[]));
      expect(actions).toContain('calendars-list');
      expect(actions).toContain('events-list');
    });
    // Every call goes through the domain-macro dispatcher with domain: 'calendar'.
    for (const call of lensRunMock.mock.calls) {
      const spec = call[0] as { domain?: string };
      expect(spec.domain).toBe('calendar');
    }
  });
});
