// FIX-metalearning-005 (curriculum leg): each Saved curriculum
// carries a two-step delete wired to metalearning.deleteCurriculum;
// arming alone deletes nothing, a refusal surfaces in the panel,
// and a successful delete removes the row (the curricula query is
// invalidated and refetches without it).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const CURR = { id: 'curr_1', topic: 'Topology', steps: [{ order: 1, title: 'Basics', rationale: 'r' }], createdAt: '2026-11-12T00:00:00Z' };
let deleteResult: { data: { ok: boolean; error?: string } } = { data: { ok: true } };
let curriculaCalls = 0;
const deleteCalls: string[] = [];

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    metalearning: {
      status: () => Promise.resolve({ data: { status: { strategies: 0, curriculums: 1, adaptations: 0, outcomes: 0 } } }),
      strategies: () => Promise.resolve({ data: { strategies: [] } }),
      bestStrategy: () => Promise.resolve({ data: {} }),
      adaptations: () => Promise.resolve({ data: { adaptations: [] } }),
      curricula: () => {
        curriculaCalls += 1;
        return Promise.resolve({ data: { curricula: deleteCalls.length > 0 && deleteResult.data.ok ? [] : [CURR] } });
      },
      deleteCurriculum: (id: string) => { deleteCalls.push(id); return Promise.resolve(deleteResult); },
      curriculum: () => Promise.resolve({ data: {} }),
      createStrategy: () => Promise.resolve({ data: {} }),
      recordOutcome: () => Promise.resolve({ data: {} }),
      adaptStrategy: () => Promise.resolve({ data: {} }),
      deleteStrategy: () => Promise.resolve({ data: {} }),
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

describe('Saved curricula delete (FIX-metalearning-005)', () => {
  beforeEach(() => { deleteCalls.length = 0; curriculaCalls = 0; deleteResult = { data: { ok: true } }; });

  it('arms first; on confirm deletes by id and the row leaves the list', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete curriculum Topology' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete curriculum Topology' }));
    expect(deleteCalls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete curriculum Topology' }));
    await waitFor(() => expect(deleteCalls).toEqual(['curr_1']));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete curriculum Topology' })).toBeNull());
  });

  it('a refusal surfaces in the panel and the row stays', async () => {
    deleteResult = { data: { ok: false, error: 'Curriculum not found' } };
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete curriculum Topology' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete curriculum Topology' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete curriculum Topology' }));
    await waitFor(() => expect(screen.getByText('Curriculum not found')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Delete curriculum Topology' })).toBeTruthy();
  });
});
