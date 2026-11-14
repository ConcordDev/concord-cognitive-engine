import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Slice B7 — FIX-inference-004: the Facts panel gains the delete that
// only the Rule Engine had — per-fact StickyDeleteConfirm wired to
// kb-remove, the id resolved from kb-list (whose facts carry ids).

const h = vi.hoisted(() => ({
  lensRun: vi.fn(),
  inf: { status: vi.fn(), query: vi.fn(), facts: vi.fn(), syllogism: vi.fn(), forwardChain: vi.fn() },
}));
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => h.lensRun(...a), apiHelpers: { inference: h.inf } }));
vi.mock('@/components/viz', () => ({ TreeDiagram: () => <div>tree</div> }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: () => <div>err</div> }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { InferenceDeskPanel } from '@/components/inference/InferenceDeskPanel';

function calls(action: string) {
  return h.lensRun.mock.calls.filter((c) => (c as unknown[])[1] === action);
}

beforeEach(() => {
  h.lensRun.mockReset();
  Object.values(h.inf).forEach((f) => f.mockReset());
  h.lensRun.mockImplementation(async (...a: unknown[]) => {
    const action = (a as unknown[])[1];
    if (action === 'kb-list') return { data: { ok: true, result: { facts: [{ id: 'fact_1', subject: 'socrates', predicate: 'is', object: 'mortal', args: ['socrates', 'mortal'] }], rules: [], factCount: 1, ruleCount: 0, predicates: {} } } };
    return { data: { ok: true, result: {} } };
  });
  h.inf.status.mockResolvedValue({ data: { status: { factCount: 1, ruleCount: 0, engine: 'ready' } } });
  // The query payload's facts carry no id — the panel must resolve it.
  h.inf.query.mockResolvedValue({ data: { facts: [{ subject: 'socrates', predicate: 'is', object: 'mortal', negated: false, source: 'manual' }], contradictions: [], confidence: 0.8 } });
  h.inf.facts.mockResolvedValue({ data: { ok: true, added: 1 } });
});

describe('FIX-inference-004 facts panel delete', () => {
  it('arm names the fact; confirm fires kb-remove with the kb-list id', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><InferenceDeskPanel mode="facts" /></QueryClientProvider>);
    const arm = await screen.findByLabelText('Delete fact socrates is mortal');
    fireEvent.click(arm);
    expect(calls('kb-remove')).toHaveLength(0); // arm alone fires nothing
    fireEvent.click(await screen.findByText('Delete fact?'));
    await waitFor(() => expect(calls('kb-remove')).toHaveLength(1));
    expect((calls('kb-remove')[0] as unknown[])[2]).toMatchObject({ id: 'fact_1' });
  });
});
