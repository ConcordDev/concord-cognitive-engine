/// <reference types="@testing-library/jest-dom/vitest" />
// FsiPanel — behavioral test against a mocked /api/lens/run.
//
// Pins the refusal path end-to-end: a turbulent-regime refusal from
// `engineering.fsiCheck` (a real, reachable `checkFsiGate` outcome —
// see server/tests/fsi-gate.test.js's own "refuses a turbulent-regime
// input" case) renders as VerifyCell's honest 'refused' state, with the
// real reason AND the extra honest fields (Re, regime) the refusal
// carries — `reasonDetailToText` reads these from `runFrontierMacro`'s
// preserved `refusal` object, which the now-fixed AlertCircle import
// (this file's sibling FrontierEngineShell.tsx bug, found and fixed
// while building this suite) no longer crashes before this renders.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const post = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => post(...a) },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import { FsiPanel } from './FsiPanel';
import { getFrontierEngine } from '@/lib/frontier-engines';

const engine = getFrontierEngine('non-newtonian-fsi')!;

function httpResponse(payload: unknown) {
  return Promise.resolve({ data: { ok: true, result: payload } });
}

describe('FsiPanel', () => {
  it('renders a turbulent-regime refusal honestly, with the real Re/regime detail preserved', async () => {
    post.mockImplementation(() =>
      httpResponse({
        ok: false,
        error: 'non_laminar_regime_unsupported',
        Re: 4821.3,
        regime: 'turbulent',
        residualHistory: [],
      }),
    );

    render(<FsiPanel engine={engine} />);
    fireEvent.click(screen.getByRole('button', { name: /Run FSI check/ }));

    await waitFor(() => expect(screen.getByText(/Honest refusal — not a fabricated pass\./)).toBeInTheDocument());
    expect(screen.getByText(/non_laminar_regime_unsupported/)).toBeInTheDocument();
    expect(screen.getByText(/Re=4821\.3/)).toBeInTheDocument();
    expect(screen.getByText(/regime=turbulent/)).toBeInTheDocument();

    // Honest boundary cell always renders regardless of run outcome.
    expect(screen.getByText(engine.boundary!)).toBeInTheDocument();
  });

  it('renders a genuinely computed (non-refused) structural fail as a real result', async () => {
    post.mockImplementation(() =>
      httpResponse({
        ok: false,
        converged: true,
        iterations: 5,
        flowRate: 1.2e-6,
        gapProfile: [0.009, 0.0085],
        mechanicalOnlyUtilization: null,
        combinedUtilization: 1.4,
        approximationCaveat: 'No wake, turbulence, or entrance-length effects.',
        residualHistory: [1e-2, 1e-3, 1e-5],
      }),
    );

    render(<FsiPanel engine={engine} />);
    fireEvent.click(screen.getByRole('button', { name: /Run FSI check/ }));

    await waitFor(() => expect(screen.getByText('Overall pass').nextElementSibling).toHaveTextContent('fail'));
    expect(screen.queryByText(/Honest refusal — not a fabricated pass\./)).not.toBeInTheDocument();
    expect(screen.getByText('Converged').nextElementSibling).toHaveTextContent('yes (5 iters)');
  });
});
