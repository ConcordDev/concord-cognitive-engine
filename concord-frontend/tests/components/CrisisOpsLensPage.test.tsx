import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// LensShell + the lens chrome pull in next/dynamic, the UI store and a11y
// hooks; stub them to passthroughs so this test isolates the crisis-ops page's
// own four UX states (LOADING / EMPTY / LOADED / FORBIDDEN) + a11y affordances.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => undefined }));

// Heavy child panels each fetch independently — stub to lightweight markers so
// the page's own states are what we assert.
vi.mock('@/components/crisis-ops/FemaDisasters', () => ({ FemaDisasters: () => React.createElement('div', { 'data-testid': 'fema' }) }));
vi.mock('@/components/crisis-ops/CrisisMap', () => ({ CrisisMap: () => React.createElement('div', { 'data-testid': 'map' }) }));
vi.mock('@/components/crisis-ops/TriagePanel', () => ({ TriagePanel: () => React.createElement('div', { 'data-testid': 'triage' }) }));
vi.mock('@/components/crisis-ops/PlaybookPanel', () => ({ PlaybookPanel: () => React.createElement('div', { 'data-testid': 'playbook' }) }));
vi.mock('@/components/crisis-ops/TeamPanel', () => ({ TeamPanel: () => React.createElement('div', { 'data-testid': 'team' }) }));
vi.mock('@/components/crisis-ops/TimelinePanel', () => ({ TimelinePanel: () => React.createElement('div', { 'data-testid': 'timeline' }) }));
vi.mock('@/components/crisis-ops/AlertsPanel', () => ({ AlertsPanel: () => React.createElement('div', { 'data-testid': 'alerts' }) }));
vi.mock('@/components/crisis-ops/ResourcePanel', () => ({ ResourcePanel: () => React.createElement('div', { 'data-testid': 'resources' }) }));
vi.mock('@/components/crisis-ops/IncidentReportPanel', () => ({ IncidentReportPanel: () => React.createElement('div', { 'data-testid': 'incident-reports' }) }));

// useLensData (react-query) — controllable per test.
const lensDataState = { items: [] as unknown[], isLoading: false, isError: false };
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: lensDataState.items,
    isLoading: lensDataState.isLoading,
    isError: lensDataState.isError,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    refetch: vi.fn(),
  }),
}));

// lensRun / isForbidden — controllable per test.
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  isForbidden: (x: unknown) =>
    !!x && typeof x === 'object' && (x as { ok?: unknown; error?: unknown }).ok === false
      && typeof (x as { error?: unknown }).error === 'string'
      && /forbidden|403/i.test((x as { error: string }).error),
}));

async function renderPage() {
  const { default: CrisisOpsPage } = await import('@/app/lenses/crisis-ops/page');
  render(React.createElement(CrisisOpsPage));
}

const CRISES = [
  { id: 'cr_1', type: 'wildfire', description: 'Ridge fire spreading', origin_world_id: 'w', started_at: 1 },
  { id: 'cr_2', type: 'flood', description: 'River breach', origin_world_id: 'w', started_at: 2 },
];

describe('CrisisOpsLensPage — four UX states + a11y', () => {
  beforeEach(() => {
    vi.resetModules();
    lensRunMock.mockReset();
    lensDataState.items = [];
    lensDataState.isLoading = false;
    lensDataState.isError = false;
    // jsdom localStorage
    window.localStorage.clear();
  });
  afterEach(() => { vi.clearAllMocks(); });

  it('LOADING: shows a loading indicator while active crises are in flight', async () => {
    lensRunMock.mockImplementation(() => new Promise(() => {})); // never resolves
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/loading…/i)).toBeInTheDocument();
    });
  });

  it('EMPTY: shows an honest at-rest empty state when no crises are active', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, crises: [], suggestions: [] } });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no active crises\. the world is at rest\./i)).toBeInTheDocument();
    });
  });

  it('LOADED: renders the active crises with a keyboard-operable Resolve control', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, crises: CRISES, suggestions: [{ skill_id: 'rescue', level: 5 }] } });
    await renderPage();
    // description appears in both the list item and the command-deck header,
    // so assert ≥1 match rather than a unique one.
    await waitFor(() => {
      expect(screen.getAllByText('Ridge fire spreading').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('River breach')).toBeInTheDocument();
    // command deck mounted for the auto-selected first crisis
    expect(screen.getByTestId('playbook')).toBeInTheDocument();
    expect(screen.getByTestId('team')).toBeInTheDocument();

    // a11y: each crisis exposes a Resolve affordance reachable by keyboard
    const resolves = screen.getAllByText('Resolve');
    expect(resolves.length).toBe(2);
    for (const r of resolves) {
      // role=button + tabIndex makes it keyboard-focusable + Enter-activatable
      expect(r).toHaveAttribute('role', 'button');
      expect(r).toHaveAttribute('tabindex', '0');
    }

    // the deployable-skill chip surfaced
    expect(screen.getByText(/rescue · L5/i)).toBeInTheDocument();
  });

  it('FORBIDDEN: renders the admin-required gate when the macro returns 403', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'forbidden: admin only' } });
    await renderPage();
    await waitFor(() => {
      // AdminRequiredState renders a recognizable gate; assert the page did NOT
      // render the normal console header instead.
      expect(screen.queryByText(/active world crises/i)).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('lens-shell')).toBeInTheDocument();
  });

  it('a11y: the header reads as a single labelled landmark with an h1', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, crises: [], suggestions: [] } });
    await renderPage();
    await waitFor(() => {
      const h1 = screen.getByRole('heading', { level: 1, name: /crisis ops/i });
      expect(h1).toBeInTheDocument();
    });
  });

  it('PERSISTENCE: surfaces the incident-report count badge when reports exist', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, crises: [], suggestions: [] } });
    lensDataState.items = [{ id: 'r1', title: 'Sitrep 1', data: {}, meta: {} }];
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/1 incident report on file/i)).toBeInTheDocument();
    });
    // and the persisted-report panel is mounted (when no crisis selected)
    expect(within(screen.getByTestId('lens-shell')).getByTestId('incident-reports')).toBeInTheDocument();
  });
});
