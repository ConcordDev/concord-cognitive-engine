// FIX-ml-004 — the manual "Log metrics" form kept its Record button
// disabled until ALL THREE fields (train loss, val loss, accuracy) were
// filled, so the walker's repro — enter train loss 0.9, click Record —
// silently did nothing: no experiment-log call, epoch stayed 0, chart
// empty. The server's experiment-log accepts any subset and defaults
// the rest. This test drives the real form against an in-memory
// experiment store: a lone train loss must enable Record, log with only
// that field present, and advance the epoch after the reload.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div>chart</div> }));

import { ExperimentTracker } from '../ExperimentTracker';

interface Pt { epoch: number; trainLoss: number; valLoss: number; accuracy: number; learningRate: number }
const exp = {
  id: 'ex1', name: 'walker-exp', modelId: 'm1', datasetId: '', status: 'running' as const,
  hyperparams: { learningRate: 0.001, batchSize: 32, epochs: 10, optimizer: 'adam' },
  metrics: [] as Pt[], tags: [], startedAt: '2026-03-01', completedAt: null,
};
const logCalls: Record<string, unknown>[] = [];

beforeEach(() => {
  exp.metrics = [];
  logCalls.length = 0;
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_domain: string, action: string, input: Record<string, unknown>) => {
    if (action === 'experiment-list') {
      return { data: { ok: true, result: { experiments: [exp] } } };
    }
    if (action === 'experiment-log') {
      logCalls.push(input);
      exp.metrics.push({
        epoch: (input.epoch as number) || exp.metrics.length + 1,
        trainLoss: (input.trainLoss as number) ?? 0,
        valLoss: (input.valLoss as number) ?? 0,
        accuracy: (input.accuracy as number) ?? 0,
        learningRate: 0.001,
      });
      return { data: { ok: true, result: { experiment: exp } } };
    }
    return { data: { ok: true, result: {} } };
  });
});

describe('manual metric logging (FIX-ml-004)', () => {
  it('a lone train loss enables Record, logs trainLoss-only, and advances the epoch', async () => {
    render(<ExperimentTracker />);
    fireEvent.click(await screen.findByText('walker-exp'));
    fireEvent.click(await screen.findByRole('button', { name: 'Log metrics' }));
    const trainInput = await screen.findByPlaceholderText('Train loss');
    const record = screen.getByRole('button', { name: 'Record' });
    expect((record as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(trainInput, { target: { value: '0.9' } });
    expect((record as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(record);
    await waitFor(() => expect(logCalls.length).toBe(1));
    expect(logCalls[0].trainLoss).toBe(0.9);
    expect(logCalls[0].valLoss).toBeUndefined();
    expect(logCalls[0].accuracy).toBeUndefined();
    expect(await screen.findByText('Epoch 1/10')).toBeTruthy();
  });
});
