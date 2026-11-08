/**
 * Reasoning-traces coverage breadth — HlrTracesPanel / HlrTracesLab.
 *
 * Exercises the panel's branches the behaviour pins do not: the Run HLR
 * form (enabled only with a topic; success refreshes + opens the new
 * trace; failure surfaces in words), the deliberation journal with its
 * awareness curve, the no-match filter line, and the detail pane's
 * loading state. Driven by a mocked fetch + lensRun in the exact shapes
 * the server returns.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { HlrTracesPanel, HlrTracesLab } from '@/components/reasoning/HlrTracesPanel';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

function jsonOk(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const MODES = ['deductive', 'inductive', 'abductive', 'adversarial', 'analogical', 'temporal', 'counterfactual'];

const JOURNAL = [
  { id: 'ag1', reason: 'dilemma', attended: 'constraint-7', quale: 'unease', surprise: 0.42, awareness_index: 0.31, note: 'Weighed the constraint.', created_at: 1762000000 },
  { id: 'ag2', reason: 'drive_spike', attended: 'novelty spike', awareness_index: 0.58, note: 'Chased the spike.', created_at: 1762000060 },
];

function tracesPayload(traces: unknown[], agentTraces: unknown[] = []) {
  return { ok: true, modes: MODES, agentTraces, traces };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  lensRunMock.mockReset();
});

describe('HlrTracesLab — the Run HLR form', () => {
  it('the run button is disabled until a topic is typed', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk(tracesPayload([]))));
    const { getByRole, getByPlaceholderText } = render(<HlrTracesLab />);
    const btn = getByRole('button', { name: /run hlr/i });
    expect(btn).toBeDisabled();
    fireEvent.change(getByPlaceholderText(/Question \/ topic to reason over/), { target: { value: 'Why is the sky blue?' } });
    expect(btn).not.toBeDisabled();
  });

  it('a successful run refreshes the list and opens the new trace', async () => {
    const after = tracesPayload([
      { traceId: 'hlr_new', mode: 'deductive', topic: 'Why is the sky blue?', chainCount: 3, confidence: 0.66 },
    ]);
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/api/reasoning/trace/')) {
        return jsonOk({ ok: true, trace: { traceId: 'hlr_new', input: { topic: 'Why is the sky blue?' }, chains: [{ chainId: 'c1', conclusion: 'Rayleigh scattering.' }] } });
      }
      return jsonOk(fetchMock.mock.calls.filter((c) => String(c[0]).includes('traces?')).length > 1 ? after : tracesPayload([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { traceId: 'hlr_new' } } });
    const { getByRole, getByPlaceholderText, getByText } = render(<HlrTracesLab />);
    fireEvent.change(getByPlaceholderText(/Question \/ topic to reason over/), { target: { value: 'Why is the sky blue?' } });
    await act(async () => { fireEvent.click(getByRole('button', { name: /run hlr/i })); });
    await waitFor(() => expect(getByText(/Rayleigh scattering\./)).toBeInTheDocument());
    expect(lensRunMock).toHaveBeenCalledWith('reasoning', 'run', expect.objectContaining({ topic: 'Why is the sky blue?', mode: 'deductive' }));
  });

  it('a failed run surfaces the error in words', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk(tracesPayload([]))));
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'brain_unavailable' } });
    const { getByRole, getByPlaceholderText, getByText } = render(<HlrTracesLab />);
    fireEvent.change(getByPlaceholderText(/Question \/ topic to reason over/), { target: { value: 'Anything' } });
    await act(async () => { fireEvent.click(getByRole('button', { name: /run hlr/i })); });
    await waitFor(() => expect(getByText(/brain_unavailable/)).toBeInTheDocument());
  });
});

describe('HlrTracesPanel — journal, filter and detail branches', () => {
  it('renders deliberation entries with the awareness curve', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk(tracesPayload([], JOURNAL))));
    const { getByText } = render(<HlrTracesPanel />);
    await waitFor(() => expect(getByText(/Weighed the constraint\./)).toBeInTheDocument());
    expect(getByText(/Chased the spike\./)).toBeInTheDocument();
    expect(getByText(/awareness index over the last 2 wakes/)).toBeInTheDocument();
    expect(getByText(/awareness = access correlate/)).toBeInTheDocument();
  });

  it('a mode with no traces shows the no-match line', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk(tracesPayload([
      { traceId: 't1', mode: 'deductive', topic: 'Only deductive', chainCount: 1, confidence: 0.4 },
    ]))));
    const { getByLabelText, getByText } = render(<HlrTracesPanel />);
    await waitFor(() => expect(getByText(/Only deductive/)).toBeInTheDocument());
    fireEvent.change(getByLabelText('Filter traces by reasoning mode'), { target: { value: 'temporal' } });
    expect(getByText(/No traces match this mode\./)).toBeInTheDocument();
  });

  it('selecting a trace shows the loading line before the detail lands', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/api/reasoning/trace/')) return new Promise(() => {});
      return jsonOk(tracesPayload([
        { traceId: 't1', mode: 'deductive', topic: 'Pending detail', chainCount: 1, confidence: 0.4 },
      ]));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getByText } = render(<HlrTracesPanel />);
    await waitFor(() => expect(getByText(/Pending detail/)).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText(/Pending detail/)); });
    expect(getByText(/Loading trace…/)).toBeInTheDocument();
  });
});
