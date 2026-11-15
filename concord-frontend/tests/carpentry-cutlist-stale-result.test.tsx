/**
 * FIX-carpentry-011 — the cut-list optimizer result went stale: add a
 * cut, Optimize, remove the cut, and the old layout (boards / waste)
 * stayed on screen describing cuts that no longer existed. The result
 * now clears the moment any optimizer input changes; Optimize
 * recomputes it for the current cuts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const calls: { action: string; input: Record<string, unknown> }[] = [];

const CUT_RESULT = {
  boardsNeeded: 1, stockLength: 96, kerf: 0.125, totalCutLength: 72,
  wasteLength: 24, wastePct: 25, materialCost: null,
  layout: [
    { board: 1, cuts: [{ label: 'rail', length: 24 }, { label: 'rail', length: 24 }, { label: 'rail', length: 24 }], usedLength: 72.25, offcut: 23.75 },
  ],
};

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, action: string, input: Record<string, unknown> = {}) => {
    calls.push({ action, input });
    const results: Record<string, unknown> = { cutListOptimize: CUT_RESULT };
    return { data: { ok: true, result: results[action] ?? {}, error: null } };
  }),
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })) } },
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }),
  TimelineView: () => React.createElement('div', { 'data-testid': 'timeline' }),
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { JobOps } from '@/components/carpentry/JobOps';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => { calls.length = 0; });

async function optimizeOneCut() {
  wrap(<JobOps />);
  fireEvent.change(screen.getByPlaceholderText('24'), { target: { value: '24' } });
  fireEvent.click(screen.getByRole('button', { name: 'Optimize' }));
  expect(await screen.findByText('Board 1')).toBeInTheDocument();
  expect(screen.getByText('25%')).toBeInTheDocument();
}

describe('cut list optimizer — stale result (FIX-carpentry-011)', () => {
  it('clears the result when the cut it describes is removed', async () => {
    await optimizeOneCut();
    fireEvent.click(screen.getByRole('button', { name: 'Remove cut' }));
    expect(screen.queryByText('Board 1')).not.toBeInTheDocument();
    expect(screen.queryByText('25%')).not.toBeInTheDocument();
  });

  it('clears the result when a cut length is edited after optimizing', async () => {
    await optimizeOneCut();
    fireEvent.change(screen.getByPlaceholderText('24'), { target: { value: '36' } });
    expect(screen.queryByText('Board 1')).not.toBeInTheDocument();
    expect(screen.queryByText('25%')).not.toBeInTheDocument();
  });

  it('recomputes for the current cuts when Optimize is clicked again', async () => {
    await optimizeOneCut();
    fireEvent.click(screen.getByRole('button', { name: 'Remove cut' }));
    expect(screen.queryByText('Board 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add cut/i }));
    fireEvent.change(screen.getByPlaceholderText('24'), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Optimize' }));
    expect(await screen.findByText('Board 1')).toBeInTheDocument();
    const optimizeCalls = calls.filter((c) => c.action === 'cutListOptimize');
    expect(optimizeCalls.length).toBe(2);
  });
});
