// server/lib/pyodide-packages.js
//
// Shared package-closure resolver for the vendored (offline) Pyodide
// scientific-computing packages — numpy, pandas, matplotlib, scipy, sympy.
// Used by BOTH the fetch/vendor script (scripts/fetch-pyodide-packages.mjs)
// and the runtime sandbox (python-sandbox.js), so "what files does package X
// need" has exactly one source of truth: the pyodide-lock.json that ships
// with the ALREADY-INSTALLED `pyodide` npm package (server/node_modules/
// pyodide/pyodide-lock.json) — never hand-maintained, always in sync with
// whichever Pyodide version is actually running.
//
// WHY VENDORED, NOT CDN-FETCHED (2026-08-02 decision, see docs/adr/010-pyodide.md):
// the base Pyodide runtime is bundled in the npm package and needs no
// network — but numpy/pandas/matplotlib/scipy are NOT bundled; Pyodide's
// own `loadPackage()` fetches them from `cdn.jsdelivr.net` on every cold
// worker by default. That would make `run_python` silently depend on a
// live third-party CDN, breaking the ADR's "no network needed" guarantee
// and adding a real availability dependency for something that used to
// have none. `scripts/fetch-pyodide-packages.mjs` downloads the exact
// pinned wheels ONCE (checksum-verified against this lockfile) into
// `server/data/pyodide-packages/`; the sandbox then loads them via
// `pyodide.loadPackage([absoluteLocalPath, ...])` — a genuinely offline,
// zero-network path, hand-verified to work (a hand-built pure-python test
// wheel loads and imports correctly via this exact call shape — see
// server/tests/pyodide-packages.test.js).
//
// If a package was never vendored (the fetch script hasn't been run), the
// sandbox returns an HONEST failure (`python_package_not_vendored`) — it
// NEVER silently falls back to a live CDN fetch. That fallback would
// re-introduce the exact network dependency this module exists to remove.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Only these five are reachable through the public surface (code.exec's
// `packages` param, the agent's `run_python` tool). Bounded and auditable —
// never an arbitrary pyodide package name a caller/brain could request.
export const PYODIDE_ALLOWED_TOP_LEVEL_PACKAGES = Object.freeze([
  "numpy", "pandas", "matplotlib", "scipy", "sympy",
]);

// Where vendored wheels live once scripts/fetch-pyodide-packages.mjs has
// run. Not committed to git (regenerated artifact, matches this repo's
// convention for e.g. the Godot web export — see .gitignore).
export const PYODIDE_VENDOR_DIR = path.resolve(__dirname, "../data/pyodide-packages");

// Tiny createRequire shim so this ESM module can resolve the CJS `pyodide`
// package the same way python-sandbox.js's resolvePyodideIndexURL() does.
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);

function resolvePyodideLockPath() {
  return path.dirname(_require.resolve("pyodide/package.json")) + "/pyodide-lock.json";
}

let _lockCache = null;
export async function loadPyodideLock() {
  if (_lockCache) return _lockCache;
  const raw = await fs.readFile(resolvePyodideLockPath(), "utf8");
  _lockCache = JSON.parse(raw);
  return _lockCache;
}

/**
 * Resolve the full transitive package closure (by name) for a set of
 * requested top-level package names, using the lockfile's own `depends`
 * graph — never a hand-maintained list that can drift from what's actually
 * installed.
 * @param {string[]} names
 * @returns {{ok:true, names:string[]}|{ok:false, error:string, unknown:string[]}}
 */
export async function resolvePackageClosure(names) {
  const lock = await loadPyodideLock();
  const pkgs = lock.packages || {};
  const unknown = names.filter((n) => !PYODIDE_ALLOWED_TOP_LEVEL_PACKAGES.includes(n));
  if (unknown.length) return { ok: false, error: "package_not_allowed", unknown };

  const seen = new Set();
  const missingFromLock = [];
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const meta = pkgs[name];
    if (!meta) { missingFromLock.push(name); return; }
    for (const dep of meta.depends || []) visit(dep);
  };
  for (const n of names) visit(n);
  if (missingFromLock.length) return { ok: false, error: "package_missing_from_lockfile", unknown: missingFromLock };
  return { ok: true, names: Array.from(seen).sort() };
}

/**
 * Map resolved package names to {name, fileName, sha256, vendoredPath, exists}.
 * @param {string[]} names — already-resolved (via resolvePackageClosure)
 */
export async function packageFileInfo(names) {
  const lock = await loadPyodideLock();
  const pkgs = lock.packages || {};
  return Promise.all(names.map(async (name) => {
    const meta = pkgs[name];
    const fileName = meta?.file_name;
    const vendoredPath = fileName ? path.join(PYODIDE_VENDOR_DIR, fileName) : null;
    const exists = vendoredPath ? await fs.access(vendoredPath).then(() => true, () => false) : false;
    return {
      name,
      fileName,
      sha256: meta?.sha256 || null,
      vendoredPath,
      exists,
    };
  }));
}

/** The jsdelivr URL Pyodide's own loadPackage() constructs for a lockfile
 * entry — hand-verified against a real attempted fetch (see
 * docs/adr/010-pyodide.md's package-loading addendum): the exact URL was
 * observed directly from the installed library's own network attempt, not
 * guessed. `${indexBase}pyodide/v${version}/full/${fileName}` mirrors that. */
export function jsdelivrUrlFor(fileName) {
  const version = _require("pyodide/package.json").version;
  return `https://cdn.jsdelivr.net/pyodide/v${version}/full/${fileName}`;
}
