/// <reference types="@testing-library/jest-dom/vitest" />
// ModelCheckerPanel — behavioral tests against a mocked /api/lens/run,
// exercising the real `audit.modelCheck*` response envelope shape.
//
// Pins two things load-bearing to this panel's correctness:
//   1. A genuine `status:'violation'` result renders the real action-name
//      trace + violating state — never a fabricated pass.
//   2. `state_space_exhausted`/`depth_bound_reached` are a real, complete
//      finding from a bounded search, NOT the shell's generic "Honest
//      refusal" box — FrontierEngineShell's VerifyCell only renders
//      `children` when its `status` prop is 'ok', so if this panel ever
//      regresses to mapping those statuses to 'refused', this rich view
//      (states explored / bound / note) silently disappears behind the
//      shell's generic reason text. This test catches that regression.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// Spy on the real axios instance's `post` rather than vi.mock-ing the whole
// client module: this panel calls `lensRun`, which closes over the
// module-scoped `api`, so replacing the module's exports leaves `lensRun`
// undefined. Spying intercepts at call time and keeps the REAL envelope
// unwrap in lib/api/client.ts under test, which is the point here.
import { api } from '@/lib/api/client';
const post = vi.spyOn(api, 'post');

import { ModelCheckerPanel } from './ModelCheckerPanel';
import { getFrontierEngine } from '@/lib/frontier-engines';

const engine = getFrontierEngine('ledger-model-checker')!;

function httpResponse(payload: unknown) {
  return { data: { ok: true, result: payload } };
}
function routeByAction(handlers: Record<string, () => unknown>) {
  // Cast: axios's `post` is generic/overloaded, so a plain (url, body)
  // implementation isn't structurally assignable to its declared type.
  post.mockImplementation(((_url: string, body: { action: string }) => {
    const h = handlers[body.action];
    if (!h) return Promise.reject(new Error(`unexpected action ${body.action}`));
    return Promise.resolve(httpResponse(h()));
  }) as unknown as typeof api.post);
}

beforeEach(() => { post.mockReset(); });

