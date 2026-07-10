/**
 * /lenses/audit — four-UX-state contract for the Audit lens.
 *
 * The audit lens's externally-loaded surface is its system-event feed:
 *   useQuery(['events'], () => api.get('/api/events'))  →  the Total Events /
 *   Audit Log / Immutable DTU Chain / Recent Audit Entries surfaces.
 * This test pins the four states against that REAL channel:
 *
 *   LOADING   — in-flight /api/events → role="status"
 *   ERROR     — failed /api/events  → role="alert" + a WORKING Retry that
 *               RE-FETCHES (refetch fires), never a swallowed-fetch silent-empty
 *   EMPTY     — ok but zero events → an honest empty state ("No DTU chain entries
 *               yet" + "No audit entries found"), and NO fabricated "Genesis
 *               Block" placeholder (that fake-seed node was removed 2026-06-28)
 *   POPULATED — real events render their action label
 *
 * No fabricated data: every state is driven by a mocked useQuery standing in for
 * the real /api/events backend in the exact shape the page consumes
 * ({ data, isLoading, isError, error, refetch }).
 *
 * Frontend Rebuild Program, Wave 2 note (2026-07-09): the page used to also
 * mount a "Backend Audit Actions" panel driving complianceCheck/trailAnalysis/
 * riskScore/samplingPlan off a generic per-domain artifact store
 * (useLensData('audit','entry') + useRunArtifact('audit')) that was never
 * populated by anything real — every click ran those macros against an
 * artifact whose `.data` never carried the `records`/`rules`/`events`/
 * `controls` shape the macros actually read, so it always degraded to the
 * macro's own empty-input branch. The real, already-shipped surface for
 * those four macros is `AuditActionPanel` (a JSON-input bench wired directly
 * via `apiHelpers.lens.runDomain`), already mounted lower on the page — the
 * duplicate generic-store panel was removed rather than fixed forward, since
 * it added no capability the real panel didn't already have.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── /api/events feed channel (drives loading/error/empty/populated) ──────────
const eventsState: {
  data: { events: Array<Record<string, unknown>> } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = { data: { events: [] }, isLoading: false, isError: false, error: null };
const refetch = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: eventsState.data,
    isLoading: eventsState.isLoading,
    isError: eventsState.isError,
    error: eventsState.error,
    refetch,
  }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: { events: [] } })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: null } })),
  isForbidden: () => false,
}));

// realtime hook inert.
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

// ── headless chrome + heavy children: inert stubs ───────────────────────────
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'lens-shell' }, children) }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/ConnectiveTissueBar', () => ({ ConnectiveTissueBar: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/audit/CveSearch', () => ({ CveSearch: () => null }));
vi.mock('@/components/audit/AuditActionPanel', () => ({ AuditActionPanel: () => null }));
vi.mock('@/components/audit/ComplianceSuite', () => ({ ComplianceSuite: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));

// ErrorState is a real component (renders "Something went wrong" + a Try again
// button) — the page wraps it in a role="alert" container, so we keep it real.

// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
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
  return new Proxy(actual, { get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]) });
});

import AuditLensPage from '@/app/lenses/audit/page';

beforeEach(() => {
  eventsState.data = { events: [] };
  eventsState.isLoading = false;
  eventsState.isError = false;
  eventsState.error = null;
  refetch.mockReset();
  window.localStorage.clear();
});

describe('audit lens — four UX states', () => {
  it('LOADING: an in-flight /api/events feed shows a role=status indicator', async () => {
    eventsState.isLoading = true;
    const { container } = render(<AuditLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('ERROR: a failed feed shows role=alert + a working Retry that re-fetches (not a silent empty page)', async () => {
    eventsState.isError = true;
    eventsState.error = new Error('events store offline');
    const { container, getByText } = render(<AuditLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/events store offline/i)).toBeInTheDocument();
    // a silent-empty page would show the audit-log empty surfaces instead — it must NOT.
    expect(() => getByText(/No audit entries found/i)).toThrow();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: a zero-event feed shows honest empty states and NO fabricated "Genesis Block" placeholder', async () => {
    eventsState.data = { events: [] };
    const { getByText, queryByText } = render(<AuditLensPage />);
    await waitFor(() => expect(getByText(/No audit entries found/i)).toBeInTheDocument());
    // the DTU chain renders an honest empty line, not a fake genesis node.
    expect(getByText(/No DTU chain entries yet/i)).toBeInTheDocument();
    expect(queryByText(/Genesis Block/i)).toBeNull();
  });

  it('POPULATED: real events render their action label', async () => {
    eventsState.data = { events: [
      { id: 'evt_1', type: 'dtu:created', payload: { entityId: 'dtu_abc' }, at: '2026-06-27T10:00:00Z' },
      { id: 'evt_2', type: 'tick:governor', payload: {}, at: '2026-06-27T10:00:15Z' },
    ] };
    const { getAllByText } = render(<AuditLensPage />);
    await waitFor(() => expect(getAllByText('dtu:created').length).toBeGreaterThan(0));
    expect(getAllByText('tick:governor').length).toBeGreaterThan(0);
  });
});
