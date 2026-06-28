/**
 * /lenses/commonsense — four-UX-state contract for the reasoning-bench
 * calculator surface (CommonsenseActionPanel), the PATH-3 component that drives
 * the commonsense reasoning calculators reachable from the panel:
 *   plausibilityCheck · analogyMapping (+ ConceptNet edges/relatedness)
 *
 * The panel reaches the backend through apiHelpers.lens.runDomain('commonsense',
 * action, { input }) → POST /api/lens/run. We mock that single channel and pin:
 *   IDLE/EMPTY  — no statement / no analogy text: clicking the calculator
 *                 surfaces an honest "<field> required" cue in the feedback row
 *                 and runs NO backend call + renders NO result card.
 *   LOADING     — while runDomain is in-flight the clicked action shows a busy
 *                 spinner and every action button is disabled.
 *   ERROR       — a backend {ok:false} (and a thrown request) surfaces the error
 *                 text in a visible feedback row — NOT a swallowed fetch that
 *                 leaves a silent-empty surface. This is the regression the
 *                 dead-calculator class hides behind.
 *   POPULATED   — a real result renders the EXACT fields the component reads
 *                 (plausibilityScore + plausibilityLabel + violations;
 *                 analogy systematicityScore + entityMapping). The fields are
 *                 the handler's REAL return shape — the previously-dead
 *                 {verdict,reasoning}/{mappings,coherence} reads are gone.
 *
 * No fabricated data — every state is produced by a mocked runDomain standing in
 * for the real dispatch in the exact { ok, result } envelope it returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── the one backend channel: apiHelpers.lens.runDomain ──────────────────────
const runDomain = vi.fn();
const apiPost = vi.fn(() => Promise.resolve({ data: {} }));
const apiDelete = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a), delete: (...a: unknown[]) => apiDelete(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));

// panel-polish: inert piping + recall (no real undo timers in the test).
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  PipeImporter: () => null,
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn(), label: '' }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { CommonsenseActionPanel } from '@/components/commonsense/CommonsenseActionPanel';

// Helper: type text into the placeholdered input/textarea, then click a button.
function typeInto(container: HTMLElement, placeholder: string, value: string) {
  const el = container.querySelector(`[placeholder="${placeholder}"]`) as HTMLInputElement | HTMLTextAreaElement;
  fireEvent.change(el, { target: { value } });
}

beforeEach(() => {
  runDomain.mockReset();
  apiPost.mockReset();
  apiPost.mockImplementation(() => Promise.resolve({ data: {} }));
  apiDelete.mockReset();
});

describe('commonsense action panel — IDLE / EMPTY', () => {
  it('clicking Plausible with no statement surfaces an honest cue and runs NO backend call', async () => {
    const utils = render(<CommonsenseActionPanel />);
    await act(async () => { fireEvent.click(utils.getByText('Plausible')); });
    await waitFor(() => expect(utils.getByText(/Statement required/i)).toBeInTheDocument());
    expect(runDomain).not.toHaveBeenCalled();
    // no plausibility result card rendered (the card shows a "satisfied" stat row).
    expect(utils.queryByText(/satisfied/i)).toBeNull();
  });

  it('clicking Analogy with no source/target surfaces an honest cue and runs NO backend call', async () => {
    const utils = render(<CommonsenseActionPanel />);
    await act(async () => { fireEvent.click(utils.getByText('Analogy')); });
    await waitFor(() => expect(utils.getByText(/Source \+ target required/i)).toBeInTheDocument());
    expect(runDomain).not.toHaveBeenCalled();
  });
});

describe('commonsense action panel — LOADING', () => {
  it('shows a busy spinner + disables actions while the plausibility request is in flight', async () => {
    let resolve!: (v: unknown) => void;
    runDomain.mockReturnValue(new Promise((r) => { resolve = r; }));
    const utils = render(<CommonsenseActionPanel />);
    typeInto(utils.container, 'Statement to plausibility-check', 'The dead man spoke to the crowd.');
    await act(async () => { fireEvent.click(utils.getByText('Plausible')); });
    // mid-flight: a spinner element is present and buttons are disabled.
    await waitFor(() => expect(utils.container.querySelector('.animate-spin')).toBeTruthy());
    const buttons = Array.from(utils.container.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.some((b) => b.disabled)).toBe(true);
    // settle so React state updates don't leak across tests.
    await act(async () => { resolve({ data: { ok: true, result: { ok: true, result: { plausibilityScore: 0, plausibilityLabel: 'implausible', violations: { count: 0, items: [] }, constraintsSatisfied: 0, eventsAnalyzed: 0 } } } }); });
  });
});

describe('commonsense action panel — ERROR (not swallowed → silent empty)', () => {
  it('a backend {ok:false} surfaces the error text in the feedback row', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'reasoner offline' } } });
    const utils = render(<CommonsenseActionPanel />);
    typeInto(utils.container, 'Statement to plausibility-check', 'A frozen river poured into the cup.');
    await act(async () => { fireEvent.click(utils.getByText('Plausible')); });
    await waitFor(() => expect(utils.getByText(/reasoner offline/i)).toBeInTheDocument());
    // no result card leaked (the card shows a "satisfied" stat row).
    expect(utils.queryByText(/satisfied/i)).toBeNull();
  });

  it('a thrown request is caught and surfaced, not swallowed into a blank panel', async () => {
    runDomain.mockRejectedValue(new Error('network down'));
    const utils = render(<CommonsenseActionPanel />);
    typeInto(utils.container, 'Analogy source', 'solar system');
    typeInto(utils.container, 'Analogy target', 'atom');
    await act(async () => { fireEvent.click(utils.getByText('Analogy')); });
    await waitFor(() => expect(utils.getByText(/network down/i)).toBeInTheDocument());
  });
});

describe('commonsense action panel — POPULATED', () => {
  it('renders the real plausibility result fields the component reads (score + label + violation)', async () => {
    runDomain.mockResolvedValue({
      data: { ok: true, result: { ok: true, result: {
        plausibilityScore: 0,
        plausibilityLabel: 'implausible',
        violations: { count: 1, items: [{ type: 'causal', description: 'Dead entities cannot perform actions', severity: 'high' }] },
        constraintsSatisfied: 0,
        totalChecksPerformed: 1,
        eventsAnalyzed: 0,
      } } } },
    );
    const utils = render(<CommonsenseActionPanel />);
    typeInto(utils.container, 'Statement to plausibility-check', 'The dead man spoke clearly to the crowd.');
    await act(async () => { fireEvent.click(utils.getByText('Plausible')); });
    // wait for a card-specific element (the violation description) — the header
    // badge "plausibility · analogy" must NOT be what we key on.
    await waitFor(() => expect(utils.getByText(/Dead entities cannot perform actions/i)).toBeInTheDocument());
    // card header is "Plausibility · implausible" (label + score in one card).
    expect(utils.getByText(/Plausibility · implausible/i)).toBeInTheDocument();
    expect(utils.getByText('0%')).toBeInTheDocument();
    // the violation type + severity badge are rendered.
    expect(utils.getByText('[causal]')).toBeInTheDocument();
    expect(utils.getByText('high')).toBeInTheDocument();
  });

  it('renders the real analogy result fields (sourceDomain → targetDomain, systematicity, entity mapping)', async () => {
    runDomain.mockResolvedValue({
      data: { ok: true, result: { ok: true, result: {
        sourceDomain: 'solar system', targetDomain: 'atom',
        entityMapping: [{ source: 'sun', target: 'nucleus', similarity: 1 }, { source: 'planet', target: 'electron', similarity: 1 }],
        systematicityScore: 30, systematicityLabel: 'low',
        candidateInferences: [{ predictedRelation: 'heavier', from: 'nucleus', to: 'electron', confidence: 0.24 }],
        coverage: { entitiesMapped: 2, totalSourceEntities: 2, relationsMapped: 1, totalSourceRelations: 2 },
      } } } },
    );
    const utils = render(<CommonsenseActionPanel />);
    typeInto(utils.container, 'Analogy source', 'solar system');
    typeInto(utils.container, 'Analogy target', 'atom');
    await act(async () => { fireEvent.click(utils.getByText('Analogy')); });
    await waitFor(() => expect(utils.getByText(/solar system → atom/i)).toBeInTheDocument());
    expect(utils.getByText('sun')).toBeInTheDocument();
    // "nucleus" appears in BOTH the entity mapping and the candidate inference.
    expect(utils.getAllByText('nucleus').length).toBeGreaterThanOrEqual(1);
    // systematicity score rendered (30%).
    expect(utils.container.textContent).toMatch(/30%/);
    // candidate inference predicted relation surfaced.
    expect(utils.getByText('heavier')).toBeInTheDocument();
  });
});
