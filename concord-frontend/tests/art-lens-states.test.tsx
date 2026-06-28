/**
 * /lenses/art — four-UX-state contract for the Art workbench (ArtActionPanel),
 * the PATH-3 surface that drives the four pure-compute art calculators:
 *   colorHarmony · compositionScore · generatePalette · styleClassify
 *
 * The panel reaches the backend through apiHelpers.lens.runDomain('art',
 * action, { input }) → POST /api/lens/run. We mock that single channel and pin:
 *   IDLE/EMPTY  — no input authored: clicking a calculator surfaces an honest
 *                 validation cue and runs NO backend call (no empty round-trip).
 *   LOADING     — while runDomain is in-flight the panel shows a busy spinner
 *                 and every action button is disabled.
 *   ERROR       — a backend {ok:false} (and a thrown request) surfaces the error
 *                 text in a visible feedback row — NOT a swallowed fetch that
 *                 leaves a silent-empty surface (the dead-calculator class).
 *   POPULATED   — a real result renders the EXACT fields the REALIGNED component
 *                 reads — the names the live server/domains/art.js handlers
 *                 actually return (harmonyScore/temperature/harmonies[].type;
 *                 overall/rating/scores; palette[].hex/role; topMatch.style/
 *                 .similarity/confidence). The prior component read invented
 *                 names (harmony/mood/score/tips/style/period) the handler never
 *                 emits → a blank card in production; this test pins the fix.
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
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn(), label: '' }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { ArtActionPanel } from '@/components/art/ArtActionPanel';

// Type into a control whose <label> matches labelText, then click a button.
function setField(utils: ReturnType<typeof render>, labelText: RegExp, value: string, sel: 'textarea' | 'input' = 'textarea') {
  const labels = Array.from(utils.container.querySelectorAll('label'));
  const label = labels.find((l) => labelText.test(l.textContent || ''));
  const el = label?.parentElement?.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
  fireEvent.change(el, { target: { value } });
}

// Envelope shape callMacro consumes: { data: { ok, result } }; callMacro then
// unwraps a nested result.ok → so we double-wrap like the live dispatch.
function env(result: unknown) {
  return { data: { ok: true, result: { ok: true, result } } };
}

beforeEach(() => {
  runDomain.mockReset();
  apiPost.mockReset();
  apiPost.mockImplementation(() => Promise.resolve({ data: {} }));
  apiDelete.mockReset();
});

describe('art workbench — IDLE / EMPTY (validation cue, no empty round-trip)', () => {
  it('Harmony with <2 colors surfaces a cue and runs NO backend call', async () => {
    const utils = render(<ArtActionPanel />);
    await act(async () => { fireEvent.click(utils.getByText('Harmony')); });
    expect(utils.getByText(/at least 2 hex colors/i)).toBeInTheDocument();
    expect(runDomain).not.toHaveBeenCalled();
  });

  it('Composition with no element lines surfaces a cue and runs NO backend call', async () => {
    const utils = render(<ArtActionPanel />);
    await act(async () => { fireEvent.click(utils.getByText('Composition')); });
    expect(utils.getByText(/element line/i)).toBeInTheDocument();
    expect(runDomain).not.toHaveBeenCalled();
  });

  it('Palette with no seed hex surfaces a cue and runs NO backend call', async () => {
    const utils = render(<ArtActionPanel />);
    await act(async () => { fireEvent.click(utils.getByText('Palette')); });
    expect(utils.getByText(/seed hex/i)).toBeInTheDocument();
    expect(runDomain).not.toHaveBeenCalled();
  });
});

describe('art workbench — LOADING', () => {
  it('shows a busy spinner + disables actions while colorHarmony is in flight', async () => {
    let resolve!: (v: unknown) => void;
    runDomain.mockReturnValue(new Promise((r) => { resolve = r; }));
    const utils = render(<ArtActionPanel />);
    setField(utils, /Color list/i, '#ff0000\n#00ffff');
    await act(async () => { fireEvent.click(utils.getByText('Harmony')); });
    await waitFor(() => expect(utils.container.querySelector('.animate-spin')).toBeTruthy());
    const buttons = Array.from(utils.container.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.some((b) => b.disabled)).toBe(true);
    // Verify the EXACT realigned input field name reaches the handler: { palette }.
    expect(runDomain).toHaveBeenCalledWith('art', 'colorHarmony', { input: { palette: ['#ff0000', '#00ffff'] } });
    await act(async () => { resolve(env({ harmonies: [], temperature: 'balanced', harmonyScore: 0, paletteSize: 2, dominantHue: 0 })); });
  });
});

describe('art workbench — ERROR (surfaced, not swallowed into a silent-empty)', () => {
  it('a backend {ok:false} surfaces the error text in the feedback row', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'palette entries must be #RRGGBB hex colors' } } });
    const utils = render(<ArtActionPanel />);
    setField(utils, /Color list/i, '#ff0000\n#00ff00');
    await act(async () => { fireEvent.click(utils.getByText('Harmony')); });
    await waitFor(() => expect(utils.getByText(/#RRGGBB hex colors/i)).toBeInTheDocument());
    // no result card leaked.
    expect(utils.container.textContent).not.toMatch(/dominant hue/i);
  });

  it('a thrown request is caught and surfaced, not swallowed into a blank panel', async () => {
    runDomain.mockRejectedValue(new Error('network down'));
    const utils = render(<ArtActionPanel />);
    // The seed + count inputs are placeholder-only (no <label>); set directly.
    const seed = utils.container.querySelector('input[placeholder="#seed hex"]') as HTMLInputElement;
    const n = utils.container.querySelector('input[placeholder="palette N"]') as HTMLInputElement;
    fireEvent.change(seed, { target: { value: '#3498db' } });
    fireEvent.change(n, { target: { value: '5' } });
    await act(async () => { fireEvent.click(utils.getByText('Palette')); });
    await waitFor(() => expect(utils.getByText(/network down/i)).toBeInTheDocument());
  });
});

describe('art workbench — POPULATED (renders the REAL handler field names)', () => {
  it('colorHarmony renders harmonyScore + temperature + harmony types', async () => {
    runDomain.mockResolvedValue(env({
      harmonies: [{ type: 'complementary', colors: ['#ff0000', '#00ffff'], hueDistance: 180 }],
      temperature: 'cool', harmonyScore: 73, paletteSize: 2, dominantHue: 120,
    }));
    const utils = render(<ArtActionPanel />);
    setField(utils, /Color list/i, '#ff0000\n#00ffff');
    await act(async () => { fireEvent.click(utils.getByText('Harmony')); });
    await waitFor(() => expect(utils.getByText(/score 73 · cool/i)).toBeInTheDocument());
    expect(utils.getByText(/2 colors · dominant hue 120/i)).toBeInTheDocument();
    // "complementary" appears as a harmony <option> AND the result chip — the
    // chip is the populated-state signal, so assert ≥2 occurrences.
    expect(utils.getAllByText('complementary').length).toBeGreaterThanOrEqual(2);
  });

  it('compositionScore renders overall + rating + per-axis scores', async () => {
    runDomain.mockResolvedValue(env({
      overall: 64, rating: 'good',
      scores: { ruleOfThirds: 70, goldenRatio: 60, balance: 65, whitespace: 50, visualFlow: 80 },
      canvasCoverage: 12, elementCount: 2,
    }));
    const utils = render(<ArtActionPanel />);
    setField(utils, /Composition elements/i, '640,360,200,200\n1280,720,150,150');
    await act(async () => { fireEvent.click(utils.getByText('Composition')); });
    await waitFor(() => expect(utils.getByText('64')).toBeInTheDocument());
    expect(utils.getByText(/Composition · good/i)).toBeInTheDocument();
    expect(utils.getByText('70')).toBeInTheDocument(); // ruleOfThirds score
    // Verify the EXACT realigned input shape reached the handler.
    expect(runDomain).toHaveBeenCalledWith('art', 'compositionScore', {
      input: { elements: [{ x: 640, y: 360, width: 200, height: 200 }, { x: 1280, y: 720, width: 150, height: 150 }], canvas: { width: 1920, height: 1080 } },
    });
  });

  it('generatePalette renders the palette swatches + harmony label', async () => {
    runDomain.mockResolvedValue(env({
      baseColor: '#3498db', harmony: 'complementary', count: 3,
      palette: [{ hex: '#3498db', role: 'base' }, { hex: '#db7734', role: 'complement' }, { hex: '#5dade2', role: 'base-variant' }],
    }));
    const utils = render(<ArtActionPanel />);
    const seed = utils.container.querySelector('input[placeholder="#seed hex"]') as HTMLInputElement;
    const n = utils.container.querySelector('input[placeholder="palette N"]') as HTMLInputElement;
    fireEvent.change(seed, { target: { value: '#3498db' } });
    fireEvent.change(n, { target: { value: '3' } });
    await act(async () => { fireEvent.click(utils.getByText('Palette')); });
    await waitFor(() => expect(utils.getByText(/Palette · complementary/i)).toBeInTheDocument());
    // Each swatch hex renders.
    expect(utils.getByText('#3498db')).toBeInTheDocument();
    expect(utils.getByText('#db7734')).toBeInTheDocument();
    // Verify the realigned input: baseColor (NOT seedColor) + harmony + count.
    expect(runDomain).toHaveBeenCalledWith('art', 'generatePalette', { input: { baseColor: '#3498db', harmony: 'analogous', count: 3 } });
  });

  it('styleClassify renders topMatch.style + similarity + confidence', async () => {
    runDomain.mockResolvedValue(env({
      topMatch: { style: 'Impressionism', similarity: 100 },
      allMatches: [{ style: 'Impressionism', similarity: 100 }, { style: 'Watercolor', similarity: 71 }],
      confidence: 'high',
    }));
    const utils = render(<ArtActionPanel />);
    setField(utils, /Style axes/i, '80,70,40,40,30,40,20,70', 'input');
    await act(async () => { fireEvent.click(utils.getByText('Style')); });
    await waitFor(() => expect(utils.getByText(/Impressionism · 100%/i)).toBeInTheDocument());
    expect(utils.getByText(/confidence high/i)).toBeInTheDocument();
    expect(utils.getByText('Watercolor')).toBeInTheDocument();
    // Verify the realigned input shape: { attributes: {...} }.
    expect(runDomain).toHaveBeenCalledWith('art', 'styleClassify', {
      input: { attributes: { brushwork: 80, colorSaturation: 70, contrast: 40, perspective: 40, detail: 30, abstraction: 40, lineWeight: 20, texture: 70 } },
    });
  });
});
