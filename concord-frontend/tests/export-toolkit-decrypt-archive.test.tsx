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

  it('decrypts the downloaded envelope in the browser and refuses the wrong password', async () => {
    const { encryptEncEnvelope, packEncEnvelope } = await import('@/lib/export/xor-fnv-archive');
    const payload = JSON.stringify({ dtus: [{ id: 'dtu_1', title: 'qa' }] });
    const packed = JSON.parse(packEncEnvelope(encryptEncEnvelope('qatest1234', payload, 'salt_qa_roundtrip')));
    render(<DecryptedArchive />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [envelopeFile(packed)] } });
    await waitFor(() => expect(screen.getByText(/Loaded: archive\.enc/)).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('archive password'), { target: { value: 'wrong-pass' } });
    fireEvent.click(screen.getByText('Decrypt + download'));
    await waitFor(() => expect(screen.getByText('Wrong password — checksum did not match.')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('archive password'), { target: { value: 'qatest1234' } });
    fireEvent.click(screen.getByText('Decrypt + download'));
    await waitFor(() => expect(screen.getByText(/checksum verified/)).toBeTruthy());
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('reads the same self-describing envelope shape EncryptedArchive writes on encrypt (round-trips through this lens)', () => {
    expect(src).toMatch(/packEncEnvelope\(\{ algorithm: res\.algorithm, salt: res\.salt, plainChecksum: res\.plainChecksum, ciphertextBase64: res\.ciphertextBase64 \}\)/);
    expect(src).toMatch(/readEncEnvelope\(text\)/);
    expect(src).toMatch(/decryptEncEnvelope\(password,/);
  });

  it('rejects a wrong password (checksum mismatch) honestly instead of downloading garbage plaintext', () => {
    const fnMatch = src.match(/const decrypt = async \(\) => \{[\s\S]*?\n {2}\};/);
    const fn = fnMatch![0];
    expect(fn).toMatch(/if \(!res\.verified\) \{ setInfo\('Wrong password — checksum did not match\.'\); return; \}/);
    const guardIdx = fn.indexOf("setInfo('Wrong password");
    const dlIdx = fn.indexOf('dl(`');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(dlIdx).toBeGreaterThan(guardIdx);
  });

  it('is mounted in the toolkit, next to the existing EncryptedArchive panel', () => {
    expect(src).toMatch(/<EncryptedArchive dtus=\{dtus\} \/>\s*\n\s*<DecryptedArchive \/>/);
  });
});
