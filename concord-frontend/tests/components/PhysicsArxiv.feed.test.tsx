/**
 * PhysicsArxiv — the Notebook arXiv feed comes through the server
 * (FIX-physics-002).
 *
 * This panel used to fetch export.arxiv.org directly from the browser.
 * arXiv sends no CORS headers, so the browser blocked every response:
 * the feed showed 0 papers with a CORS error in the console, on every
 * load, for every user. The papers now arrive via the physics domain's
 * live_arxiv macro (the same server feed every other arXiv surface
 * uses). These pins hold that: the browser never fetches arXiv itself,
 * papers render from the macro's result, a category change re-queries
 * the macro, and a macro refusal shows the honest unavailable line
 * with zero papers.
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

import { PhysicsArxiv } from '@/components/physics/PhysicsArxiv';

const PAPERS = [
  { arxivId: '2511.00001v1', title: 'Quantum Widgets in Free Fall', summary: 'We drop widgets.', published: '2025-11-10T00:00:00Z', authors: ['Ada Lovelace', 'Alan Turing'], abstractUrl: 'https://arxiv.org/abs/2511.00001v1', category: 'physics.gen-ph' },
  { arxivId: '2511.00002v1', title: 'Condensed Matter, Condensed Paper', summary: 'Short and dense.', published: '2025-11-09T00:00:00Z', authors: ['Marie Curie'], abstractUrl: 'https://arxiv.org/abs/2511.00002v1', category: 'physics.gen-ph' },
];

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PhysicsArxiv />
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
  browserFetch = vi.fn(async () => { throw new Error('browser fetch must not be used for arXiv'); });
  globalThis.fetch = browserFetch as unknown as typeof fetch;
  lensRun.mockImplementation(async () => ({ data: { ok: true, result: { ok: true, papers: PAPERS, category: 'physics.gen-ph', total: 2 } } }));
});
afterEach(() => cleanup());

describe('PhysicsArxiv feed (FIX-physics-002)', () => {
  it('renders papers from the live_arxiv macro and never fetches arXiv from the browser', async () => {
    renderPanel();
    await until(() => !!screen.queryByText('Quantum Widgets in Free Fall'));
    expect(screen.getByText('Condensed Matter, Condensed Paper')).toBeInTheDocument();
    expect(browserFetch).not.toHaveBeenCalled();
    expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'physics', name: 'live_arxiv',
      input: expect.objectContaining({ category: 'physics.gen-ph', limit: 20 }),
    }));
  });

  it('changing the category re-queries the macro for that category', async () => {
    renderPanel();
    await until(() => !!screen.queryByText('Quantum Widgets in Free Fall'));
    const select = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'quant-ph' } });
    await until(() => lensRun.mock.calls.some((c) => (c[0] as { input?: { category?: string } })?.input?.category === 'quant-ph'));
    expect(browserFetch).not.toHaveBeenCalled();
  });

  it('a macro refusal shows the honest unavailable line and zero papers', async () => {
    lensRun.mockImplementation(async () => ({ data: { ok: true, result: { ok: false, reason: 'arxiv_unreachable', error: 'arXiv returned no papers for this category feed' } } }));
    renderPanel();
    await until(() => !!screen.queryByText(/arXiv feed unavailable/));
    expect(screen.queryByText('Quantum Widgets in Free Fall')).toBeNull();
    expect(browserFetch).not.toHaveBeenCalled();
  });
});
