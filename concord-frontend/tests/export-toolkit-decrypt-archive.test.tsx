import { describe, it, expect } from 'vitest';
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
// codebase's established static-source-pin pattern instead, pinning the
// real macro call, the envelope round-trip, and the checksum-mismatch
// rejection path directly against the production source.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '..', 'components', 'export', 'ExportToolkit.tsx'),
  'utf8',
);

describe('export lens — DecryptedArchive panel (Wave 4 gap-closure)', () => {
  it('calls the real export.decrypt-archive macro with password/salt/ciphertextBase64/expectedChecksum', () => {
    expect(src).toMatch(/lensRun\('export', 'decrypt-archive', \{/);
    const fnMatch = src.match(/const decrypt = async \(\) => \{[\s\S]*?\n {2}\};/);
    expect(fnMatch).toBeTruthy();
    const fn = fnMatch![0];
    expect(fn).toMatch(/password, salt: envelope\.salt, ciphertextBase64: envelope\.ciphertextBase64,/);
    expect(fn).toMatch(/expectedChecksum: envelope\.plainChecksum \|\| undefined,/);
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
