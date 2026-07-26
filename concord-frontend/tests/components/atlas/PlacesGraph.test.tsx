/**
 * PlacesGraph — clicking a graph node now shows real detail instead of
 * being a dead no-op (R1-2 wave 3 premium pass). `onNodeClick` was defined
 * on GraphView's props but PlacesGraph never passed it, so clicking a
 * saved-place or saved-list node in the atlas knowledge graph did nothing
 * beyond a cursor change. Fixed: clicking a place node shows its category
 * + which of the user's real lists contain it; clicking a list node shows
 * its real member places. Both are derived from data already fetched for
 * the graph itself — no second round-trip.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Stub GraphView with a minimal fake that exposes onNodeClick as clickable
// buttons — PlacesGraph's own detail-derivation logic is what this file
// tests, not GraphView's canvas rendering (covered separately).
vi.mock('@/components/atlas/GraphView', () => ({
  GraphView: ({ nodes, onNodeClick }: { nodes: Array<{ id: string; label?: string }>; onNodeClick?: (n: { id: string; label?: string }) => void }) => (
    <div data-testid="graph-view-stub">
      {nodes.map((n) => (
        <button key={n.id} onClick={() => onNodeClick?.(n)}>
          {n.label || n.id}
        </button>
      ))}
    </div>
  ),
}));

import { PlacesGraph } from '@/components/atlas/PlacesGraph';

describe('PlacesGraph — node click shows real detail', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  function mockData() {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'places-list') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              places: [
                { id: 'p1', name: 'The Coffee Spot', category: 'cafe' },
                { id: 'p2', name: 'Riverside Park', category: 'park' },
              ],
            },
          },
        });
      }
      if (action === 'lists-list') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              lists: [
                { id: 'l1', name: 'Weekend spots', placeIds: ['p1', 'p2'] },
              ],
            },
          },
        });
      }
      return Promise.resolve({ data: { ok: false } });
    });
  }

  it('clicking a place node shows its category and containing lists', async () => {
    mockData();
    render(<PlacesGraph />);

    await waitFor(() => expect(screen.getByTestId('graph-view-stub')).toBeInTheDocument());
    fireEvent.click(await screen.findByText('The Coffee Spot'));

    expect(await screen.findByText('cafe')).toBeInTheDocument();
    expect(screen.getByText(/In 1 list: Weekend spots/)).toBeInTheDocument();
  });

  it('clicking a list node shows its real member places', async () => {
    mockData();
    render(<PlacesGraph />);

    await waitFor(() => expect(screen.getByTestId('graph-view-stub')).toBeInTheDocument());
    fireEvent.click(await screen.findByText('Weekend spots'));

    expect(await screen.findByText(/2 places: The Coffee Spot, Riverside Park/)).toBeInTheDocument();
  });

  it('a place with no lists says so honestly instead of a fabricated count', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'places-list') {
        return Promise.resolve({ data: { ok: true, result: { places: [{ id: 'p1', name: 'Lonely Place', category: 'misc' }] } } });
      }
      if (action === 'lists-list') {
        return Promise.resolve({ data: { ok: true, result: { lists: [] } } });
      }
      return Promise.resolve({ data: { ok: false } });
    });
    render(<PlacesGraph />);

    await waitFor(() => expect(screen.getByTestId('graph-view-stub')).toBeInTheDocument());
    fireEvent.click(await screen.findByText('Lonely Place'));

    expect(await screen.findByText('Not in any list yet.')).toBeInTheDocument();
  });
});
