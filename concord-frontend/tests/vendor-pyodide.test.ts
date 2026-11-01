import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — plain ESM script, no type declarations
import { vendorPyodide, isUpToDate, FILES, TARBALL_SHA256, TARBALL_URL, PYODIDE_VERSION } from '../scripts/vendor-pyodide.mjs';

/**
 * scripts/vendor-pyodide.mjs (#1707 / Ops M12): the Pyodide core is vendored from a pinned release
 * tarball with hard-coded SHA-256s. The security-relevant behaviour is that nothing unverified is ever
 * written into public/pyodide/, and that the hashes/URL are pinned to 0.26.4.
 */
describe('vendor-pyodide', () => {
  const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-pyodide-test-'));

  it('is pinned: version, release URL, and 64-hex SHA-256s for the tarball and each of the five files', () => {
    expect(PYODIDE_VERSION).toBe('0.26.4');
    expect(TARBALL_URL).toBe('https://github.com/pyodide/pyodide/releases/download/0.26.4/pyodide-core-0.26.4.tar.bz2');
    expect(TARBALL_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(FILES).sort()).toEqual(['pyodide-lock.json', 'pyodide.asm.js', 'pyodide.asm.wasm', 'pyodide.js', 'python_stdlib.zip']);
    for (const h of Object.values(FILES)) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an empty or tampered output directory is not "up to date"', () => {
    const dir = tmpDir();
    expect(isUpToDate(dir)).toBe(false);
    for (const f of Object.keys(FILES)) fs.writeFileSync(path.join(dir, f), 'not the real runtime');
    expect(isUpToDate(dir)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a tarball that fails the pinned SHA-256 is rejected and nothing is written', async () => {
    const out = path.join(tmpDir(), 'v0.26.4');
    await expect(vendorPyodide({ outDir: out, log: () => {}, fetchTarball: async () => Buffer.from('definitely not pyodide') }))
      .rejects.toThrow(/tarball sha256 mismatch/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('a fetch failure propagates (the --soft caller decides whether that is fatal) and writes nothing', async () => {
    const out = path.join(tmpDir(), 'v0.26.4');
    await expect(vendorPyodide({ outDir: out, log: () => {}, fetchTarball: async () => { throw new Error('offline'); } }))
      .rejects.toThrow(/offline/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('is wired: prebuild/predev run it in soft mode, gitignored, same-origin only', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.scripts.prebuild).toBe('node scripts/vendor-pyodide.mjs --soft');
    expect(pkg.scripts.predev).toBe('node scripts/vendor-pyodide.mjs --soft');
    expect(pkg.scripts['vendor:pyodide']).toBe('node scripts/vendor-pyodide.mjs');
    const ignore = fs.readFileSync(path.join(__dirname, '..', '..', '.gitignore'), 'utf8');
    expect(ignore).toContain('concord-frontend/public/pyodide/');
    const exec = fs.readFileSync(path.join(__dirname, '..', 'components', 'code', 'localExec.ts'), 'utf8');
    expect(exec).toContain('/pyodide/v0.26.4/');
    expect(exec).not.toMatch(/cdn\.jsdelivr\.net\/pyodide|pyodide\/v0\.26\.4\/full/);
  });
});
