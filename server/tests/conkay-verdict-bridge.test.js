/**
 * server/lib/conkay-verdict-bridge.js — pure derivation of the
 * `conkay:verdict` event payload (R5/E22, ConKay spatial mode / Godot Hub).
 *
 * This is the ONE decision point server.js's `/api/lens/run` handler
 * delegates to: given a completed macro call's (domain, action, result),
 * should a `conkay:verdict` event fire, and with what payload? Kept as a
 * pure function (no HTTP, no realtimeEmit) so the classification logic is
 * directly unit-testable without booting the server.
 *
 * Run: node --test tests/conkay-verdict-bridge.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveConkayVerdictEmit } from "../lib/conkay-verdict-bridge.js";

describe("deriveConkayVerdictEmit — reason.verify (direct CapabilityVerdict shape)", () => {
  it("derives the proven tier from a council-confirmed 'grounded' verdict", () => {
    const out = deriveConkayVerdictEmit("reason", "verify", {
      ok: true, verdict: "grounded", mode: "council", confidence: 0.82,
    });
    assert.deepEqual(out, { tier: "proven", verdict: "grounded", confidence: 0.82 });
  });

  it("derives the proven tier from a Z3 machine-checked 'proven' verdict", () => {
    const out = deriveConkayVerdictEmit("reason", "verify", {
      ok: true, verdict: "proven", mode: "proof", confidence: 1,
    });
    assert.equal(out.tier, "proven");
    assert.equal(out.verdict, "proven");
  });

  it("derives the flagged tier from a refuted verdict", () => {
    const out = deriveConkayVerdictEmit("reason", "verify", { ok: true, verdict: "refuted", confidence: 1 });
    assert.equal(out.tier, "flagged");
  });

  it("derives the reasoned tier from citations_resolve (no judge ran)", () => {
    const out = deriveConkayVerdictEmit("reason", "verify", { ok: true, verdict: "citations_resolve" });
    assert.equal(out.tier, "reasoned");
    assert.equal(out.confidence, null); // never fabricates a confidence figure it wasn't given
  });

  it("returns null (no emit) when the macro reported ok:false", () => {
    const out = deriveConkayVerdictEmit("reason", "verify", { ok: false, reason: "no_db" });
    assert.equal(out, null);
  });

  it("returns null (no emit) for a malformed/undefined result", () => {
    assert.equal(deriveConkayVerdictEmit("reason", "verify", null), null);
    assert.equal(deriveConkayVerdictEmit("reason", "verify", undefined), null);
  });
});

describe("deriveConkayVerdictEmit — reason.evaluate_answer (adapted via toCapabilityVerdict)", () => {
  it("adapts a 'grounded' evaluate_answer result to the proven tier", () => {
    const out = deriveConkayVerdictEmit("reason", "evaluate_answer", {
      ok: true, verdict: "grounded", mode: "llm-enhanced", faithfulness: 0.91,
      citation: { citationsTotal: 2, citationsResolved: 2, allResolved: true, confidence: 0.91, supported: true },
    });
    assert.equal(out.tier, "proven");
    assert.equal(out.verdict, "grounded");
    assert.equal(out.confidence, 0.91);
  });

  it("adapts a 'contradicted' evaluate_answer result to the flagged tier (via the refuted remap)", () => {
    const out = deriveConkayVerdictEmit("reason", "evaluate_answer", { ok: true, verdict: "contradicted" });
    assert.equal(out.tier, "flagged");
    assert.equal(out.verdict, "refuted");
  });

  it("adapts a 'partially_grounded' evaluate_answer result to the reasoned tier", () => {
    const out = deriveConkayVerdictEmit("reason", "evaluate_answer", { ok: true, verdict: "partially_grounded" });
    assert.equal(out.tier, "reasoned");
  });

  it("returns null when evaluate_answer itself failed", () => {
    assert.equal(deriveConkayVerdictEmit("reason", "evaluate_answer", { ok: false }), null);
  });
});

describe("deriveConkayVerdictEmit — scope gate (only the two known verdict macros)", () => {
  it("returns null for any other domain/action, even with a plausible-looking result", () => {
    assert.equal(deriveConkayVerdictEmit("math", "naturalQuery", { ok: true, verdict: "grounded" }), null);
    assert.equal(deriveConkayVerdictEmit("reason", "prove", { ok: true, verdict: "proven" }), null);
    assert.equal(deriveConkayVerdictEmit("reason", "council", { ok: true }), null);
  });

  it("never throws on missing/odd arguments", () => {
    assert.doesNotThrow(() => deriveConkayVerdictEmit(undefined, undefined, undefined));
    assert.doesNotThrow(() => deriveConkayVerdictEmit("reason", "verify", "not-an-object"));
  });
});
