#!/usr/bin/env node
/**
 * Vendor the Pyodide 0.26.4 core runtime into public/pyodide/v0.26.4/ so the Code lens's local Python
 * runner loads it from Concord's own origin (components/code/localExec.ts, python-exec.worker.ts) —
 * never from a CDN at runtime.
 *
 * Pinned and verified end to end:
 *   - the official release tarball (pyodide-core-0.26.4.tar.bz2, ~5.6 MB) is checked against a hard-coded
 *     SHA-256 before anything is extracted; a mismatch is always fatal (exit 1), never "soft";
 *   - only the five files the worker needs are copied out, and each is re-checked against its own
 *     hard-coded SHA-256. The same five files are byte-identical in the independently published
 *     `pyodide@0.26.4` npm package, which is how the hashes below were cross-checked.
 *
 * Idempotent: when all five files are present with the right hashes, nothing is downloaded.
 *
 * Usage:
 *   node scripts/vendor-pyodide.mjs          # fetch if missing/stale; exit 1 on any failure
 *   node scripts/vendor-pyodide.mjs --soft   # (build hook) a NETWORK failure warns and exits 0 — the
 *                                            # Python runner then reports "runtime unavailable"; a hash
 *                                            # mismatch is still fatal
 *
 * Output is git-ignored (regenerated, checksum-pinned; the repo's LFS budget is not spent on it).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PYODIDE_VERSION = '0.26.4';
export const TARBALL_URL = `https://github.com/pyodide/pyodide/releases/download/${PYODIDE_VERSION}/pyodide-core-${PYODIDE_VERSION}.tar.bz2`;
export const TARBALL_SHA256 = '70dba93432f3653155998cc9001f9c200182343c2f95165a2f9e9e4673fa35e8';
export const FILES = {
  'pyodide.js': 'c0069107621d5b942a659e737a12e774cc0451feaa2256f475d72e071d844ec7',
  'pyodide.asm.js': '919560652ed3dad3707cb3a394785da1e046fb13dc0defa162058ff230cb7eed',
  'pyodide.asm.wasm': 'b7e66a19427a55010ac3367c1b6c64b893f9826f783412945fdf0c3337f3bc94',
  'python_stdlib.zip': '72894522b791858b9d613ac786b951d8b5094035dcf376313ea24a466810f336',
  'pyodide-lock.json': 'cd50b49de944c579045e122fe8628b31f9ce446379f032f36c05e273d38766e0',
};

const here = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = path.join(here, '..', 'public', 'pyodide', `v${PYODIDE_VERSION}`);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fileHash = (p) => sha256(fs.readFileSync(p));

export function isUpToDate(dir = OUT_DIR) {
  return Object.entries(FILES).every(([name, want]) => {
    try { return fileHash(path.join(dir, name)) === want; } catch { return false; }
  });
}

class NetworkError extends Error {}
class IntegrityError extends Error {}

async function download(url, timeoutMs = 120_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    if (!res.ok) throw new NetworkError(`GET ${url} -> HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof NetworkError) throw e;
    throw new NetworkError(`GET ${url} failed: ${e?.message || e}`);
  } finally {
    clearTimeout(t);
  }
}

export async function vendorPyodide({ outDir = OUT_DIR, log = console.log, fetchTarball = () => download(TARBALL_URL) } = {}) {
  if (isUpToDate(outDir)) { log(`[vendor-pyodide] up to date (${path.relative(process.cwd(), outDir) || outDir})`); return { changed: false }; }
  log(`[vendor-pyodide] fetching ${TARBALL_URL}`);
  const tarball = await fetchTarball();
  const got = sha256(tarball);
  if (got !== TARBALL_SHA256) throw new IntegrityError(`tarball sha256 mismatch: expected ${TARBALL_SHA256}, got ${got}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pyodide-core-'));
  try {
    const tarPath = path.join(tmp, 'core.tar.bz2');
    fs.writeFileSync(tarPath, tarball);
    // execFileSync with an argv array — no shell. Only the five needed members are extracted.
    execFileSync('tar', ['-xjf', tarPath, '-C', tmp, ...Object.keys(FILES).map((f) => `pyodide/${f}`)], { stdio: 'pipe' });
    for (const [name, want] of Object.entries(FILES)) {
      const have = fileHash(path.join(tmp, 'pyodide', name));
      if (have !== want) throw new IntegrityError(`${name} sha256 mismatch: expected ${want}, got ${have}`);
    }
    fs.mkdirSync(outDir, { recursive: true });
    for (const name of Object.keys(FILES)) {
      fs.copyFileSync(path.join(tmp, 'pyodide', name), path.join(outDir, name));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const total = Object.keys(FILES).reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
  log(`[vendor-pyodide] vendored ${Object.keys(FILES).length} files (${(total / 1048576).toFixed(1)} MB) -> ${outDir}`);
  return { changed: true, bytes: total };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const soft = process.argv.includes('--soft');
  vendorPyodide().catch((e) => {
    if (e instanceof IntegrityError) { console.error(`[vendor-pyodide] FATAL integrity failure: ${e.message}`); process.exit(1); }
    if (soft && e instanceof NetworkError) {
      console.warn(`[vendor-pyodide] WARNING (soft): ${e.message}. The Code lens's Python runner will report "runtime unavailable" until this succeeds.`);
      process.exit(0);
    }
    console.error(`[vendor-pyodide] failed: ${e?.message || e}`);
    process.exit(1);
  });
}
