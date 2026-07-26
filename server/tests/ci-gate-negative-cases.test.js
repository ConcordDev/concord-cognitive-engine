// server/tests/ci-gate-negative-cases.test.js
//
// META-VERIFICATION: every CI gate in this repo has, until now, only ever been
// observed PASSING. A gate that has never been shown failing on a known-bad
// input is indistinguishable from a gate that cannot fail. The concrete miss
// that motivated this file: `scripts/check-doc-claims-all.mjs` reported
// "0 MISMATCH" while CLAUDE.md carried genuinely stale composite numbers
// (e.g. "256 WIRED / 0 broken / 2 by-design" next to a real count of 262) —
// the checker only ever extracts ONE (bold-number, command) pair per line
// (the bold number nearest the command), so a line with several bold numbers
// and one command silently leaves the others unchecked. Green from that gate
// means "every number that got PAIRED with a command still matches", not
// "this document is true."
//
// This file proves, per gate, that a KNOWN-BAD input makes it fail — built
// synthetically (fixture docs under server/tests/fixtures/, or a temporary
// file/directory created and removed via try/finally) — NEVER by editing a
// real repo file. Where a gate's own script hardcodes its scan root (most of
// them do — no --root/--file override), the "fixture" is a uniquely-named
// temp file added at the real hardcoded location and removed in a finally
// block, the same class of technique server/tests/stale-code-staging-suffix.test.js
// uses for a detector that needs a real-shaped tree.
//
// Hard rule honored: no gate script is edited. server/lib/detectors/** and
// audit/** are only ever IMPORTED (read-only), never modified.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { diffAgainstBaseline, ciDecision, fingerprint } from "../lib/detectors/baseline.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = path.join(ROOT, "server", "tests", "fixtures", "ci-gate-negative-cases");

// spawnSync (not execFileSync) — execFileSync only returns stdout on a
// zero-exit run and throws away stderr unless the process itself throws,
// which silently breaks any assertion against stderr on a passing/soft-fail
// script (verify-lens-backends.mjs always exits 0 and puts its report on
// stderr). spawnSync gives both streams regardless of exit code.
function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// Removes a path if present; never throws (cleanup must never mask the real
// assertion failure it's running alongside in a finally block).
function safeRm(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* noop */ }
}

describe("CI gate 1/6 — scripts/check-doc-claims.mjs (per-file engine behind check-doc-claims-all.mjs)", () => {
  it("known-bad: a fixture doc with a wrong number + adjacent command is reported MISMATCH and exits non-zero under --ci", () => {
    const r = run("node", [
      "scripts/check-doc-claims.mjs",
      "--file", "server/tests/fixtures/ci-gate-negative-cases/doc-claims-mismatch.md",
      "--json", "--ci",
    ]);
    assert.equal(r.code, 1, `expected non-zero exit, got 0. stdout=${r.stdout}`);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.countClaims.length, 1);
    assert.equal(parsed.countClaims[0].status, "MISMATCH");
    assert.equal(parsed.countClaims[0].claimed, 999);
    assert.equal(parsed.countClaims[0].actual, 1);
  });

  it("control: a fixture doc whose claim is actually correct passes clean", () => {
    const r = run("node", [
      "scripts/check-doc-claims.mjs",
      "--file", "server/tests/fixtures/ci-gate-negative-cases/doc-claims-match.md",
      "--json", "--ci",
    ]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.countClaims[0].status, "MATCH");
  });

  it("STRUCTURAL BLIND SPOT (proven, not fixed): a composite line with THREE bold numbers and ONE command " +
     "only ever pairs the command with the nearest bold number — the other two, even if wildly wrong, are " +
     "silently never checked and the file reports zero mismatches", () => {
    const r = run("node", [
      "scripts/check-doc-claims.mjs",
      "--file", "server/tests/fixtures/ci-gate-negative-cases/doc-claims-composite-blind-spot.md",
      "--json", "--ci",
    ]);
    // The fixture asserts "**999 WIRED** / **777 broken** / **1 by-design**" against
    // a directory that actually has 1 file. 999 and 777 are obviously false, but the
    // extractor produces exactly ONE claim (paired with "1", the bold number nearest
    // the trailing command) — so the gate PASSES on a doc containing two flatly wrong
    // numbers. This is the exact shape of the real CLAUDE.md miss this file exists for.
    assert.equal(r.code, 0, "gate must (structurally) pass here — this is the blind spot, not a bug in the fixture");
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.countClaims.length, 1, "only one of the three bold numbers on the line was ever extracted");
    assert.equal(parsed.countClaims[0].claimed, 1, "the extractor paired the command with the LAST bold number, not the first two");
  });
});

