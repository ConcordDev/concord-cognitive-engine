// LockFairnessTab.test.tsx
//
// FIX-lock-005: the Lock profiler showed six analyses; the server's
// fairnessScore (Jain's index + starvation) had no surface. The
// profiler now has a Fairness tab that runs the action against the
// recorded trace and renders its result.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => React.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    Component.displayName = name;
    return Component;
  };
  const names = ['Activity', 'AlertTriangle', 'Flame', 'GitBranch', 'Layers', 'Loader2', 'Plus', 'RefreshCw', 'Trash2', 'TrendingUp', 'Scale'];
  return Object.fromEntries(names.map((n) => [n, createIcon(n)]));
});
vi.mock('@/components/viz', () => ({ ChartKit: () => null, TimelineView: () => null, TreeDiagram: () => null }));

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, action: string) => {
    if (action === 'holdTimeline') return { data: { ok: true, result: { eventCount: 18, spans: [], lanes: [] } } };
    if (action === 'fairnessScore') {
      return { data: { ok: true, result: {
        jainsIndex: 0.21, fairnessLevel: 'poor',
        processes: [{ processId: 't-starved', avgWaitMs: 400, maxWaitMs: 400, lockRequests: 3 }],
        starvation: { detected: true, threshold: 225, starvedProcesses: [{ processId: 't-starved', avgWaitMs: 400, ratioToMean: 5.33 }] },
        waitDistribution: { mean: 75, stdDev: 145.77, coefficientOfVariation: 1.9436, maxMinRatio: 40 },
        resourceFairness: [{ resource: 'db', processCount: 6, jainsIndex: 0.21, fair: false }],
        summary: { totalProcesses: 6, totalWaitEvents: 18, starvedCount: 1, unfairResources: 1 },
      } } };
    }
    return { data: { ok: true, result: {} } };
  }),
}));

import { LockProfiler } from '@/components/lock/LockProfiler';

describe('Lock Fairness tab (FIX-lock-005)', () => {
  afterEach(() => cleanup());

  it('renders the fairnessScore result under its own tab', async () => {
    render(React.createElement(LockProfiler));
    fireEvent.click(await screen.findByRole('button', { name: /Fairness/ }));
    expect(await screen.findByText(/Jain’s index/)).toBeTruthy();
    expect(await screen.findByText('0.21')).toBeTruthy();
    expect(await screen.findByText(/Starvation detected/)).toBeTruthy();
    expect(await screen.findByText(/Fairness by lock/)).toBeTruthy();
  });
});
