import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-ml-002: an AutoML configuration run reads as what it
// is in the Experiments tab (not "Epoch 0/200" of a phantom training
// run), a running experiment with no logs says what it waits for, and
// the AutoML run form names the tracked record.

const h = vi.hoisted(() => ({ lensRun: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => h.lensRun(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div>chart</div> }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('@/components/panel-polish', () => ({ usePipe: () => ({ publish: vi.fn() }), useRecallableAction: () => ({ run: (fn: () => unknown) => fn() }), RecallSlot: () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ExperimentTracker } from '@/components/ml/ExperimentTracker';
import { AutoMLPanel } from '@/components/ml/AutoMLPanel';

const CONFIG_EXP = { id: 'ex-cfg', name: 'Churn baseline', kind: 'automl-config', modelId: 'xgboost', datasetId: 'ds1', status: 'completed', hyperparams: { learningRate: 0.1, batchSize: 32, nEstimators: 200, maxDepth: 7, epochs: 0, optimizer: 'xgboost' }, metrics: [], tags: ['automl'], startedAt: '2026-03-01', completedAt: '2026-03-01' };
const RUNNING_EXP = { id: 'ex-run', name: 'manual-run', modelId: 'm1', datasetId: 'ds1', status: 'running', hyperparams: { learningRate: 0.001, batchSize: 32, epochs: 10, optimizer: 'adam' }, metrics: [], tags: [], startedAt: '2026-03-01', completedAt: null };

function calls(action: string) {
  return h.lensRun.mock.calls.filter((c) => (c as unknown[])[1] === action);
}

beforeEach(() => {
  h.lensRun.mockReset();
  h.lensRun.mockImplementation(async (...a: unknown[]) => {
    const action = (a as unknown[])[1];
    if (action === 'experiment-list') return { data: { ok: true, result: { experiments: [CONFIG_EXP, RUNNING_EXP] } } };
    if (action === 'dataset-list') return { data: { ok: true, result: { datasets: [{ id: 'ds1', name: 'Iris' }] } } };
    if (action === 'automl-templates') return { data: { ok: true, result: { templates: [{ id: 'tabular-classification', task: 'classification', title: 'Tabular Classification', description: 'd', steps: ['Profile'], recommendedModels: ['xgboost'], estimatedTime: '10 min', wired: true }] } } };
    if (action === 'automl-run') return { data: { ok: true, result: { run: { templateId: 'tabular-classification', datasetName: 'Iris', experimentId: 'ex-cfg', steps: [{ step: 'Profile dataset', detail: 'ok', done: true }], note: 'Configuration run: no score is claimed here.' } } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('FIX-ml-002 experiment reads', () => {
  it('a configuration run is labelled as one, never as Epoch 0/200', async () => {
    render(<ExperimentTracker />);
    expect(await screen.findByText('Configuration run — no training logged')).toBeTruthy();
    expect(screen.queryByText(/Epoch 0\/200/)).toBeNull();
    fireEvent.click(screen.getByText('Churn baseline'));
    expect(await screen.findByText(/AutoML configuration run — this record holds the suggested configuration/)).toBeTruthy();
  });

  it('a running experiment with no logs says what it is waiting for', async () => {
    render(<ExperimentTracker />);
    expect(await screen.findByText('Epoch 0/10')).toBeTruthy();
    fireEvent.click(screen.getByText('manual-run'));
    expect(await screen.findByText(/Waiting for epoch logs/)).toBeTruthy();
  });
});

describe('FIX-ml-002 automl run naming', () => {
  it('the run name rides automl-run and the receipt reads Configuration run complete', async () => {
    render(<AutoMLPanel />);
    fireEvent.click(await screen.findByText('Tabular Classification'));
    fireEvent.change(await screen.findByLabelText('Run name (optional)'), { target: { value: 'Churn baseline' } });
    const select = Array.from(document.querySelectorAll('select')).find((s) => s.innerHTML.includes('Iris')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'ds1' } });
    fireEvent.click(screen.getByRole('button', { name: /Run configuration/ }));
    await waitFor(() => expect(calls('automl-run')).toHaveLength(1));
    expect((calls('automl-run')[0] as unknown[])[2]).toMatchObject({ name: 'Churn baseline', datasetId: 'ds1' });
    expect(await screen.findByText(/Configuration run complete — Iris/)).toBeTruthy();
  });
});
