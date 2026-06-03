// tests/grade-macro-depth.test.js
//
// The macro-depth grader is itself a load-bearing honesty instrument — it's the
// number we cite for "how deep is this codebase". This pins the two fixes that
// made it honest in BOTH directions, against the real tree:
//
//  1. DELEGATION-AWARE: a thin macro that delegates to an imported lib fn the
//     tests exercise (e.g. crime.record → recordCrime, tested in
//     crime-engine.test.js) is credited as tested + graded by the delegate's
//     real work — not mis-graded as an untested "stub".
//  2. INVOCATION-HARDENED (gameability closed): a macro is only credited as
//     tested by a REAL invocation (literal runMacro) or a tested delegate — a
//     bare "domain.macro" string mention no longer counts. And shape-only
//     coverage (smoke harness + bulk CASES-loops) is excluded under --honest,
//     so the honest score reflects genuine BEHAVIORAL coverage only.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GRADER = path.join(ROOT, "scripts", "grade-macro-depth.mjs");
const run = (args) => execFileSync("node", [GRADER, ...args], { cwd: ROOT, encoding: "utf8", timeout: 180_000, stdio: ["ignore", "ignore", "ignore"] });
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, "audit", f), "utf8"));
const find = (j, d, m) => j.macros.find((x) => x.domain === d && x.macro === m);

describe("macro-depth grader — honesty invariants (real tree)", () => {
  let dflt, honest;
  before(() => {
    run([]); dflt = load("macro-depth.json");
    run(["--honest"]); honest = load("macro-depth-honest.json");
  });

  it("DELEGATION: a thin wrapper over a tested lib fn is credited (crime.record → recordCrime)", () => {
    const m = find(honest, "crime", "record");
    assert.ok(m, "crime.record should be graded");
    assert.equal(m.hasTest, true, "credited via the tested delegate recordCrime (crime-engine.test.js imports+calls it)");
    assert.notEqual(m.tier, "stub", "a tested delegation is NOT a stub");
    assert.ok(m.combinedLoc > 15, "the delegate's real LOC is inherited, not just the 6-line wrapper");
  });

  it("LITERAL invocation still credits (dtu.create is called as runMacro(\"dtu\",\"create\",…))", () => {
    const m = find(honest, "dtu", "create");
    assert.ok(m && m.hasTest === true, "literal runMacro invocation = behavioral credit, both modes");
    assert.equal(m.tier, "production-grade");
  });

  it("HONEST excludes shape-only coverage, so honest production% < default production%", () => {
    const pg = (j) => j.totals["production-grade"] / j.total;
    assert.ok(pg(honest) < pg(dflt), `honest prod% (${pg(honest).toFixed(3)}) must be < default (${pg(dflt).toFixed(3)}) — shape/smoke credit dropped`);
    // and the honest weighted score is a believable floor, not a flattering 1.0
    assert.ok(honest.weightedScore < dflt.weightedScore, "honest score is strictly lower than default");
    assert.ok(honest.weightedScore > 0.3 && honest.weightedScore < 0.8, `honest score in the sane band, got ${honest.weightedScore}`);
  });

  it("the grader runs to completion on the full tree (no RangeError crash)", () => {
    assert.ok(dflt.total > 8000, "graded the whole macro tree");
    assert.equal(dflt.mode, "default");
    assert.equal(honest.mode, "honest");
  });
});
