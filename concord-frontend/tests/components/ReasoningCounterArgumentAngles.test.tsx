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
      return {
        data: { chains: [{ id: 'chain-1', ownerId: 'u1', question: 'Does the remedy work?', type: 'deductive', stepCount: 2, status: 'open' }] },
        isError: false, error: null, refetch: vi.fn(),
      };
    }
    if (key === 'auth-whoami') {
      return { data: { result: { actor: { userId: 'u1' } } }, isError: false, error: null, refetch: vi.fn() };
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
// FIX-reasoning-001: the stateless engines run through lensRun on the SELECTED chain's
// premises/conclusion — not through a synced chain artifact. lensRun is the boundary.
const runActionMutateAsync = vi.fn();
const lensRunMock = vi.hoisted(() => vi.fn());
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
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// ── headless chrome + heavy side panels → inert stubs (not under test) ─────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/reasoning/ReasoningArxiv', () => ({ ReasoningArxiv: () => null }));
vi.mock('@/components/reasoning/ArgumentWorkbench', () => ({ ArgumentWorkbench: () => null }));
vi.mock('@/components/reasoning/ArgumentMapStudio', () => ({ ArgumentMapStudio: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/common/EmptyState', () => ({
  ErrorState: ({ error }: { error?: string }) => React.createElement('div', { role: 'alert' }, error || 'error'),
}));

// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: import('react').ReactNode }) => children,
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

function engineReturns(result: Record<string, unknown>) {
  lensRunMock.mockImplementation(async (_domain: string, action: string) => {
    if (action === 'whoami') return { data: { ok: true, result: { actor: { userId: 'u1' } } } };
    return { data: { ok: true, result } };
  });
}

async function openAnalysisTabAndSelectChain() {
  render(<ReasoningLensPage />);
  fireEvent.click(screen.getByText('Analysis'));
  // The engines need a selected chain to read premises from.
  await act(async () => { fireEvent.click(await screen.findByText('Does the remedy work?')); });
}

async function openAnalysisTabAndRunCounterArgumentGen() {
  await openAnalysisTabAndSelectChain();
  const button = await screen.findByText('Generate Counter-Arguments');
  await act(async () => { fireEvent.click(button); });
}

describe('reasoning lens — counterArgumentGen angles card list (replaces raw JSON dump)', () => {
  beforeEach(() => {
    runActionMutateAsync.mockReset();
    lensRunMock.mockReset();
  });

  it('renders a distinct card per angle with a type-specific badge — never a raw JSON dump', async () => {
    engineReturns(COUNTER_ARGUMENT_RESULT);
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
    engineReturns({ totalClaims: 2, strongestClaim: 'c1', weakestClaim: 'c2', strengthMap: { c1: { strength: 80 }, c2: { strength: 20 } } });
    await openAnalysisTabAndSelectChain();
    const button = await screen.findByText('Full Strength Assessment');
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(screen.getByText(/"totalClaims"/)).toBeTruthy());
  });

  it('renders the honest guidance message (not a dump, not a card list) when the backend returns {message}', async () => {
    engineReturns({ message: 'No usable premises in that chain yet.' });
    await openAnalysisTabAndRunCounterArgumentGen();
    await waitFor(() => expect(screen.getByText('No usable premises in that chain yet.')).toBeTruthy());
    expect(screen.queryByText('Weak Link')).toBeNull();
  });

  it('runs the engine on the selected chain\'s own premises + conclusion, and never sends a mapId (the local Argument Maps tab is not backend-persisted)', async () => {
    engineReturns(COUNTER_ARGUMENT_RESULT);
    await openAnalysisTabAndRunCounterArgumentGen();
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'counterArgumentGen')).toBe(true));
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'counterArgumentGen')!;
    expect(call[0]).toBe('reasoning');
    expect(call[2]).toEqual({
      premises: ['Experts say it works', 'everyone knows that already'],
      conclusion: 'everyone knows that already',
    });
    expect(call[2]).not.toHaveProperty('mapId');
  });

  it('with no chain selected it says so and calls no engine', async () => {
    engineReturns(COUNTER_ARGUMENT_RESULT);
    render(<ReasoningLensPage />);
    fireEvent.click(screen.getByText('Analysis'));
    const button = await screen.findByText('Generate Counter-Arguments');
    await act(async () => { fireEvent.click(button); });
    expect(await screen.findByText('Select a chain in the table above first.')).toBeTruthy();
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'counterArgumentGen')).toBe(false);
  });
});
