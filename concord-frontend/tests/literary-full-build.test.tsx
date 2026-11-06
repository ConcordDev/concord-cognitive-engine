/**
 * literary-full-build.test.tsx — build(literary) pins.
 *
 * (1) F1's surface half: a completed search over an EMPTY corpus renders an
 *     explicit outcome ("No passages can match yet — the corpus isn't
 *     ingested") instead of the walked silence (the results region used to be
 *     gated on !corpusEmpty, so the search completed into nothing).
 * (2) F7(ii): one submission, ONE error surface — a rejected search never
 *     fires the semantic_graph call (the parallel pair both rejected and the
 *     toast fired twice).
 * (3) S2: the Lattice asks for the literary-scoped graph and a node click
 *     opens its detail (label + provenance + connection count).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], total: 0, isLoading: false, isError: false, create: vi.fn(), update: vi.fn(), remove: vi.fn(), refetch: vi.fn() }),
}));
vi.mock('@/components/atlas/GraphView', () => ({
  GraphView: (props: { nodes: Array<{ id: string; label?: string }>; onNodeClick?: (n: unknown) => void }) =>
    React.createElement('div', { 'data-testid': 'graph-view' },
      (props.nodes || []).map((n) => React.createElement('button', {
        key: n.id, type: 'button', 'data-testid': `node-${n.id}`,
        onClick: () => props.onNodeClick?.(n),
      }, n.label || n.id))),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, { get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]) });
});

import { SearchPanel } from '@/components/literary/SearchPanel';
import { LatticePanel } from '@/components/literary/LatticePanel';

function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

beforeEach(() => { lensRun.mockReset(); });

describe('build(literary)', () => {
  it('a search over the empty corpus renders the corpus-empty outcome, not silence', async () => {
    lensRun.mockImplementation((_d: string, verb: string) => {
      if (verb === 'stats') return reply({ sources: 0, chunks: 0, embedded: 0 });
      if (verb === 'search') return reply({ ok: true, results: [], count: 0, semantic: false });
      if (verb === 'semantic_graph') return reply({ ok: true, nodes: [], edges: [] });
      return reply({ ok: true });
    });
    render(<SearchPanel />);
    const input = await screen.findByLabelText('Literary search query');
    fireEvent.change(input, { target: { value: 'mortality and conscience' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    await waitFor(() => expect(screen.getByText(/No passages can match yet/)).toBeTruthy());
    expect(screen.queryByText(/No passages matched\. Try broader terms/)).toBeNull();
  });

  it('a rejected search fires ONE error surface — the graph call never runs', async () => {
    lensRun.mockImplementation((_d: string, verb: string) => {
      if (verb === 'stats') return reply({ sources: 3, chunks: 40, embedded: 40 });
      if (verb === 'search') return Promise.reject(new Error('Input too long: input.query: 775 chars (max 200)'));
      return reply({ ok: true });
    });
    render(<SearchPanel />);
    const input = await screen.findByLabelText('Literary search query');
    fireEvent.change(input, { target: { value: 'x'.repeat(300) } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const graphCalls = lensRun.mock.calls.filter((c) => c[1] === 'semantic_graph');
    expect(graphCalls.length).toBe(0);
  });

  it('the Lattice requests the literary-scoped graph and a node opens its detail', async () => {
    lensRun.mockImplementation((_d: string, verb: string, input?: { dtuId?: string }) => {
      if (verb === 'resonance_graph') {
        return reply({
          ok: true,
          nodes: [
            { id: 'dtu_lit_1', label: 'The Prince · 1', group: 'literary', weight: 0.9 },
            { id: 'dtu_game_1', label: 'Faction power sim', group: 'game', weight: 0.4 },
          ],
          edges: [{ source: 'dtu_lit_1', target: 'dtu_game_1', kind: 'resonance' }],
        });
      }
      if (verb === 'provenance' && input?.dtuId === 'dtu_lit_1') {
        return reply({ ok: true, provenance: { title: 'The Prince', author: 'Machiavelli', license: 'public_domain', gutenbergId: '1232' } });
      }
      return reply({ ok: false, reason: 'not_found' });
    });
    render(<LatticePanel />);
    const node = await screen.findByTestId('node-dtu_lit_1');
    const graphCall = lensRun.mock.calls.find((c) => c[1] === 'resonance_graph');
    expect((graphCall?.[2] as { scope?: string })?.scope).toBe('literary');
    expect(screen.getByText(/anchored on this corpus/)).toBeTruthy();
    fireEvent.click(node);
    await waitFor(() => expect(screen.getByTestId('lattice-node-detail')).toBeTruthy());
    expect(screen.getByText(/Literary passage · Machiavelli/)).toBeTruthy();
    expect(screen.getByText(/1 connection in this graph/)).toBeTruthy();
  });
});
