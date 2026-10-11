import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeyboardProvider } from '@/lib/keyboard';

const paginated = vi.fn();
const getDtu = vi.fn();
const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    dtus: {
      paginated: (...args: unknown[]) => paginated(...args),
      get: (...args: unknown[]) => getDtu(...args),
    },
  },
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('@/components/lists/VirtualDTUList', () => ({
  VirtualDTUList: ({ dtus, onSelect }: { dtus: Array<{ id: string; title: string; createdAt: Date }>; onSelect: (d: { id: string }) => void }) => (
    <ul>
      {dtus.map((d) => (
        <li key={d.id}>
          <button type="button" onClick={() => onSelect(d)}>{d.title}</button>
          <time>{Number.isNaN(d.createdAt?.getTime?.()) ? '' : d.createdAt.toISOString()}</time>
        </li>
      ))}
    </ul>
  ),
}));

vi.mock('@/components/dtu/DTUDetailView', () => ({
  DTUDetailView: ({ dtuId }: { dtuId: string }) => <div>detail {dtuId}</div>,
}));

vi.mock('@/components/dtu/DTUQuickCreate', () => ({
  DTUQuickCreate: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" onClick={onSuccess}>create form</button>
  ),
}));

import { BrowserPanel } from '@/components/dtus/BrowserPanel';

const row = {
  id: 'dtu-1',
  title: 'Helix note',
  summary: 'a summary',
  content: 'body',
  tier: 'regular',
  tags: ['lattice'],
  timestamp: '2020-01-02T03:04:05.000Z',
  createdAt: '2020-01-02T03:04:05.000Z',
  domain: 'notes',
  parents: [],
  children: [],
};

function renderPanel(props?: { initialQuery?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <KeyboardProvider>
        <BrowserPanel {...props} />
      </KeyboardProvider>
    </QueryClientProvider>,
  );
}

describe('BrowserPanel', () => {
  beforeEach(() => {
    paginated.mockReset();
    getDtu.mockReset();
    lensRun.mockReset();
    paginated.mockResolvedValue({
      data: {
        ok: true,
        items: [row],
        pagination: { total: 40, hasNext: true },
      },
    });
  });

  it('shows the page count, creation time, and a New DTU action', async () => {
    renderPanel({ initialQuery: 'helix' });
    expect(await screen.findByText('Helix note')).toBeTruthy();
    expect(screen.getAllByText('Showing 1–20 of 40').length).toBeGreaterThan(0);
    expect(screen.queryByText(/1--20/)).toBeNull();
    expect(screen.queryByText('Total DTUs')).toBeNull();
    expect(screen.getByRole('button', { name: 'New DTU' })).toBeTruthy();
    expect(screen.queryByText('Live Feed')).toBeNull();
    expect(screen.getByText('No unit selected')).toBeTruthy();
    expect(screen.getByText('2020-01-02T03:04:05.000Z')).toBeTruthy();
    expect(paginated).toHaveBeenCalled();
    const params = paginated.mock.calls[0][0] as { query?: string };
    expect(params.query).toBe('helix');
  });

  it('filters by tier, pages, switches to grid, and runs compute actions after a selection', async () => {
    renderPanel();
    expect(await screen.findByText('Helix note')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tier'), { target: { value: 'mega' } });
    await waitFor(() => {
      const last = paginated.mock.calls.at(-1)?.[0] as { tier?: string };
      expect(last.tier).toBe('mega');
    });
    // Next stays disabled while the new query key is still pending.
    expect(await screen.findByText(/Page 1 of 2/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      const last = paginated.mock.calls.at(-1)?.[0] as { offset?: number };
      expect(last.offset).toBe(20);
    });
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Layout grid' }));
    expect(await screen.findByText('Helix note')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));

    fireEvent.click(screen.getByRole('button', { name: 'Helix note' }));
    expect(screen.queryByText('No unit selected')).toBeNull();
    expect(screen.getByText('detail dtu-1')).toBeTruthy();

    const shapes: Record<string, Record<string, unknown>> = {
      lineageAnalysis: { lineageHealth: 'healthy', depth: 2, forkCount: 1, totalDescendants: 3, isRoot: false, isLeaf: true, title: 'Helix note', oldestAncestor: 'root' },
      qualityScore: { totalScore: 80, grade: 'B', breakdown: { clarity: 20, depth: 20, links: 20, care: 20 }, recommendations: ['cite more'], title: 'Helix note' },
      citationNetwork: { influenceScore: 4, inDegree: 2, outDegree: 1, reciprocalCount: 0, influenceLevel: 'moderate', hIndex: 1, topCiters: [{ title: 'Other', count: 2 }] },
      tierRecommendation: { recommendedTier: 'mega', action: 'promote', currentTier: 'regular', reasoning: 'cited', metrics: { citations: 3 } },
      duplicateDetection: { duplicatesFound: 1, totalChecked: 4, isUnique: false, duplicates: [{ title: 'Dup', combinedScore: 90, titleSimilarity: 80 }], possibleDuplicates: [{ title: 'Maybe', combinedScore: 40 }] },
    };
    for (const [action, result] of Object.entries(shapes)) {
      lensRun.mockResolvedValueOnce({ data: { ok: true, result } });
      const label = action === 'lineageAnalysis' ? 'Lineage Analysis'
        : action === 'qualityScore' ? 'Quality Score'
        : action === 'citationNetwork' ? 'Citation Network'
        : action === 'tierRecommendation' ? 'Tier Recommendation'
        : 'Duplicate Detection';
      fireEvent.click(screen.getByRole('button', { name: label }));
      await screen.findByText('Result');
    }

    lensRun.mockResolvedValueOnce({ data: { ok: false, error: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lineage Analysis' }));
    expect(await screen.findByText(/Action failed: nope/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Xcircle'));
  });

  it('shows an empty browse state and an error retry', async () => {
    paginated.mockResolvedValue({ data: { ok: true, items: [], pagination: { total: 0, hasNext: false } } });
    const view = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Layout grid' }));
    expect(await screen.findByText('No DTUs found')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    view.unmount();

    paginated.mockRejectedValueOnce(new Error('substrate down'));
    renderPanel();
    expect(await screen.findByText(/substrate down/)).toBeTruthy();
  });
});
