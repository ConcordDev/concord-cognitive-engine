/**
 * /lenses/security — four-UX-state contract for the Security lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (CTA) / populated states against its real backend channel: the artifact
 * list (useLensData('security', type) → GET /api/lens/security), and that the
 * compute-action runner is constructed on the 'security' domain (a regression
 * to any other id resolves to NO backend receiver — every page action button,
 * vulnerabilityScan / incidentEscalate / accessAudit / threatAssessment, would
 * silently no-op).
 *
 * a11y / swallowed-fetch → silent-empty: loading is role=status, error is
 * role=alert with a Retry that RE-FETCHES (we assert refetch fires). The page
 * owns these surfaces directly (it uses LensShell, not LensPageShell); a failed
 * security feed must surface role=alert + Retry, NOT a blank "no items" page.
 * No fabricated data — every state is driven by a mocked useLensData standing in
 * for the real backend in the exact shape it returns.
 *
 * The page boots in 'Dashboard' mode (no list CTA there); EMPTY/POPULATED switch
 * to the Incidents tab to exercise the real list branch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── main list channel: useLensData (controls loading/error/empty/populated) ──
const lensDataState: {
  items: unknown[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = { items: [], isLoading: false, isError: false, error: null };
const refetch = vi.fn();

// ── compute-action channel: useRunArtifact mutate ───────────────────────────
const runMutate = vi.fn(() => Promise.resolve({ ok: true, result: {} }));
const useRunArtifactSpy = vi.fn();

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: lensDataState.items,
    total: lensDataState.items.length,
    isLoading: lensDataState.isLoading,
    isError: lensDataState.isError,
    error: lensDataState.error,
    isSeeding: false,
    refetch,
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve({})),
    createMut: { isPending: false },
    updateMut: { isPending: false },
    deleteMut: { isPending: false },
  }),
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: (domain: string) => {
    useRunArtifactSpy(domain);
    return { mutateAsync: (...a: unknown[]) => runMutate(...a), isPending: false };
  },
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
  isForbidden: () => false,
}));

// realtime + nav hooks → inert
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
// heavy security children (their own backend macros are covered by the
// security-lens-macros server test) → inert here.
vi.mock('@/components/security/SecurityAdvisories', () => ({ SecurityAdvisories: () => null }));
vi.mock('@/components/security/ThreatVulnPanel', () => ({ ThreatVulnPanel: () => null }));
vi.mock('@/components/security/VulnManager', () => ({ VulnManager: () => null }));
vi.mock('@/components/security/SOCConsole', () => ({ SOCConsole: () => null }));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
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

import SecurityLensPage from '@/app/lenses/security/page';

const INCIDENT = {
  id: 'art_1',
  title: 'Phishing wave Q2',
  data: { severity: 'P2', type: 'phishing', status: 'detected', description: 'Spoofed payroll email', assignee: 'soc-lead', mttd: 0, mttr: 0, affectedAssets: [] },
  meta: { tags: [], status: 'detected', visibility: 'private' },
  createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};

beforeEach(() => {
  lensDataState.items = [];
  lensDataState.isLoading = false;
  lensDataState.isError = false;
  lensDataState.error = null;
  refetch.mockReset();
  runMutate.mockClear();
  useRunArtifactSpy.mockClear();
  window.localStorage.clear();
});

describe('security lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the security domain', () => {
    render(<SecurityLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('security');
  });

  it('LOADING: an in-flight feed shows a role=status indicator', async () => {
    lensDataState.isLoading = true;
    const { container } = render(<SecurityLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('ERROR: a failed feed shows role=alert + a working Retry that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('security store offline');
    const { container, getByText } = render(<SecurityLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/security store offline/i)).toBeInTheDocument();
    // a silent-empty page would show a "No … found" CTA instead — it must NOT.
    expect(() => getByText(/No .* found/i)).toThrow();

    // Retry ("Try again") must re-invoke the backend fetch (refetch), not be dead.
    await act(async () => { fireEvent.click(getByText(/Try again/i)); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: an empty Incidents feed shows the honest "No Incidents found" CTA', async () => {
    lensDataState.items = [];
    const { getByText, getAllByText } = render(<SecurityLensPage />);
    // switch off the Dashboard onto a list tab where the empty CTA lives
    await act(async () => { fireEvent.click(getAllByText('Incidents')[0]); });
    await waitFor(() => expect(getByText(/No Incidents found/i)).toBeInTheDocument());
    // the CTA is a real create affordance, not a dead label
    expect(getByText(/Create one to get started/i)).toBeInTheDocument();
    expect(getByText(/Add Incident/i)).toBeInTheDocument();
  });

  it('POPULATED: a real incident artifact renders with its title in the Incidents tab', async () => {
    lensDataState.items = [INCIDENT];
    const { getByText, getAllByText } = render(<SecurityLensPage />);
    await act(async () => { fireEvent.click(getAllByText('Incidents')[0]); });
    await waitFor(() => expect(getByText('Phishing wave Q2')).toBeInTheDocument());
    // the real description from the artifact renders in the card
    expect(getByText(/Spoofed payroll email/i)).toBeInTheDocument();
  });
});
