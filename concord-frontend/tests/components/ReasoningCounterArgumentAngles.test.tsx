/**
 * Reasoning lens — "AI-Powered Analysis" counter-argument angles UI.
 *
 * Closes the docs/WAVE4_INVENTORY.md row about counterArgumentGen: the
 * backend now returns a real "angles" array (including two NEW attack
 * types — weak-link + scheme-critical-question — both sourced from real
 * data, see server/domains/reasoning.js) but the frontend used to render
 * the whole result as a raw JSON.stringify dump. This pins the real
 * findings-card-list UI that replaced it: one card per angle, badged by
 * attack type, never a <pre> JSON blob for a counterArgumentGen result.
 *
 * The page's other hooks (chain data, argument-map CRUD, realtime, etc.)
 * are mocked at the hook boundary so this test isolates the analysis
 * panel's rendering of a `runAction.mutateAsync` result — the same
 * pattern used by tests/debate-lens-states.test.tsx and
 * tests/atlas-lens-states.test.tsx for this large a lens page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── react-query: discriminate by queryKey so the three useQuery calls each
//    get sane data; useMutation/useQueryClient are inert. ───────────────────
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    if (key === 'reasoning-trace') {
      return {
        data: {
          trace: {
            steps: [
              { conclusion: 'Experts say it works' },
              { conclusion: 'everyone knows that already' },
            ],
            conclusion: null,
          },
        },
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    if (key === 'reasoning-chains') {
      return { data: { chains: [] }, isError: false, error: null, refetch: vi.fn() };
    }
    if (key === 'reasoning-status') {
      return { data: { status: {} }, isError: false, error: null, refetch: vi.fn() };
    }
    return { data: {}, isError: false, error: null, refetch: vi.fn() };
  },
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ── lens artifact channel: one seeded chain artifact so the action buttons
//    have a target (chainArtifacts.length > 0). ─────────────────────────────
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    items: [{ id: 'reasoning-artifact-1', title: 'Synced chain', data: {} }],
    create: vi.fn(),
  }),
}));

// ── runAction.mutateAsync is the ONLY backend boundary this test drives —
//    it resolves with a real counterArgumentGen-shaped result (all five
//    pre-existing attack types + the two new map-sourced ones). ────────────
const runActionMutateAsync = vi.fn();
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: [], isLoading: false }),
  useCreateArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve({})) }),
  useRunArtifact: () => ({ mutateAsync: runActionMutateAsync, isPending: false }),
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: [] })), post: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: {
    reasoning: {
      list: vi.fn(() => Promise.resolve({ data: { chains: [] } })),
      status: vi.fn(() => Promise.resolve({ data: {} })),
      trace: vi.fn(() => Promise.resolve({ data: { trace: {} } })),
      create: vi.fn(() => Promise.resolve({ data: {} })),
      addStep: vi.fn(() => Promise.resolve({ data: {} })),
      conclude: vi.fn(() => Promise.resolve({ data: {} })),
    },
  },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

// ── headless chrome + heavy side panels → inert stubs (not under test) ─────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
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
vi.mock('@/components/reasoning/ReasoningArxiv', () => ({ ReasoningArxiv: () => null }));
vi.mock('@/components/reasoning/ArgumentWorkbench', () => ({ ArgumentWorkbench: () => null }));
vi.mock('@/components/reasoning/ArgumentMapStudio', () => ({ ArgumentMapStudio: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/common/EmptyState', () => ({
  ErrorState: ({ error }: { error?: string }) => React.createElement('div', { role: 'alert' }, error || 'error'),
}));

// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import ReasoningLensPage from '@/app/lenses/reasoning/page';

// A real counterArgumentGen shape: the 4 pre-existing attack types plus the
// 2 NEW map-sourced ones this Wave-4 gap-closure added.
const COUNTER_ARGUMENT_RESULT = {
  angles: [
    { attack: 'internal-contradiction', detail: '"birds fly" contradicts "birds not fly" — press on this before anything else.' },
    { attack: 'unsupported-leap', detail: 'The conclusion introduces "oranges" with no premise backing it — ask where that came from.' },
    { attack: 'fallacy', detail: 'Appeal to Authority: Citing authority without specific evidence' },
    {
      attack: 'weak-link',
      detail: 'In "Robust debate", the claim "It\'s popular" is the weakest link (strength 20/100 — 2 counters vs 0 support) — attack there first.',
      source: 'map-strength-assessment',
      mapId: 'map_abc123',
      nodeId: 'node_xyz789',
    },
    {
      attack: 'scheme-critical-question',
      detail: 'Is the expert credible in this domain?',
      source: 'scheme:authority',
      schemeName: 'Argument from Expert Opinion',
    },
    {
      attack: 'scheme-critical-question',
      detail: 'Do other experts disagree?',
      source: 'scheme:authority',
      schemeName: 'Argument from Expert Opinion',
    },
  ],
  validity: 'invalid-contradictions',
  recommendation: 'Resolve contradictions before proceeding',
  map: { mapId: 'map_abc123', title: 'Robust debate', scheme: 'authority' },
};

async function openAnalysisTabAndRunCounterArgumentGen() {
  render(<ReasoningLensPage />);
  fireEvent.click(screen.getByText('Analysis'));
  const button = await screen.findByText('Generate Counter-Arguments');
  await act(async () => { fireEvent.click(button); });
}

describe('reasoning lens — counterArgumentGen angles card list (replaces raw JSON dump)', () => {
  beforeEach(() => {
    runActionMutateAsync.mockReset();
  });

  it('renders a distinct card per angle with a type-specific badge — never a raw JSON dump', async () => {
    runActionMutateAsync.mockResolvedValue({ ok: true, result: COUNTER_ARGUMENT_RESULT });
    await openAnalysisTabAndRunCounterArgumentGen();

    // Every angle's detail text renders as real content.
    await waitFor(() => expect(screen.getByText(/press on this before anything else/)).toBeTruthy());
    expect(screen.getByText(/ask where that came from/)).toBeTruthy();
    expect(screen.getByText(/Appeal to Authority: Citing authority/)).toBeTruthy();
    expect(screen.getByText(/is the weakest link/)).toBeTruthy();
    expect(screen.getByText('Is the expert credible in this domain?')).toBeTruthy();
    expect(screen.getByText('Do other experts disagree?')).toBeTruthy();

    // Badge labels — one per attack type actually present.
    expect(screen.getByText('Contradiction')).toBeTruthy();
    expect(screen.getByText('Unsupported Leap')).toBeTruthy();
    expect(screen.getByText('Fallacy')).toBeTruthy();
    expect(screen.getByText('Weak Link')).toBeTruthy();
    // Two scheme-critical-question angles → two "Critical Question" badges.
    expect(screen.getAllByText('Critical Question').length).toBe(2);
    // The scheme name is surfaced next to the critical-question badges.
    expect(screen.getAllByText('Argument from Expert Opinion').length).toBe(2);

    // The old behavior — dumping the whole result as formatted JSON — must
    // be gone for this shape (no literal '"angles":' JSON key text).
    expect(screen.queryByText(/"angles":/)).toBeNull();
  });

  it('still falls back to raw JSON for a non-angles result shape (e.g. strengthAssessment), so only counterArgumentGen gets the card list', async () => {
    runActionMutateAsync.mockResolvedValue({
      ok: true,
      result: { totalClaims: 2, strongestClaim: 'c1', weakestClaim: 'c2', strengthMap: { c1: { strength: 80 }, c2: { strength: 20 } } },
    });
    render(<ReasoningLensPage />);
    fireEvent.click(screen.getByText('Analysis'));
    const button = await screen.findByText('Full Strength Assessment');
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(screen.getByText(/"totalClaims"/)).toBeTruthy());
  });

  it('renders the honest guidance message (not a dump, not a card list) when the backend returns {message}', async () => {
    runActionMutateAsync.mockResolvedValue({ ok: true, result: { message: 'No reasoning artifacts synced yet.' } });
    await openAnalysisTabAndRunCounterArgumentGen();
    await waitFor(() => expect(screen.getByText('No reasoning artifacts synced yet.')).toBeTruthy());
    expect(screen.queryByText('Weak Link')).toBeNull();
  });

  it('does not send a mapId from this panel (documented decision — the local Argument Maps tab is not backend-persisted)', async () => {
    runActionMutateAsync.mockResolvedValue({ ok: true, result: COUNTER_ARGUMENT_RESULT });
    await openAnalysisTabAndRunCounterArgumentGen();
    await waitFor(() => expect(runActionMutateAsync).toHaveBeenCalled());
    const call = runActionMutateAsync.mock.calls[0][0];
    expect(call.action).toBe('counterArgumentGen');
    expect(call.params).not.toHaveProperty('mapId');
  });
});