describe('ModelCheckerPanel', () => {
  it('shows the idle Verify state and the persistent honest-boundary cell before any run', () => {
    render(<ModelCheckerPanel engine={engine} />);
    expect(screen.getByText(/Run the compute cell above/)).toBeInTheDocument();
    expect(screen.getByText(engine.boundary!)).toBeInTheDocument();
  });

  it('renders a real violation with the exact action-name trace and violating state — never a fabricated pass', async () => {
    routeByAction({
      modelCheckLedgerConservation: () => ({
        status: 'violation',
        invariant: 'circulating_never_exceeds_minted',
        message: 'circulating balance 598.54 exceeds total minted USD 500 — this is currency created from nothing.',
        trace: ['mint(alice,500)', 'transfer(alice->bob,100)'],
        state: { rows: [{ type: 'MINT', to: 'alice', amount: 500 }], mintedUsd: 500 },
        statesExplored: 5,
        bound: { maxStates: 5000, maxDepth: 6 },
        replay: { reproduced: true, finalState: { mintedUsd: 500 } },
      }),
    });
    render(<ModelCheckerPanel engine={engine} />);
    fireEvent.click(screen.getByRole('button', { name: /Run bounded check/ }));

    await waitFor(() => expect(screen.getByText('INVARIANT VIOLATED')).toBeInTheDocument());
    // The step label and the action name are separate nodes (`<span>Step N:</span> {action}`),
    // so assert on the enclosing <li> — getByText(/Step 1:/) returns only the label span.
    expect(screen.getByText(/Step 1:/).closest('li')).toHaveTextContent('mint(alice,500)');
    expect(screen.getByText(/Step 2:/).closest('li')).toHaveTextContent('transfer(alice->bob,100)');
    expect(screen.getByText(/reproduced the same violating state/)).toBeInTheDocument();

    const [, body] = post.mock.calls.at(-1)!;
    expect(body).toMatchObject({
      domain: 'audit',
      action: 'modelCheckLedgerConservation',
      input: { predicate: 'buggy', maxStates: 5000, maxDepth: 6 },
    });
  });

  it('renders a real no_violation_found result with its exhaustive-search caveat', async () => {
    routeByAction({
      modelCheckLedgerConservation: () => ({
        status: 'no_violation_found',
        exhaustive: true,
        statesExplored: 120,
        bound: { maxStates: 20000, maxDepth: 10 },
        note: 'the full reachable state graph of this bounded MODEL was explored with no invariant violation found. This is exhaustive for the abstract model only.',
      }),
    });
    render(<ModelCheckerPanel engine={engine} />);
    fireEvent.click(screen.getByLabelText(/Correct — the current CREDIT_ROW_PREDICATE/));
    fireEvent.click(screen.getByRole('button', { name: /Run bounded check/ }));

    await waitFor(() => expect(screen.getByText('No violation found (exhaustive)')).toBeInTheDocument());
    expect(screen.getByText(/exhaustive for the abstract model only/)).toBeInTheDocument();
  });

  it('renders state_space_exhausted as a real, complete finding (statesExplored/bound/note visible) — NOT hidden behind the generic refused box', async () => {
    routeByAction({
      modelCheckLedgerConservation: () => ({
        status: 'state_space_exhausted',
        exhaustive: false,
        statesExplored: 3,
        bound: { maxStates: 3, maxDepth: 100 },
        note: 'the state cap (maxStates) was reached before the reachable space was fully covered — this is NOT a proof that no violation exists beyond the explored region. Raise maxStates to search further.',
      }),
    });
    render(<ModelCheckerPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText(/Max states/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Run bounded check/ }));

    await waitFor(() => expect(screen.getByText('State cap reached — incomplete')).toBeInTheDocument());
    // The rich stats + note must be visible — this is the regression this file guards.
    expect(screen.getByText(/Raise maxStates to search further/)).toBeInTheDocument();
    expect(screen.getByText('States explored')).toBeInTheDocument();
    // Must NOT show the shell's generic refusal copy for this real, complete finding.
    expect(screen.queryByText(/Honest refusal — not a fabricated pass\./)).not.toBeInTheDocument();
  });

  it('renders the royalty cascade cap violation for real numbers when the cap is unchecked', async () => {
    routeByAction({
      modelCheckRoyaltyCascade: () => ({
        status: 'violation',
        invariant: 'royalty_never_exceeds_cap',
        message: 'royalty payout 310 exceeds 30% of sale amount 1000 (cap=300) across 3 ancestor(s).',
        trace: ['citeAncestor(1)', 'citeAncestor(2)', 'purchase(1000)'],
        state: { lastAmount: 1000, lastPayout: 310 },
        statesExplored: 8,
        bound: { maxStates: 5000, maxDepth: 10 },
        replay: { reproduced: true, finalState: { lastAmount: 1000, lastPayout: 310 } },
      }),
    });
    render(<ModelCheckerPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Invariant model'), { target: { value: 'royalty' } });
    fireEvent.click(screen.getByLabelText(/Enforce the 30% royalty cap/));
    fireEvent.click(screen.getByRole('button', { name: /Run bounded check/ }));

    await waitFor(() => expect(screen.getByText(/royalty payout 310 exceeds 30%/)).toBeInTheDocument());
    const [, body] = post.mock.calls.at(-1)!;
    expect(body).toMatchObject({ domain: 'audit', action: 'modelCheckRoyaltyCascade', input: { enforceCap: false } });
  });

  it('renders a genuine handler exception as an honest error, never dressed up as a completed check', async () => {
    routeByAction({
      modelCheckLedgerConservation: () => ({ ok: false, error: 'handler_error', message: 'unexpected token' }),
    });
    render(<ModelCheckerPanel engine={engine} />);
    fireEvent.click(screen.getByRole('button', { name: /Run bounded check/ }));

    await waitFor(() => expect(screen.getByText('Request failed.')).toBeInTheDocument());
    expect(screen.getByText('handler_error')).toBeInTheDocument();
  });
});
