/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/components/conkay/panels/ProvenancePanel.test.tsx
//
// F5 — pins the K3 DTU Provenance panel: an honest empty state when no
// verify run has happened, a normal grounded/resolved run rendering the
// verdict as the headline + the real DTU refs as graph nodes, and — the
// single most important behavior in this unit — a `fabricated_citation`
// verdict rendering RED and PROMINENT, never hidden or filtered out.
//
// Seeds the REAL conkayHudStore (same pattern as ConKayCockpit.test.tsx)
// rather than mocking zustand — `setLastVerify`/`setRunDtuRefs` are the real
// single-writer actions ConKayOverlay#verifyMessage calls, so seeding through
// them exercises the actual contract, not a stand-in.
//
// LC2 — also pins the persistent per-DTU "Trust" badge the panel now fetches
// via the `dtu.confidence` macro (mocked here through `lensRun`, the same
// helper `ConKayOverlay` itself uses for every other real macro call): a
// scored DTU renders "Trust: NN% (M citations)", an honestly-unscored DTU
// renders "Trust: not yet evaluated" (never a bare, misleading "50%"), and
// the Trust badge is visually/textually distinct from the "Verify:" verdict
// headline so the two signals are never conflated.

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProvenancePanel, trustStateFromConfidenceResult } from './ProvenancePanel';
import { useConkayHudStore } from '../conkayHudStore';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

