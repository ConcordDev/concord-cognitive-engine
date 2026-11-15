// FIX-cri-002 — Quality Loop's Compare produced no output: the panel
// counted a DTU as "scored" whenever its creti field was truthy, but
// /api/dtus serializes creti as summary TEXT (dtuForClient) while cri's
// server contract (normDtu) keeps creti only as an OBJECT of numeric
// dimension scores — so the dropdowns populated with DTUs the server
// could only refuse, and no empty state explained any of it. The panel
// now applies the server's contract when counting scored DTUs, and
// Compare renders an honest empty state below two scored DTUs.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { corpusRef, compareResult } = vi.hoisted(() => ({
  corpusRef: { dtus: [] as unknown[] },
  compareResult: {
    a: { id: 'd1', title: 'Alpha', composite: 0.8 },
    b: { id: 'd2', title: 'Beta', composite: 0.5 },
    compositeDelta: 0.3,
    overallWinner: 'a',
    dimensions: [
      { dimension: 'coherence', a: 0.9, b: 0.4, delta: 0.5, winner: 'a' },
      { dimension: 'relevance', a: 0.7, b: 0.6, delta: 0.1, winner: 'a' },
    ],
    dimensionWins: { a: 2, b: 0, tie: 0 },
    biggestGap: { dimension: 'coherence', a: 0.9, b: 0.4, delta: 0.5, winner: 'a' },
  },
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async () => ({ data: { dtus: corpusRef.dtus } })),
    post: vi.fn(async () => ({ data: {} })),
  },
  lensRun: vi.fn(async (_domain: string, action: string) => {
    if (action === 'compare') return { data: { ok: true, result: compareResult, error: null } };
    if (action === 'trend-history') return { data: { ok: true, result: { history: [] }, error: null } };
    return { data: { ok: true, result: {}, error: null } };
  }),
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { QualityLoopPanel } from '@/components/cri/QualityLoopPanel';

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QualityLoopPanel />
    </QueryClientProvider>,
  );
}

describe('Quality Loop compare contract (FIX-cri-002)', () => {
  it('text-creti corpus (the real /api/dtus shape): header counts 0 scored, Compare shows the empty state', async () => {
    corpusRef.dtus = [
      { id: 'd1', title: 'Alpha', creti: 'A summary of alpha in prose.' },
      { id: 'd2', title: 'Beta', creti: 'A summary of beta in prose.' },
    ];
    renderPanel();
    expect(await screen.findByText(/0\/2 DTUs scored/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^compare$/i }));
    expect(await screen.findByText('No scored DTUs to compare yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /compare profiles/i })).toBeNull();
  });

  it('object-scored corpus: the compare flow still works end to end', async () => {
    corpusRef.dtus = [
      { id: 'd1', title: 'Alpha', creti: { coherence: 0.9, relevance: 0.7 } },
      { id: 'd2', title: 'Beta', creti: { coherence: 0.4, relevance: 0.6 } },
    ];
    renderPanel();
    expect(await screen.findByText(/2\/2 DTUs scored/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^compare$/i }));
    const selects = await screen.findAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'd1' } });
    fireEvent.change(selects[1], { target: { value: 'd2' } });
    fireEvent.click(screen.getByRole('button', { name: /compare profiles/i }));
    await waitFor(() => expect(screen.getByText('Dimension-by-dimension')).toBeTruthy());
    expect(screen.getByText('80%')).toBeTruthy();
  });
});
