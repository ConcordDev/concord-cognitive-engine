/// <reference types="@testing-library/jest-dom/vitest" />
// ConsensusPanel — behavioral tests against a mocked /api/lens/run,
// exercising the real `mesh.consensus*` response envelope shape (see
// server/domains/mesh.js + server/lib/consensus/hash-dag.js).
//
// Mocks `api.post` (not `lensRun`) so the tests run through the REAL
// envelope-unwrap logic in lib/api/client.ts, the same convention
// QecDecoderPanel.test.tsx / ModelCheckerPanel.test.tsx use — the panel
// calls `lensRun`, and `lensRun` closes over the module-scoped `api`
// object, so replacing the module's exports would leave `lensRun`
// undefined.
//
// Two things this file pins on purpose:
//   1. Equivocation detection is driven by real consensusAppend/
//      consensusMergeRemote calls made THIS session, not a canned
//      scenario — and (per the panel's own header comment, verified
//      against hash-dag.js) an honest single-identity session can only
//      ever produce ZERO evidence, because appendUpdate always signs off
//      the CURRENT heads and the signing key never leaves the server.
//      That "0 evidence" outcome is itself the real, correct answer this
//      test pins — a non-zero-evidence scenario is not exercised because
//      the real API structurally cannot produce one from an honest caller
//      (see the file-header architectural finding), so fabricating one
//      here would test a code path the real backend can't reach.
//   2. The DAG's tamper/authenticity defense IS demonstrable end-to-end:
//      append a real record, resubmit it with one field edited via the
//      "tamper" checkbox, and the mocked consensusMergeRemote responds
//      with the real `hash_mismatch` rejection shape hash-dag.js#mergeRemote
//      produces when the recomputed hash no longer matches the claimed one.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import { api } from '@/lib/api/client';
const post = vi.spyOn(api, 'post');

import { ConsensusPanel } from './ConsensusPanel';
import { getFrontierEngine } from '@/lib/frontier-engines';

const engine = getFrontierEngine('byzantine-consensus')!;

function httpResponse(payload: unknown) {
  return { data: { ok: true, result: payload } };
}

type Body = { action: string; input: Record<string, unknown> };
function routeByAction(handlers: Record<string, (body: Body) => unknown>) {
  // Cast: axios's `post` is generic/overloaded, so a plain (url, body)
  // implementation isn't structurally assignable to its declared type.
  post.mockImplementation(((_url: string, body: Body) => {
    const h = handlers[body.action];
    if (!h) return Promise.reject(new Error(`unexpected action ${body.action}`));
    return Promise.resolve(httpResponse(h(body)));
  }) as unknown as typeof api.post);
}

beforeEach(() => { post.mockReset(); });

const STATUS_INITIAL = {
  nodeId: 'user-7f3a',
  publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...\n-----END PUBLIC KEY-----',
  heads: [] as string[],
  size: 0,
  deferred: 0,
  knownAuthors: 0,
};

async function renderAndWaitForStatus(extraHandlers: Record<string, (body: Body) => unknown> = {}) {
  routeByAction({ consensusStatus: () => STATUS_INITIAL, ...extraHandlers });
  render(<ConsensusPanel engine={engine} />);
  await waitFor(() => expect(screen.getByText('user-7f3a…')).toBeInTheDocument());
}

