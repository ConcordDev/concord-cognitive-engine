#!/usr/bin/env node
/**
 * Ensure the Pyodide runtime is vendored before a production build ships
 * (PR #1707, GB-0736): check -> vendor (hard) -> re-check.
 *
 * Why this exists alongside scripts/vendor-pyodide.mjs: the vendoring was
 * wired only as npm pre-hooks (prebuild/predev --soft). Any build that
 * invokes `npx next build` directly — the deploy lane's build does —
 * bypasses npm lifecycle hooks entirely, so the runtime was silently
 * absent from the shipped build while public/pyodide/ is gitignored and
 * nothing downstream noticed. next.config.js therefore runs THIS script
 * during phase-production-build: the one repo-controlled code path every
 * `next build` evaluates, whatever invoked it.
 *
 * Failure posture, deliberately unlike the --soft pre-hooks: if the
 * runtime cannot be vendored and verified, this script exits non-zero and
 * the build FAILS with the remedy named. A build that proceeds without
 * the runtime is the silent-ship failure this gate exists to prevent; the
 * dev-time soft path (predev/prebuild) is untouched. A build in a
 * network-less sandbox can opt out explicitly at the next.config layer
 * (CONCORD_PYODIDE_VENDOR_SKIP=1, logged loudly there) — never silently.
 *
 * Concurrency: `next build` can evaluate the config in more than one
 * process. A lockfile in the OS temp dir (keyed by output directory)
 * serializes the vendor step; waiters re-check after acquiring instead of
 * assuming they must vendor. A lock older than 10 minutes is treated as
 * stale (its owner died) and broken, so a crashed build cannot brick
 * later ones.
 *
 * Usage:
 *   node scripts/ensure-pyodide.mjs   # exit 0 = runtime vendored + verified
 *   npm run ensure:pyodide
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OUT_DIR, vendorPyodide } from './vendor-pyodide.mjs';
import { checkPyodide } from './check-pyodide.mjs';

const LOCK_STALE_MS = 10 * 60 * 1000;
const LOCK_WAIT_MS = 120 * 1000;
const LOCK_POLL_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function lockPathFor(outDir = OUT_DIR) {
  const key = createHash('sha256').update(path.resolve(outDir)).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `concord-vendor-pyodide-${key}.lock`);
}

async function acquireLock(lockPath, log) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      return;
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          log(`[ensure-pyodide] breaking stale vendor lock ${lockPath} (older than ${LOCK_STALE_MS / 60000} min)`);
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch { /* lock vanished between open and stat — just retry */ continue; }
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for the Pyodide vendor lock ${lockPath} — another build has held it for over ${LOCK_WAIT_MS / 1000}s. If no build is running, delete that file and retry.`);
      }
      await sleep(LOCK_POLL_MS);
    }
  }
}

/**
 * `vendorImpl` / `checkImpl` are test seams (the same injection style as
 * vendorPyodide's fetchTarball): production callers get the real
 * vendorPyodide + checkPyodide.
 */
export async function ensurePyodide({ outDir = OUT_DIR, log = console.log, vendorImpl = vendorPyodide, checkImpl = checkPyodide } = {}) {
  const first = checkImpl({ dir: outDir });
  if (first.ok) {
    log('[ensure-pyodide] Pyodide runtime already vendored and verified.');
    return { changed: false };
  }
  const lockPath = lockPathFor(outDir);
  await acquireLock(lockPath, log);
  try {
    // Another build may have vendored while this one waited on the lock.
    const second = checkImpl({ dir: outDir });
    if (second.ok) {
      log('[ensure-pyodide] Pyodide runtime vendored by a parallel build and verified.');
      return { changed: false };
    }
    log(`[ensure-pyodide] vendoring Pyodide runtime (${second.problems.length} problem${second.problems.length === 1 ? '' : 's'}: ${second.problems.join('; ')})`);
    await vendorImpl({ outDir, log });
    const after = checkImpl({ dir: outDir });
    if (!after.ok) {
      throw new Error(`Pyodide vendoring ran but the runtime is still not verified: ${after.problems.join('; ')}. Run \`npm run vendor:pyodide\` manually to see the underlying failure.`);
    }
    log('[ensure-pyodide] Pyodide runtime vendored and verified.');
    return { changed: true };
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  ensurePyodide().catch((e) => {
    console.error(`[ensure-pyodide] FAILED: ${e?.message || e}`);
    console.error('[ensure-pyodide] the build must not ship without the runtime. Remedy: run `npm run vendor:pyodide` (needs network access to github.com), then rebuild.');
    process.exit(1);
  });
}
