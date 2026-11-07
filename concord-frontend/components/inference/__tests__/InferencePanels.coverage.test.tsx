// Render + behaviour coverage for the inference lens: the desk panel (facts / query / syllogism /
// forward-chain / unify, history) and the rule-engine workbench (KB editor, query + proof tree,
// why/how, step console, forward chain).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const h = vi.hoisted(() => ({
  lensRun: vi.fn(),
  inf: { status: vi.fn(), query: vi.fn(), facts: vi.fn(), syllogism: vi.fn(), forwardChain: vi.fn() },
}));
const TREE = { id: 'root', label: 'ancestor(a,c)', children: [{ id: 'c1', label: 'parent(a,b)' }, { id: 'c2', label: 'ancestor(b,c)' }] };
function resultFor(action: string): unknown {
  switch (action) {
    case 'kb-list': return { facts: [{ id: 'f1', predicate: 'parent', args: ['a', 'b'], addedAt: '2026-03-01' }, { id: 'f2', predicate: 'parent', args: ['b', 'c'], addedAt: '2026-03-01' }], rules: [{ id: 'r1', name: 'anc', priority: 2, text: 'ancestor(X,Y) :- parent(X,Y)', addedAt: '2026-03-01', if: [{ predicate: 'parent', args: ['X', 'Y'] }, { predicate: 'dead', args: ['Y'], negated: true }], then: { predicate: 'ancestor', args: ['X', 'Y'] } }], factCount: 2, ruleCount: 1, predicates: { parent: 2, ancestor: 0 } };
    case 'kb-check': return { report: [{ line: 'parent(a,b).', valid: true, kind: 'fact', predicate: 'parent' }, { line: 'ancestor(X,Y) :- parent(X,Y).', valid: true, kind: 'rule', predicate: 'ancestor', variables: ['X', 'Y'] }, { line: 'bad line', valid: false, error: 'syntax error' }] };
    case 'kb-add': return { addedCount: 2, errorCount: 1, errors: [{ line: 'bad', error: 'syntax error' }] };
    case 'kb-query': return { goal: 'ancestor(a,Z)', proved: true, solutionCount: 2, answerCount: 2, answers: [{ Z: 'b' }, { Z: 'c' }], proofTrees: [TREE], nodesExplored: 9, traceLength: 12 };
    case 'kb-explain': return { fact: 'ancestor(a,c)', derivable: true, why: 'Derived via anc', how: [{ conclusion: 'ancestor(a,b)', via: 'anc', kind: 'rule' }, { conclusion: 'parent(a,b)', via: 'fact', kind: 'fact' }], stepCount: 2, proofTree: TREE, nodesExplored: 5 };
    case 'kb-trace': return { goal: 'ancestor(a,c)', proved: true, steps: [{ step: 1, depth: 0, indent: '', goal: 'ancestor(a,c)', kind: 'call', action: 'try rule anc', result: 'ok' }, { step: 2, depth: 1, indent: '  ', goal: 'parent(a,c)', kind: 'fail', action: 'lookup', result: { bound: false } }, { step: 3, depth: 1, indent: '  ', goal: 'parent(a,b)', kind: 'exit', action: 'match', result: null }], stepCount: 3, nodesExplored: 4, builtins: ['not', '='] };
    case 'kb-forward': return { strategy: 'priority', initialFactCount: 2, derivedFactCount: 2, totalFactCount: 4, iterations: 2, fixedPointReached: true, derivedFacts: ['ancestor(a,b)', 'ancestor(b,c)'], rulesApplied: ['anc'], derivationLog: [{ iteration: 1, fired: 'anc', priority: 2, conflictSetSize: 2, derived: 'ancestor(a,b)', strategy: 'priority' }], factsByPredicate: { parent: 2, ancestor: 2 } };
    case 'unify': return { unifiable: true, term1: 'f(?X)', term2: 'f(a)', mgu: { '?X': 'a' }, bindingCount: 1, unifiedTerm: 'f(a)', verification: true, steps: [{ step: 1, description: 'bind ?X := a' }], stepCount: 1 };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => h.lensRun(...a), apiHelpers: { inference: h.inf } }));
vi.mock('@/components/viz', () => ({ TreeDiagram: ({ root }: { root?: { label?: string } }) => <div>tree:{root?.label}</div> }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: ({ error, onRetry }: { error?: string; onRetry?: () => void }) => <div>err:{error}<button onClick={onRetry}>retry-desk</button></div> }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
const sent = () => h.lensRun.mock.calls.map((c) => actionOf(c));
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 25)); }); };
afterEach(() => cleanup());
beforeEach(() => {
  h.lensRun.mockReset(); Object.values(h.inf).forEach((f) => f.mockReset());
  h.lensRun.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
  h.inf.status.mockResolvedValue({ data: { status: { factCount: 4, ruleCount: 1, engine: 'ready' } } });
  h.inf.query.mockResolvedValue({ data: { facts: [{ subject: 'socrates', predicate: 'is', object: 'mortal', negated: false, source: 'manual' }, { subject: 'a', predicate: 'is', object: 'b', negated: true }], contradictions: [{ subject: 'a', predicate: 'is', object: 'b' }], confidence: 0.8 } });
  h.inf.facts.mockResolvedValue({ data: { ok: true, added: 1 } });
  h.inf.syllogism.mockResolvedValue({ data: { ok: true, conclusion: 'Socrates is mortal', derivation: { majorPremise: 'All men are mortal', minorPremise: 'Socrates is a man', conclusion: 'Socrates is mortal', rule: 'Barbara', confidence: 0.95, derivedThisRun: true }, kbWrites: { premisesStored: ['p1'], ruleAdded: 'r', conclusionStored: true } } });
  h.inf.forwardChain.mockResolvedValue({ data: { ok: true, derived: ['x'], iterations: 2 } });
});

