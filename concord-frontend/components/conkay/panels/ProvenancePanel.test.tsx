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

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProvenancePanel } from './ProvenancePanel';
import { useConkayHudStore } from '../conkayHudStore';

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
});

describe('ProvenancePanel', () => {
  it('renders an honest empty state when no verification run has happened', () => {
    render(<ProvenancePanel />);
    expect(screen.getByTestId('ck-provenance-empty')).toHaveTextContent('No verification run yet.');
    // No fabricated/placeholder graph or verdict badge in the empty state.
    expect(screen.queryByTestId('ck-provenance-verdict')).toBeNull();
    expect(screen.queryByRole('canvas')).toBeNull();
  });

  it('renders the verdict as the header and the real DTU refs as graph nodes for a normal verified run', () => {
    useConkayHudStore.getState().setLastVerify({ verdict: 'grounded', mode: 'council', confidence: 0.87 });
    useConkayHudStore.getState().setRunDtuRefs([
      { id: 'dtu-1', title: 'Beam load formula', tier: 'core' },
      { id: 'dtu-2', title: 'Material yield table', tier: 'core' },
    ]);

    render(<ProvenancePanel />);

    const verdictEl = screen.getByTestId('ck-provenance-verdict');
    expect(verdictEl).toHaveTextContent('Grounded');
    expect(verdictEl).toHaveTextContent('87%');
    expect(verdictEl.getAttribute('data-flagged')).toBe('false');

    expect(screen.getByTestId('ck-provenance-ref-dtu-1')).toHaveTextContent('Beam load formula');
    expect(screen.getByTestId('ck-provenance-ref-dtu-2')).toHaveTextContent('Material yield table');
    expect(screen.getByTestId('ck-provenance-ref-dtu-1').getAttribute('data-flagged')).toBe('false');
    expect(document.querySelector('canvas')).toBeInTheDocument();
  });

  it('renders a fabricated_citation verdict RED and PROMINENT — never hidden or filtered out', () => {
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
