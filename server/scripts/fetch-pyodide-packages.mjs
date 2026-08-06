#!/usr/bin/env node
// server/scripts/fetch-pyodide-packages.mjs
//
// Vendors the Pyodide scientific-computing packages (numpy, pandas,
// matplotlib, scipy, sympy + their full transitive closure — 16 wheel
// files total, resolved from the installed pyodide's own lockfile, see
// lib/pyodide-packages.js) into server/data/pyodide-packages/ so
// python-sandbox.js can load them with ZERO runtime network dependency.
//
// Mirrors this repo's existing scripts/fetch-godot.mjs pattern:
// checksum-verified (SHA-256, straight from pyodide-lock.json — the SAME
// hashes the real pyodide library itself trusts), idempotent (skips a
// file that's already present and verifies clean), and supports `--check`
// to verify an existing vendor directory without downloading anything.
//
// NOT RUN IN THIS SESSION'S SANDBOX: this environment's outbound-network
// proxy allowlists only a specific short list of hosts (registry.npmjs.org,
// pypi.org, github.com for the session's own repo, a few others) —
// cdn.jsdelivr.net (where these wheels actually live) is not on it, so a
// live end-to-end run of this script could not be executed or observed
// here (hand-verified: curl to cdn.jsdelivr.net gets a 403 from the proxy
// itself, "CONNECT tunnel failed"). The URL construction and hash-check
// logic ARE verified: jsdelivrUrlFor() reproduces, byte-for-byte, the
// exact URL the real installed `pyodide` npm package attempted to fetch
// when asked to load numpy (observed directly, not guessed), and the
// local-wheel-loading mechanism this script feeds is proven end-to-end in
// server/tests/pyodide-packages.test.js with a hand-built test wheel. A
// normal CI runner or production box with standard outbound HTTPS should
// reach cdn.jsdelivr.net without issue — that's a materially different
// network posture than this dev sandbox's narrow proxy allowlist.
//
// Usage:
//   node scripts/fetch-pyodide-packages.mjs             # download + verify
//   node scripts/fetch-pyodide-packages.mjs --check      # verify only, no downloads

import fs from "node:fs";
import crypto from "node:crypto";
import {
  PYODIDE_ALLOWED_TOP_LEVEL_PACKAGES, PYODIDE_VENDOR_DIR,
  resolvePackageClosure, packageFileInfo, jsdelivrUrlFor,
} from "../lib/pyodide-packages.js";

const CHECK_ONLY = process.argv.includes("--check");

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

async function downloadTo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

async function main() {
  const closure = await resolvePackageClosure(PYODIDE_ALLOWED_TOP_LEVEL_PACKAGES);
  if (!closure.ok) {
    console.error("[fetch-pyodide-packages] failed to resolve package closure:", closure);
    process.exit(1);
  }
  const files = await packageFileInfo(closure.names);
  fs.mkdirSync(PYODIDE_VENDOR_DIR, { recursive: true });

  let ok = 0, downloaded = 0, failed = 0;
  for (const f of files) {
    if (!f.fileName || !f.sha256) {
      console.error(`[fetch-pyodide-packages] ${f.name}: missing file_name/sha256 in lockfile`);
      failed++;
      continue;
    }
    const already = f.exists && sha256File(f.vendoredPath) === f.sha256;
    if (already) {
      console.log(`[fetch-pyodide-packages] OK   ${f.fileName} (already vendored, hash verified)`);
      ok++;
      continue;
    }
    if (CHECK_ONLY) {
      console.error(`[fetch-pyodide-packages] MISSING/DRIFTED ${f.fileName}`);
      failed++;
      continue;
    }
    const url = jsdelivrUrlFor(f.fileName);
    try {
      console.log(`[fetch-pyodide-packages] fetching ${f.fileName} ...`);
      await downloadTo(url, f.vendoredPath);
      const gotHash = sha256File(f.vendoredPath);
      if (gotHash !== f.sha256) {
        fs.unlinkSync(f.vendoredPath); // never leave a corrupt/mismatched file on disk
        throw new Error(`sha256 mismatch: expected ${f.sha256}, got ${gotHash}`);
      }
      console.log(`[fetch-pyodide-packages] OK   ${f.fileName} (downloaded + hash verified)`);
      downloaded++;
    } catch (err) {
      console.error(`[fetch-pyodide-packages] FAILED ${f.fileName}: ${err.message}`);
      failed++;
    }
  }

  console.log(`[fetch-pyodide-packages] ${ok + downloaded} ok (${downloaded} downloaded this run), ${failed} failed, ${files.length} total`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[fetch-pyodide-packages] fatal:", err);
  process.exit(1);
});
