// FIX-observe-003 (FE half) — each metric row in Observe ▸ Metrics has
// a delete control: first click arms a per-row Confirm, second click
// calls observe.metricDelete.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/viz', () => ({
  __esModule: true,
  ChartKit: () => React.createElement('div', { 'data-testid': 'chartkit' }),
  TimelineView: () => React.createElement('div', { 'data-testid': 'timeline' }),
}));

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));

import { ObservePlatform } from '@/components/observe/ObservePlatform';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_domain: string, name: string) => {
    if (name === 'metricList') return { data: { ok: true, result: { metrics: [{ name: 'qa.metric', points: 3, latest: 2 }] } } };
    return { data: { ok: true, result: {} } };
  });
});
afterEach(() => cleanup());

describe('Observe metrics delete', () => {
  it('first trash click only arms the confirm; second click deletes', async () => {
    render(<ObservePlatform />);
    const trash = await screen.findByRole('button', { name: 'Delete qa.metric' });
    await act(async () => { fireEvent.click(trash); });
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'metricDelete')).toBe(false);
    const confirm = await screen.findByRole('button', { name: 'Confirm delete qa.metric' });
    await act(async () => { fireEvent.click(confirm); });
    const del = lensRunMock.mock.calls.find((c) => c[1] === 'metricDelete');
    expect(del?.[2]).toMatchObject({ metric: 'qa.metric' });
  });
});