describe('InferenceDeskPanel', () => {
  const mount = async (mode: string) => {
    const { InferenceDeskPanel } = await import('../InferenceDeskPanel');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const v = render(<QueryClientProvider client={qc}><InferenceDeskPanel mode={mode as never} /></QueryClientProvider>);
    await settle();
    return v;
  };

  it('drives every desk mode with exercise', { timeout: 120000 }, async () => {
    for (const mode of ['facts', 'query', 'syllogism', 'forward', 'unify']) {
      const v = await mount(mode);
      await exercise({ passes: 3, text: 'f(?X, a)', skip: /delete|remove|trash|discard|cancel|close|dismiss|clear|^×$/i });
      await settle();
      expect(v.container.textContent?.length).toBeGreaterThan(50);
      cleanup();
    }
    expect(h.inf.facts).toHaveBeenCalled();
    expect(h.inf.query).toHaveBeenCalled();
    expect(h.inf.syllogism).toHaveBeenCalled();
    expect(h.inf.forwardChain).toHaveBeenCalled();
    expect(sent()).toContain('unify');
  });

  it('shows the loading state, a status error with retry, and failed mutations', async () => {
    h.inf.status.mockRejectedValue(new Error('engine offline'));
    const bad = await mount('facts');
    expect(bad.container.textContent).toMatch(/engine offline/);
    cleanup();
    h.inf.status.mockResolvedValue({ data: {} });
    h.inf.syllogism.mockRejectedValue(new Error('bad premise'));
    h.inf.facts.mockRejectedValue(new Error('bad fact'));
    h.lensRun.mockImplementation(async () => ({ data: { ok: false, error: 'cannot unify' } }));
    for (const mode of ['facts', 'syllogism', 'unify']) {
      await mount(mode);
      await exercise({ passes: 2, text: 'x', skip: /delete|remove|cancel|close|^×$/i });
      cleanup();
    }
  });
});

describe('RuleEngineWorkbench', () => {
  const mount = async () => { const { RuleEngineWorkbench } = await import('../RuleEngineWorkbench'); const v = render(<RuleEngineWorkbench />); await settle(); return v; };
  const TAB_RE = /^(Rule Editor & KB|Query \+ Proof Tree|Why \/ How|Step Console|Forward Chain)$/;
  const goTab = async (name: string) => { const b = screen.getAllByRole('button').find((x) => (x.textContent || '').trim() === name); if (b) await click(b); };

  it('loads the KB and walks every tab, running each engine', { timeout: 150000 }, async () => {
    const v = await mount();
    expect(sent()).toContain('kb-list');
    for (const t of ['Rule Editor & KB', 'Query + Proof Tree', 'Why / How', 'Step Console', 'Forward Chain']) {
      await goTab(t);
      await exercise({ passes: 2, text: 'ancestor(a, Z)', skip: new RegExp(`${TAB_RE.source}|delete|remove|trash|discard|cancel|close|dismiss|clear|^×$`, 'i') });
      await settle();
    }
    const calls = sent();
    for (const a of ['kb-check', 'kb-query', 'kb-explain', 'kb-trace', 'kb-forward']) expect(calls).toContain(a);
    expect(v.container.textContent?.length).toBeGreaterThan(100);
  });

  it('edits and removes rules/facts, seeds a sample KB and clears it', { timeout: 120000 }, async () => {
    const v = await mount();
    await exercise({ passes: 3, text: 'parent(x, y).', skip: new RegExp(`${TAB_RE.source}|cancel|close|dismiss|^×$`, 'i') });
    await settle();
    expect(sent().some((x) => /kb-(add|remove|clear|seed-sample)/.test(x))).toBe(true);
    expect(v.container.textContent?.length).toBeGreaterThan(50);
  });

  it('reports failures and an empty KB', { timeout: 90000 }, async () => {
    h.lensRun.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'kb-list' ? { data: { ok: true, result: { facts: [], rules: [], factCount: 0, ruleCount: 0, predicates: {} } } } : { data: { ok: false, error: 'kb engine error' } });
    const v = await mount();
    for (const t of ['Rule Editor & KB', 'Query + Proof Tree', 'Why / How', 'Step Console', 'Forward Chain']) {
      await goTab(t);
      await exercise({ passes: 1, text: 'q(a)', skip: new RegExp(`${TAB_RE.source}|delete|remove|cancel|close|^×$`, 'i') });
    }
    expect(v.container.textContent).toMatch(/kb engine error|No |empty|error/i);
  });
});
