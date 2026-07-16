/* eslint-disable @typescript-eslint/no-explicit-any */
// Tests for the "Merge Nodes" tab added to GraphParityPanel — the real UI
// for graph.map-merge-nodes (the honest replacement for the ungrounded
// graph.merge sandbox macro). Covers: two-node selection, the destructive
// confirmation step, the macro being called with the correct real node/map
// ids, the graph view reflecting the merge afterward (edges re-pointed +
// deduped, losing node gone), and honest error surfacing on macro failure.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── Mock lensRun routing ────────────────────────────────────────────────────
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  __esModule: true,
  lensRun: (domain: string, action: string, params: Record<string, unknown> = {}) =>
    lensRunMock(domain, action, params),
}));

// ── Mock lucide-react ────────────────────────────────────────────────────────
vi.mock('lucide-react', async () => {
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    __esModule: true,
    Workflow: make('Workflow'), Loader2: make('Loader2'), Crosshair: make('Crosshair'),
    Filter: make('Filter'), Palette: make('Palette'), Clock: make('Clock'),
    LayoutGrid: make('LayoutGrid'), RefreshCw: make('RefreshCw'), Download: make('Download'),
    Trash2: make('Trash2'), Plus: make('Plus'), Link2: make('Link2'), GitMerge: make('GitMerge'),
  };
});

import { GraphParityPanel } from '@/components/graph/GraphParityPanel';

const okResult = (result: any = {}) => ({ data: { ok: true, result, error: null } });
const errResult = (error = 'Action failed') => ({ data: { ok: false, result: null, error } });

// ── Fixture: a real 3-node map (central "Root" + "Alpha" + "Beta") with two
// edges (Root->Alpha, Root->Beta). Merging Alpha into Beta re-points
// Root->Alpha onto Beta, which collides with the existing Root->Beta edge —
// so a correct merge leaves exactly one edge (Root->Beta) and removes Alpha.
function makeMapState() {
  return {
    id: 'm1',
    title: 'Test Map',
    nodes: [
      { id: 'c1', label: 'Root', central: true },
      { id: 'n1', label: 'Alpha', notes: 'alpha notes' },
      { id: 'n2', label: 'Beta' },
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 'n1' },
      { id: 'e2', from: 'c1', to: 'n2' },
    ],
  };
}

let mapState: ReturnType<typeof makeMapState>;
let routeHandlers: Record<string, (params: any) => any>;

