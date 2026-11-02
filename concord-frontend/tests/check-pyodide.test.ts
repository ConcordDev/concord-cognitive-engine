import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — plain ESM script, no type declarations
import { checkPyodide } from '../scripts/check-pyodide.mjs';

/**
 * scripts/check-pyodide.mjs (#1707 / GB-0736): the post-build verification
 * that the vendored Pyodide runtime exists and matches its pinned hashes.
 * The desk's ask is that this be a real check with named problems, not a
 * boolean waved through — so the behaviour pinned here is the per-file
 * verdict: missing files are named as missing, tampered files as hash
 * mismatches, and only a fully-correct directory reads ok.
 *
 * The `files` map is injected with small known contents (the seam exists
 * for this) so the suite never needs the real 13 MB runtime.
 */
describe('check-pyodide', () => {
  const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
  const FILES = { 'a.txt': sha256('alpha'), 'b.txt': sha256('beta') };
  const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'check-pyodide-test-'));
  const write = (dir: string, name: string, content: string) => fs.writeFileSync(path.join(dir, name), content);

  it('a directory with every file present and hash-correct is ok, with no problems', () => {
    const dir = tmpDir();
    write(dir, 'a.txt', 'alpha');
    write(dir, 'b.txt', 'beta');
    const { ok, problems } = checkPyodide({ dir, files: FILES });
    expect(ok).toBe(true);
    expect(problems).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('missing files are named as missing — including when the whole directory is absent', () => {
    const dir = tmpDir();
    write(dir, 'a.txt', 'alpha');
    const partial = checkPyodide({ dir, files: FILES });
    expect(partial.ok).toBe(false);
    expect(partial.problems).toEqual(['missing: b.txt']);

    const absent = checkPyodide({ dir: path.join(dir, 'does-not-exist'), files: FILES });
    expect(absent.ok).toBe(false);
    expect(absent.problems).toEqual(['missing: a.txt', 'missing: b.txt']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a tampered file is named as a hash mismatch with both hashes shown', () => {
    const dir = tmpDir();
    write(dir, 'a.txt', 'alpha');
    write(dir, 'b.txt', 'tampered');
    const { ok, problems } = checkPyodide({ dir, files: FILES });
    expect(ok).toBe(false);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('hash mismatch: b.txt');
    expect(problems[0]).toContain(FILES['b.txt']);
    expect(problems[0]).toContain(sha256('tampered'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
