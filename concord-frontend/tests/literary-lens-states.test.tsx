/**
 * /lenses/literary — four-UX-state contract.
 *
 * Pins that the Literary Lattice renders genuine loading / error (with a working
 * Retry) / empty / populated states against the real macro surface
 * (lensRun('literary', …) → POST /api/lens/run), plus a11y (the search input
 * carries an accessible name; loading is role=status; error is role=alert).
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, exactly the shape server/domains/literary.js returns. The
 * Canvas-rendering GraphView and the headless LensShell are stubbed so the test
 * stays focused on the page's own state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the page's single backend channel ────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── useLensData (persistence) mock — controllable annotations library ───────
const annotationCreate = vi.fn(() => Promise.resolve({ ok: true }));
let annotationItems: Array<Record<string, unknown>> = [];
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: annotationItems,
    total: annotationItems.length,
    isLoading: false,
    isError: false,
    create: annotationCreate,
    update: vi.fn(),
    remove: vi.fn(),
    refetch: vi.fn(),
  }),
}));

// ── headless shell + canvas graph: render-only stubs ────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/atlas/GraphView', () => ({
  GraphView: () => React.createElement('div', { 'data-testid': 'graph-view' }),
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

// Import AFTER mocks are registered.
import LiteraryLensPage from '@/app/lenses/literary/page';

// Helper: lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const HIT = {
  chunkId: 'c1', dtuId: 'dtu_lit_1', title: 'Hamlet', author: 'William Shakespeare', era: 'renaissance',
  chapter: 1, kind: 'verse', heading: 'The Question', snippet: 'To be, or not to be…', score: 0.42,
  provenance: { sourceId: 'gut_1524', dtuId: 'dtu_lit_1', title: 'Hamlet', author: 'William Shakespeare', license: 'public_domain', gutenbergId: '1524', url: 'https://gutenberg.org/1524' },
};

beforeEach(() => {
  lensRun.mockReset();
  annotationCreate.mockClear();
  annotationItems = [];
});

describe('literary lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while stats are in flight', async () => {
    // stats never resolves → page stays in the stats-loading state.
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'stats') return new Promise(() => {});
      return reply({ ok: true, nodes: [], edges: [] });
    });
    const { getByText, container } = render(<LiteraryLensPage />);
    await waitFor(() => expect(getByText(/Loading the lattice/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('EMPTY (corpus): shows the honest "no corpus ingested" CTA when chunks === 0', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'stats') return reply({ ok: true, sources: 0, chunks: 0, embedded: 0 });
      return reply({ ok: true, nodes: [], edges: [] });
    });
    const { getByText } = render(<LiteraryLensPage />);
    await waitFor(() => expect(getByText(/No corpus ingested yet/i)).toBeInTheDocument());
  });

  it('a11y: the search input carries an accessible name', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'stats' ? reply({ ok: true, sources: 1, chunks: 2, embedded: 0 }) : reply({ ok: true, nodes: [], edges: [] }));
    const { getByLabelText } = render(<LiteraryLensPage />);
    await waitFor(() => expect(getByLabelText('Literary search query')).toBeInTheDocument());
  });

  it('ERROR: a failed search shows role=alert + a working Retry that re-runs the search', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'stats') return reply({ ok: true, sources: 1, chunks: 99, embedded: 0 });
      if (name === 'search') return reply({ error: 'search_failed' }, false); // ok:false envelope
      return reply({ ok: true, nodes: [], edges: [] });
    });
    const { getByLabelText, getByText, container } = render(<LiteraryLensPage />);
    await waitFor(() => expect(getByLabelText('Literary search query')).toBeInTheDocument());

    fireEvent.change(getByLabelText('Literary search query'), { target: { value: 'conscience' } });
    await act(async () => { fireEvent.click(getByText('Search')); });

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/Search failed/i)).toBeInTheDocument();

    const searchCallsBefore = lensRun.mock.calls.filter((c) => c[1] === 'search').length;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'search').length).toBeGreaterThan(searchCallsBefore));
  });

  it('POPULATED: a successful search renders the hit, the honest badge, and provenance on select', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'stats') return reply({ ok: true, sources: 1, chunks: 2, embedded: 2 });
      if (name === 'search') return reply({ ok: true, results: [HIT], count: 1, semantic: true });
      if (name === 'semantic_graph') return reply({ ok: true, nodes: [{ id: 'c1', label: 'Hamlet', group: 'shakespeare', weight: 1 }], edges: [] });
      if (name === 'resonance') return reply({ ok: true, dtuId: 'dtu_lit_1', edges: [] });
      return reply({ ok: true, nodes: [], edges: [] });
    });
    const { getByLabelText, getByText, getAllByText } = render(<LiteraryLensPage />);
    await waitFor(() => expect(getByLabelText('Literary search query')).toBeInTheDocument());

    fireEvent.change(getByLabelText('Literary search query'), { target: { value: 'mortality' } });
    await act(async () => { fireEvent.click(getByText('Search')); });

    // Result rendered + honest "Grounded (hybrid)" badge (semantic === true).
    await waitFor(() => expect(getAllByText('Hamlet').length).toBeGreaterThan(0));
    expect(getByText('Grounded (hybrid)')).toBeInTheDocument();
    expect(getByText('1 result')).toBeInTheDocument();

    // Selecting the hit surfaces real provenance (license from the server).
    await act(async () => { fireEvent.click(getByText('To be, or not to be…')); });
    await waitFor(() => expect(getByText('public_domain')).toBeInTheDocument());
  });

  it('POPULATED (keyword): the badge reads "Keyword only" when the server semantic flag is false', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'stats') return reply({ ok: true, sources: 1, chunks: 2, embedded: 0 });
      if (name === 'search') return reply({ ok: true, results: [HIT], count: 1, semantic: false });
      if (name === 'semantic_graph') return reply({ ok: true, nodes: [], edges: [] });
      return reply({ ok: true, nodes: [], edges: [] });
    });
    const { getByLabelText, getByText } = render(<LiteraryLensPage />);
    await waitFor(() => expect(getByLabelText('Literary search query')).toBeInTheDocument());
    fireEvent.change(getByLabelText('Literary search query'), { target: { value: 'x' } });
    await act(async () => { fireEvent.click(getByText('Search')); });
    await waitFor(() => expect(getByText('Keyword only')).toBeInTheDocument());
  });

  it('PERSISTENCE: saving an annotation mints the DTU (annotate) AND persists a durable artifact (create)', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'stats') return reply({ ok: true, sources: 1, chunks: 2, embedded: 2 });
      if (name === 'search') return reply({ ok: true, results: [HIT], count: 1, semantic: true });
      if (name === 'semantic_graph') return reply({ ok: true, nodes: [], edges: [] });
      if (name === 'resonance') return reply({ ok: true, dtuId: 'dtu_lit_1', edges: [] });
      if (name === 'annotate') return reply({ ok: true, dtuId: 'dtu_note_1', citedChunkId: 'c1' });
      return reply({ ok: true, nodes: [], edges: [] });
    });
    const { getByLabelText, getByText } = render(<LiteraryLensPage />);
    await waitFor(() => expect(getByLabelText('Literary search query')).toBeInTheDocument());
    fireEvent.change(getByLabelText('Literary search query'), { target: { value: 'mortality' } });
    await act(async () => { fireEvent.click(getByText('Search')); });
    await waitFor(() => expect(getByText('To be, or not to be…')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('To be, or not to be…')); });

    const noteBox = getByLabelText('Annotation note');
    fireEvent.change(noteBox, { target: { value: 'A moral read of the soliloquy.' } });
    await act(async () => { fireEvent.click(getByText('Save note')); });

    await waitFor(() => expect(getByText(/DTU minted/i)).toBeInTheDocument());
    // annotate macro fired (mints derivative DTU) …
    expect(lensRun.mock.calls.some((c) => c[1] === 'annotate')).toBe(true);
    // … and the durable annotation artifact was created.
    expect(annotationCreate).toHaveBeenCalledTimes(1);
  });

  it('LIBRARY: previously-saved annotations render from the persistence store', async () => {
    annotationItems = [{ id: 'a1', title: 'Note: Hamlet', data: { title: 'Hamlet', author: 'William Shakespeare', note: 'Conscience as a brake.' } }];
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'stats' ? reply({ ok: true, sources: 1, chunks: 2, embedded: 2 }) : reply({ ok: true, nodes: [], edges: [] }));
    const { getByText } = render(<LiteraryLensPage />);
    await waitFor(() => expect(getByText('Your annotations')).toBeInTheDocument());
    expect(getByText(/Conscience as a brake/i)).toBeInTheDocument();
  });
});
