/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * PremonitionOverlay — envelope-unwrap contract (finding 18).
 *
 * POST /api/lens/run ALWAYS answers `{ ok: true, result: PAYLOAD }` where the
 * outer `ok` is only a transport flag — PAYLOAD (`forward_sim.predictions_for_player`'s
 * own `{ ok, predictions }` shape, server.js:74970-74985) carries the real
 * `predictions` array. Reading `data?.predictions` off the raw top-level
 * fetch body (rather than `raw.result.predictions`) meant the prediction
 * card could never appear, no matter how many real predictions existed.
 *
 * The component already unwraps via `raw?.result ?? raw` (see the inline
 * comment at PremonitionOverlay.tsx:42-45) — these tests pin that fix with
 * the REAL nested envelope shape so a future regression (reverting back to
 * reading the raw body) fails loudly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import PremonitionOverlay from './PremonitionOverlay';

function envelope(macroResult: unknown) {
  return { ok: true, result: macroResult };
}
function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const PREDICTION_LOW = {
  id: 'pred_1',
  subject_kind: 'quest',
  subject_id: 'q_dome',
  anticipated: 'The dome will hold, but only just.',
  confidence: 0.4,
  composed_at: 1735000000,
  expires_at: null,
  realised_at: null,
};

const PREDICTION_HIGH = {
  id: 'pred_2',
  subject_kind: 'faction',
  subject_id: 'f_concord',
  anticipated: 'Concord will move against the Sovereign Ruins.',
  confidence: 0.85,
  composed_at: 1735000100,
  expires_at: null,
  realised_at: null,
};

const PREDICTION_REALISED = {
  ...PREDICTION_HIGH,
  id: 'pred_3',
  realised_at: 1735000200,
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('PremonitionOverlay — envelope unwrap (finding 18)', () => {
  it('renders nothing while the predictions call is in flight / before it resolves', () => {
    // @ts-expect-error test global
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    const { container } = render(<PremonitionOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('surfaces the real highest-confidence unrealised prediction from result.predictions', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn(() =>
      jsonResponse(envelope({ ok: true, userId: 'u1', predictions: [PREDICTION_LOW, PREDICTION_HIGH] })),
    );
    const { getByText, container } = render(<PremonitionOverlay />);

    // pre-fix `data?.predictions` read the top-level (always-undefined)
    // field, so the card never appeared no matter what the backend had.
    await waitFor(() => expect(getByText(/Concord will move against the Sovereign Ruins/)).toBeInTheDocument());
    expect(getByText('(faction)')).toBeInTheDocument();
    expect(container.textContent).toMatch(/conviction 85%/);
    // the lower-confidence prediction is not the one shown
    expect(container.textContent).not.toMatch(/dome will hold/);
  });

  it('filters out already-realised predictions and renders nothing if none remain', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn(() =>
      jsonResponse(envelope({ ok: true, userId: 'u1', predictions: [PREDICTION_REALISED] })),
    );
    const { container } = render(<PremonitionOverlay />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('an empty result.predictions array renders nothing (not a crash)', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn(() => jsonResponse(envelope({ ok: true, userId: 'u1', predictions: [] })));
    const { container } = render(<PremonitionOverlay />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
