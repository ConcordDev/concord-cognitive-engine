import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Wave 4 gap-closure — export-capability-map.md: `export.decrypt-archive`
// (server/domains/exportdomain.js) had no UI caller; encrypt-archive did
// (EncryptedArchive). ExportToolkit mounts 8 independent sibling panels
// (ScheduledExports/IncrementalExport/SelectiveFields/PdfExport/
// EncryptedArchive/DecryptedArchive/CloudDestinations/ExportHistory), each
// firing its own network call on mount — a full render test would need to
// mock all eight just to reach the new panel. This file follows this
// codebase's established static-source-pin pattern for the round-trip and
// rejection assertions below, but the macro-call claim (stale-lying-test
// detector finding) is now proven at runtime: `DecryptedArchive` is
// exported as a small testability seam (it was previously a private
// function inside ExportToolkit.tsx — the ONLY source change in this
// commit), rendered standalone, and driven through a real file upload +
// button click with `lensRun` mocked only at the network boundary — the
// same pattern established in tests/components/PortabilityPanel.test.tsx.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '..', 'components', 'export', 'ExportToolkit.tsx'),
  'utf8',
);

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { DecryptedArchive } from '@/components/export/ExportToolkit';

function envelopeFile(env: Record<string, unknown>, name = 'archive.enc') {
  return new File([JSON.stringify(env)], name, { type: 'application/octet-stream' });
}

describe('export lens — DecryptedArchive panel (Wave 4 gap-closure)', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('calls the real export.decrypt-archive macro with password/salt/ciphertextBase64/expectedChecksum', async () => {
    lensRun.mockResolvedValueOnce({
      data: { ok: true, result: { verified: true, checksum: 'chk', byteLength: 42, plaintext: '{"dtus":[]}' } },
    });
    render(<DecryptedArchive />);

    const envelope = { algorithm: 'aes-256-gcm', salt: 'saltvalue', plainChecksum: 'plainchk123', ciphertextBase64: 'Y2lwaGVy' };
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [envelopeFile(envelope)] } });
    await waitFor(() => expect(screen.getByText(/Loaded: archive\.enc/)).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('archive password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByText('Decrypt + download'));

    // Real call, driven by a real file upload + click — not a
    // re-implementation of the handler, the handler itself.
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('export', 'decrypt-archive', {
        password: 'hunter2',
        salt: 'saltvalue',
        ciphertextBase64: 'Y2lwaGVy',
        expectedChecksum: 'plainchk123',
      }),
    );
  });

  it('reads the same self-describing envelope shape EncryptedArchive writes on encrypt (round-trips through this lens)', () => {
    // EncryptedArchive's download envelope:
    expect(src).toMatch(/algorithm: res\.algorithm, salt: res\.salt, plainChecksum: res\.plainChecksum, ciphertextBase64: res\.ciphertextBase64/);
    // DecryptedArchive's upload parse expects the same two required fields:
    const onFileMatch = src.match(/const onFile = async \(file: File\) => \{[\s\S]*?\n {2}\};/);
    expect(onFileMatch).toBeTruthy();
    expect(onFileMatch![0]).toMatch(/if \(!parsed\.salt \|\| !parsed\.ciphertextBase64\)/);
  });

  it('rejects a wrong password (checksum mismatch) honestly instead of downloading garbage plaintext', () => {
    const fnMatch = src.match(/const decrypt = async \(\) => \{[\s\S]*?\n {2}\};/);
    const fn = fnMatch![0];
    expect(fn).toMatch(/if \(res\.verified === false\) \{ setInfo\('Wrong password — checksum did not match\.'\); return; \}/);
    // The download call must appear AFTER the verified===false early return,
    // i.e. the file only downloads on the success path.
    const guardIdx = fn.indexOf("setInfo('Wrong password");
    const dlIdx = fn.indexOf('dl(`');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(dlIdx).toBeGreaterThan(guardIdx);
  });

  it('is mounted in the toolkit, next to the existing EncryptedArchive panel', () => {
    expect(src).toMatch(/<EncryptedArchive dtus=\{dtus\} \/>\s*\n\s*<DecryptedArchive \/>/);
  });
});
