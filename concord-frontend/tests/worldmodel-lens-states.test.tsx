/**
 * /lenses/worldmodel — four-UX-state contract (digital-twin / world-model surface).
 *
 * Pins that the Worldmodel lens renders genuine loading / error (with a working
 * Retry) / empty / populated states against the real macro surface
 * (lensRun('worldmodel', '<action>', …) → POST /api/lens/run that the
 * LENS_ACTIONS handlers in server/domains/worldmodel.js answer), plus a11y
 * (shared loading is role=status, a failed shared fetch surfaces role=alert with
 * a WORKING Retry — never a silently-empty page).
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, in exactly the envelope shape the macros return
 * ({ data: { ok, result } }). The headless LensShell + the self-contained child
 * components (GraphCanvas, ChartKit, WorldModelArxiv) are stubbed so the test
 * stays on the page's own shared-query state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── lensRun mock — the page's single backend channel ────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── headless shell + lens chrome: render-only stubs ─────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// Self-contained children that do their own work: stub inert / minimal so the
// test is scoped to the page's shared-query state machine.
vi.mock('@/components/worldmodel/WorldModelArxiv', () => ({ WorldModelArxiv: () => null }));
vi.mock('@/components/worldmodel/GraphCanvas', () => ({
  GraphCanvas: ({ nodes, edges }: { nodes: unknown[]; edges: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'graph-canvas' }, `${nodes.length}n/${edges.length}e`),
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }) }));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
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
import WorldmodelLensPage from '@/app/lenses/worldmodel/page';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorldmodelLensPage />
    </QueryClientProvider>,
  );
}

// lensRun returns an axios-shaped { data: { ok, result } }; the page's run()
// helper throws on data.ok === false.
function ok(result: Record<string, unknown>) {
  return Promise.resolve({ data: { ok: true, result } });
}

// Route a reply per worldmodel action so the four shared queries each resolve.
function routed(map: Record<string, Record<string, unknown>>, fallback: Record<string, unknown> = {}) {
  return (_domain: string, action: string) => ok(map[action] ?? fallback);
}

const EMPTY = {
  wm_status: { entities: 0, relations: 0, types: 0, snapshots: 0, scenarios: 0, simulations: 0, ingestEvents: 0 },
  wm_list_entities: { entities: [], total: 0 },
  wm_list_relations: { relations: [], total: 0 },
  list_entity_types: { types: [], total: 0 },
  graph: { nodes: [], edges: [], nodeCount: 0, edgeCount: 0 },
};

const POPULATED = {
  wm_status: { entities: 2, relations: 1, types: 1, snapshots: 0, scenarios: 0, simulations: 0, ingestEvents: 0 },
  wm_list_entities: {
    entities: [
      { id: 'ent_a', name: 'Reactor', type: 'system', attributes: { value: 120 } },
      { id: 'ent_b', name: 'Grid', type: 'system', attributes: { value: 80 } },
    ],
    total: 2,
  },
  wm_list_relations: {
    relations: [{ id: 'rel_1', from: 'ent_a', to: 'ent_b', type: 'feeds', weight: 0.5 }],
    total: 1,
  },
  list_entity_types: { types: [{ name: 'system', fields: [{ key: 'value', kind: 'number' }] }], total: 1 },
  graph: {
    nodes: [
      { id: 'ent_a', name: 'Reactor', type: 'system', attributes: { value: 120 }, degree: 1 },
      { id: 'ent_b', name: 'Grid', type: 'system', attributes: { value: 80 }, degree: 1 },
    ],
    edges: [{ id: 'rel_1', from: 'ent_a', to: 'ent_b', type: 'feeds', weight: 0.5 }],
    nodeCount: 2,
    edgeCount: 1,
  },
};

beforeEach(() => { lensRun.mockReset(); });

describe('worldmodel lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the shared queries are in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    let view: ReturnType<typeof render>;
    await act(async () => { view = renderPage(); });
    await waitFor(() => {
      const statuses = view!.container.querySelectorAll('[role="status"]');
      expect(statuses.length).toBeGreaterThan(0);
    });
    expect(view!.getAllByText(/Loading/i).length).toBeGreaterThan(0);
  });

  it('EMPTY: renders the honest empty graph + "no entities" CTA when the model is empty', async () => {
    lensRun.mockImplementation(routed(EMPTY));
    const { getByTestId, getByText } = renderPage();
    await waitFor(() => expect(getByTestId('graph-canvas')).toBeInTheDocument());
    // empty graph: 0 nodes / 0 edges
    expect(getByTestId('graph-canvas').textContent).toContain('0n/0e');
    expect(getByText(/0 nodes · 0 edges/i)).toBeInTheDocument();
  });

  it('ERROR: a failed shared fetch shows role=alert + a working Retry that re-fetches and recovers', async () => {
    let fail = true;
    lensRun.mockImplementation((_d: string, action: string) => {
      if (fail) return Promise.resolve({ data: { ok: false, error: 'STATE unavailable' } });
      return ok(POPULATED[action as keyof typeof POPULATED] ?? {});
    });
    const { container, getByText } = renderPage();
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/STATE unavailable/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    // recovers — the alert clears and the populated graph mounts
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeFalsy());
    await waitFor(() => expect(getByText(/2 nodes · 1 edges/i)).toBeInTheDocument());
  });

  it('POPULATED: renders the real header rollups + the real graph rows from the macros', async () => {
    lensRun.mockImplementation(routed(POPULATED));
    const { getByTestId, getByText } = renderPage();
    await waitFor(() => expect(getByTestId('graph-canvas')).toBeInTheDocument());
    // graph carries the real node/edge counts from the macro output
    expect(getByTestId('graph-canvas').textContent).toContain('2n/1e');
    expect(getByText(/2 nodes · 1 edges/i)).toBeInTheDocument();
    // header rollups read straight from wm_status
    expect(getByText(/2 entities/i)).toBeInTheDocument();
    expect(getByText(/1 relations/i)).toBeInTheDocument();
  });

  it('a11y: the section tab controls are real buttons with accessible text', async () => {
    lensRun.mockImplementation(routed(EMPTY));
    const { getByRole } = renderPage();
    await waitFor(() => expect(getByRole('button', { name: /Entities/i })).toBeInTheDocument());
    expect(getByRole('button', { name: /Relations/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /Simulate/i })).toBeInTheDocument();
  });

  it('error surface uses role=alert (a swallowed failure is NOT allowed to render as an empty page)', async () => {
    lensRun.mockImplementation(() => Promise.resolve({ data: { ok: false, error: 'graph backend exploded' } }));
    const { container, getByText } = renderPage();
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/graph backend exploded/i)).toBeInTheDocument();
  });
});
