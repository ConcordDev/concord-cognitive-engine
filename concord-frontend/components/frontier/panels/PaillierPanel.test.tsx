/// <reference types="@testing-library/jest-dom/vitest" />
// PaillierPanel — behavioral tests against a mocked /api/lens/run,
// exercising the REAL response envelope shape crypto.paillier* macros
// send over the wire (server/domains/crypto.js).
//
// Pins three things:
//   1. The happy-path session flow (open box -> cast -> reveal) calls the
//      real macros with the real param shapes (sessionId/value on
//      contribute, sessionId/mode on aggregate) and renders the real
//      decrypted aggregate from the response — never a client-computed
//      guess.
//   2. A cast plaintext is NEVER redisplayed anywhere in the DOM after a
//      successful cast — only the returned (opaque) ciphertext and a
//      count are shown. This is the load-bearing honesty property of the
//      whole panel.
//   3. paillierMultiplyCiphertexts renders as a real, honest refusal (the
//      verbatim message server/lib/crypto/paillier.js#multiplyCiphertexts
//      returns), not a fabricated pass and not a swallowed generic error.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const post = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => post(...a) },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import { PaillierPanel } from './PaillierPanel';
import { getFrontierEngine } from '@/lib/frontier-engines';

const engine = getFrontierEngine('paillier-aggregation')!;

// Real shape /api/lens/run sends over HTTP: one flat envelope,
// { ok:true, result:<payload> }, where <payload> is either the success
// payload directly or the refusal shape {ok:false, error, ...}.
function httpResponse(payload: unknown) {
  return { data: { ok: true, result: payload } };
}

function routeByAction(handlers: Record<string, (input: Record<string, unknown>) => unknown>) {
  post.mockImplementation((_url: string, body: { action: string; input: Record<string, unknown> }) => {
    const h = handlers[body.action];
    if (!h) return Promise.reject(new Error(`unexpected action ${body.action}`));
    return Promise.resolve(httpResponse(h(body.input)));
  });
}

beforeEach(() => {
  post.mockReset();
});

const KEYGEN_RESULT = {
  sessionId: 'phe_test_session',
  publicKey: { n: '1'.repeat(80), g: '2'.repeat(80), bits: 512 },
  bits: 512,
  ownerId: 'u1',
  note: 'The secret key stays server-side. Anyone with sessionId + publicKey can contribute an encrypted value; only the owner can call paillierAggregate to reveal the combined total.',
};

describe('PaillierPanel', () => {
  it('shows the idle Verify state and the persistent honest-boundary cell before any run', () => {
    render(<PaillierPanel engine={engine} />);
    expect(screen.getByText(/Run the compute cell above/)).toBeInTheDocument();
    expect(screen.getByText(engine.boundary!)).toBeInTheDocument();
    // Additively-homomorphic-only honesty point must appear verbatim.
    // Assert the REAL registry boundary text rather than a hand-typed phrase —
    // a hardcoded string here silently stops testing anything the moment the
    // canonical boundary in lib/frontier-engines.ts is reworded.
    expect(screen.getByText(engine.boundary!)).toBeInTheDocument();
  });

  it('opens a session, casts a value, and reveals the real aggregate — without ever redisplaying the plaintext', async () => {
    const CIPHERTEXT = '9'.repeat(120);
    routeByAction({
      paillierKeygen: (input) => {
        expect(input.bits).toBe(512);
        return KEYGEN_RESULT;
      },
      paillierContribute: (input) => {
        expect(input).toEqual({ sessionId: 'phe_test_session', value: 42 });
        return { sessionId: 'phe_test_session', contributionId: 'phec_1', contributorCount: 1, ciphertext: CIPHERTEXT };
      },
      paillierAggregate: (input) => {
        expect(input).toEqual({ sessionId: 'phe_test_session', mode: 'sum' });
        return {
          sessionId: 'phe_test_session',
          mode: 'sum',
          contributorCount: 1,
          rawValue: 42,
          differentialPrivacy: null,
          note: 'rawValue is the exact decrypted aggregate — Paillier gives confidentiality of individual inputs during computation, not privacy of the released output.',
        };
      },
    });

    render(<PaillierPanel engine={engine} />);

    fireEvent.click(screen.getByRole('button', { name: /Open ballot box/ }));
    await waitFor(() => expect(screen.getByText(/phe_test_session/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Integer value'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /^Cast$/ }));
    await waitFor(() => expect(screen.getByText('phec_1')).toBeInTheDocument());

    // The plaintext value is never shown again — only the opaque
    // (truncated) ciphertext and the input, which was cleared.
    expect(screen.queryByText('42')).not.toBeInTheDocument();
    expect((screen.getByLabelText('Integer value') as HTMLInputElement).value).toBe('');
    // The ciphertext preview is truncated, not the raw blob.
    expect(screen.queryByText(CIPHERTEXT)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reveal aggregate/ }));

    await waitFor(() => expect(screen.getByText(/Sum of 1 sealed entry = 42/)).toBeInTheDocument());
    expect(screen.getByText(/nothing was\s*decrypted along the way/)).toBeInTheDocument();
  });

  it('renders paillierMultiplyCiphertexts\' real refusal — not FHE, not a fabricated pass', async () => {
    routeByAction({
      paillierMultiplyCiphertexts: (input) => {
        expect(input).toEqual({});
        return {
          ok: false,
          error: 'fhe_required',
          reason:
            'Paillier is partially homomorphic (addition only): E(a) * E(b) does not ' +
            'decrypt to a*b, or to anything meaningful — it is not a valid operation in ' +
            'this scheme. Computing an encrypted product of two ciphertexts requires ' +
            'Fully Homomorphic Encryption (FHE — e.g. CKKS, BFV, BGV, or TFHE, which use ' +
            'bootstrapping to support unbounded multiplicative depth). This module does ' +
            'not implement FHE and does not claim to. Use addEncrypted() for E(a)+E(b), ' +
            'or multiplyPlaintext() to scale a ciphertext by a known plaintext constant.',
        };
      },
    });

    render(<PaillierPanel engine={engine} />);
    fireEvent.click(screen.getByRole('button', { name: /Try ciphertext × ciphertext/ }));

    await waitFor(() => expect(screen.getByText(/Honest refusal — not a fabricated pass\./)).toBeInTheDocument());
    expect(screen.getByText(/fhe_required/)).toBeInTheDocument();
    expect(screen.getByText(/Fully Homomorphic Encryption/)).toBeInTheDocument();
  });
});
