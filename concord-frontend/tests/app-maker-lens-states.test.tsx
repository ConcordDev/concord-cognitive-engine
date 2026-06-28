/**
 * /lenses/app-maker — four-UX-state contract for the App Maker lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty / populated states against its real backend channels:
 *   • the apps list (apiHelpers.apps.list → GET /api/apps)
 *   • the compute-action panel (useRunArtifact('app-maker') → POST
 *     /api/lens/app-maker/:id/run, the HYPHENATED domain the backend registers)
 *
 * Load-bearing wiring assertion: the action panel must drive the 'app-maker'
 * (hyphen) domain — a regression to 'appmaker' would resolve to NO backend
 * receiver. We assert useRunArtifact was constructed with 'app-maker'.
 *
 * a11y: loading is role=status, error is role=alert with a working Retry that
 * RE-FETCHES (we assert the underlying call count grows + the surface recovers).
 * No fabricated data — every state is driven by a mocked API standing in for the
 * real backend in the exact shape the routes/macros return.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── backend channels: apiHelpers (apps list/create + lens.create) ───────────
const appsList = vi.fn();
const appsCreate = vi.fn();
const appsPromote = vi.fn();
const appsValidate = vi.fn();
const lensCreate = vi.fn();

// ── compute-action channel: useRunArtifact mutate ───────────────────────────
const runMutate = vi.fn();
const useRunArtifactSpy = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    apps: {
      list: (...a: unknown[]) => appsList(...a),
      create: (...a: unknown[]) => appsCreate(...a),
      promote: (...a: unknown[]) => appsPromote(...a),
      validate: (...a: unknown[]) => appsValidate(...a),
    },
    lens: { create: (...a: unknown[]) => lensCreate(...a) },
  },
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: (domain: string) => {
    useRunArtifactSpy(domain);
    return { mutateAsync: (...a: unknown[]) => runMutate(...a) };
  },
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  // No pre-existing artifact → handleAppmakerAction takes the auto-create path.
  useLensData: () => ({ items: [] }),
}));

// ── headless chrome + side panels: render-only / inert stubs ────────────────
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
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/ConnectiveTissueBar', () => ({ ConnectiveTissueBar: () => null }));
vi.mock('@/components/app-maker/NpmPackageSearch', () => ({ NpmPackageSearch: () => null }));
vi.mock('@/components/app-maker/AppBuilderStudio', () => ({ AppBuilderStudio: () => null }));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
}));

import AppMakerLens from '@/app/lenses/app-maker/page';

const APP = { id: 'app_1', name: 'My CRM', status: 'draft', author: 'user_a', version: '0.0.1', createdAt: '2026-06-27' };

beforeEach(() => {
  appsList.mockReset();
  appsCreate.mockReset();
  lensCreate.mockReset();
  runMutate.mockReset();
  useRunArtifactSpy.mockReset();
});

describe('app-maker lens — wiring', () => {
  it('drives the compute-action panel on the HYPHENATED app-maker domain', async () => {
    appsList.mockImplementation(() => Promise.resolve({ data: { apps: [] } }));
    render(<AppMakerLens />);
    await waitFor(() => expect(useRunArtifactSpy).toHaveBeenCalledWith('app-maker'));
    expect(useRunArtifactSpy).not.toHaveBeenCalledWith('appmaker');
  });
});

describe('app-maker lens — apps list four UX states', () => {
  it('LOADING: shows a role=status indicator while the apps list is in flight', async () => {
    appsList.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByText, container } = render(<AppMakerLens />);
    await waitFor(() => expect(getByText(/Loading your apps/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('EMPTY: shows the honest "No apps yet" CTA when the list is empty', async () => {
    appsList.mockImplementation(() => Promise.resolve({ data: { apps: [] } }));
    const { getByText } = render(<AppMakerLens />);
    await waitFor(() => expect(getByText(/No apps yet/i)).toBeInTheDocument());
  });

  it('ERROR: a failed apps load shows role=alert + a working Retry that re-fetches and recovers', async () => {
    let fail = true;
    appsList.mockImplementation(() => {
      if (fail) return Promise.reject(new Error('apps offline'));
      return Promise.resolve({ data: { apps: [APP] } });
    });
    const { getByText, container } = render(<AppMakerLens />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/apps offline/i)).toBeInTheDocument();

    const before = appsList.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(appsList.mock.calls.length).toBeGreaterThan(before));
    // recovers to the populated row
    await waitFor(() => expect(getByText('My CRM')).toBeInTheDocument());
  });

  it('POPULATED: renders the real app row with its status + version', async () => {
    appsList.mockImplementation(() => Promise.resolve({ data: { apps: [APP] } }));
    const { getByText } = render(<AppMakerLens />);
    await waitFor(() => expect(getByText('My CRM')).toBeInTheDocument());
    expect(getByText('draft')).toBeInTheDocument();
    expect(getByText('v0.0.1')).toBeInTheDocument();
  });
});

describe('app-maker lens — compute-action panel error state + working Retry', () => {
  it('ERROR: a failed action shows role=alert + Retry; Retry re-invokes the backend and recovers', async () => {
    appsList.mockImplementation(() => Promise.resolve({ data: { apps: [] } }));
    // auto-create returns an artifact id so the action proceeds to runMutate.
    lensCreate.mockImplementation(() => Promise.resolve({ data: { artifact: { id: 'art_1' } } }));

    let fail = true;
    runMutate.mockImplementation(() => {
      if (fail) return Promise.resolve({ ok: false, error: 'scaffold offline' });
      return Promise.resolve({ ok: true, result: { routes: [{ name: 'Home', path: '/', componentCount: 2, dynamic: false }], fileStructure: [{ path: 'src/App.jsx' }], totalComponents: 2, deepestNesting: 1 } });
    });

    const { getByText, container, getAllByText } = render(<AppMakerLens />);
    await waitFor(() => expect(getByText(/No apps yet/i)).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText('Scaffold App')); });
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/scaffold offline/i)).toBeInTheDocument();

    const before = runMutate.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(runMutate.mock.calls.length).toBeGreaterThan(before));
    // recovers to a populated result (the scaffold routes render)
    await waitFor(() => expect(getAllByText(/Routes/i).length).toBeGreaterThan(0));
  });
});
