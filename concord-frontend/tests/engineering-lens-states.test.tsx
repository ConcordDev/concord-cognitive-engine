/**
 * /lenses/engineering — four-UX-state contract for the Engineering lens.
 *
 * The engineering lens's externally-loaded surface is the Materials tab, fed by
 * the engineering.materialLibrary macro (lensRun('engineering','materialLibrary')).
 * Previously that fetch was fire-and-forget with NO error branch, so a failing
 * macro left the tab stuck on a perpetual "Loading…" spinner — a swallowed-fetch
 * → silent-empty defect. This test pins the four states against the REAL channel:
 *
 *   LOADING   — in-flight materialLibrary → role="status"
 *   ERROR     — failed materialLibrary → role="alert" + a WORKING Retry that
 *               re-invokes the macro (not a silent perpetual spinner)
 *   EMPTY     — ok but zero materials → an honest "No materials" CTA, not a spinner
 *   POPULATED — real material rows render with their label
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend in the exact { data: { ok, result, error } } shape it returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── materialLibrary fetch channel — a controllable deferred per render ───────
type LensResult = { data: { ok: boolean; result: unknown; error: string | null } };
const matState: { mode: 'pending' | 'error' | 'empty' | 'populated' } = { mode: 'populated' };
const lensRunCalls: Array<{ domain: string; action: string }> = [];

function materialResponse(): Promise<LensResult> {
  if (matState.mode === 'pending') return new Promise<LensResult>(() => {}); // never resolves
  if (matState.mode === 'error') return Promise.resolve({ data: { ok: false, result: null, error: 'material library offline' } });
  if (matState.mode === 'empty') return Promise.resolve({ data: { ok: true, result: { materials: [], categories: [] }, error: null } });
  return Promise.resolve({
    data: {
      ok: true,
      result: {
        materials: [
          { id: 'steel-a36', label: 'ASTM A36 Structural Steel', category: 'metal', E: 200000, yield: 250, ultimate: 400, density: 7850, poisson: 0.26, cte: 11.7, thermalK: 50, costPerKg: 1.1 },
        ],
        categories: ['metal'],
      },
      error: null,
    },
  });
}

const lensRun = vi.fn((domain: string, action: string): Promise<LensResult> => {
  lensRunCalls.push({ domain, action });
  if (action === 'materialLibrary') return materialResponse();
  // listLoadCases + everything else: benign empty ok.
  return Promise.resolve({ data: { ok: true, result: { loadCases: [], parts: [] }, error: null } });
});

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: (...a: [string, string]) => lensRun(...a),
  isForbidden: () => false,
}));

// react-query: useQuery inert (FEA job polling), artifact mutate hooks inert.
const useRunArtifactSpy = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: (domain: string) => { useRunArtifactSpy(domain); return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }; },
  useCreateArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

// ── headless chrome + heavy children: inert stubs ───────────────────────────
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'lens-shell' }, children) }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: vi.fn() }),
  RecallSlot: () => null,
}));
// heavy engineering children (own macros covered by engineering-lens-macros server test) → inert.
vi.mock('@/components/engineering/HnEngineeringFeed', () => ({ HnEngineeringFeed: () => null }));
vi.mock('@/components/engineering/EngineeringActionPanel', () => ({ EngineeringActionPanel: () => null }));
vi.mock('@/components/engineering/GeometryEditor', () => ({ GeometryEditor: () => null }));
vi.mock('@/components/engineering/BomPanel', () => ({ BomPanel: () => null }));
vi.mock('@/components/engineering/TolerancePanel', () => ({ TolerancePanel: () => null }));
vi.mock('@/components/engineering/FEAResultViewer', () => ({ FEAResultViewer: () => null }));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) => React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, { get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]) });
});

import EngineeringLensPage from '@/app/lenses/engineering/page';

// Helper: render then switch to the Materials tab (the externally-loaded surface).
async function renderOnMaterials() {
  const utils = render(<EngineeringLensPage />);
  await act(async () => {
    fireEvent.click(utils.getByText('Materials'));
  });
  return utils;
}

beforeEach(() => {
  matState.mode = 'populated';
  lensRunCalls.length = 0;
  lensRun.mockClear();
  useRunArtifactSpy.mockClear();
  window.localStorage.clear();
});

describe('engineering lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the engineering domain + materialLibrary is fetched', async () => {
    render(<EngineeringLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('engineering');
    await waitFor(() => expect(lensRunCalls.some((c) => c.domain === 'engineering' && c.action === 'materialLibrary')).toBe(true));
  });

  it('LOADING: an in-flight material library shows a role=status indicator', async () => {
    matState.mode = 'pending';
    const { container } = await renderOnMaterials();
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('EMPTY: an ok-but-empty library shows an honest "No materials" CTA (not a perpetual spinner)', async () => {
    matState.mode = 'empty';
    const { getByText, container } = await renderOnMaterials();
    await waitFor(() => expect(getByText(/No materials/i)).toBeInTheDocument());
    // not stuck on the loading spinner
    expect(container.querySelector('[role="status"]')).toBeFalsy();
  });

  it('ERROR: a failed library shows role=alert + a working Retry that re-fetches (not a silent empty/spinner)', async () => {
    matState.mode = 'error';
    const { container, getByText } = await renderOnMaterials();

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/material library offline/i)).toBeInTheDocument();
    // it must NOT be stuck on the loading spinner
    expect(container.querySelector('[role="status"]')).toBeFalsy();

    // Retry re-invokes the materialLibrary macro (and on success clears the error).
    const before = lensRunCalls.filter((c) => c.action === 'materialLibrary').length;
    matState.mode = 'populated';
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRunCalls.filter((c) => c.action === 'materialLibrary').length).toBeGreaterThan(before));
    await waitFor(() => expect(getByText('ASTM A36 Structural Steel')).toBeInTheDocument());
  });

  it('POPULATED: a real material row renders with its label', async () => {
    matState.mode = 'populated';
    const { getByText } = await renderOnMaterials();
    await waitFor(() => expect(getByText('ASTM A36 Structural Steel')).toBeInTheDocument());
  });
});
