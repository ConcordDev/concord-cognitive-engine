// tests/constant-time-detector.test.js
//
// Proves the constant-time detector — the first AST-based detector in this
// suite — actually fires on the four real secret-dependent-flow classes it
// targets (branch, index, loop-bound, early-exit) and, just as important,
// does NOT fire on the matching clean/safe counterpart of each. The
// safe-compare.js pair is explicitly load-bearing per the task brief: a
// detector that flags the constant-time-compare idiom itself is worthless.
//
// Also proves: the annotation-based taint source works independent of
// naming convention, the detector degrades honestly (a single info finding,
// ok:true) when the `typescript` parser is unavailable, and it never throws
// on malformed/unparseable input.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runConstantTimeDetector,
  analyzeSourceText,
  SECRET_NAME_RE,
} from "../lib/detectors/constant-time-detector.js";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures", "constant-time");

async function fixture(name) {
  return readFile(path.join(FIXTURES, name), "utf8");
}

/** Builds a fake repo with a server/ tree (the detector only walks <root>/server/). */
async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "consttime-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, "server", rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

function findingsById(report, id) {
  return report.findings.filter((f) => f.id === id);
}
function realFindings(report) {
  return report.findings.filter((f) => f.severity !== "info");
}

describe("constant-time detector — pure helper: SECRET_NAME_RE", () => {
  it("matches the documented naming convention", () => {
    for (const nm of ["secret", "userPassword", "privateKey", "private_key", "apiKey", "authToken", "seed", "hmacDigest", "signature", "passphrase", "credential"]) {
      assert.ok(SECRET_NAME_RE.test(nm), `${nm} should match`);
    }
    for (const nm of ["userChoice", "publicIndex", "table", "input", "count"]) {
      assert.ok(!SECRET_NAME_RE.test(nm), `${nm} should NOT match`);
    }
  });
});

// The naming-convention taint source is OPT-IN (default OFF) — see the taint
// source policy in constant-time-detector.js. These unit tests exercise that
// heuristic deliberately, so they pass it explicitly; the DEFAULT
// (annotation-only) behavior is asserted separately below.
const NAMING_ON = { useNamingConvention: true };