describe("CI gate 2/6 — scripts/verify-invariant-test-links.mjs", () => {
  // No --file/--root override exists on this script — it hardcodes CLAUDE.md +
  // docs/*.md as its source list. To exercise it against a known-bad claim we
  // add ONE uniquely-named temp file under the real docs/ dir and remove it in
  // a finally block; we never touch an existing file's content.
  it("known-bad: a doc claiming a test file is pinned when that file does not exist on disk is reported MISSING and exits non-zero under --ci", () => {
    const tmpDoc = path.join(ROOT, "docs", "__ci_gate_negative_case_invariant_links_tmp.md");
    const fakeRef = "tests/ci-gate-negative-case-does-not-exist-on-disk.test.js";
    safeRm(tmpDoc);
    try {
      fs.writeFileSync(tmpDoc, `# temp fixture\n\nThis invariant is pinned by \`${fakeRef}\`.\n`);
      const r = run("node", ["scripts/verify-invariant-test-links.mjs", "--json", "--ci"]);
      assert.equal(r.code, 1, `expected non-zero exit, got 0. stdout=${r.stdout}`);
      const parsed = JSON.parse(r.stdout);
      const missingRefs = parsed.missing.map((m) => m.ref);
      assert.ok(missingRefs.includes(fakeRef), `expected ${fakeRef} in missing list: ${JSON.stringify(missingRefs)}`);
    } finally {
      safeRm(tmpDoc);
    }
  });

  it("a fixture ref phrased as PLANNED work is deliberately NOT flagged (documented suppression, not a bug)", () => {
    const tmpDoc = path.join(ROOT, "docs", "__ci_gate_negative_case_invariant_links_planned_tmp.md");
    const fakeRef = "tests/ci-gate-negative-case-planned-future-work.test.js";
    safeRm(tmpDoc);
    try {
      fs.writeFileSync(tmpDoc, `# temp fixture\n\nThis is planned work, will be pinned by \`${fakeRef}\`.\n`);
      const r = run("node", ["scripts/verify-invariant-test-links.mjs", "--json"]);
      assert.equal(r.code, 0);
      const parsed = JSON.parse(r.stdout);
      const seenRefs = [...(parsed.missing || []).map((m) => m.ref)];
      assert.ok(!seenRefs.includes(fakeRef), "a line containing 'planned'/'will be pinned' is suppressed entirely, by design");
    } finally {
      safeRm(tmpDoc);
    }
  });
});

describe("CI gate 3/6 — scripts/verify-lens-backends.mjs", () => {
  // Same shape: LENSDIR is hardcoded to concord-frontend/app/lenses. A lens
  // page that calls a macro domain guaranteed not to exist forces an UNWIRED
  // verdict for that one lens.
  it("known-bad: a lens page calling a nonexistent macro domain is verdicted UNWIRED, moving the aggregate count", () => {
    const lensDir = path.join(ROOT, "concord-frontend", "app", "lenses", "__ci_gate_negative_case_tmp");
    safeRm(lensDir);
    try {
      fs.mkdirSync(lensDir, { recursive: true });
      fs.writeFileSync(
        path.join(lensDir, "page.tsx"),
        `export default function Page() {\n  lensRun("totally-fake-domain-zzz-9999-does-not-exist", "nope-action");\n  return null;\n}\n`,
      );
      const r = run("node", ["scripts/verify-lens-backends.mjs"]);
      assert.equal(r.code, 0, "the script itself has no --ci gate of its own (see blind-spot notes) — it just reports");
      const lastLine = r.stdout.trim().split("\n").pop();
      const summary = JSON.parse(lastLine);
      assert.ok((summary.verdicts.UNWIRED || 0) >= 1, `expected >=1 UNWIRED verdict, got ${JSON.stringify(summary.verdicts)}`);
      assert.ok(r.stderr.includes("__ci_gate_negative_case_tmp"), "the human-readable stderr report names the bad lens");
    } finally {
      safeRm(lensDir);
    }
  });
});

describe("CI gate 4/6 — scripts/verify-schema-drift.mjs", () => {
  // SERVER root is hardcoded to server/. A lib file with a db.prepare() SELECT
  // naming a column that exists on no table anywhere (migrations or lib-side
  // CREATE TABLE) is unambiguous single-table drift, high confidence.
  it("known-bad: a SELECT naming a column that exists nowhere on `users` is flagged as drift and fails --ci 0", { timeout: 60_000 }, () => {
    const tmpFile = path.join(ROOT, "server", "lib", "__ci_gate_negative_case_schema_drift_tmp.js");
    const badCol = "__ci_gate_test_bogus_col_9f3a2b__";
    safeRm(tmpFile);
    try {
      fs.writeFileSync(
        tmpFile,
        `export function badQuery(db) {\n  return db.prepare("SELECT ${badCol} FROM users WHERE id = ?").get(1);\n}\n`,
      );
      const r = run("node", ["scripts/verify-schema-drift.mjs", "--json"]);
      assert.equal(r.code, 0, "plain run (no --ci) always exits 0, it only reports");
      const parsed = JSON.parse(r.stdout);
      assert.ok(parsed.drift >= 1, `expected >=1 drift finding, got ${parsed.drift}`);
      const hit = parsed.findings.find((f) => f.table === "users" && f.column === badCol);
      assert.ok(hit, `expected a finding for users.${badCol}, got ${JSON.stringify(parsed.findings)}`);

      const ciRun = run("node", ["scripts/verify-schema-drift.mjs", "--ci", "0"]);
      assert.equal(ciRun.code, 1, "with --ci 0 (zero-drift floor), the new finding must fail the build");
      assert.match(ciRun.stderr + ciRun.stdout, /FAIL/);
    } finally {
      safeRm(tmpFile);
    }
  });
});

