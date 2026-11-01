/**
 * MindMapBuilder — #1706 rework behaviour tests against a STATEFUL fake
 * lensRun that mirrors the graph domain's map semantics (the server
 * suite pins the real macros; this pins that the builder actually
 * drives them): rename a map, import with per-row errors, the unlinked
 * (orphans) view, undo after delete, and edge label/type editing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

interface FNode { id: string; label: string; notes: string; central: boolean; props?: Record<string, unknown> }
interface FEdge { id: string; from: string; to: string; label: string; type?: string }
interface FMap { id: string; title: string; description?: string; nodes: FNode[]; edges: FEdge[]; trash?: { kind: string; node?: FNode; edge?: FEdge; edges?: FEdge[] }[] }

let seq = 0;
const id = (p: string) => `${p}_${++seq}`;
const store: { maps: FMap[] } = { maps: [] };

function seed() {
  store.maps = [{
    id: 'mp_1', title: 'Systems', description: '',
    nodes: [
      { id: 'nd_c', label: 'Systems', notes: '', central: true },
      { id: 'nd_a', label: 'Alpha', notes: '', central: false },
      { id: 'nd_solo', label: 'Solo', notes: '', central: false },
    ],
    edges: [{ id: 'ed_1', from: 'nd_c', to: 'nd_a', label: 'feeds', type: '' }],
    trash: [],
  }];
}

const lensRunMock = vi.fn(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
  const wrap = (data: unknown) => ({ data });
  if (domain === 'thread') return wrap({ ok: true, result: { drafts: [] } });
  const map = store.maps.find((m) => m.id === (input.id || input.mapId));
  switch (action) {
    case 'map-list':
      return wrap({ ok: true, result: { maps: store.maps.map((m) => ({ id: m.id, title: m.title, nodeCount: m.nodes.length, edgeCount: m.edges.length })) } });
    case 'graph-dashboard':
      return wrap({ ok: true, result: { maps: store.maps.length, totalNodes: 3, totalEdges: 1 } });
    case 'map-detail':
      return map ? wrap({ ok: true, result: { map } }) : wrap({ ok: false, error: 'map not found' });
    case 'map-metrics': {
      if (!map) return wrap({ ok: false, error: 'map not found' });
      return wrap({ ok: true, result: { nodeCount: map.nodes.length, edgeCount: map.edges.length, avgDegree: 1, mostConnected: null, isolatedNodes: 1 } });
    }
    case 'map-update': {
      if (!map) return wrap({ ok: false, error: 'map not found' });
      if (input.title != null) map.title = String(input.title);
      if (input.description != null) map.description = String(input.description);
      return wrap({ ok: true, result: { map } });
    }
    case 'node-add': {
      if (!map) return wrap({ ok: false, error: 'map not found' });
      const node: FNode = { id: id('nd'), label: String(input.label), notes: '', central: false };
      map.nodes.push(node);
      let edge: FEdge | null = null;
      if (input.parentId) { edge = { id: id('ed'), from: String(input.parentId), to: node.id, label: '' }; map.edges.push(edge); }
      return wrap({ ok: true, result: { node, edge } });
    }
    case 'node-delete': {
      if (!map) return wrap({ ok: false, error: 'map not found' });
      const node = map.nodes.find((n) => n.id === input.nodeId);
      if (!node) return wrap({ ok: false, error: 'node not found' });
      const removedEdges = map.edges.filter((e) => e.from === node.id || e.to === node.id);
      map.nodes = map.nodes.filter((n) => n.id !== node.id);
      map.edges = map.edges.filter((e) => e.from !== node.id && e.to !== node.id);
      (map.trash ||= []).unshift({ kind: 'node', node, edges: removedEdges });
      return wrap({ ok: true, result: { deleted: node.id, undoable: true } });
    }
    case 'map-undo-delete': {
      if (!map) return wrap({ ok: false, error: 'map not found' });
      const t = (map.trash || [])[0];
      if (!t) return wrap({ ok: false, error: 'nothing to undo' });
      map.trash!.shift();
      if (t.kind === 'node' && t.node) {
        map.nodes.push(t.node);
        for (const e of t.edges || []) map.edges.push(e);
        return wrap({ ok: true, result: { restored: 'node', node: t.node, restoredEdges: (t.edges || []).length } });
      }
      return wrap({ ok: true, result: { restored: 'edge', edge: t.edge } });
    }
    case 'edge-add': {
      if (!map) return wrap({ ok: false, error: 'map not found' });
      const edge: FEdge = { id: id('ed'), from: String(input.fromNodeId), to: String(input.toNodeId), label: String(input.label || ''), type: String(input.type || '') };
      map.edges.push(edge);
      return wrap({ ok: true, result: { edge } });
    }
    case 'edge-delete': {
      if (!map) return wrap({ ok: false, error: 'map not found' });
      map.edges = map.edges.filter((e) => e.id !== input.edgeId);
      return wrap({ ok: true, result: { deleted: input.edgeId, undoable: true } });
    }
    case 'edge-update': {
      if (!map) return wrap({ ok: false, error: 'map not found' });
      const edge = map.edges.find((e) => e.id === input.edgeId);
      if (!edge) return wrap({ ok: false, error: 'edge not found' });
      if (input.label != null) edge.label = String(input.label);
      if (input.type != null) edge.type = String(input.type);
      return wrap({ ok: true, result: { edge } });
    }
    case 'node-update': {
      if (!map) return wrap({ ok: false, error: 'map not found' });
      const node = map.nodes.find((n) => n.id === input.nodeId);
      if (!node) return wrap({ ok: false, error: 'node not found' });
      if (input.props) node.props = { ...(node.props || {}), ...(input.props as Record<string, unknown>) };
      return wrap({ ok: true, result: { node } });
    }
    case 'map-orphans': {
      if (!map) return wrap({ ok: false, error: 'map not found' });
      const deg = new Map(map.nodes.map((n) => [n.id, 0]));
      for (const e of map.edges) { deg.set(e.from, (deg.get(e.from) || 0) + 1); deg.set(e.to, (deg.get(e.to) || 0) + 1); }
      const orphans = map.nodes.filter((n) => deg.get(n.id) === 0);
      return wrap({ ok: true, result: { orphans, count: orphans.length } });
    }
    case 'map-import': {
      const lines = String(input.content || '').split('\n').filter((l) => l.trim());
      const errors: { row: number; error: string }[] = [];
      const nodes: FNode[] = [];
      lines.slice(1).forEach((l, i) => {
        const label = l.split(',')[0].trim();
        if (!label) { errors.push({ row: i + 2, error: 'node label required' }); return; }
        nodes.push({ id: id('nd'), label, notes: '', central: nodes.length === 0 });
      });
      const m: FMap = { id: id('mp'), title: String(input.title || 'Imported map'), nodes, edges: [], trash: [] };
      store.maps.push(m);
      return wrap({ ok: true, result: { map: m, imported: { nodes: nodes.length, edges: 0 }, errors } });
    }
    case 'pathFind':
      return wrap({ ok: true, result: { path: null, message: 'not connected' } });
    default:
      return wrap({ ok: true, result: {} });
  }
});

vi.mock('@/lib/api/client', () => ({
  lensRun: (domain: string, action: string, input?: Record<string, unknown>) => lensRunMock(domain, action, input),
}));

import { MindMapBuilder } from '@/components/graph/MindMapBuilder';

async function openSeeded() {
  render(<MindMapBuilder />);
  fireEvent.click(await screen.findByRole('button', { name: /Systems/ }));
  await screen.findByText('Cross-links');
}

describe('MindMapBuilder rework flows', () => {
  beforeEach(() => {
    seq = 0;
    seed();
    lensRunMock.mockClear();
  });

  it('renames the active map through map-update', async () => {
    await openSeeded();
    fireEvent.click(screen.getByRole('button', { name: 'Edit map' }));
    const title = screen.getByLabelText('Map title');
    fireEvent.change(title, { target: { value: 'Renamed Systems' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Renamed Systems/ })).toBeTruthy());
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'map-update')).toBe(true);
  });

  it('imports a CSV and shows the per-row error for the bad row', async () => {
    await openSeeded();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.change(screen.getByLabelText('Import content'), {
      target: { value: 'label,notes\nOne,first\nTwo,second\n,missing' },
    });
    const importButtons = screen.getAllByRole('button', { name: 'Import' });
    fireEvent.click(importButtons[importButtons.length - 1]);
    await screen.findByText(/Imported 2 nodes/);
    expect(screen.getByText(/Row 4: node label required/)).toBeTruthy();
  });

  it('shows the unlinked nodes and only them', async () => {
    await openSeeded();
    fireEvent.click(screen.getByRole('button', { name: 'Show unlinked nodes' }));
    await screen.findByText('Unlinked nodes');
    const panel = screen.getByText('Unlinked nodes').closest('div');
    expect(panel?.textContent).toContain('Solo');
    expect(panel?.textContent).not.toContain('Alpha');
  });

  it('shows the §5f orphan-roundup line only once the panel is actually cleared', async () => {
    await openSeeded();
    fireEvent.click(screen.getByRole('button', { name: 'Show unlinked nodes' }));
    await screen.findByText('Unlinked nodes');
    // Solo is still unlinked — the line is not earned yet.
    expect(screen.queryByText('Every thought is connected.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide unlinked' }));
    // Link Solo to the central node in the store, then re-open the panel.
    store.maps[0].edges.push({ id: 'ed_2', from: 'nd_c', to: 'nd_solo', label: '', type: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Show unlinked nodes' }));
    await screen.findByText('Every thought is connected.');
  });

  it('undoes a node deletion', async () => {
    await openSeeded();
    // Alpha is a branch of the central node; delete it via its row button
    // (the first "Alpha" text is the tree row; it also appears in the
    // cross-links list until its edge is deleted with it).
    const alphaRow = screen.getAllByText('Alpha')[0].closest('div');
    const del = alphaRow?.querySelector('button[aria-label="Delete"]') as HTMLButtonElement;
    fireEvent.click(del);
    await waitFor(() => expect(screen.queryAllByText('Alpha')).toHaveLength(0));
    fireEvent.click(screen.getByRole('button', { name: 'Undo delete' }));
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    expect(screen.getByRole('status').textContent).toContain('Restored');
  });

  it('typing a branch name keeps focus in the builder and grows the map (F2)', async () => {
    await openSeeded();
    const input = screen.getAllByPlaceholderText('+ branch')[0] as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'PR2 Branch One' } });
    // The F2 bug remounted the branch tree on every keystroke (the row
    // component was declared inside the render body), throwing focus
    // to the document where the page's digit shortcuts switched the
    // lens to Explorer. The input node must survive the change, still
    // focused, with the typed text intact.
    expect(screen.getAllByPlaceholderText('+ branch')[0]).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('PR2 Branch One');
    expect(screen.getByText('Mind Map Builder')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByText('PR2 Branch One').length).toBeGreaterThan(0));
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'node-add' && (c[2] as { label?: string }).label === 'PR2 Branch One')).toBe(true);
  });

  it('edits a cross-link label and type through edge-update', async () => {
    await openSeeded();
    fireEvent.click(screen.getByRole('button', { name: 'Edit link' }));
    fireEvent.change(screen.getByLabelText('Link label'), { target: { value: 'blocks' } });
    fireEvent.change(screen.getAllByLabelText('Link type')[0], { target: { value: 'control' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('(blocks)')).toBeTruthy());
    expect(screen.getByText('control')).toBeTruthy();
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'edge-update')).toBe(true);
  });
});
