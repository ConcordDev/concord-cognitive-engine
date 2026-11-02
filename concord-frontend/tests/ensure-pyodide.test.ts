import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — plain ESM script, no type declarations
import { ensurePyodide, lockPathFor } from '../scripts/ensure-pyodide.mjs';

/**
 * scripts/ensure-pyodide.mjs (#1707 / GB-0736): the build-time gate
 * next.config.js runs on phase-production-build — check, vendor if
 * needed, re-check, and FAIL rather than let a build ship without the
 * Code lens's Python runtime. The behaviour pinned here is the decision
 * table, exercised through the vendor/check seams (no network, no real
 * runtime): already-verified short-circuits; a parallel build's work is
 * reused, not duplicated; a vendor that runs but does not verify is a
 * failure; and a vendor failure propagates as a failure — it is never
 * swallowed into a soft pass (that is the pre-hook's job, not this
 * gate's).
 */
describe('ensure-pyodide', () => {
  const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-pyodide-test-'));
  const ok = { ok: true, problems: [] as string[] };
  const bad = { ok: false, problems: ['missing: pyodide.js'] };
  const sequence = (results: Array<typeof ok>) => {
    let i = 0;
    return vi.fn(() => results[Math.min(i++, results.length - 1)]);
  };

  it('already vendored + verified: returns without invoking the vendor', async () => {
    const vendorImpl = vi.fn(async () => ({ changed: true }));
    const out = await ensurePyodide({ outDir: tmpDir(), log: () => {}, vendorImpl, checkImpl: () => ok });
    expect(out).toEqual({ changed: false });
    expect(vendorImpl).not.toHaveBeenCalled();
  });

  it('vendored by a parallel build while waiting on the lock: re-checks and does not vendor twice', async () => {
    const vendorImpl = vi.fn(async () => ({ changed: true }));
    const checkImpl = sequence([bad, ok]);
    const out = await ensurePyodide({ outDir: tmpDir(), log: () => {}, vendorImpl, checkImpl });
    expect(out).toEqual({ changed: false });
    expect(vendorImpl).not.toHaveBeenCalled();
    expect(checkImpl).toHaveBeenCalledTimes(2);
  });

  it('not vendored: vendors once, re-checks, and reports the change', async () => {
    const vendorImpl = vi.fn(async () => ({ changed: true }));
    const checkImpl = sequence([bad, bad, ok]);
    const dir = tmpDir();
    const out = await ensurePyodide({ outDir: dir, log: () => {}, vendorImpl, checkImpl });
    expect(out).toEqual({ changed: true });
    expect(vendorImpl).toHaveBeenCalledTimes(1);
    expect(vendorImpl).toHaveBeenCalledWith(expect.objectContaining({ outDir: dir }));
    expect(checkImpl).toHaveBeenCalledTimes(3);
    // The lock is released afterwards — a later build must not wait on us.
    expect(fs.existsSync(lockPathFor(dir))).toBe(false);
  });

  it('a vendor that runs but does not verify is a failure naming the remaining problems', async () => {
    const vendorImpl = vi.fn(async () => ({ changed: true }));
    await expect(
      ensurePyodide({ outDir: tmpDir(), log: () => {}, vendorImpl, checkImpl: () => bad }),
    ).rejects.toThrow(/still not verified: missing: pyodide\.js/);
  });

  it('a vendor failure (offline, integrity) propagates — never swallowed into a soft pass', async () => {
    const vendorImpl = vi.fn(async () => { throw new Error('offline'); });
    await expect(
      ensurePyodide({ outDir: tmpDir(), log: () => {}, vendorImpl, checkImpl: () => bad }),
    ).rejects.toThrow(/offline/);
  });

  it('the vendor lock is keyed by output directory: stable per dir, distinct across dirs', () => {
    expect(lockPathFor('/a/b')).toBe(lockPathFor('/a/b'));
    expect(lockPathFor('/a/b')).not.toBe(lockPathFor('/a/c'));
  });
});