describe("CI gate 5/6 — server/scripts/run-detectors.js (--diff --ci ratchet)", () => {
  // A full `run-detectors.js --diff --ci` invocation runs ~30 detectors against
  // an ephemeral fully-migrated DB, which is too slow to run twice inside a
  // single test file under parallel load (other suites are saturating the
  // box right now). Rather than skip this gate, we test the EXACT decision
  // functions run-detectors.js calls unmodified — `diffAgainstBaseline` +
  // `ciDecision` from server/lib/detectors/baseline.js, imported read-only
  // (never edited; that file is PROTECTED). This is narrower than an
  // end-to-end CLI run but exercises the real, unmodified ratchet logic with
  // fully synthetic data — no real file I/O, no PROTECTED files touched.
  it("known-bad: a NEW high-severity finding not in the baseline fails ciDecision", () => {
    const existingFinding = { id: "r1", severity: "medium", location: "a.js:1" };
    const newFinding = { id: "r2", severity: "high", location: "b.js:9" };
    // The baseline key MUST be the real sha256 fingerprint (detector|ruleId|location|
    // severity) — using an arbitrary string here would make every current finding
    // read as "new" and defeat the point of the test (proving the UNCHANGED one is
    // correctly recognized so only the genuinely new high fires the gate).
    const existingFp = fingerprint(existingFinding, "x");
    const baseline = { fingerprints: { [existingFp]: { detector: "x", id: "r1", severity: "medium" } } };
    const report = { reports: [{ id: "x", findings: [existingFinding, newFinding] }] };
    const delta = diffAgainstBaseline(report, baseline);
    assert.equal(delta.unchangedCount, 1, "the pre-existing finding must fingerprint-match and NOT count as new");
    assert.equal(delta.addedCount, 1);
    assert.equal(delta.addedBySeverity.high, 1);

    const decision = ciDecision(delta, { total: 2 }, null);
    assert.equal(decision.pass, false);
    assert.equal(decision.reason, "new_high_or_critical");
  });

  it("known-bad: total findings exceeding budget.maxTotal * 1.05 fails ciDecision even with zero new high/critical", () => {
    const baseline = { fingerprints: {} };
    const report = { reports: [{ id: "x", findings: [{ id: "r1", severity: "info", location: "a.js:1" }] }] };
    const delta = diffAgainstBaseline(report, baseline);
    // Everything here is "added" info-severity, so new_high_or_critical must NOT fire —
    // isolates the budget branch.
    assert.equal(delta.addedBySeverity.critical, 0);
    assert.equal(delta.addedBySeverity.high, 0);

    const decision = ciDecision(delta, { total: 1000 }, { maxTotal: 100 });
    assert.equal(decision.pass, false);
    assert.equal(decision.reason, "budget_exceeded");
  });

  it("control: an unchanged baseline-only report with total under budget passes", () => {
    const existingFinding = { id: "r1", severity: "critical", location: "a.js:1" };
    const existingFp = fingerprint(existingFinding, "x");
    const baseline = { fingerprints: { [existingFp]: { detector: "x", id: "r1", severity: "critical" } } };
    const report = { reports: [{ id: "x", findings: [existingFinding] }] };
    const delta = diffAgainstBaseline(report, baseline);
    assert.equal(delta.addedCount, 0);
    const decision = ciDecision(delta, { total: 1 }, { maxTotal: 100 });
    assert.equal(decision.pass, true);
  });
});

describe("CI gate 6/6 — scripts/generate-wiring-doc.mjs --check", () => {
  // Reuses the same fixture technique as gate 3: this script recomputes
  // docs/WIRING.md live from verify-lens-backends.mjs + verify-invariant-test-links.mjs
  // and diffs against the committed file. Adding the same bad lens used above
  // guarantees the live computation diverges from whatever is committed,
  // regardless of ambient drift in the working tree at test time.
  it("known-bad: an extra UNWIRED lens not reflected in the committed docs/WIRING.md fails --check", { timeout: 30_000 }, () => {
    const lensDir = path.join(ROOT, "concord-frontend", "app", "lenses", "__ci_gate_negative_case_wiring_doc_tmp");
    safeRm(lensDir);
    try {
      fs.mkdirSync(lensDir, { recursive: true });
      fs.writeFileSync(
        path.join(lensDir, "page.tsx"),
        `export default function Page() {\n  lensRun("totally-fake-domain-zzz-9999-does-not-exist", "nope-action");\n  return null;\n}\n`,
      );
      const r = run("node", ["scripts/generate-wiring-doc.mjs", "--check"]);
      assert.equal(r.code, 1, `expected --check to fail with the fixture lens present. stdout=${r.stdout} stderr=${r.stderr}`);
      assert.match(r.stderr + r.stdout, /STALE/);
    } finally {
      safeRm(lensDir);
    }
  });
});
