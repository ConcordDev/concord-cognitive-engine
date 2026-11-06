/**
 * Reasoning-traces build — RT-S2 + RT-S3 behaviour pins.
 *
 * RT-S2: the standalone page's floating "Open a trace" CTA, when there
 * is no trace to open, says so in words (the panel's own empty-state
 * sentence) instead of silently shifting focus; when traces exist it
 * opens the latest one and shows no notice.
 * RT-S3: the mode filter's per-mode options carry counts computed from
 * the visible list ("Filters count what they filter" — the class
 * standard the Lead compilation entered into S2's acceptance).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import ReasoningTracesPage from '@/app/lenses/reasoning/traces/page';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

function jsonOk(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const MODES = ['deductive', 'inductive', 'abductive', 'adversarial', 'analogical', 'temporal', 'counterfactual'];

const TRACES = {
  ok: true,
  modes: MODES,
  agentTraces: [],
  traces: [
    { traceId: 'hlr_trace_a1', mode: 'deductive', topic: 'First deductive topic', chainCount: 3, confidence: 0.72 },
    { traceId: 'hlr_trace_a2', mode: 'deductive', topic: 'Second deductive topic', chainCount: 2, confidence: 0.5 },
    { traceId: 'hlr_trace_b1', mode: 'temporal', topic: 'A temporal topic', chainCount: 4, confidence: 0.61 },
  ],
};

const TRACE_DETAIL = {
  ok: true,
  trace: { traceId: 'hlr_trace_a1', input: { topic: 'First deductive topic', mode: 'deductive' }, chains: [{ chainId: 'c1', conclusion: 'Detail rendered.' }] },
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('RT-S3 — the filter counts its modes', () => {
  it('per-mode options carry counts from the visible list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk(TRACES)));
    const { getByLabelText } = render(<ReasoningTracesPage />);
    await waitFor(() => expect(getByLabelText('Filter traces by reasoning mode')).toBeInTheDocument());
    const select = getByLabelText('Filter traces by reasoning mode') as HTMLSelectElement;
    const texts = Array.from(select.options).map((o) => o.textContent);
    expect(texts).toContain('All modes (3)');
    expect(texts).toContain('deductive (2)');
    expect(texts).toContain('temporal (1)');
    expect(texts).toContain('abductive (0)');
  });

  it('filtering by a counted mode shows only its traces', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk(TRACES)));
    const { getByLabelText, getByText, queryByText } = render(<ReasoningTracesPage />);
    await waitFor(() => expect(getByText(/A temporal topic/)).toBeInTheDocument());
    fireEvent.change(getByLabelText('Filter traces by reasoning mode'), { target: { value: 'temporal' } });
    expect(getByText(/A temporal topic/)).toBeInTheDocument();
    expect(queryByText(/First deductive topic/)).toBeNull();
  });
});

describe('RT-S2 — "Open a trace" speaks when there is none', () => {
  it('the empty case renders the no-traces sentence on click (absent before)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk({ ok: true, traces: [], modes: MODES, agentTraces: [] })));
    const { getByRole, getByText, queryByText } = render(<ReasoningTracesPage />);
    await waitFor(() => expect(getByText(/no reasoning traces yet/i)).toBeInTheDocument());
    expect(queryByText(/When one fires, it shows up here, and this button opens/)).toBeNull();
    await act(async () => { fireEvent.click(getByRole('button', { name: /open a trace/i })); });
    expect(getByText(/No traces yet — the HLR engine records a trace/)).toBeInTheDocument();
  });

  it('the populated case opens the first trace and shows no notice', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/api/reasoning/trace/')) return jsonOk(TRACE_DETAIL);
      return jsonOk(TRACES);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getByRole, getByText, queryByText } = render(<ReasoningTracesPage />);
    await waitFor(() => expect(getByText(/First deductive topic/)).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByRole('button', { name: /open a trace/i })); });
    await waitFor(() => expect(getByText(/Detail rendered\./)).toBeInTheDocument());
    expect(queryByText(/No traces yet — the HLR engine records a trace/)).toBeNull();
  });
});
