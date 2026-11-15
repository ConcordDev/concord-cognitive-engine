// CriScoresAgreement.test.tsx
//
// FIX-cri-001: the CRI scores panel showed 0% for every DTU while the
// Quality Loop badge counted 67/181 "scored". A DTU record's `creti`
// is its human-readable TEXT (a string); dimension scores exist only
// when creti is an object (the server's normDtu definition). Both
// panels now use that definition: text-only DTUs render an explicit
// "unscored" state, stats are computed over scored DTUs only, and the
// badge count agrees with the table.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn(async () => ({ data: {} })) },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, result: {} })) }),
  useArtifacts: () => ({ data: [], isLoading: false }),
  useCreateArtifact: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...p }: Record<string, unknown>) => React.createElement('div', p, children as React.ReactNode) }),
}));

import { ScoresPanel } from '@/components/cri/ScoresPanel';
import { QualityLoopPanel } from '@/components/cri/QualityLoopPanel';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

const DTUS = [
  { id: 'd1', title: 'Text only DTU', creti: 'CRETI: a wall of human text, not scores' },
  { id: 'd2', title: 'Scored DTU', creti: { coherence: 0.9, relevance: 0.8, evidence: 0.7, timeliness: 0.6, integration: 0.5, composite: 0.7 } },
  { id: 'd3', title: 'Bare DTU' },
];

describe('CRI scored agreement (FIX-cri-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockResolvedValue({ data: { dtus: DTUS } });
  });
  afterEach(() => cleanup());

  it('ScoresPanel: 1/3 scored, the scored row shows real %, the others show unscored', async () => {
    render(wrap(React.createElement(ScoresPanel)));
    expect((await screen.findAllByText('Scored DTU')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('1/3')).toBeTruthy(); // the Scored stat card
    expect(screen.getAllByText('70%').length).toBeGreaterThanOrEqual(1); // d2 composite
    expect(screen.getAllByText('unscored').length).toBeGreaterThanOrEqual(2);
    // Avg is over the scored set only: 70%, not 23% (0-padded) or 0%.
    expect(screen.getByText('Avg Score').previousSibling?.textContent).toBe('70%');
  });

  it('QualityLoop badge counts the same scored set: 1/3', async () => {
    render(wrap(React.createElement(QualityLoopPanel)));
    expect(await screen.findByText('1/3 DTUs scored')).toBeTruthy();
  });
});
