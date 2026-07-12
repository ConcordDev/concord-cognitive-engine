/**
 * PortabilityPanel — Wave 4 gap-closure test.
 *
 * `dtu_portability` (export/validate/import corpus backup,
 * server/lib/dtu-portability.js + server/domains/dtu-portability.js)
 * shipped with zero frontend callers (docs/lens-specs/dtus-capability-map.md
 * §1c). This pins the first real UI against the REAL macro shapes
 * (mocked at the `lensRun()` boundary only — no network):
 *
 *   1. Export downloads a real envelope built from the macro's actual
 *      counts/hashes, calling `dtu_portability.export` with the checkbox
 *      state.
 *   2. Validate on a well-formed envelope surfaces the real dtuCount /
 *      citationCount and enables Import.
 *   3. Validate on a tampered envelope surfaces the real failure reason
 *      honestly (not a silent/generic failure) and keeps Import disabled.
 *   4. Import surfaces the real per-field import result (dtus/citations/
 *      skipped), gated behind an explicit confirm().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { PortabilityPanel } from '@/components/dtus/PortabilityPanel';

// Real envelope shape per server/lib/dtu-portability.js#exportUserCorpus.
const ENVELOPE = {
  spec: 'concord-dtu-pack/v1',
  exported_at: 1700000000,
  creator_id: 'u1',
  instance_signature: 'abc123',
  dtus: [{ id: 'dtu:1', kind: 'skill', title: 'Test DTU', creator_id: 'u1' }],
  citations: [],
  economy_ledger: [],
  attachments: [],
  hashes: { dtus_sha256: 'deadbeef' },
  counts: { dtus: 1, citations: 0, economy: 0, attachments: 0 },
};

function ok<T>(result: T) {
  return { data: { ok: true, result, error: null } };
}
// Real lensRun() behavior on a macro `{ok:false, reason, error}` shape: the
// result is collapsed to null and the mirrored `error` string surfaces —
// see server/lib/dtu-portability.js's "error mirrors reason" comment.
function failed(errorMsg: string) {
  return { data: { ok: false, result: null, error: errorMsg } };
}

function makeFile(content: unknown, name = 'export.json') {
  return new File([JSON.stringify(content)], name, { type: 'application/json' });
}

describe('PortabilityPanel (Wave 4 gap-closure — dtu_portability UI)', () => {
  beforeEach(() => {
    lensRun.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('exports the real corpus and triggers a file download', async () => {
    lensRun.mockResolvedValueOnce(ok(ENVELOPE));
    render(<PortabilityPanel />);

    fireEvent.click(screen.getByRole('button', { name: /export my corpus/i }));

    await waitFor(() =>
      expect(screen.getByText(/downloaded — 1 DTU\(s\), 0 citation\(s\)/i)).toBeTruthy(),
    );

    expect(lensRun).toHaveBeenCalledWith('dtu_portability', 'export', {
      includeEconomy: true,
      includeAttachments: false,
    });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it('surfaces an export failure honestly instead of a silent no-op', async () => {
    lensRun.mockResolvedValueOnce(failed('no_actor'));
    render(<PortabilityPanel />);

    fireEvent.click(screen.getByRole('button', { name: /export my corpus/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/no_actor/)).toBeTruthy();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it('validates a well-formed envelope, shows real counts, and enables Import', async () => {
    lensRun.mockResolvedValueOnce(
      ok({ ok: true, dtuCount: 1, citationCount: 0, economyCount: 0, attachmentCount: 0 }),
    );
    render(<PortabilityPanel />);

    const fileInput = screen.getByLabelText(/envelope file/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile(ENVELOPE)] } });

    await waitFor(() => expect(screen.getByText(/envelope is valid/i)).toBeTruthy());
    expect(lensRun).toHaveBeenCalledWith('dtu_portability', 'validate', { envelope: ENVELOPE });

    const importBtn = screen.getByRole('button', { name: /import validated envelope/i });
    await waitFor(() => expect(importBtn).not.toBeDisabled());
  });

  it('surfaces a tampered envelope honestly and keeps Import disabled', async () => {
    // Real lensRun() shape for dtu_portability.validate's dtu_hash_mismatch
    // failure path (server/lib/dtu-portability.js#validateEnvelope, now
    // mirroring error===reason so lensRun preserves the specific cause).
    lensRun.mockResolvedValueOnce(failed('dtu_hash_mismatch'));
    render(<PortabilityPanel />);

    const tampered = { ...ENVELOPE, dtus: [{ ...ENVELOPE.dtus[0], title: 'tampered' }] };
    const fileInput = screen.getByLabelText(/envelope file/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile(tampered)] } });

    await waitFor(() => expect(screen.getByText(/validation failed/i)).toBeTruthy());
    expect(screen.getByText(/dtu_hash_mismatch/)).toBeTruthy();
    expect(screen.getByText(/modified or corrupted/i)).toBeTruthy();

    const importBtn = screen.getByRole('button', { name: /import validated envelope/i });
    expect(importBtn).toBeDisabled();
  });

  it('rejects a file that is not valid JSON without ever calling validate', async () => {
    render(<PortabilityPanel />);
    const fileInput = screen.getByLabelText(/envelope file/i) as HTMLInputElement;
    const badFile = new File(['not json {{{'], 'bad.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [badFile] } });

    await waitFor(() => expect(screen.getByText(/not valid json/i)).toBeTruthy());
    expect(lensRun).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /import validated envelope/i })).toBeDisabled();
  });

  it('imports a validated envelope and surfaces the real import result (idempotency included)', async () => {
    lensRun.mockResolvedValueOnce(
      ok({ ok: true, dtuCount: 2, citationCount: 1, economyCount: 0, attachmentCount: 0 }),
    );
    render(<PortabilityPanel />);

    const fileInput = screen.getByLabelText(/envelope file/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile(ENVELOPE)] } });
    await waitFor(() => expect(screen.getByText(/envelope is valid/i)).toBeTruthy());

    lensRun.mockResolvedValueOnce(
      ok({ ok: true, imported: { dtus: 2, citations: 1, economy: 0, attachments: 0, skipped: 1 } }),
    );
    fireEvent.click(screen.getByRole('button', { name: /import validated envelope/i }));

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/imported 2 dtu\(s\), 1 citation\(s\)/i)).toBeTruthy(),
    );
    expect(screen.getByText(/1 already present — skipped/i)).toBeTruthy();
    expect(lensRun).toHaveBeenLastCalledWith('dtu_portability', 'import', { envelope: ENVELOPE });
  });

  it('does not import when the user cancels the confirm dialog', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    lensRun.mockResolvedValueOnce(
      ok({ ok: true, dtuCount: 1, citationCount: 0, economyCount: 0, attachmentCount: 0 }),
    );
    render(<PortabilityPanel />);

    const fileInput = screen.getByLabelText(/envelope file/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile(ENVELOPE)] } });
    await waitFor(() => expect(screen.getByText(/envelope is valid/i)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /import validated envelope/i }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());

    // Only the export.validate call happened — no second (import) call.
    expect(lensRun).toHaveBeenCalledTimes(1);
  });
});
