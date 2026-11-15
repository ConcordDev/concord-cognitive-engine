/**
 * QuantumArxiv — the quantum research feed comes through the server
 * (FIX-quantum-006).
 *
 * This panel fetched export.arxiv.org directly from the browser.
 * arXiv sends no CORS headers, so every load failed — 0 papers and
 * CORS errors in the console — while the lens still presented itself
 * as REAL data. The papers now arrive via the quantum domain's
 * live_arxiv macro, the same server feed every other arXiv surface
 * uses (the physics panel was converted the same way, FIX-physics-002).
 * These pins hold that: the browser never fetches arXiv itself,
 * papers render from the macro's result, a category change re-queries
 * the macro with the panel's category, and a macro refusal shows the
 * honest unavailable line with zero papers.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { QuantumArxiv } from '@/components/quantum/QuantumArxiv';

const PAPERS = [
  { arxivId: '2511.10001v1', title: 'Error Correction at Scale', summary: 'Logical qubits, finally.', published: '2025-11-11T00:00:00Z', authors: ['Ada Lovelace', 'Alan Turing'], abstractUrl: 'https://arxiv.org/abs/2511.10001v1', category: 'quant-ph' },
  { arxivId: '2511.10002v1', title: 'A Second Quantum Paper', summary: 'More qubits.', published: '2025-11-10T00:00:00Z', authors: ['Marie Curie'], abstractUrl: 'https://arxiv.org/abs/2511.10002v1', category: 'quant-ph' },
];

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <QuantumArxiv />
    </QueryClientProvider>,
  );
}
async function until(pred: () => boolean, ms = 2500) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('until: timed out');
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
}

let browserFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  lensRun.mockReset();
  browserFetch = vi.fn(async () => { throw new Error('browser must not fetch arXiv directly'); });
  vi.stubGlobal('fetch', browserFetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('QuantumArxiv server feed (FIX-quantum-006)', () => {
  it('renders papers from the quantum live_arxiv macro and never fetches arXiv itself', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ok: true, total: 2, papers: PAPERS } } });
    renderPanel();
    await until(() => screen.queryByText('Error Correction at Scale') != null);
    expect(screen.getByText('A Second Quantum Paper')).toBeInTheDocument();
    expect(browserFetch).not.toHaveBeenCalled();
    const call = lensRun.mock.calls.find((c) => (c[0] as { name?: string })?.name === 'live_arxiv');
    expect(call).toBeTruthy();
    expect((call![0] as { domain: string }).domain).toBe('quantum');
    expect((call![0] as { input: { category: string } }).input.category).toBe('quant-ph');
  });

  it('re-queries the macro when the category changes', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ok: true, total: 2, papers: PAPERS } } });
    renderPanel();
    await until(() => screen.queryByText('Error Correction at Scale') != null);
    fireEvent.change(screen.getByLabelText('arXiv category'), { target: { value: 'cs.ET' } });
    await until(() => lensRun.mock.calls.some((c) => (c[0] as { input?: { category?: string } })?.input?.category === 'cs.ET'));
  });

  it('shows the honest unavailable line and zero papers when the macro refuses', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ok: false, reason: 'arxiv_unreachable', error: 'arXiv unreachable' } } });
    renderPanel();
    await until(() => screen.queryByText('arXiv unreachable.') != null);
    expect(screen.queryByText('Error Correction at Scale')).not.toBeInTheDocument();
  });
});
