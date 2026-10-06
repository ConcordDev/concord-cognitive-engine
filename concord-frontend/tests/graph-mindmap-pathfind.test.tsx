/** MindMapBuilder — "How are these connected?" runs graph.pathFind over the open map's edges. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

import { MindMapBuilder } from '@/components/graph/MindMapBuilder';

const MAP = {
  id: 'm1', title: 'Physics',
  nodes: [
    { id: 'n1', label: 'Energy', notes: '', central: true },
    { id: 'n2', label: 'Work', notes: '', central: false },
    { id: 'n3', label: 'Force', notes: '', central: false },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '' }, { id: 'e2', from: 'n2', to: 'n3', label: '' }],
};

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) => {
    const r: Record<string, unknown> = {
      'map-list': { maps: [{ id: 'm1', title: 'Physics', nodeCount: 3, edgeCount: 2 }] },
      'graph-dashboard': { maps: 1, totalNodes: 3, totalEdges: 2 },
      'map-detail': { map: MAP },
      'map-metrics': { nodeCount: 3, edgeCount: 2, avgDegree: 1.33, mostConnected: null, isolatedNodes: 0 },
      pathFind: { found: true, path: ['n1', 'n2', 'n3'], hopCount: 2 },
    };
    return Promise.resolve({ data: { ok: true, result: r[action] } });
  });
});

describe('MindMapBuilder path finder', () => {
  it('sends the map edges undirected and renders the labelled path', async () => {
    render(<MindMapBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /physics/i }));
    await screen.findByLabelText('Path start');
    fireEvent.change(screen.getByLabelText('Path start'), { target: { value: 'n1' } });
    fireEvent.change(screen.getByLabelText('Path end'), { target: { value: 'n3' } });
    fireEvent.click(screen.getByRole('button', { name: /find path/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('graph', 'pathFind', {
      edges: [{ source: 'n1', target: 'n2' }, { source: 'n2', target: 'n3' }], from: 'n1', to: 'n3', directed: false,
    }));
    await screen.findByText(/2 steps/);
  });
});