function installDefaultHandlers() {
  mapState = makeMapState();
  routeHandlers = {
    'map-list': () =>
      okResult({ maps: [{ id: mapState.id, title: mapState.title, nodeCount: mapState.nodes.length, edgeCount: mapState.edges.length }] }),
    'map-detail': () => okResult({ map: mapState }),
    'map-merge-nodes': (p: any) => {
      const { sourceNodeId, targetNodeId } = p;
      if (!sourceNodeId || !targetNodeId) return errResult('sourceNodeId and targetNodeId required');
      if (sourceNodeId === targetNodeId) return errResult('cannot merge a node with itself');
      const source = mapState.nodes.find((n) => n.id === sourceNodeId);
      const target = mapState.nodes.find((n) => n.id === targetNodeId);
      if (!source || !target) return errResult('both nodes must exist in the map');
      // Real re-pointing + dedup simulation, mirroring the backend macro.
      let edgesRepointed = 0;
      for (const e of mapState.edges) {
        if (e.from === sourceNodeId) { e.from = targetNodeId; edgesRepointed++; }
        if (e.to === sourceNodeId) { e.to = targetNodeId; edgesRepointed++; }
      }
      const beforeSelfLoop = mapState.edges.length;
      mapState.edges = mapState.edges.filter((e) => e.from !== e.to);
      const selfLoopsDropped = beforeSelfLoop - mapState.edges.length;
      const seen = new Set<string>();
      const deduped: typeof mapState.edges = [];
      let duplicateEdgesRemoved = 0;
      for (const e of mapState.edges) {
        const key = `${e.from}::${e.to}`;
        if (seen.has(key)) { duplicateEdgesRemoved++; continue; }
        seen.add(key);
        deduped.push(e);
      }
      mapState.edges = deduped;
      mapState.nodes = mapState.nodes.filter((n) => n.id !== sourceNodeId);
      return okResult({
        mapId: mapState.id, keptNodeId: targetNodeId, removedNodeId: sourceNodeId,
        node: target, edgesRepointed, duplicateEdgesRemoved, selfLoopsDropped,
        nodeCount: mapState.nodes.length, edgeCount: mapState.edges.length,
      });
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installDefaultHandlers();
  lensRunMock.mockImplementation((_domain: string, action: string, params: any) => {
    const h = routeHandlers[action];
    if (!h) return Promise.resolve(okResult({}));
    return Promise.resolve(h(params));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderLoadedWithMapSelected() {
  render(<GraphParityPanel />);
  const mapSelect = await screen.findByDisplayValue('Select a mind map…');
  fireEvent.change(mapSelect, { target: { value: 'm1' } });
  await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('graph', 'map-detail', { id: 'm1' }));
}

function openMergeTab() {
  fireEvent.click(screen.getByRole('button', { name: 'Merge Nodes' }));
}

describe('GraphParityPanel — Merge Nodes tab', () => {
  it('lets the user select two real nodes to merge', async () => {
    await renderLoadedWithMapSelected();
    openMergeTab();

    const sourceSel = screen.getByDisplayValue('Node to merge (removed)…');
    const targetSel = screen.getByDisplayValue('Node to keep (survives)…');
    expect(sourceSel).toBeDefined();
    expect(targetSel).toBeDefined();

    fireEvent.change(sourceSel, { target: { value: 'n1' } });
    fireEvent.change(targetSel, { target: { value: 'n2' } });

    expect(screen.getByDisplayValue('Alpha')).toBeDefined();
    expect(screen.getByDisplayValue('Beta')).toBeDefined();
  });

  it('requires confirmation before calling the merge macro — a destructive action is never one-click', async () => {
    await renderLoadedWithMapSelected();
    openMergeTab();
    fireEvent.change(screen.getByDisplayValue('Node to merge (removed)…'), { target: { value: 'n1' } });
    fireEvent.change(screen.getByDisplayValue('Node to keep (survives)…'), { target: { value: 'n2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    // Confirmation copy names both real nodes by label, not id.
    expect(screen.getByText(/Merge “Alpha” into “Beta”\?/)).toBeDefined();
    // The macro must NOT have fired yet — confirming is a separate step.
    expect(lensRunMock).not.toHaveBeenCalledWith('graph', 'map-merge-nodes', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Merge “Alpha” into “Beta”\?/)).toBeNull();
    expect(lensRunMock).not.toHaveBeenCalledWith('graph', 'map-merge-nodes', expect.anything());
  });

  it('confirming calls map-merge-nodes with the correct real mapId/sourceNodeId/targetNodeId, and the view reflects the merge', async () => {
    await renderLoadedWithMapSelected();
    openMergeTab();
    fireEvent.change(screen.getByDisplayValue('Node to merge (removed)…'), { target: { value: 'n1' } });
    fireEvent.change(screen.getByDisplayValue('Node to keep (survives)…'), { target: { value: 'n2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }));

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('graph', 'map-merge-nodes', {
        mapId: 'm1', sourceNodeId: 'n1', targetNodeId: 'n2',
      }),
    );

    // The macro's real result is surfaced (edge re-pointed → collided with an
    // existing edge → deduped down to 1).
    await waitFor(() => expect(screen.getByText(/1 edge\(s\) re-pointed/)).toBeDefined());
    expect(screen.getByText(/1 duplicate\(s\) removed/)).toBeDefined();

    // The view refetches: Alpha (the losing node) is gone from the node
    // selects, and the footer node/edge counts reflect the real post-merge
    // state (2 nodes, 1 edge — Root->Beta only).
    await waitFor(() => expect(screen.getByText(/2 nodes · 1 edges/)).toBeDefined());
    expect(screen.queryByDisplayValue('Alpha')).toBeNull();
  });

  it('surfaces an honest error when the merge macro rejects the request, without touching the graph view', async () => {
    routeHandlers['map-merge-nodes'] = () => errResult('cannot merge a node with itself');
    await renderLoadedWithMapSelected();
    openMergeTab();
    fireEvent.change(screen.getByDisplayValue('Node to merge (removed)…'), { target: { value: 'n1' } });
    fireEvent.change(screen.getByDisplayValue('Node to keep (survives)…'), { target: { value: 'n2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }));

    await waitFor(() => expect(screen.getByText('cannot merge a node with itself')).toBeDefined());
    // No fabricated success summary — the merge-result panel never renders.
    expect(screen.queryByText(/edge\(s\) re-pointed/)).toBeNull();
    // Nothing was actually merged: both nodes are still selectable.
    expect(screen.getByDisplayValue('Alpha')).toBeDefined();
  });

  it('disables picking the same node as both source and target', async () => {
    await renderLoadedWithMapSelected();
    openMergeTab();
    fireEvent.change(screen.getByDisplayValue('Node to merge (removed)…'), { target: { value: 'n1' } });
    const targetSel = screen.getByDisplayValue('Node to keep (survives)…') as HTMLSelectElement;
    const alphaOptionInTarget = Array.from(targetSel.options).find((o) => o.value === 'n1');
    expect(alphaOptionInTarget?.disabled).toBe(true);
  });
});