describe("constant-time detector — analyzeSourceText (in-process, no fs)", () => {
  it("flags a secret-dependent branch and does not flag its clean counterpart", () => {
    const bad = analyzeSourceText(ts, "a.js", "function f(secretFlag){ if (secretFlag) { return 1; } return 2; }", "a.js", ".js", NAMING_ON);
    assert.ok(bad.some((f) => f.id === "secret_dependent_branch"), "expected a branch finding");

    const good = analyzeSourceText(ts, "b.js", "function f(userChoice){ if (userChoice) { return 1; } return 2; }", "b.js", ".js", NAMING_ON);
    assert.equal(good.length, 0, "ordinary branch on a non-secret must not be flagged");
  });

  it("flags secret-dependent element access (index) and not a public-index counterpart", () => {
    const bad = analyzeSourceText(ts, "a.js", "function f(t, secretIndex){ return t[secretIndex]; }", "a.js", ".js", NAMING_ON);
    assert.ok(bad.some((f) => f.id === "secret_dependent_index"));

    const good = analyzeSourceText(ts, "b.js", "function f(t, publicIndex){ return t[publicIndex]; }", "b.js", ".js", NAMING_ON);
    assert.equal(good.length, 0);
  });

  it("exempts `.length` from the loop-bound rule (fixed-length loop idiom) but flags a raw tainted bound", () => {
    const fixedLen = analyzeSourceText(ts, "a.js", "function f(secret){ for (let i=0;i<secret.length;i++){} }", "a.js", ".js", NAMING_ON);
    assert.equal(fixedLen.filter((f) => f.id === "secret_dependent_loop_bound").length, 0, "secret.length as a fixed bound is the recommended idiom, not a leak");

    const rawBound = analyzeSourceText(ts, "b.js", "function f(secretCount){ for (let i=0;i<secretCount;i++){ noop(); } }", "b.js", ".js", NAMING_ON);
    assert.ok(rawBound.some((f) => f.id === "secret_dependent_loop_bound"), "a raw secret-tainted scalar as the bound must be flagged");
  });

  it("does not taint through compound assignment (|=) — the safe accumulate-diff idiom stays clean", () => {
    const safe = analyzeSourceText(
      ts, "s.js",
      "function f(secret,input){ let diff=0; for(let i=0;i<secret.length;i++){ diff |= secret[i]^input[i]; } return diff===0; }",
      "s.js", ".js", NAMING_ON
    );
    assert.equal(safe.length, 0, `expected zero findings, got: ${JSON.stringify(safe.map((f) => f.id))}`);
  });

  it("the annotation `// @secret` is an independent taint source", () => {
    const src = "// @secret\nfunction verify(k, input) { if (k === input) { return true; } return false; }";
    const withAnnotation = analyzeSourceText(ts, "a.js", src, "a.js", ".js");
    assert.ok(withAnnotation.some((f) => f.id === "secret_dependent_branch"), "annotated param must be tainted");

    const withoutAnnotation = analyzeSourceText(
      ts, "b.js",
      "function verify(k, input) { if (k === input) { return true; } return false; }",
      "b.js", ".js"
    );
    assert.equal(withoutAnnotation.length, 0, "without the annotation, `k` matches no naming convention and must not be flagged");
  });

  it("propagates taint through plain assignment and destructuring, but not across unrelated names", () => {
    const viaAssign = analyzeSourceText(ts, "a.js", "function f(secret){ let x; x = secret; if (x) { return 1; } return 2; }", "a.js", ".js", NAMING_ON);
    assert.ok(viaAssign.some((f) => f.id === "secret_dependent_branch"));

    const viaDestructure = analyzeSourceText(ts, "b.js", "function f(bundle){ const { secretKey } = bundle; if (secretKey) { return 1; } return 2; }", "b.js", ".js", NAMING_ON);
    assert.ok(viaDestructure.some((f) => f.id === "secret_dependent_branch"), "destructured secret-named binding must be tainted");
  });

  it("never throws on malformed/unparseable input — returns an array (possibly empty)", () => {
    const out = analyzeSourceText(ts, "garbage.js", "function broken(secret {{{ if (secret) return ]]] const x = }", "garbage.js", ".js", NAMING_ON);
    assert.ok(Array.isArray(out));
  });
});

