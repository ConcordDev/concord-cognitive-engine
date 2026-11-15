// Behavior test for FIX-export-008: PDF/delta/enc history entries must
// be re-downloadable. The panels retained nothing, so history showed
// "no payload retained" for exactly the formats the ticket names. Pins:
// (1) the delta panel records the exact payload it downloads; (2) the
// PDF panel records its base64 with payloadEncoding 'base64'; (3) the
// enc panel records the exact envelope it downloads; (4) ExportHistory
// decodes a base64 payload back to bytes on re-download; (5) an entry
// that genuinely retains nothing gets a clear note, not jargon.
// Panels are exported seams per the DecryptedArchive precedent; the api
// client is mocked at the network boundary.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  api: { post: vi.fn(), get: (...a: unknown[]) => apiGet(...a), delete: vi.fn(), put: vi.fn() },
}));

import { IncrementalExport, PdfExport, EncryptedArchive, ExportHistory } from '@/components/export/ExportToolkit';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

const createdBlobs: Blob[] = [];
beforeEach(() => {
  lensRun.mockReset();
  apiGet.mockReset();
  createdBlobs.length = 0;
  URL.createObjectURL = vi.fn((b: Blob) => { createdBlobs.push(b); return 'blob:mock'; }) as never;
  URL.revokeObjectURL = vi.fn() as never;
});

describe('export history re-download (FIX-export-008)', () => {
  it('delta panel records the exact payload it downloads', async () => {
    const records = [{ id: 'd1', title: 'One', updatedAt: '2026-11-13T00:00:00.000Z' }];
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'cursor-list') return ok({ cursors: [] });
      if (action === 'incremental-pull') return ok({ changedRecords: 1, unchangedRecords: 0, isFirstRun: true, newCursor: '2026-11-13T00:00:00.000Z', records });
      return ok({});
    });
    render(<IncrementalExport dtus={records as never} />);
    fireEvent.click(screen.getByText('Export delta + advance cursor'));
    await waitFor(() => {
      const rec = lensRun.mock.calls.find((c) => c[1] === 'record-run');
      expect(rec).toBeTruthy();
      expect(rec![2].payload).toBe(JSON.stringify(records, null, 2));
      expect(rec![2].itemCount).toBe(1);
    });
  });

  it('pdf panel records the base64 payload with its encoding', async () => {
    const base64 = Buffer.from('PDFBYTES').toString('base64');
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'pdf-generate') return ok({ base64, byteLength: 8, recordCount: 2 });
      return ok({});
    });
    render(<PdfExport dtus={[{ id: 'd1' }, { id: 'd2' }] as never} />);
    fireEvent.click(screen.getByText('Generate PDF'));
    await waitFor(() => {
      const rec = lensRun.mock.calls.find((c) => c[1] === 'record-run');
      expect(rec).toBeTruthy();
      expect(rec![2].payload).toBe(base64);
      expect(rec![2].payloadEncoding).toBe('base64');
    });
  });

  it('enc panel records the exact envelope it downloads', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'encrypt-archive') return ok({ algorithm: 'concord-xor-fnv/v1', salt: 'salt_1', plainChecksum: 'chk', ciphertextBase64: 'Y2lwaGVy', byteLength: 42 });
      return ok({});
    });
    render(<EncryptedArchive dtus={[{ id: 'd1' }] as never} />);
    fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: 'probe1234' } });
    fireEvent.click(screen.getByText(/Encrypt \+ download/i));
    await waitFor(() => {
      const rec = lensRun.mock.calls.find((c) => c[1] === 'record-run');
      expect(rec).toBeTruthy();
      expect(typeof rec![2].payload).toBe('string');
      expect(rec![2].payload).toContain('Y2lwaGVy');
      expect(rec![2].payload).toBe(createdBlobs.length ? rec![2].payload : rec![2].payload);
    });
    // the recorded payload is byte-identical to the downloaded envelope
    const blobText = await createdBlobs[0].text();
    const rec = lensRun.mock.calls.find((c) => c[1] === 'record-run');
    expect(rec![2].payload).toBe(blobText);
    expect(rec![2].filename).toMatch(/^concord-export-\d+\.enc$/);
  });

  it('history re-download decodes a base64 payload and notes unretained runs clearly', async () => {
    const base64 = Buffer.from('PDFBYTES').toString('base64');
    const runs = [
      { id: 'run_pdf', at: '2026-11-13T00:00:00.000Z', format: 'pdf', itemCount: 2, byteLength: 8, dataSources: ['dtus'], trigger: 'manual', filename: 'Concord Export.pdf', scheduleId: null, hasPayload: true },
      { id: 'run_old', at: '2026-11-12T00:00:00.000Z', format: 'enc', itemCount: 1, byteLength: 5, dataSources: ['dtus'], trigger: 'manual', filename: 'old.enc', scheduleId: null, hasPayload: false },
    ];
    lensRun.mockImplementation((_d: string, action: string, input?: Record<string, unknown>) => {
      if (action === 'history-list') return ok({ runs, totalBytesExported: 13 });
      if (action === 'history-download') return ok({ filename: 'Concord Export.pdf', payload: base64, encoding: 'base64', format: 'pdf', id: input?.id });
      return ok({});
    });
    render(<ExportHistory />);
    expect(await screen.findByText(/No file retained for this run/)).toBeTruthy();
    fireEvent.click(screen.getByText('Re-download'));
    await waitFor(() => expect(createdBlobs.length).toBe(1));
    expect(await createdBlobs[0].text()).toBe('PDFBYTES');
  });
});
