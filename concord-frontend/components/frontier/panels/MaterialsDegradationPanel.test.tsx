/// <reference types="@testing-library/jest-dom/vitest" />
// MaterialsDegradationPanel — behavioral tests against a mocked
// /api/lens/run, exercising the REAL response envelope shape
// `materials.durabilityCheck` sends over the wire.
//
// This pins two things at once:
//
//   1. The refusal path renders as a real, honest refusal (VerifyCell's
//      'refused' state, with the actual reason string) — never a
//      fabricated pass, never a swallowed generic error.
//
//   2. The bug `runFrontierMacro` (FrontierEngineShell.tsx) was written
//      to fix: `checkDurabilityGate`'s own `ok` field can genuinely be
//      `false` on a COMPLETED (non-refused) computation — a structure
//      that fails at its final sampled year, with real samples/baseline
//      data and no `reason`/`error` field. Verified directly against the
//      live engine (`server/lib/asset-gen/durability-gate.js`) before
//      writing this test: a real run with a large enough tip load
//      returns exactly this shape. The panel must render this as a real
//      "Verify" result (samples table, "fail" status) — NOT collapse it
//      into "Honest refusal" the way the generic `lensRun` helper did.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const post = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => post(...a) },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import { MaterialsDegradationPanel } from './MaterialsDegradationPanel';
import { getFrontierEngine } from '@/lib/frontier-engines';

const engine = getFrontierEngine('materials-degradation')!;

const DEGRADATION_CONSTANTS_RESULT = {
  materials: [
    {
      material: 'steel-a36',
      known: true,
      label: 'ASTM A36 Structural Steel (ferrite-pearlite)',
      mechanisms: { fatigue: true, thermal: false, moisture: false },
      paris: { C: 6.9e-12, m: 3.0, source: 'Barsom & Rolfe' },
      diffusion: null,
    },
  ],
  honestBoundary: engine.boundary,
};

// Real shape `/api/lens/run` sends over HTTP: one flat envelope,
// `{ ok:true, result:<payload> }`, where `<payload>` is either the
// success payload directly OR the refusal shape `{ok:false, error, ...}`.
function httpResponse(payload: unknown) {
  return { data: { ok: true, result: payload } };
}

function routeByAction(handlers: Record<string, () => unknown>) {
  post.mockImplementation((_url: string, body: { action: string }) => {
    const h = handlers[body.action];
    if (!h) return Promise.reject(new Error(`unexpected action ${body.action}`));
    return Promise.resolve(httpResponse(h()));
  });
}

beforeEach(() => {
  post.mockReset();
});

async function renderAndWaitForMaterials() {
  render(<MaterialsDegradationPanel engine={engine} />);
  await waitFor(() => expect(screen.getByRole('option', { name: /ASTM A36/ })).toBeInTheDocument());
}

describe('MaterialsDegradationPanel', () => {
  it('shows the idle Verify state and the persistent honest-boundary cell before any run', async () => {
    routeByAction({ degradationConstants: () => DEGRADATION_CONSTANTS_RESULT });
    await renderAndWaitForMaterials();
    expect(screen.getByText(/Run the compute cell above/)).toBeInTheDocument();
    expect(screen.getByText(engine.boundary!)).toBeInTheDocument();
  });

  it('renders a genuine refusal (unsupported_member_orientation) as an honest refusal, not a fabricated pass', async () => {
    routeByAction({
      degradationConstants: () => DEGRADATION_CONSTANTS_RESULT,
      durabilityCheck: () => ({ ok: false, error: 'unsupported_member_orientation', memberIds: ['m1'] }),
    });
    await renderAndWaitForMaterials();

    fireEvent.click(screen.getByRole('button', { name: /Run durability check/ }));

    await waitFor(() => expect(screen.getByText(/Honest refusal — not a fabricated pass\./)).toBeInTheDocument());
    expect(screen.getByText('unsupported_member_orientation')).toBeInTheDocument();
    // No fabricated samples table alongside a refusal.
    expect(screen.queryByText('Baseline utilization')).not.toBeInTheDocument();
  });

  it('renders a genuinely COMPUTED structural failure (ok:false, no reason) as a real result, not a refusal', async () => {
    // The exact shape verified against the live engine: check.ok===false
    // with real samples/baseline and no reason/error field, because the
    // beam genuinely fails at the sampled years rather than being refused
    // up front.
    routeByAction({
      degradationConstants: () => DEGRADATION_CONSTANTS_RESULT,
      durabilityCheck: () => ({
        ok: false,
        material: 'steel-a36',
        mechanisms: ['fatigue'],
        baseline: { utilization: 1.2 },
        samples: [
          { year: 0, allPass: false, utilization: 1.2, lawUsed: 'linear-damage-fraction-lemaitre-chaboche' },
          { year: 50, allPass: false, utilization: 1.3, lawUsed: 'linear-damage-fraction-lemaitre-chaboche' },
        ],
        firstFailureYear: 0,
        lawUsed: 'linear-damage-fraction-lemaitre-chaboche',
      }),
    });
    await renderAndWaitForMaterials();

    fireEvent.click(screen.getByRole('button', { name: /Run durability check/ }));

    // Real computed result, not the refusal copy.
    await waitFor(() => expect(screen.getByText('Baseline utilization')).toBeInTheDocument());
    expect(screen.queryByText(/Honest refusal — not a fabricated pass\./)).not.toBeInTheDocument();

    const finalOkStat = screen.getByText('Final ok').nextElementSibling as HTMLElement;
    expect(finalOkStat).toHaveTextContent('fail');
    const firstFailureStat = screen.getByText('First failure year').nextElementSibling as HTMLElement;
    expect(firstFailureStat).toHaveTextContent('0');

    // Both sampled years render in the table, each honestly marked failing.
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1); // drop header row
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getByText('fail')).toBeInTheDocument();
    }

    // The request itself carries a real beam-frame model shape (nodes,
    // members, supports) and the selected material — never a JSON blob
    // the user typed, and never omitted fields the backend requires.
    const durabilityCall = post.mock.calls.find(([, body]) => body.action === 'durabilityCheck');
    expect(durabilityCall).toBeDefined();
    const input = (durabilityCall![1] as { input: Record<string, unknown> }).input;
    expect(input.materialKey).toBe('steel-a36');
    expect(input.mechanisms).toEqual(['fatigue']);
    const model = input.model as { nodes: unknown[]; members: unknown[]; supports: unknown[] };
    expect(model.nodes).toHaveLength(2);
    expect(model.members).toHaveLength(1);
    expect(model.supports).toHaveLength(1);
  });
});
