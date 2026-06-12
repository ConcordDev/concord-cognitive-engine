/**
 * proof-gate — the sound (Z3) layer for reason.verify.
 *
 * Z3 and the subconscious brain are exercised live in deployment; this pins the
 * deterministic logic offline by injecting a fake brainFn (returns canned SMT-LIB)
 * and a fake z3Runner (returns sat/unsat/unknown), so the whole verdict mapping is
 * CI-testable with no binary and no model — mirrors the reason-verify floor tests.
 *
 *   unsat-of-negation  → proven   (sound: claim is valid)
 *   sat-of-negation    → refuted  (sound: counterexample exists)
 *   unknown            → unknown
 *   no z3 binary       → unavailable (and reason.verify is left untouched)
 *   non-math claim     → not_amenable (no brain/Z3 cost)
 *
 * Run: node --test server/tests/proof-gate.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { classifyAmenable, extractSmt, runZ3, proveClaim } from "../lib/proof-gate.js";
import { verifyClaim } from "../lib/reason-verify.js";

// A z3Runner stub: first call is the availability probe "(check-sat)", later the
// real script. `available:false` simulates a box with no Z3 installed.
function z3Stub({ available = true, result = "unsat" } = {}) {
  return async (smt) => {
    if (!available) return { available: false, result: null, raw: "ENOENT" };
    if (/^\s*\(check-sat\)\s*$/.test(smt)) return { available: true, result: "sat", raw: "sat" }; // probe
    return { available: true, result, raw: result };
  };
}

const brainStub = (smt) => async () => ({ text: "```smt\n" + smt + "\n```" });

describe("proof-gate — amenability heuristic", () => {
  it("flags math/logic claims with a formalisable anchor", () => {
    assert.equal(classifyAmenable("for all integers n, n + 0 = n").amenable, true);
    assert.equal(classifyAmenable("3 + 4 > 5").amenable, true);
    assert.equal(classifyAmenable("if x is prime and x > 2 then x is odd").amenable, true);
  });
  it("rejects prose with no formalisable structure", () => {
    assert.equal(classifyAmenable("Paris is the capital of France").amenable, false);
    assert.equal(classifyAmenable("the music feels warm and nostalgic").amenable, false);
    assert.equal(classifyAmenable("").amenable, false);
  });
});

describe("proof-gate — SMT extraction", () => {
  it("pulls a fenced smt block and keeps through check-sat", () => {
    const out = extractSmt("blah\n```smt\n(declare-const x Int)\n(assert (> x 0))\n(check-sat)\n```\ntrailing");
    assert.match(out, /\(check-sat\)/);
    assert.match(out, /declare-const x Int/);
    assert.doesNotMatch(out, /trailing/);
  });
  it("appends a check-sat when the brain forgot it but gave assertions", () => {
    const out = extractSmt("```smt\n(assert false)\n```");
    assert.match(out, /\(check-sat\)/);
  });
  it("returns null when there's nothing formalisable", () => {
    assert.equal(extractSmt("no smt here at all"), null);
  });
});

describe("proof-gate — proveClaim verdict mapping", () => {
  it("unsat-of-negation → proven (sound)", async () => {
    const r = await proveClaim({
      claim: "for all integers n, n + 0 = n",
      brainFn: brainStub("(declare-const n Int)\n(assert (not (= (+ n 0) n)))\n(check-sat)"),
      z3Runner: z3Stub({ result: "unsat" }),
    });
    assert.equal(r.verdict, "proven");
    assert.equal(r.attempted, true);
    assert.equal(r.z3Available, true);
    assert.match(r.smt, /check-sat/);
  });

  it("sat-of-negation → refuted (counterexample)", async () => {
    const r = await proveClaim({
      claim: "for all integers n, n > 0",
      brainFn: brainStub("(declare-const n Int)\n(assert (not (> n 0)))\n(check-sat)"),
      z3Runner: z3Stub({ result: "sat" }),
    });
    assert.equal(r.verdict, "refuted");
  });

  it("unknown → unknown", async () => {
    const r = await proveClaim({
      claim: "3 + 4 > 5",
      brainFn: brainStub("(assert (not (> (+ 3 4) 5)))\n(check-sat)"),
      z3Runner: z3Stub({ result: "unknown" }),
    });
    assert.equal(r.verdict, "unknown");
  });

  it("no Z3 binary → unavailable, and the brain is never called", async () => {
    let brainCalled = false;
    const r = await proveClaim({
      claim: "3 + 4 > 5",
      brainFn: async () => { brainCalled = true; return { text: "```smt\n(check-sat)\n```" }; },
      z3Runner: z3Stub({ available: false }),
    });
    assert.equal(r.verdict, "unavailable");
    assert.equal(r.z3Available, false);
    assert.equal(brainCalled, false, "must probe Z3 before spending a brain call");
  });

  it("non-amenable claim → not_amenable, no work done", async () => {
    let z3Called = false;
    const r = await proveClaim({
      claim: "Paris is lovely in spring",
      brainFn: async () => ({ text: "" }),
      z3Runner: async () => { z3Called = true; return { available: true, result: "sat" }; },
    });
    assert.equal(r.verdict, "not_amenable");
    assert.equal(z3Called, false);
  });

  it("brain marks UNFORMALISABLE → unformalisable", async () => {
    const r = await proveClaim({
      claim: "for all x, beauty implies truth",
      brainFn: async () => ({ text: "```smt\n; UNFORMALISABLE\n```" }),
      z3Runner: z3Stub({ result: "unsat" }),
    });
    assert.equal(r.verdict, "unformalisable");
  });
});

describe("runZ3 — graceful when binary absent", () => {
  it("returns available:false instead of throwing when z3 is missing", async () => {
    const r = await runZ3("(check-sat)", { z3Path: "/nonexistent/z3-binary-xyz", timeoutMs: 1000 });
    assert.equal(r.available, false);
  });
});

describe("reason.verify — proof gate integration", () => {
  let db;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT, data TEXT);`);
  });

  it("a proven math claim upgrades the top-level verdict to 'proven'", async () => {
    const r = await verifyClaim(db, {
      claim: "for all integers n, n + 0 = n",
      citationIds: [],
      useCouncil: false,
      proofBrainFn: brainStub("(declare-const n Int)\n(assert (not (= (+ n 0) n)))\n(check-sat)"),
      proofZ3Runner: z3Stub({ result: "unsat" }),
    });
    assert.equal(r.verdict, "proven");
    assert.equal(r.supported, true);
    assert.equal(r.mode, "proof");
    assert.equal(r.proof.verdict, "proven");
  });

  it("a refuted claim sets verdict 'refuted' / supported:false", async () => {
    const r = await verifyClaim(db, {
      claim: "for all integers n, n > 0",
      citationIds: [],
      useCouncil: false,
      proofBrainFn: brainStub("(declare-const n Int)\n(assert (not (> n 0)))\n(check-sat)"),
      proofZ3Runner: z3Stub({ result: "sat" }),
    });
    assert.equal(r.verdict, "refuted");
    assert.equal(r.supported, false);
  });

  it("no Z3 ⇒ proof gate is a no-op; floor verdict untouched", async () => {
    const r = await verifyClaim(db, {
      claim: "3 + 4 > 5",
      citationIds: [],
      useCouncil: false,
      proofZ3Runner: z3Stub({ available: false }),
    });
    // Nothing cited + no proof ⇒ stays at the deterministic floor.
    assert.equal(r.verdict, "unverified");
    assert.equal(r.proof.verdict, "unavailable");
  });

  it("non-math claim ⇒ proof stays null, no override", async () => {
    const r = await verifyClaim(db, {
      claim: "Paris is the capital of France",
      citationIds: [],
      useCouncil: false,
      proofZ3Runner: z3Stub({ result: "unsat" }),
    });
    assert.equal(r.verdict, "unverified");
    assert.equal(r.proof, null);
  });
});