function confidenceEnvelope(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

let originalRAF: typeof window.requestAnimationFrame;
let originalCAF: typeof window.cancelAnimationFrame;

beforeAll(() => {
  originalRAF = window.requestAnimationFrame;
  originalCAF = window.cancelAnimationFrame;
  // Stub rAF so GraphView's force-layout loop doesn't spin forever in jsdom
  // (same stub the existing GraphView.test.tsx uses).
  window.requestAnimationFrame = vi.fn(() => 0) as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = vi.fn() as unknown as typeof window.cancelAnimationFrame;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    canvas: { width: 600, height: 400 },
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterAll(() => {
  window.requestAnimationFrame = originalRAF;
  window.cancelAnimationFrame = originalCAF;
});

beforeEach(() => {
  useConkayHudStore.getState().reset();
  lensRun.mockReset();
  // Default: every DTU is honestly unscored unless a test overrides it.
  lensRun.mockResolvedValue(confidenceEnvelope({ known: false, score: 0.5, evidenceCount: 0 }));
});

describe('ProvenancePanel', () => {
  it('renders an honest empty state when no verification run has happened', () => {
    render(<ProvenancePanel />);
    expect(screen.getByTestId('ck-provenance-empty')).toHaveTextContent('No verification run yet.');
    // No fabricated/placeholder graph or verdict badge in the empty state.
    expect(screen.queryByTestId('ck-provenance-verdict')).toBeNull();
    expect(screen.queryByRole('canvas')).toBeNull();
  });

  it('renders the verdict as the header and the real DTU refs as graph nodes for a normal verified run', async () => {
    useConkayHudStore.getState().setLastVerify({ verdict: 'grounded', mode: 'council', confidence: 0.87 });
    useConkayHudStore.getState().setRunDtuRefs([
      { id: 'dtu-1', title: 'Beam load formula', tier: 'core' },
      { id: 'dtu-2', title: 'Material yield table', tier: 'core' },
    ]);

    render(<ProvenancePanel />);

    const verdictEl = screen.getByTestId('ck-provenance-verdict');
    expect(verdictEl).toHaveTextContent('Verify:');
    expect(verdictEl).toHaveTextContent('Grounded');
    expect(verdictEl).toHaveTextContent('87%');
    expect(verdictEl.getAttribute('data-flagged')).toBe('false');

    expect(screen.getByTestId('ck-provenance-ref-dtu-1')).toHaveTextContent('Beam load formula');
    expect(screen.getByTestId('ck-provenance-ref-dtu-2')).toHaveTextContent('Material yield table');
    expect(screen.getByTestId('ck-provenance-ref-dtu-1').getAttribute('data-flagged')).toBe('false');
    expect(document.querySelector('canvas')).toBeInTheDocument();

    // Trust badges settle once the (mocked) dtu.confidence fetch resolves.
    await waitFor(() => {
      expect(screen.getByTestId('ck-provenance-trust-dtu-1')).toHaveTextContent('Trust:');
    });
  });

  it('renders a fabricated_citation verdict RED and PROMINENT — never hidden or filtered out', async () => {
    useConkayHudStore.getState().setLastVerify({ verdict: 'fabricated_citation', mode: 'deterministic', confidence: null });
    useConkayHudStore.getState().setRunDtuRefs([
      { id: 'dtu-ghost', title: 'A source that does not exist', tier: null },
    ]);

    render(<ProvenancePanel />);

    // The verdict is the headline, not softened or hidden.
    const verdictEl = screen.getByTestId('ck-provenance-verdict');
    expect(verdictEl).toHaveTextContent('Fabricated citation');
    expect(verdictEl.getAttribute('data-flagged')).toBe('true');
    expect(verdictEl.className).toMatch(/rose/);

    // The flagged ref is present in the DOM (not filtered out) and rendered red.
    const refEl = screen.getByTestId('ck-provenance-ref-dtu-ghost');
    expect(refEl).toBeInTheDocument();
    expect(refEl).toHaveTextContent('A source that does not exist');
    expect(refEl.getAttribute('data-flagged')).toBe('true');
    expect(refEl.className).toMatch(/rose/);

    // The graph still renders (not suppressed) with the flagged data passed through.
    expect(document.querySelector('canvas')).toBeInTheDocument();

    // A fabricated-citation verdict is a Verify-layer fact only — it must
    // never be mistaken for (or bleed into) the separate Trust badge, which
    // still renders its own honest reading of the persistent substrate.
    await waitFor(() => {
      expect(screen.getByTestId('ck-provenance-trust-dtu-ghost')).toHaveTextContent('Trust:');
    });
    expect(screen.getByTestId('ck-provenance-trust-dtu-ghost')).not.toHaveTextContent('Fabricated');
  });

  it('treats a verify pass with zero citations (verdict "unverified") as an honest hub-only state, not empty', () => {
    useConkayHudStore.getState().setLastVerify({ verdict: 'unverified', mode: null, confidence: null });
    // dtuRefs defaults to [] when the caller has nothing to check against.
    useConkayHudStore.getState().setRunDtuRefs([]);

    render(<ProvenancePanel />);

    expect(screen.getByTestId('ck-provenance-verdict')).toHaveTextContent('Unverified');
    // No refs to list, so no ref rows and no graph canvas — but the verdict
    // itself is still shown, honestly reflecting "nothing was cited."
    expect(screen.queryByTestId(/^ck-provenance-ref-/)).toBeNull();
  });
});

describe('ProvenancePanel — persistent DTU Trust badge (LC2)', () => {
  it('renders "Trust: not yet evaluated" for an honestly-unscored DTU — never a bare, misleading score', async () => {
    lensRun.mockResolvedValue(confidenceEnvelope({ known: false, score: 0.5, evidenceCount: 0 }));
    useConkayHudStore.getState().setLastVerify({ verdict: 'grounded', mode: 'council', confidence: 0.9 });
    useConkayHudStore.getState().setRunDtuRefs([{ id: 'dtu-fresh', title: 'Never scored', tier: 'core' }]);

    render(<ProvenancePanel />);

    await waitFor(() => {
      expect(screen.getByTestId('ck-provenance-trust-dtu-fresh')).toHaveTextContent('Trust: not yet evaluated');
    });
    const trustEl = screen.getByTestId('ck-provenance-trust-dtu-fresh');
    expect(trustEl.getAttribute('data-trust-known')).toBe('false');
    // The honest-unknown placeholder score (0.5) must never surface as "50%".
    expect(trustEl).not.toHaveTextContent('50%');
    expect(lensRun).toHaveBeenCalledWith('dtu', 'confidence', { dtuId: 'dtu-fresh' });
  });

  it('renders "Trust: NN% (M citations)" for a DTU with real accumulated evidence', async () => {
    lensRun.mockResolvedValue(confidenceEnvelope({ known: true, score: 0.62, evidenceCount: 12 }));
    useConkayHudStore.getState().setLastVerify({ verdict: 'grounded', mode: 'council', confidence: 0.9 });
    useConkayHudStore.getState().setRunDtuRefs([{ id: 'dtu-seasoned', title: 'Well-cited claim', tier: 'core' }]);

    render(<ProvenancePanel />);

    await waitFor(() => {
      expect(screen.getByTestId('ck-provenance-trust-dtu-seasoned')).toHaveTextContent('Trust: 62% (12 citations)');
    });
    expect(screen.getByTestId('ck-provenance-trust-dtu-seasoned').getAttribute('data-trust-known')).toBe('true');
  });

  it('keeps Trust visually/textually distinct from the Verify verdict headline', async () => {
    // Verify says "Grounded" (a fabricated-looking-good verdict), but the
    // persistent Trust substrate independently reports low confidence — the
    // two must coexist without either overwriting or echoing the other.
    lensRun.mockResolvedValue(confidenceEnvelope({ known: true, score: 0.2, evidenceCount: 3 }));
    useConkayHudStore.getState().setLastVerify({ verdict: 'grounded', mode: 'council', confidence: 0.95 });
    useConkayHudStore.getState().setRunDtuRefs([{ id: 'dtu-mixed', title: 'Disputed claim', tier: 'core' }]);

    render(<ProvenancePanel />);

    const verdictEl = screen.getByTestId('ck-provenance-verdict');
    expect(verdictEl).toHaveTextContent('Verify:');
    expect(verdictEl).toHaveTextContent('95%'); // the verify-run confidence

    await waitFor(() => {
      const trustEl = screen.getByTestId('ck-provenance-trust-dtu-mixed');
      expect(trustEl).toHaveTextContent('Trust: 20% (3 citations)');
    });
    // The verdict badge itself never absorbs the Trust reading.
    expect(verdictEl).not.toHaveTextContent('20%');
  });

  it('shows a loading state and degrades honestly to "unavailable" on a failed lookup — never fabricates', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'no_db' } });
    useConkayHudStore.getState().setLastVerify({ verdict: 'grounded', mode: 'council', confidence: 0.8 });
    useConkayHudStore.getState().setRunDtuRefs([{ id: 'dtu-broken', title: 'Lookup fails', tier: 'core' }]);

    render(<ProvenancePanel />);

    // Before the async lookup resolves, the badge honestly says "…", never a
    // guessed number.
    expect(screen.getByTestId('ck-provenance-trust-dtu-broken')).toHaveTextContent('Trust: …');

    await waitFor(() => {
      expect(screen.getByTestId('ck-provenance-trust-dtu-broken')).toHaveTextContent('Trust: unavailable');
    });
  });

  it('never wires a write-back: rendering the panel issues only reads (no mutating call)', async () => {
    useConkayHudStore.getState().setLastVerify({ verdict: 'grounded', mode: 'council', confidence: 0.8 });
    useConkayHudStore.getState().setRunDtuRefs([{ id: 'dtu-readonly', title: 'x', tier: 'core' }]);

    render(<ProvenancePanel />);

    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    // Every call this panel makes is the read-only confidence lookup —
    // never an update/write macro (e.g. no 'updateConfidence'-shaped action).
    for (const call of lensRun.mock.calls) {
      expect(call[0]).toBe('dtu');
      expect(call[1]).toBe('confidence');
    }
  });
});

