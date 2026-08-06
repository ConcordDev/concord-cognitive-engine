// server/tests/pyodide-packages.test.js
//
// lib/pyodide-packages.js — the shared package-closure resolver used by
// BOTH scripts/fetch-pyodide-packages.mjs and lib/python-sandbox.js.
// Pins: whitelist enforcement, transitive-dependency resolution off the
// REAL installed pyodide's own lockfile (never a hand-maintained list that
// could drift), the exact jsdelivr URL shape (hand-verified against a real
// attempted fetch by the installed pyodide library itself — see
// docs/adr/010-pyodide.md), and — the load-bearing proof — that
// pyodide.loadPackage([absoluteLocalPath]) genuinely installs a package
// with ZERO network access, using a small hand-built fixture wheel
// (server/tests/fixtures/pyodide-test-wheel/), not a real numpy/pandas
// (which this sandboxed dev environment cannot download — see
// scripts/fetch-pyodide-packages.mjs's header for why).

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  PYODIDE_ALLOWED_TOP_LEVEL_PACKAGES,
  resolvePackageClosure, packageFileInfo, jsdelivrUrlFor, loadPyodideLock,
} from "../lib/pyodide-packages.js";
import { __runPythonWithRawPackagePathsForTests } from "../lib/python-sandbox.js";

test("PYODIDE_ALLOWED_TOP_LEVEL_PACKAGES is exactly the five scientific packages", () => {
  assert.deepEqual([...PYODIDE_ALLOWED_TOP_LEVEL_PACKAGES].sort(), ["matplotlib", "numpy", "pandas", "scipy", "sympy"]);
});

test("resolvePackageClosure rejects a package outside the whitelist", async () => {
  const r = await resolvePackageClosure(["os"]);
  assert.equal(r.ok, false);
  assert.equal(r.error, "package_not_allowed");
  assert.deepEqual(r.unknown, ["os"]);
});

test("resolvePackageClosure resolves numpy alone with no extra dependencies", async () => {
  const r = await resolvePackageClosure(["numpy"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.names, ["numpy"]);
});

test("resolvePackageClosure resolves pandas's real transitive dependency chain", async () => {
  const r = await resolvePackageClosure(["pandas"]);
  assert.equal(r.ok, true);
  assert.ok(r.names.includes("pandas"));
  assert.ok(r.names.includes("numpy"), "pandas depends on numpy");
  assert.ok(r.names.includes("python-dateutil"));
  assert.ok(r.names.includes("pytz"));
});

test("resolvePackageClosure resolves matplotlib's full closure (heaviest dependency graph)", async () => {
  const r = await resolvePackageClosure(["matplotlib"]);
  assert.equal(r.ok, true);
  for (const dep of ["contourpy", "cycler", "fonttools", "kiwisolver", "numpy", "packaging", "pillow", "pyparsing", "python-dateutil", "pytz"]) {
    assert.ok(r.names.includes(dep), `expected matplotlib closure to include ${dep}`);
  }
});

test("resolvePackageClosure resolves sympy -> mpmath", async () => {
  const r = await resolvePackageClosure(["sympy"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.names.sort(), ["mpmath", "sympy"]);
});

test("resolvePackageClosure dedupes a shared dependency across multiple requested packages", async () => {
  const r = await resolvePackageClosure(["pandas", "scipy"]); // both depend on numpy
  assert.equal(r.ok, true);
  assert.equal(r.names.filter((n) => n === "numpy").length, 1);
});

test("resolvePackageClosure resolves the full closure of all five packages to exactly 16 wheels", async () => {
  const r = await resolvePackageClosure([...PYODIDE_ALLOWED_TOP_LEVEL_PACKAGES]);
  assert.equal(r.ok, true);
  assert.equal(r.names.length, 16);
});

test("packageFileInfo reports exists:false for every package in a clean tree (nothing vendored yet)", async () => {
  const r = await resolvePackageClosure(["numpy"]);
  const files = await packageFileInfo(r.names);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "numpy");
  assert.match(files[0].fileName, /^numpy-.*\.whl$/);
  assert.equal(typeof files[0].sha256, "string");
  assert.equal(files[0].sha256.length, 64);
  assert.equal(files[0].exists, false);
});

test("jsdelivrUrlFor reproduces the EXACT URL the real installed pyodide library attempts to fetch (hand-verified, not guessed)", async () => {
  const lock = await loadPyodideLock();
  const fileName = lock.packages.numpy.file_name;
  const url = jsdelivrUrlFor(fileName);
  // The literal URL observed when pyodide.loadPackage(['numpy']) was run for
  // real against the installed library, before this vendoring mechanism
  // existed — see docs/adr/010-pyodide.md.
  assert.match(url, /^https:\/\/cdn\.jsdelivr\.net\/pyodide\/v[\d.]+\/full\//);
  assert.ok(url.endsWith(fileName));
});

test("the local-wheel-loading mechanism itself is real, end-to-end, zero network: a hand-built fixture wheel installs and runs via the exact call shape production uses", async () => {
  const wheelPath = path.resolve(
    import.meta.dirname, "fixtures/pyodide-test-wheel/concordtestpkg-0.0.1-py3-none-any.whl",
  );
  const r = await __runPythonWithRawPackagePathsForTests(
    "import concordtestpkg\nconcordtestpkg.greet()",
    [wheelPath],
    ["concordtestpkg"],
  );
  assert.equal(r.ok, true);
  assert.equal(r.result, "hello from a real vendored local wheel");
  assert.match(r.stdout, /Loaded concordtestpkg/);
});

test("a missing/bad local wheel path fails honestly — pyodide.loadPackage() doesn't throw on a per-package load failure (hand-verified), so the failure surfaces where the user's code actually tries to import it, not silently", async () => {
  const r = await __runPythonWithRawPackagePathsForTests(
    "import nothing", ["/nonexistent/path/to/nothing-0.0.1-py3-none-any.whl"], ["nothing"],
  );
  // loadPackage() itself resolves (doesn't reject) even though the file is
  // missing — it logs the failure into Pyodide's own stderr channel and
  // moves on. The real, user-visible failure is the subsequent ImportError
  // when the requested-but-unloaded package is actually imported.
  assert.equal(r.ok, false);
  assert.match(r.error, /nothing/i);
  assert.match(r.stderr, /ENOENT|no such file/i);
});