describe('ConsensusPanel', () => {
  it('shows the idle Verify state, the loaded node status bar, and the persistent honest-boundary cell before any run', async () => {
    await renderAndWaitForStatus();
    expect(screen.getByText(/Run the compute cell above/)).toBeInTheDocument();
    expect(screen.getByText(engine.boundary!)).toBeInTheDocument();
    // Real fields from consensusStatus, not fabricated.
    expect(screen.getByText('(none yet)')).toBeInTheDocument(); // heads
    expect(screen.getAllByText('0').length).toBeGreaterThan(0); // size / deferred / knownAuthors
  });

  it('appends a real record, then resubmits it tampered and gets the real hash_mismatch rejection — not a canned scenario', async () => {
    // A 64-char hex-shaped hash (sha256 digest length), as computeNodeHash
    // in hash-dag.js would produce — used consistently between the append
    // response and the merge-rejection response below.
    const HASH_A = 'a1'.repeat(32);
    const EXPECTED_HASH = 'b2'.repeat(32);

    const recordA = {
      nodeId: 'user-7f3a',
      payload: { key: 'balance:alice', value: 'paid' },
      parents: [] as string[],
      vectorClock: { 'user-7f3a': 1 },
      signature: 'c2lnbmF0dXJlLWJhc2U2NA==',
      publicKeyPem: STATUS_INITIAL.publicKeyPem,
      hash: HASH_A,
    };

    await renderAndWaitForStatus({
      consensusAppend: () => ({ record: recordA, heads: [HASH_A], size: 1 }),
      // The real hash-DAG rejection shape: `mergeRemote` recomputes the hash
      // from the (now-tampered) claimed content and compares it to the
      // claimed hash — a mismatch is refused BEFORE signature verification
      // even runs, per hash-dag.js#mergeRemote.
      consensusMergeRemote: (body) => {
        const rec = body.input.record as { hash: string; payload: { value: string } };
        const rejected = rec.hash === HASH_A && rec.payload.value !== 'paid';
        if (rejected) {
          return {
            merge: { ok: false, error: 'hash_mismatch', expected: EXPECTED_HASH, claimed: HASH_A },
            heads: [HASH_A],
            size: 1,
            deferred: 0,
          };
        }
        return { merge: { ok: true, integrated: true, hash: rec.hash }, heads: [rec.hash], size: 2, deferred: 0 };
      },
    });

    // Step 1: real consensusAppend, default action/key/value ('balance:alice' = 'paid').
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText(/consensusAppend\(balance:alice = paid\)/)).toBeInTheDocument());
    expect(screen.getByText(new RegExp(`new head ${HASH_A.slice(0, 10)}`))).toBeInTheDocument();
    expect(screen.getByText(/parents \[none — genesis\]/)).toBeInTheDocument();
    const [, appendBody] = post.mock.calls.find(([, b]) => (b as Body).action === 'consensusAppend')!;
    expect(appendBody).toMatchObject({ domain: 'mesh', action: 'consensusAppend', input: { key: 'balance:alice', value: 'paid' } });

    // Step 2: switch to merge, tamper the value (the real record from step 1
    // is auto-selected via selectedHash), and resubmit.
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'merge' } });
    expect(screen.getByLabelText(/Record to re-submit/)).toHaveValue(HASH_A);
    fireEvent.click(screen.getByLabelText(/Tamper the value before re-merging/));
    expect(screen.getByLabelText('Tampered value')).toHaveValue('TAMPERED');

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText(/REJECTED: hash_mismatch/)).toBeInTheDocument());
    expect(screen.getByText(/the tampered payload no longer matches its own signed hash, so it was refused before integration/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`expected hash ${EXPECTED_HASH.slice(0, 10)}`))).toBeInTheDocument();

    const [, mergeBody] = post.mock.calls.find(([, b]) => (b as Body).action === 'consensusMergeRemote')!;
    expect(mergeBody).toMatchObject({ domain: 'mesh', action: 'consensusMergeRemote' });
    const sentRecord = (mergeBody as Body).input.record as { hash: string; payload: { value: string; key: string } };
    expect(sentRecord.hash).toBe(HASH_A); // tamperer never recomputes the hash — that's the whole defense
    expect(sentRecord.payload.value).toBe('TAMPERED');
    expect(sentRecord.payload.key).toBe('balance:alice');
  });

  it('reads materialized state via consensusState — order + folded key/value, never fabricated', async () => {
    const HASH_A = 'c3'.repeat(32);
    await renderAndWaitForStatus({
      consensusState: () => ({
        order: [HASH_A],
        state: { 'balance:alice': 'paid' },
        heads: [HASH_A],
        size: 1,
      }),
    });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'state' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText(/consensusState\(\)/)).toBeInTheDocument());
    expect(screen.getByText(new RegExp(`order \\(git-log-style, oldest→newest\\): ${HASH_A.slice(0, 10)}`))).toBeInTheDocument();
    expect(screen.getByText(/"balance:alice": "paid"/)).toBeInTheDocument();
  });

  it('renders 0 equivocation evidence with the honest architectural explanation — not silently, and not as a failure', async () => {
    await renderAndWaitForStatus({
      consensusEquivocation: () => ({ evidence: [], count: 0 }),
    });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'equivocation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText(/consensusEquivocation\(\)/)).toBeInTheDocument());
    expect(screen.getByText(
      /0 evidence\. Every message in this replica came from a real appendUpdate off the then-current heads/,
    )).toBeInTheDocument();
    expect(screen.getByText(/a single identity cannot equivocate against itself through this API/)).toBeInTheDocument();

    const [, body] = post.mock.calls.find(([, b]) => (b as Body).action === 'consensusEquivocation')!;
    // Default is scoped to self — real nodeId from the loaded status, not blank.
    expect(body).toMatchObject({ domain: 'mesh', action: 'consensusEquivocation', input: { nodeId: 'user-7f3a' } });
  });

  it('renders a genuine handler exception as a real request failure, never a fabricated pass', async () => {
    await renderAndWaitForStatus({
      consensusEquivocation: () => ({ ok: false, error: 'consensusEquivocation failed' }),
    });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'equivocation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText('Request failed.')).toBeInTheDocument());
    expect(screen.getByText('consensusEquivocation failed')).toBeInTheDocument();
  });
});