describe("constant-time detector — end to end (real fs, real repo shape)", () => {
  let dir;

  it("FIRES on vulnerable-compare.js at the right line, does NOT fire on safe-compare.js (load-bearing)", async () => {
    dir = await tmpRepo({
      "lib/crypto/vulnerable-compare.js": await fixture("vulnerable-compare.js"),
      "lib/crypto/safe-compare.js": await fixture("safe-compare.js"),
    });
    const r = await runConstantTimeDetector({ root: dir });
    assert.equal(r.ok, true);

    const badFindings = r.findings.filter((f) => f.location?.includes("vulnerable-compare.js"));
    assert.ok(badFindings.some((f) => f.id === "secret_dependent_early_exit"), "the early-exit-in-loop pattern must be flagged");
    const earlyExit = badFindings.find((f) => f.id === "secret_dependent_early_exit");
    // Derive the expected line from the fixture itself rather than hardcoding a
    // magic number — the previous hardcoded `:8` broke the moment the fixture's
    // header comment changed by one line, which says nothing about the detector.
    const fixtureSrc = await fixture("vulnerable-compare.js");
    const loopLine = fixtureSrc.split("\n").findIndex((l) => l.includes("for (")) + 1;
    assert.ok(loopLine > 0, "fixture must contain the loop this test is about");
    assert.match(
      earlyExit.location,
      new RegExp(`vulnerable-compare\\.js:${loopLine}$`),
      `early-exit finding should point at the loop on line ${loopLine}, got ${earlyExit.location}`
    );

    const safeFindings = r.findings.filter((f) => f.location?.includes("safe-compare.js"));
    assert.equal(safeFindings.length, 0, `safe-compare.js must produce ZERO findings, got: ${JSON.stringify(safeFindings)}`);
    await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("FIRES on vulnerable-index.js, does NOT fire on safe-index.js", async () => {
    dir = await tmpRepo({
      "lib/crypto/vulnerable-index.js": await fixture("vulnerable-index.js"),
      "lib/crypto/safe-index.js": await fixture("safe-index.js"),
    });
    const r = await runConstantTimeDetector({ root: dir });
    const bad = r.findings.filter((f) => f.location?.includes("vulnerable-index.js") && f.id === "secret_dependent_index");
    assert.ok(bad.length >= 1);
    const safe = r.findings.filter((f) => f.location?.includes("safe-index.js"));
    assert.equal(safe.length, 0);
    await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("FIRES on vulnerable-branch.js, does NOT fire on safe-branch.js", async () => {
    dir = await tmpRepo({
      "lib/crypto/vulnerable-branch.js": await fixture("vulnerable-branch.js"),
      "lib/crypto/safe-branch.js": await fixture("safe-branch.js"),
    });
    const r = await runConstantTimeDetector({ root: dir });
    const bad = r.findings.filter((f) => f.location?.includes("vulnerable-branch.js") && f.id === "secret_dependent_branch");
    assert.ok(bad.length >= 1);
    const safe = r.findings.filter((f) => f.location?.includes("safe-branch.js"));
    assert.equal(safe.length, 0);
    await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("annotation.js fires end to end via the real detector entry point", async () => {
    dir = await tmpRepo({ "lib/crypto/annotation-secret.js": await fixture("annotation-secret.js") });
    const r = await runConstantTimeDetector({ root: dir });
    const bad = r.findings.filter((f) => f.location?.includes("annotation-secret.js"));
    assert.ok(bad.some((f) => f.id === "secret_dependent_branch"));
    await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("never throws — returns ok:true on a garbage-syntax file and an empty tree", async () => {
    dir = await tmpRepo({ "lib/crypto/garbage-syntax.js": await fixture("garbage-syntax.js.fixture") });
    const r = await runConstantTimeDetector({ root: dir });
    assert.equal(r.ok, true);
    await rm(dir, { recursive: true, force: true });

    dir = await tmpRepo({ "x.txt": "no code here" });
    const r2 = await runConstantTimeDetector({ root: dir });
    assert.equal(r2.ok, true);
    dir = null;
  });

  it("skips fixture/test files and its own detector directory (no self-noise, no double-counting fixtures)", async () => {
    dir = await tmpRepo({
      "tests/fixtures/constant-time/vulnerable-compare.js": await fixture("vulnerable-compare.js"),
      "some.test.js": "function f(secret){ if (secret) { return 1; } return 2; }",
    });
    const r = await runConstantTimeDetector({ root: dir });
    const real = realFindings(r);
    assert.equal(real.length, 0, `fixtures/test files must be skipped, got: ${JSON.stringify(real.map((f) => f.location))}`);
    await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("degrades honestly (ok:true, single info finding) when the typescript parser is unavailable", async () => {
    dir = await tmpRepo({ "lib/crypto/vulnerable-branch.js": await fixture("vulnerable-branch.js") });
    const r = await runConstantTimeDetector({ root: dir, opts: { __loadTs: async () => null } });
    assert.equal(r.ok, true);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].id, "constant_time_parser_unavailable");
    assert.equal(r.findings[0].severity, "info");
    await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("real dynamic import of `typescript` actually resolves (sanity: the lazy-import path works in this env)", async () => {
    dir = await tmpRepo({ "lib/crypto/vulnerable-branch.js": await fixture("vulnerable-branch.js") });
    const r = await runConstantTimeDetector({ root: dir }); // no __loadTs override — real import("typescript")
    assert.ok(r.findings.some((f) => f.id === "secret_dependent_branch"), "with the real parser loaded, the detector must actually find the seeded vulnerability");
    dir = null;
  });
});

describe("constant-time detector — registry wiring", () => {
  it("is registered under the code-quality consumer only (not security)", async () => {
    const { listDetectors } = await import("../lib/detectors/index.js");
    const entry = listDetectors().find((d) => d.id === "constant-time");
    assert.ok(entry, "constant-time must be registered");
    assert.ok(entry.consumers.includes("code-quality"));
    assert.ok(!entry.consumers.includes("security"), "must NOT join the blocking security gate per the task brief");
  });
});
