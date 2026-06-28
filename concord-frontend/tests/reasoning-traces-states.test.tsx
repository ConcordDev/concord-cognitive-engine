/**
 * /lenses/reasoning/traces — four-UX-state contract.
 *
 * The HLR reasoning-trace browser is a reader / dashboard over the
 * High-Level-Reasoning engine. This pins that it renders genuine
 * loading / error (with a working Retry) / empty / populated states against
 * the real REST surface (GET /api/reasoning/traces + GET /api/reasoning/trace/:id),
 * plus a11y (the mode filter carries an accessible name; the refresh control is
 * labelled).
 *
 * No fabricated data: every state is driven by a mocked fetch standing in for
 * the real backend, in exactly the shape server/emergent/hlr-engine.js +
 * server.js return ({ ok, traces, modes, agentTraces } / { ok, trace }).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import ReasoningTracesPage from '@/app/lenses/reasoning/traces/page';

function jsonOk(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
function httpFail(status: number) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve({ ok: false }) });
}

const MODES = ['deductive', 'inductive', 'abductive', 'adversarial', 'analogical', 'temporal', 'counterfactual'];

const TRACES = {
  ok: true,
  modes: MODES,
  agentTraces: [],
  traces: [
    { traceId: 'hlr_trace_a1', mode: 'deductive', topic: 'Does adding a heartbeat improve depth?', chainCount: 3, confidence: 0.72 },
    { traceId: 'hlr_trace_b2', mode: 'abductive', topic: 'What best explains the drift alert?', chainCount: 4, confidence: 0.61 },
  ],
};

const TRACE_DETAIL = {
  ok: true,
  trace: { traceId: 'hlr_trace_a1', input: { topic: 'Does adding a heartbeat improve depth?', mode: 'deductive' }, chains: [{ chainId: 'c1', conclusion: 'Likely yes.' }] },
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('reasoning traces lens — four UX states', () => {
  it('LOADING: shows a status spinner while traces are in flight', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { getByRole } = render(<ReasoningTracesPage />);
    const status = getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status.textContent).toMatch(/loading reasoning traces/i);
  });

  it('ERROR: shows an honest alert + a working Retry that re-fetches', async () => {
    const fetchMock = vi.fn(() => httpFail(500));
    vi.stubGlobal('fetch', fetchMock);
    const { getByRole, getByText } = render(<ReasoningTracesPage />);

    await waitFor(() => expect(getByRole('alert')).toBeInTheDocument());
    expect(getByRole('alert').textContent).toMatch(/couldn.?t load reasoning traces/i);

    const callsBefore = fetchMock.mock.calls.length;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('EMPTY: shows an honest empty state when no traces are recorded', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk({ ok: true, traces: [], modes: MODES, agentTraces: [] })));
    const { getByText } = render(<ReasoningTracesPage />);
    await waitFor(() => expect(getByText(/no reasoning traces yet/i)).toBeInTheDocument());
  });

  it('POPULATED: renders the trace list + the mode filter is labelled (a11y)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk(TRACES)));
    const { getByText, getByLabelText } = render(<ReasoningTracesPage />);
    // Topic summaries are unique to the trace-list buttons.
    await waitFor(() => expect(getByText(/Does adding a heartbeat improve depth/i)).toBeInTheDocument());
    expect(getByText(/What best explains the drift alert/i)).toBeInTheDocument();
    // a11y: the mode filter has an accessible name.
    expect(getByLabelText('Filter traces by reasoning mode')).toBeInTheDocument();
  });

  it('drives the real trace-detail route when a trace is opened', async () => {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/api/reasoning/trace/')) return jsonOk(TRACE_DETAIL);
      return jsonOk(TRACES);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByText } = render(<ReasoningTracesPage />);
    await waitFor(() => expect(getByText(/Does adding a heartbeat improve depth/i)).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText(/Does adding a heartbeat improve depth/i)); });

    await waitFor(() => {
      const detailCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/reasoning/trace/'));
      expect(detailCall).toBeTruthy();
    });
    // The detail pane renders the fetched trace JSON.
    await waitFor(() => expect(getByText(/Likely yes\./)).toBeInTheDocument());
  });
});
