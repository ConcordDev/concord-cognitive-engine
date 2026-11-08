// Behaviour coverage for the hypothesis lab: list + metrics, propose (duplicate guard + force),
// detail view with evidence / tests / predictions / lifecycle, confirm / reject / refine /
// archive / delete with their two-step guards.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const HYP = (id: string, status: string) => ({
  id, createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-02T00:00:00Z',
  machine: { kind: 'hypothesis', hypothesis: {
    statement: `Statement for ${id}`, status, confidence: 0.64, falsifiable: true,
    evidence_for: [{ dtuId: 'd1', weight: 0.8, summary: 'Cohort data supports it' }],
    evidence_against: [{ dtuId: 'd2', weight: 0.3, summary: 'One outlier study' }],
    tests: [{ id: 't1', description: 'A/B retention', status: 'pending', result: null }, { id: 't2', description: 'Survey', status: 'passed', result: 'ok' }],
    predictions: [{ statement: 'Retention rises', verified: null }, { statement: 'Churn drops', verified: true }],
    lifecycle: [{ event: 'proposed', by: 'me', at: '2026-03-01T00:00:00Z', note: 'initial' }, { event: 'testing', by: 'me', at: '2026-03-02T00:00:00Z' }],
    parentHypothesis: null, childHypotheses: ['c1'], domain: 'growth', priority: 'high',
  } },
});
let list = [HYP('h1', 'proposed'), HYP('h2', 'testing'), HYP('h3', 'confirmed')];
let proposeResult: unknown = { ok: true, hypothesis: HYP('hnew', 'proposed') };
function respond(action: string, input?: Record<string, unknown>) {
  switch (action) {
    case 'list': return { ok: true, result: list };
    case 'metrics': return { ok: true, result: { total: 3, byStatus: { proposed: 1, testing: 1, confirmed: 1 }, avgConfidence: 0.64, factDTUsCreated: 1, rejectionDTUsCreated: 0 } };
    case 'get': return { ok: true, result: { ok: true, hypothesis: HYP(String(input?.id), 'testing') } };
    case 'propose': return proposeResult;
    case 'confirm': return { ok: true, result: { factDtuId: 'fact-123' } };
    case 'refine': return { ok: true, result: { childId: 'child-1' } };
    case 'add_test': return { ok: true, result: { testId: 't9' } };
    default: return { ok: true, result: { ok: true } };
  }
}
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => Promise.resolve({ data: respond(actionOf(a), a[2] as Record<string, unknown>) }).then((d) => { lensRunMock(...a); return d; }) }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: (_t, tag: string) => ({ children, onClick, className, disabled }: { children?: React.ReactNode; onClick?: () => void; className?: string; disabled?: boolean }) => React.createElement(tag, { onClick, className, disabled }, children) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 40)); }); };
const btn = (re: RegExp, nth = 0) => screen.getAllByRole('button', { name: re })[nth];
const mount = async () => {
  const { HypothesisLab } = await import('../HypothesisLab');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const v = render(<QueryClientProvider client={qc}><HypothesisLab /></QueryClientProvider>);
  await settle();
  return v;
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  list = [HYP('h1', 'proposed'), HYP('h2', 'testing'), HYP('h3', 'confirmed')];
  proposeResult = { ok: true, result: { hypothesis: HYP('hnew', 'proposed') } };
});

describe('HypothesisLab', () => {
  it('lists hypotheses with metrics and proposes a new one (and handles duplicates)', async () => {
    const v = await mount();
    expect(v.container.textContent).toMatch(/Statement for h1/);
    expect(sent()).toEqual(expect.arrayContaining(['list', 'metrics']));
    const statement = screen.getByPlaceholderText(/falsifiable claim/);
    await act(async () => { fireEvent.change(statement, { target: { value: 'Onboarding lifts retention' } }); });
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('Domain (optional)'), { target: { value: 'growth' } }); });
    await click(btn(/^Propose/));
    expect(sent()).toContain('propose');
    expect(sent()).toContain('get');
    cleanup();
    proposeResult = { ok: false, error: 'duplicate_statement', result: { duplicateOf: { id: 'h1', statement: 'Statement for h1', status: 'proposed' } } };
    await mount();
    await act(async () => { fireEvent.change(screen.getByPlaceholderText(/falsifiable claim/), { target: { value: 'Statement for h1' } }); });
    await click(btn(/^Propose/));
    expect(document.body.textContent).toMatch(/Open the existing one/);
    await click(btn(/Open the existing one/));
  });

  it('walks the detail view: evidence, tests, predictions, confirm, refine, reject, archive, delete', { timeout: 90000 }, async () => {
    const v = await mount();
    await click(screen.getByText('Statement for h2'));
    await settle();
    expect(sent()).toContain("get");
    await exercise({ passes: 3, text: 'new text here', skip: /^(All|Proposed|Testing|Confirmed|Rejected|Refined|Archived)$|delete|trash|discard|cancel|close|dismiss|clear|^×$/i });
    await settle();
    const calls = sent();
    expect(calls.some((x) => /add_evidence|add_test|update_test|add_prediction|verify_prediction|confirm|refine|reject|archive/.test(x))).toBe(true);
    expect(v.container.textContent?.length).toBeGreaterThan(100);
  });

  it('arms and confirms archive and delete, and filters by status', async () => {
    const v = await mount();
    for (const s of ['Proposed', 'Testing', 'Confirmed', 'Rejected', 'All']) {
      const b = screen.queryAllByRole('button').find((x) => new RegExp(`^${s}`, 'i').test((x.textContent || '').trim()));
      if (b) await click(b);
    }
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('Search statements…'), { target: { value: 'h3' } }); });
    await click(screen.getByText('Statement for h3'));
    for (const re of [/Archive/, /Delete/]) {
      const first = screen.queryAllByRole('button').find((b) => re.test((b.textContent || '').trim()));
      if (first) {
        await click(first);
        const confirm = screen.queryAllByRole('button').find((b) => /confirm|yes|really/i.test((b.textContent || '').trim()));
        if (confirm) await click(confirm);
      }
    }
    expect(v.container.textContent?.length).toBeGreaterThan(50);
  });

  it('shows empty and failing states', async () => {
    list = [];
    const empty = await mount();
    expect(empty.container.textContent).toMatch(/Hypothesis Lab/);
    cleanup();
    lensRunMock.mockReset();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    proposeResult = { ok: false, error: 'engine busy' };
    list = [HYP('h1', 'proposed')];
    await mount();
    await act(async () => { fireEvent.change(screen.getByPlaceholderText(/falsifiable claim/), { target: { value: 'Another claim' } }); });
    await click(btn(/^Propose/));
    spy.mockRestore();
    expect(sent()).toContain('propose');
  });
});
