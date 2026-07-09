/**
 * /lenses/pharmacy — rebuilt destination shell (Frontend Rebuild Program,
 * Wave 2, Health/life-sim archetype).
 *
 * Supersedes the pre-rebuild version of this file, which pinned the old
 * page's FAKE medication/interaction CRUD (`useLensData('pharmacy',
 * 'medication'|'interaction')` — a disconnected generic DTU-artifact model
 * that had zero relationship to the real `pharmacy` macros). That system,
 * the duplicate "Pharmacy Analysis Engine" panel, and the generic-scaffold
 * trio (ManifestActionBar/AutoActionStrip/RecentMineCard/
 * CrossLensRecentsPanel) were retired in the rebuild — see
 * docs/lens-specs/pharmacy-capability-map.md.
 *
 * This test pins the new primary surface instead: a 4-destination shell
 * (Overview / My Meds / Drug Reference & Safety / Rx Bench) whose Overview
 * destination drives real loading/error/empty/populated states off
 * `pharmacy.pharmacy-dashboard` via `useMacroDispatchFeedback` — a real
 * macro dispatch, not a fabricated artifact list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen, within } from '@testing-library/react';
import React from 'react';

const dispatchMock = vi.fn();
const dispatchState: {
  status: 'idle' | 'dispatched' | 'running' | 'done' | 'error';
  result: Record<string, unknown> | null;
  error: string | null;
} = { status: 'idle', result: null, error: null };

vi.mock('@/hooks/useMacroDispatchFeedback', () => ({
  useMacroDispatchFeedback: () => ({
    status: dispatchState.status,
    runId: null, domain: null, action: null,
    result: dispatchState.result,
    error: dispatchState.error,
    ms: null, stage: null,
    dispatch: dispatchMock,
    reset: vi.fn(),
  }),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
  isForbidden: () => false,
}));

// ── headless chrome: render-only / inert stubs ──────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
vi.mock('@/components/ui/DensityToggle', () => ({ DensityToggle: () => null }));
// heavy pharmacy children (their own backend macros are covered by the
// pharmacy-lens-macros server test and each component's own test) → inert here.
vi.mock('@/components/pharmacy/PharmacyRxSection', () => ({ PharmacyRxSection: () => React.createElement('div', { 'data-testid': 'rx-section' }, 'RxSection') }));
vi.mock('@/components/pharmacy/FdaDrugReference', () => ({ FdaDrugReference: () => React.createElement('div', { 'data-testid': 'fda-reference' }, 'FdaDrugReference') }));
vi.mock('@/components/pharmacy/FdaLivePanel', () => ({ FdaLivePanel: () => React.createElement('div', { 'data-testid': 'fda-live' }, 'FdaLivePanel') }));
vi.mock('@/components/pharmacy/RxFormularyToolsPanel', () => ({ RxFormularyToolsPanel: () => React.createElement('div', { 'data-testid': 'formulary-tools' }, 'FormularyTools') }));
vi.mock('@/components/pharmacy/PharmacyActionPanel', () => ({ PharmacyActionPanel: () => React.createElement('div', { 'data-testid': 'action-panel' }, 'ActionPanel') }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: vi.fn() }),
  RecallSlot: () => null,
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

import PharmacyLensPage from '@/app/lenses/pharmacy/page';

beforeEach(() => {
  dispatchState.status = 'idle';
  dispatchState.result = null;
  dispatchState.error = null;
  dispatchMock.mockReset();
});

describe('pharmacy lens — destination shell', () => {
  it('renders the safety disclaimer and 4-destination nav (no fake medication/interaction CRUD tabs)', () => {
    render(<PharmacyLensPage />);
    expect(screen.getByText(/Not medical or pharmaceutical advice/i)).toBeInTheDocument();
    const nav = within(screen.getByRole('navigation', { name: /Pharmacy destinations/i }));
    expect(nav.getByRole('button', { name: /Overview/i })).toBeInTheDocument();
    expect(nav.getByRole('button', { name: /My Meds/i })).toBeInTheDocument();
    expect(nav.getByRole('button', { name: /Drug Reference & Safety/i })).toBeInTheDocument();
    expect(nav.getByRole('button', { name: /Rx Bench/i })).toBeInTheDocument();
    // the retired fake tabs must not be present
    expect(screen.queryByText(/No medications tracked yet\. Add one/i)).not.toBeInTheDocument();
  });

  it('OVERVIEW LOADING: shows a role=status indicator while the dashboard macro is in flight', () => {
    dispatchState.status = 'dispatched';
    const { container } = render(<PharmacyLensPage />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('OVERVIEW ERROR: shows role=alert with a working Retry that re-dispatches', async () => {
    dispatchState.status = 'error';
    dispatchState.error = 'pharmacy store offline';
    const { container, getByText } = render(<PharmacyLensPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/pharmacy store offline/i)).toBeInTheDocument();
    fireEvent.click(getByText('Retry'));
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledWith('pharmacy', 'pharmacy-dashboard', {}));
  });

  it('OVERVIEW EMPTY: a real zero-medication dashboard shows the honest empty state + a real nav CTA', async () => {
    dispatchState.status = 'done';
    dispatchState.result = { medications: 0, todayDoses: { total: 0, taken: 0, pending: 0 }, adherence30d: null, refillsDue: 0, openRefillRequests: 0 };
    render(<PharmacyLensPage />);
    await waitFor(() => expect(screen.getByText(/No medications tracked yet/i)).toBeInTheDocument());
    const cta = screen.getByRole('button', { name: /Go to My Meds/i });
    fireEvent.click(cta);
    await waitFor(() => expect(screen.getByTestId('rx-section')).toBeInTheDocument());
  });

  it('OVERVIEW POPULATED: a real dashboard result renders stat tiles', async () => {
    dispatchState.status = 'done';
    dispatchState.result = { medications: 3, todayDoses: { total: 4, taken: 2, pending: 2 }, adherence30d: 87, refillsDue: 1, openRefillRequests: 1 };
    render(<PharmacyLensPage />);
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    expect(screen.getByText('2/4')).toBeInTheDocument();
  });

  it('NAV: switching to My Meds mounts the real PharmacyRxSection (med-list/dose-log/reminders/refills/prices/adherence workbench)', async () => {
    render(<PharmacyLensPage />);
    const nav = within(screen.getByRole('navigation', { name: /Pharmacy destinations/i }));
    fireEvent.click(nav.getByRole('button', { name: /My Meds/i }));
    await waitFor(() => expect(screen.getByTestId('rx-section')).toBeInTheDocument());
  });

  it('NAV: switching to Drug Reference & Safety mounts FdaDrugReference by default, with Browse/Recalls and Formulary tools sub-tabs', async () => {
    render(<PharmacyLensPage />);
    const nav = within(screen.getByRole('navigation', { name: /Pharmacy destinations/i }));
    fireEvent.click(nav.getByRole('button', { name: /Drug Reference & Safety/i }));
    await waitFor(() => expect(screen.getByTestId('fda-reference')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Browse & Recalls/i }));
    await waitFor(() => expect(screen.getByTestId('fda-live')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Formulary & Inventory Tools/i }));
    await waitFor(() => expect(screen.getByTestId('formulary-tools')).toBeInTheDocument());
  });

  it('NAV: switching to Rx Bench mounts the real PharmacyActionPanel (label/interactions/adverse/dose + mint/DM/publish/agent)', async () => {
    render(<PharmacyLensPage />);
    const nav = within(screen.getByRole('navigation', { name: /Pharmacy destinations/i }));
    fireEvent.click(nav.getByRole('button', { name: /Rx Bench/i }));
    await waitFor(() => expect(screen.getByTestId('action-panel')).toBeInTheDocument());
  });
});
