/**
 * Reasoning chains — the analysis engines run on the selected chain
 * (FIX-reasoning-001).
 *
 * Three defects compounded into "chain actions fail, Assess Strength
 * shows nothing, Analysis shows Steps 0 and dead buttons":
 *  1. The Analysis table read `chain.steps.length`, but list_chains
 *     returns slim rows { stepCount, status, type } — Steps showed 0
 *     for every chain, Status showed Open for concluded chains.
 *  2. Both panels routed the stateless engines through a synced
 *     'chain' DTU artifact that only ChainProofPanel's seed effect
 *     ever created. Analysis disabled its buttons unless that artifact
 *     existed; ChainProof's handlers silently returned without one.
 * The engines now run through lensRun against the selected chain's
 * params — the pattern server/domains/reasoning.js documents — and
 * these pins drive the real panels against the REAL reasoning lens
 * actions (imported from the server domain), with the REST chain
 * payloads in the real list_chains / get_trace contract shapes.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The real server lens actions, captured through their registrar.
import registerReasoningActions from '../../server/domains/reasoning.js';

const serverActions: Record<string, (ctx: unknown, artifact: unknown, params: never) => unknown> = {};
registerReasoningActions((domain: string, name: string, fn: never) => {
  serverActions[`${domain}.${name}`] = fn as never;
});
// The server.js frontend-action aliases ChainProofPanel calls by name.
const ALIASES: Record<string, string> = {
  validate_logic: 'logicValidate',
  check_fallacies: 'fallacyDetect',
  assess_strength: 'strengthAssessment',
};

const CHAIN_ROW = { id: 'chain_1', question: 'Is Socrates mortal?', type: 'deductive', status: 'active', stepCount: 1, confidence: 0.9 };
const TRACE = {
  chainId: 'chain_1',
  question: 'Is Socrates mortal?',
  steps: [{ index: 0, type: 'DEDUCTION', premises: ['All humans are mortal'], conclusion: 'Socrates is mortal', justification: 'Socrates is human', rule: '', confidence: 0.9 }],
  assumptions: [],
  conclusion: null,
  overallConfidence: 0.9,
};

const lensRun = vi.fn(async (domain: string, action: string, input: Record<string, unknown>) => {
  const target = ALIASES[action] || action;
  const fn = serverActions[`${domain}.${target}`];
  if (!fn) return { data: { ok: false, result: null, error: `no action ${domain}.${action}` } };
  // /api/lens/run semantics: the input becomes both artifact.data and params.
  const out = fn({ userId: 'u1', actor: { userId: 'u1' } }, { data: input }, input as never) as { ok: boolean; result?: unknown; error?: string };
  return { data: { ok: out.ok, result: out.result ?? null, error: out.error ?? null } };
});

let traceHits = 0;
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...(a as [string, string, Record<string, unknown>])),
  // The artifact store is EMPTY — no 'chain' artifact exists anywhere.
  // (On the pre-fix panels this is exactly what disabled the Analysis
  // buttons and silenced ChainProof's handlers.)
  api: {
    get: async () => ({ data: { ok: true, artifacts: [], total: 0 } }),
    post: async () => ({ data: { ok: true, result: {} } }),
    put: async () => ({ data: { ok: true } }),
    delete: async () => ({ data: { ok: true } }),
  },
  apiHelpers: {
    reasoning: {
      list: async () => ({ data: { ok: true, chains: [CHAIN_ROW] } }),
      trace: async () => { traceHits++; return { data: { ok: true, trace: TRACE } }; },
      create: async () => ({ data: { ok: true, chain: CHAIN_ROW } }),
      addStep: async () => ({ data: { ok: true } }),
      conclude: async () => ({ data: { ok: true } }),
    },
  },
}));

import { AnalysisPanel } from '@/components/reasoning/AnalysisPanel';
import { ChainProofPanel } from '@/components/reasoning/ChainProofPanel';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
async function until(pred: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('until: timed out');
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
}

beforeEach(() => { lensRun.mockClear(); traceHits = 0; });
afterEach(() => { cleanup(); });

describe('reasoning chain analysis (FIX-reasoning-001)', () => {
  it('Analysis shows the real step count and its engines are enabled without any synced artifact', async () => {
    wrap(<AnalysisPanel />);
    await until(() => screen.queryByText('Is Socrates mortal?') != null);
    // Steps column reads stepCount from the list contract — 1, not 0.
    const row = screen.getByText('Is Socrates mortal?').closest('tr')!;
    expect(row.textContent).toContain('1');
    expect(screen.getByText('deductive')).toBeInTheDocument();

    const strengthBtn = screen.getByRole('button', { name: /Full Strength Assessment/ });
    expect(strengthBtn).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Deep Analysis/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Generate Counter-Arguments/ })).not.toBeDisabled();

    fireEvent.click(screen.getByText('Is Socrates mortal?'));
    // The premises come from the selected chain's trace — wait for it
    // to land before running the engine.
    await until(() => traceHits > 0);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    fireEvent.click(strengthBtn);
    await until(() => document.body.textContent?.includes('"totalClaims"') ?? false);
    const call = lensRun.mock.calls.find((c) => c[1] === 'strengthAssessment');
    expect(call).toBeTruthy();
    expect(call![2]).toEqual({ premises: ['Socrates is mortal'], conclusion: 'Socrates is mortal' });
  });

  it('ChainProof Assess Strength runs and shows a result with no artifact sync', async () => {
    wrap(<ChainProofPanel />);
    await until(() => screen.queryByText('Is Socrates mortal?') != null);
    fireEvent.click(screen.getByText('Is Socrates mortal?'));
    const btn = screen.getByRole('button', { name: /Assess Strength/ });
    await until(() => !(btn as HTMLButtonElement).disabled);
    fireEvent.click(btn);
    await until(() => document.body.textContent?.includes('"totalClaims"') ?? false);
    const call = lensRun.mock.calls.find((c) => c[1] === 'assess_strength');
    expect(call).toBeTruthy();
    expect(call![2]).toEqual({ premises: ['Socrates is mortal'], conclusion: 'Socrates is mortal' });
  });
});
