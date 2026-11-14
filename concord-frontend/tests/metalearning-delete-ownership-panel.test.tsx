// Delete-ownership fix, FE leg: the strategy delete route answers 200
// with the macro's body, so a refusal (not yours / ownerless corpus)
// resolves as ok:false. The panel must surface that refusal in its
// Results panel and keep the confirm armed — before the fix, onSuccess
// treated every resolved response as a successful delete and the
// refusal reached only the console.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const STRAT = {
  id: 'strat_1', name: 'Spaced Review', domain: 'memory', ownerId: 'someone-else',
  uses: 0, successes: 0, failures: 0, avgPerformance: null,
  parameters: { learningRate: 0.1, explorationRate: 0.2, batchSize: 10, abstractionLevel: 1, consolidationThreshold: 0.7 },
  createdAt: '2026-11-12T00:00:00Z',
};
let deleteResult: { data: { ok: boolean; error?: string } } = { data: { ok: false, error: 'You can only delete strategies you defined.' } };
const deleteCalls: string[] = [];

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    metalearning: {
      status: () => Promise.resolve({ data: { status: { strategies: 1, curriculums: 0, adaptations: 0, outcomes: 0 } } }),
      strategies: () => Promise.resolve({ data: { strategies: deleteCalls.length > 0 && deleteResult.data.ok ? [] : [STRAT] } }),
      bestStrategy: () => Promise.resolve({ data: {} }),
      adaptations: () => Promise.resolve({ data: { adaptations: [] } }),
      curricula: () => Promise.resolve({ data: { curricula: [] } }),
      deleteCurriculum: () => Promise.resolve({ data: {} }),
      curriculum: () => Promise.resolve({ data: {} }),
      createStrategy: () => Promise.resolve({ data: {} }),
      recordOutcome: () => Promise.resolve({ data: {} }),
      adaptStrategy: () => Promise.resolve({ data: {} }),
      deleteStrategy: (id: string) => { deleteCalls.push(id); return Promise.resolve(deleteResult); },
    },
  },
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('framer-motion', () => {
  const passthrough = (tag: string) => {
    const C = ({ children, ...props }: Record<string, unknown>) => React.createElement(tag, props, children as React.ReactNode);
    return C;
  };
  return { motion: new Proxy({}, { get: (_t, tag: string) => passthrough(tag) }) };
});

import { StrategiesDeskPanel } from '@/components/metalearning/StrategiesDeskPanel';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StrategiesDeskPanel />
    </QueryClientProvider>,
  );
}

async function armAndConfirm() {
  const arm = await screen.findByLabelText('Delete strategy Spaced Review');
  fireEvent.click(arm);
  const confirm = await screen.findByRole('button', { name: 'Delete?' });
  fireEvent.click(confirm);
}

describe('Strategy delete ownership surfacing (delete-ownership fix)', () => {
  beforeEach(() => {
    deleteCalls.length = 0;
    deleteResult = { data: { ok: false, error: 'You can only delete strategies you defined.' } };
  });

  it('a refusal surfaces in the panel, the row stays, and the confirm stays armed', async () => {
    mount();
    await armAndConfirm();
    await waitFor(() => expect(deleteCalls).toEqual(['strat_1']));
    expect(await screen.findByText(/only delete strategies you defined/)).toBeTruthy();
    expect(screen.getByText('Spaced Review')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete?' })).toBeTruthy();
  });

  it('a successful delete removes the row', async () => {
    deleteResult = { data: { ok: true } };
    mount();
    await armAndConfirm();
    await waitFor(() => expect(deleteCalls).toEqual(['strat_1']));
    await waitFor(() => expect(screen.queryByText('Spaced Review')).toBeNull());
  });
});
