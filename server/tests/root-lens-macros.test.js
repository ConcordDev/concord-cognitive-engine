// Phase-2 behavioral macro tests for server/domains/root.js — the base-6
// "Refusal Algebra" glyph calculator the /lenses/root surface drives.
//
// LIGHTWEIGHT + hermetic: no server boot, no network, no LLM. Registers the
// domain through the SAME canonical register(domain, name, (ctx, input) => …)
// shim runMacro dispatches with, then drives every macro the lens actually
// calls — evaluate / bitwise / glyphLookup / tutorial / save / history /
// reload / deleteComputation / share / getShare — asserting ACTUAL computed
// values + multi-step round-trips (save → history reflects it → reload by id →
// delete; share → getShare resolves the immutable snapshot), per-user
// isolation, and the fail-CLOSED numeric guard the macro-assassin V2 probes.
//
// This is the test that proves the wiring fix: root.js was a SAVED-CLASS dead
// module (legacy registerLensAction convention + never imported into server.js
// → every root.* call hit unknown_macro). The shim adapts the verified handler
// bodies onto the canonical 2-arg convention so they are reachable.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerRootActions from "../domains/root.js";

// root.js uses the legacy 3-arg registerLensAction(domain, action, (ctx,
// artifact, params)) convention and is loaded by server/domains/index.js. Mirror
// the REAL LENS_ACTIONS dispatch (server.js:39150 — `handler(ctx, virtualArtifact,
// input)`): the registrar stores the raw handler; call() invokes it with a
// virtual artifact and the input as the 3rd `params` arg.
const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "root", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`root.${name} not registered`);
  const virtualArtifact = { id: null, domain: "root", type: "domain_action", data: input, meta: {} };
  return fn(ctx, virtualArtifact, input);
}

before(() => { registerRootActions(register); });

