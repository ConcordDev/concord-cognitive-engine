/**
 * Pins the /api/lens/run envelope-unwrap fix for DecreeComposer (finding 28).
 *
 * This is the most dangerous flavor of the bug pattern: pre-fix, `submit()`
 * checked the top-level transport `j?.ok` — which POST /api/lens/run ALWAYS
 * sets to `true` once the call itself succeeds, regardless of whether the
 * macro rejected the request. `kingdoms.propose_decree` returns
 * `{ ok: false, reason }` at `.result` when the server rejects a decree (e.g.
 * `not_authorised`, `invalid_kind`) — pre-fix, that rejection was silently
 * swallowed and the composer reported success (closed the modal, no error)
 * even though nothing was issued server-side. This suite pins both the
 * success path AND that a genuine rejection now surfaces as an error and
 * does NOT close the modal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';

import DecreeComposer from '@/components/concordia/hud/DecreeComposer';

function envelope(macroPayload: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, result: macroPayload }),
  });
}

describe('DecreeComposer — envelope unwrap (finding 28)', () => {
  it('a server-side rejection is reported as an error and the modal stays open', async () => {
    // Transport succeeded (outer ok:true) but the macro rejected the decree.
    vi.stubGlobal('fetch', vi.fn(() => envelope({ ok: false, reason: 'not_authorised' })));
    const onClose = vi.fn();
    const { getByText, container } = render(
      <DecreeComposer kingdomId="kdm-1" open onClose={onClose} />,
    );
    await act(async () => { getByText('Issue').click(); });
    await waitFor(() => expect(container.textContent).toMatch(/not_authorised/));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a real success (result.ok true) closes the modal with no error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => envelope({ ok: true, id: 'dcr_1', kind: 'festival', popularity_delta: 12 })));
    const onClose = vi.fn();
    const { getByText, container } = render(
      <DecreeComposer kingdomId="kdm-1" open onClose={onClose} />,
    );
    await act(async () => { getByText('Issue').click(); });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(container.textContent).not.toMatch(/rejected/i);
  });

  it('regression guard: transport-level ok:true alone must not read as success', async () => {
    // The literal pre-fix bug shape: outer ok is true, but there is no
    // top-level `reason`/success — the real verdict is nested at `.result`.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { ok: false, reason: 'invalid_kind' } }),
    })));
    const onClose = vi.fn();
    const { getByText, container } = render(
      <DecreeComposer kingdomId="kdm-1" open onClose={onClose} />,
    );
    await act(async () => { getByText('Issue').click(); });
    await waitFor(() => expect(container.textContent).toMatch(/invalid_kind/));
    expect(onClose).not.toHaveBeenCalled();
  });
});
