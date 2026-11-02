#!/usr/bin/env node
/**
 * Verify the vendored Pyodide runtime is present and intact under
 * public/pyodide/v0.26.4/ (PR #1707, GB-0736).
 *
 * The deploy desk held #1707 in part because the vendoring was only an npm
 * pre-hook: the lane's build runs `npx next build` directly, the hook never
 * fires, and public/pyodide/ is gitignored — so a build could ship with the
 * Code lens's Python runtime silently absent. This check is the verifiable
 * half of the fix: it answers, per file, whether the runtime a build is
 * about to ship actually exists and matches the pinned SHA-256s in
 * scripts/vendor-pyodide.mjs. scripts/ensure-pyodide.mjs runs it inside
 * the build (via next.config.js); CI and humans can run it directly.
 *
 * Usage:
 *   node scripts/check-pyodide.mjs   # exit 0 = vendored + verified;
 *                                    # exit 1 = missing/stale, problems named
 *   npm run check:pyodide
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, OUT_DIR, PYODIDE_VERSION } from './vendor-pyodide.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Per-file verdict for a vendored runtime directory.
 * `files` is injectable so tests can pin small known contents instead of
 * the real 13 MB runtime (same seam style as vendorPyodide's fetchTarball).
 * Returns { ok, problems } — problems names every missing or
 * hash-mismatched file; it never collapses to a bare boolean.
 */
export function checkPyodide({ dir = OUT_DIR, files = FILES } = {}) {
  const problems = [];
  for (const [name, want] of Object.entries(files)) {
    const p = path.join(dir, name);
    let buf;
    try {
      buf = fs.readFileSync(p);
    } catch {
      problems.push(`missing: ${name}`);
      continue;
    }
    const got = sha256(buf);
    if (got !== want) problems.push(`hash mismatch: ${name} (expected ${want}, got ${got})`);
  }
  return { ok: problems.length === 0, problems };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { ok, problems } = checkPyodide();
  if (ok) {
    console.log(`[check-pyodide] OK — Pyodide ${PYODIDE_VERSION} runtime vendored and hash-verified (${Object.keys(FILES).length} files under public/pyodide/v${PYODIDE_VERSION}/).`);
    process.exit(0);
  }
  console.error(`[check-pyodide] FAILED — the Pyodide ${PYODIDE_VERSION} runtime under public/pyodide/v${PYODIDE_VERSION}/ is not vendored:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('[check-pyodide] remedy: run `npm run vendor:pyodide` (needs network access to github.com), then re-run this check.');
  process.exit(1);
}