describe('trustStateFromConfidenceResult (pure reshape, pinned)', () => {
  it('never fabricates: a non-object result reshapes to null', () => {
    expect(trustStateFromConfidenceResult(null)).toBeNull();
    expect(trustStateFromConfidenceResult(undefined)).toBeNull();
    expect(trustStateFromConfidenceResult('nope')).toBeNull();
  });

  it('reshapes a real known+scored result verbatim', () => {
    expect(trustStateFromConfidenceResult({ dtuId: 'd1', known: true, score: 0.73, evidenceCount: 5 })).toEqual({
      status: 'ready',
      known: true,
      score: 0.73,
      evidenceCount: 5,
    });
  });

  it('reshapes the honest-unknown shape (known:false) without inventing evidence', () => {
    expect(trustStateFromConfidenceResult({ known: false, score: 0.5, evidenceCount: 0 })).toEqual({
      status: 'ready',
      known: false,
      score: 0.5,
      evidenceCount: 0,
    });
  });

  it('defensively coerces malformed score/evidenceCount fields instead of throwing', () => {
    expect(trustStateFromConfidenceResult({ known: true, score: 'oops', evidenceCount: null })).toEqual({
      status: 'ready',
      known: true,
      score: 0.5,
      evidenceCount: 0,
    });
  });
});
