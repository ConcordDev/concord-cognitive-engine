/**
 * /lenses/neuro (NeuroTrainPanel) — wiring + UX-state contract.
 *
 * The Wave-2 rebuild retired the neuro lens's generic Networks/Neurons/
 * Training/Datasets/Experiments/Metrics CRUD scaffold (a `useLensData`-backed
 * store with zero connection to any neuro-domain macro — every field was
 * free-typed by the user, never computed) and replaced the one macro it
 * never reached — `neuro.train` — with NeuroTrainPanel, a real designed
 * feature. This file pins NeuroTrainPanel's real dispatch + UX-state
 * contract the same way geology/forestry pin their bespoke panels: mock the
 * REAL macro channel (`lensRun`) and assert genuine loading / error /
 * populated behavior — no fabricated rows.
 *
 * DISPATCH: NeuroTrainPanel calls `lensRun('neuro', 'train', input)` directly
 * (not through useLensData/useRunArtifact — those hooks belonged to the
 * retired scaffold and are no longer imported anywhere in the neuro lens).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { NeuroTrainPanel } from '@/components/neuro/NeuroTrainPanel';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function transportErr(message: string) {
  return Promise.resolve({ data: { ok: false, error: message } });
}

const TRAINED_RESULT = {
  mode: 'trained', simulated: false, optimizer: 'adam', epochs: 40, samples: 60,
  loss: 0.1234, accuracy: 0.95,
  history: [{ epoch: 1, loss: 0.6, accuracy: 0.5 }, { epoch: 40, loss: 0.1234, accuracy: 0.95 }],
  weights: [1.2, -0.8], bias: 0.05,
};

const PROJECTION_RESULT = {
  mode: 'projection', simulated: true, basis: 'hyperparameter_projection',
  note: 'No dataset attached — this is a deterministic learning-curve projection.',
  optimizer: 'adam', epochs: 40, layers: 3, neurons: 64, samples: 1000,
  loss: 0.2, accuracy: 0.82, projectedAccuracyCeiling: 0.9,
  history: [{ epoch: 1, loss: 0.7, accuracy: 0.5 }, { epoch: 40, loss: 0.2, accuracy: 0.82 }],
};

beforeEach(() => { lensRunMock.mockReset(); });
afterEach(() => { vi.clearAllMocks(); });

describe('NeuroTrainPanel — wiring', () => {
  it('dispatches neuro.train with a real synthetic dataset in toy mode', async () => {
    lensRunMock.mockImplementation(() => ok(TRAINED_RESULT));
    const { getByText } = render(<NeuroTrainPanel />);
    await act(async () => { fireEvent.click(getByText('Train')); });
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const [domain, action, input] = lensRunMock.mock.calls[0];
    expect(domain).toBe('neuro');
    expect(action).toBe('train');
    expect(Array.isArray((input as { dataset: unknown[] }).dataset)).toBe(true);
    expect((input as { dataset: { features: number[]; label: number }[] }).dataset.length).toBeGreaterThan(0);
  });

  it('dispatches neuro.train with hyperparameters only (no dataset) in projection mode', async () => {
    lensRunMock.mockImplementation(() => ok(PROJECTION_RESULT));
    const { getByText } = render(<NeuroTrainPanel />);
    await act(async () => { fireEvent.click(getByText('Hyperparameter projection')); });
    await act(async () => { fireEvent.click(getByText('Project learning curve')); });
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const [, , input] = lensRunMock.mock.calls[0];
    expect(input).not.toHaveProperty('dataset');
    expect(input).toHaveProperty('layers');
    expect(input).toHaveProperty('neurons');
  });
});

describe('NeuroTrainPanel — UX states', () => {
  it('POPULATED (trained): renders the real mode label, loss, accuracy — never a fabricated number', async () => {
    lensRunMock.mockImplementation(() => ok(TRAINED_RESULT));
    const { getByText } = render(<NeuroTrainPanel />);
    await act(async () => { fireEvent.click(getByText('Train')); });
    await waitFor(() => expect(getByText('Trained (real)')).toBeInTheDocument());
    expect(getByText('0.1234')).toBeInTheDocument();
    expect(getByText('95.0%')).toBeInTheDocument();
  });

  it('POPULATED (projection): the honest "simulated" note is never hidden from the user', async () => {
    lensRunMock.mockImplementation(() => ok(PROJECTION_RESULT));
    const { getByText } = render(<NeuroTrainPanel />);
    await act(async () => { fireEvent.click(getByText('Hyperparameter projection')); });
    await act(async () => { fireEvent.click(getByText('Project learning curve')); });
    await waitFor(() => expect(getByText('Projection')).toBeInTheDocument());
    expect(getByText(PROJECTION_RESULT.note)).toBeInTheDocument();
  });

  it('ERROR: a failed dispatch surfaces the real error message, not a silent no-op', async () => {
    lensRunMock.mockImplementation(() => transportErr('brain offline'));
    const { getByText } = render(<NeuroTrainPanel />);
    await act(async () => { fireEvent.click(getByText('Train')); });
    await waitFor(() => expect(getByText(/brain offline/i)).toBeInTheDocument());
  });

  it('ERROR: a thrown/rejected lensRun surfaces its message', async () => {
    lensRunMock.mockImplementation(() => Promise.reject(new Error('network down')));
    const { getByText } = render(<NeuroTrainPanel />);
    await act(async () => { fireEvent.click(getByText('Train')); });
    await waitFor(() => expect(getByText(/network down/i)).toBeInTheDocument());
  });
});