// Fresh per-user STATE for every test (the domain keys persistence by userId
// inside globalThis._concordSTATE.rootLens).
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// ── Wiring: every macro the lens drives is registered through the shim ──────
describe("root — registration (canonical convention)", () => {
  it("registers every macro the lens calls, dispatchable as (ctx, input)", () => {
    for (const m of [
      "evaluate", "bitwise", "glyphLookup", "tutorial",
      "save", "history", "reload", "deleteComputation", "share", "getShare",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing root.${m}`);
    }
  });

  it("dispatches params through the 2-arg shim (not the artifact slot)", () => {
    // The shim must forward `input` as the params object so a (ctx, input)
    // call reaches the handler's params — proving the SAVED-CLASS adapter
    // works. A regression here means root.* silently no-ops on real calls.
    const r = call("evaluate", ctxA, { expression: "1 + 1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decimal, 2);
  });
});

// ── evaluate — multi-term expression with real precedence + glyph mixing ────
describe("root — evaluate", () => {
  it("computes operator precedence (2 + 3 * 4 = 14)", () => {
    const r = call("evaluate", ctxA, { expression: "2 + 3 * 4" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decimal, 14);
    assert.ok(r.result.steps.length >= 2);
    // 14 in base-6 is "22" → ⊚⊚
    assert.equal(r.result.glyph, "⊚⊚");
  });

  it("honours parentheses ((2 + 3) * 4 = 20)", () => {
    const r = call("evaluate", ctxA, { expression: "(2 + 3) * 4" });
    assert.equal(r.result.decimal, 20);
  });

  it("mixes glyph operands with decimals (⟲⟐ + 1 = 7)", () => {
    // ⟲⟐ = base-6 "10" = decimal 6
    const r = call("evaluate", ctxA, { expression: "⟲⟐ + 1" });
    assert.equal(r.result.decimal, 7);
  });

  it("fails CLOSED on an empty expression", () => {
    const r = call("evaluate", ctxA, { expression: "" });
    assert.equal(r.ok, false);
    assert.match(r.error, /required/);
  });

  it("reports unbalanced parentheses without throwing", () => {
    const r = call("evaluate", ctxA, { expression: "(2 + 3" });
    assert.equal(r.ok, false);
    assert.match(r.error, /parenthes/i);
  });
});

// ── bitwise / modular ──────────────────────────────────────────────────────
describe("root — bitwise / modular", () => {
  it("computes AND (12 & 10 = 8) with base-6 rendering", () => {
    const r = call("bitwise", ctxA, { a: 12, b: 10, op: "and" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decimal, 8);
    assert.equal(r.result.base6, "12"); // 8 in base-6
  });

  it("computes modulo (17 % 6 = 5)", () => {
    const r = call("bitwise", ctxA, { a: 17, b: 6, op: "mod" });
    assert.equal(r.result.decimal, 5);
    assert.equal(r.result.base6, "5");
  });

  it("rejects modulo by Refusal (zero) as undefined", () => {
    const r = call("bitwise", ctxA, { a: 5, b: 0, op: "mod" });
    assert.equal(r.ok, false);
    assert.match(r.error, /undefined/);
  });

  it("rejects an unknown operator", () => {
    const r = call("bitwise", ctxA, { a: 1, b: 1, op: "nand" });
    assert.equal(r.ok, false);
    assert.match(r.error, /op must be/);
  });

  it("accepts glyph-string operands", () => {
    // ⟲⟐ = 6, ⟲ = 1 → 6 | 1 = 7
    const r = call("bitwise", ctxA, { a: "⟲⟐", b: "⟲", op: "or" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decimal, 7);
  });
});

// ── glyphLookup — semantic-name keyboard ────────────────────────────────────
describe("root — glyphLookup", () => {
  it("translates semantic names to a glyph string + decimal", () => {
    const r = call("glyphLookup", ctxA, { terms: "Pivot Refusal" });
    assert.equal(r.ok, true);
    assert.equal(r.result.tokens.length, 2);
    assert.equal(r.result.tokens[0].name, "Pivot");
    assert.equal(r.result.glyphString, "⟲⟐");
    assert.equal(r.result.decimal, 6); // ⟲⟐ = base-6 "10"
  });

  it("accepts base-6 digit numbers", () => {
    const r = call("glyphLookup", ctxA, { terms: "1, 0" });
    assert.equal(r.result.decimal, 6);
  });

  it("rejects an unknown term", () => {
    const r = call("glyphLookup", ctxA, { terms: "Banana" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not a glyph/);
  });

  it("requires a non-empty terms field", () => {
    assert.equal(call("glyphLookup", ctxA, {}).ok, false);
  });
});

// ── tutorial — deterministic code-derived examples ──────────────────────────
describe("root — tutorial", () => {
  it("returns >=5 lessons computed from the real primitives", () => {
    const r = call("tutorial", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.lessonCount >= 5);
    const conv = r.result.lessons.find((l) => l.id === "conversion");
    assert.ok(conv && conv.examples.length > 0);
    // The conversion lesson's worked example for 27 must equal the live result.
    const ex27 = conv.examples.find((e) => e.decimal === 27);
    assert.ok(ex27, "27 example present");
    // 27 = base-6 "43" → digit 4 (⊚⟲) then digit 3 (⟐⟲) → ⊚⟲⟐⟲
    assert.equal(ex27.glyph, "⊚⟲⟐⟲");
  });
});

// ── save → history → reload → delete notebook round-trip ────────────────────
describe("root — notebook round-trip", () => {
  it("saves an operation, lists it in history, reloads by id, then deletes it", () => {
    const s = call("save", ctxA, {
      kind: "operation", a: 4, b: 7, op: "+",
      resultGlyph: "⟲⟲", resultDecimal: 11,
    });
    assert.equal(s.ok, true);
    assert.equal(s.result.total, 1);
    const id = s.result.computation.id;
    assert.equal(s.result.computation.resultDecimal, 11);

    const h = call("history", ctxA);
    assert.equal(h.ok, true);
    assert.equal(h.result.total, 1);
    assert.equal(h.result.computations[0].a, 4);
    assert.equal(h.result.computations[0].op, "+");

    const rl = call("reload", ctxA, { id });
    assert.equal(rl.ok, true);
    assert.equal(rl.result.computation.b, 7);

    const del = call("deleteComputation", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(del.result.total, 0);
    assert.equal(call("history", ctxA).result.total, 0);
  });

  it("saves a free-form expression and reloads it", () => {
    const s = call("save", ctxA, { kind: "expression", expression: "2 + 2" });
    assert.equal(s.ok, true);
    const rl = call("reload", ctxA, { id: s.result.computation.id });
    assert.equal(rl.result.computation.expression, "2 + 2");
  });

  it("rejects a save with a bad op for its kind", () => {
    const r = call("save", ctxA, { kind: "operation", a: 1, b: 2, op: "nope" });
    assert.equal(r.ok, false);
    assert.match(r.error, /op must be one of/);
  });

  it("errors reloading/deleting an unknown id", () => {
    assert.match(call("reload", ctxA, { id: "rc_missing" }).error, /not found/);
    assert.match(call("deleteComputation", ctxA, { id: "rc_missing" }).error, /not found/);
  });

  it("INVARIANT: notebook is scoped per-user", () => {
    call("save", ctxA, { kind: "operation", a: 1, b: 2, op: "+" });
    assert.equal(call("history", ctxB).result.total, 0);
    assert.equal(call("history", ctxA).result.total, 1);
  });

  it("fails CLOSED on a poisoned history limit (assassin V2)", () => {
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      const r = call("history", ctxA, { limit: bad });
      assert.equal(r.ok, false, `limit=${bad} should fail-closed`);
      assert.equal(r.error, "invalid_limit");
    }
  });

  it("still honours a valid history limit", () => {
    for (let i = 0; i < 5; i++) call("save", ctxA, { kind: "operation", a: i, b: 1, op: "+" });
    const r = call("history", ctxA, { limit: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.computations.length, 2);
    assert.equal(r.result.total, 5);
  });
});

// ── share → getShare immutable snapshot ─────────────────────────────────────
describe("root — share round-trip", () => {
  it("shares a computation and resolves the snapshot from another user", () => {
    const sh = call("share", ctxA, {
      kind: "operation", a: 5, b: 6, op: "×",
      resultGlyph: "⟲⟐⟐", resultDecimal: 30,
    });
    assert.equal(sh.ok, true);
    assert.match(sh.result.link, /\/lenses\/root\?share=share_/);

    // Public read: another user resolves the same immutable snapshot.
    const got = call("getShare", ctxB, { shareId: sh.result.shareId });
    assert.equal(got.ok, true);
    assert.equal(got.result.snapshot.resultDecimal, 30);
    assert.equal(got.result.snapshot.sharedBy, "user_a");
  });

  it("rejects an unknown shareId", () => {
    const r = call("getShare", ctxA, { shareId: "share_missing" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("requires an operand for an operation share", () => {
    const r = call("share", ctxA, { kind: "operation", op: "+" });
    assert.equal(r.ok, false);
    assert.match(r.error, /operand a is required/);
  });
});
