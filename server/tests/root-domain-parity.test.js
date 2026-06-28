// Tier-2 contract tests for the root lens (base-6 Refusal Algebra calculator)
// parity macros: evaluate / bitwise / glyphLookup / tutorial / save / history /
// reload / deleteComputation / share / getShare.
// Pins the expression evaluator precedence, bitwise/modular math, semantic
// name parsing, notebook persistence + history re-load, and shareable links.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerRootActions from "../domains/root.js";

const ACTIONS = new Map();
// root.js uses the legacy 3-arg registerLensAction(domain, action, (ctx,
// artifact, params)) convention (loaded via server/domains/index.js). Mirror the
// REAL LENS_ACTIONS dispatch (server.js:39150 — `handler(ctx, virtualArtifact,
// input)`): store the raw handler, invoke with a virtual artifact + the input as
// the 3rd `params` arg.
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`root.${name}`);
  if (!fn) throw new Error(`root.${name} not registered`);
  const virtualArtifact = { id: null, domain: "root", type: "domain_action", data: params, meta: {} };
  return fn(ctx, virtualArtifact, params);
}

before(() => {
  registerRootActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("root — expression evaluator", () => {
  it("evaluates a multi-term expression with operator precedence", () => {
    const r = call("evaluate", ctxA, { expression: "2 + 3 * 4" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decimal, 14);
    assert.ok(r.result.steps.length >= 2);
    assert.ok(r.result.glyph.length > 0);
  });

  it("honours parentheses over precedence", () => {
    const r = call("evaluate", ctxA, { expression: "(2 + 3) * 4" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decimal, 20);
  });

  it("accepts glyph operands mixed with decimals", () => {
    // ⟲⟐ = base-6 "10" = decimal 6
    const r = call("evaluate", ctxA, { expression: "⟲⟐ + 1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decimal, 7);
  });

  it("rejects an empty expression", () => {
    const r = call("evaluate", ctxA, { expression: "" });
    assert.equal(r.ok, false);
    assert.match(r.error, /required/);
  });

  it("reports unbalanced parentheses", () => {
    const r = call("evaluate", ctxA, { expression: "(2 + 3" });
    assert.equal(r.ok, false);
    assert.match(r.error, /parenthes/i);
  });
});

describe("root — bitwise / modular operations", () => {
  it("computes a bitwise AND", () => {
    const r = call("bitwise", ctxA, { a: 12, b: 10, op: "and" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decimal, 8);
    assert.equal(r.result.op, "and");
  });

  it("computes modulo and renders a base-6 string", () => {
    const r = call("bitwise", ctxA, { a: 17, b: 6, op: "mod" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decimal, 5);
    assert.equal(r.result.base6, "5");
  });

  it("rejects modulo by Refusal (zero)", () => {
    const r = call("bitwise", ctxA, { a: 5, b: 0, op: "mod" });
    assert.equal(r.ok, false);
    assert.match(r.error, /undefined/);
  });

  it("rejects an unknown operator", () => {
    const r = call("bitwise", ctxA, { a: 1, b: 1, op: "nand" });
    assert.equal(r.ok, false);
    assert.match(r.error, /op must be/);
  });
});

describe("root — glyph keyboard lookup", () => {
  it("translates semantic names to a glyph string", () => {
    const r = call("glyphLookup", ctxA, { terms: "Pivot Refusal" });
    assert.equal(r.ok, true);
    assert.equal(r.result.tokens.length, 2);
    assert.equal(r.result.tokens[0].name, "Pivot");
    // ⟲⟐ = decimal 6
    assert.equal(r.result.decimal, 6);
  });

  it("accepts base-6 digit numbers", () => {
    const r = call("glyphLookup", ctxA, { terms: "1, 0" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decimal, 6);
  });

  it("rejects an unknown term", () => {
    const r = call("glyphLookup", ctxA, { terms: "Banana" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not a glyph/);
  });
});

describe("root — tutorial", () => {
  it("returns code-derived worked examples", () => {
    const r = call("tutorial", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.lessonCount >= 5);
    const conv = r.result.lessons.find((l) => l.id === "conversion");
    assert.ok(conv);
    assert.ok(conv.examples.length > 0);
  });
});

describe("root — saved notebook + history re-load", () => {
  it("saves an operation and lists it in history", () => {
    const s = call("save", ctxA, { kind: "operation", a: 4, b: 7, op: "+" });
    assert.equal(s.ok, true);
    assert.equal(s.result.total, 1);
    const h = call("history", ctxA);
    assert.equal(h.ok, true);
    assert.equal(h.result.total, 1);
    assert.equal(h.result.computations[0].a, 4);
  });

  it("INVARIANT: notebook is scoped per-user", () => {
    call("save", ctxA, { kind: "operation", a: 1, b: 2, op: "+" });
    const b = call("history", ctxB);
    assert.equal(b.result.total, 0);
  });

  it("reloads a saved computation by id", () => {
    const s = call("save", ctxA, { kind: "expression", expression: "2 + 2" });
    const r = call("reload", ctxA, { id: s.result.computation.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.computation.expression, "2 + 2");
  });

  it("returns an error reloading an unknown id", () => {
    const r = call("reload", ctxA, { id: "rc_missing" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("deletes a saved computation", () => {
    const s = call("save", ctxA, { kind: "operation", a: 9, b: 3, op: "−" });
    const d = call("deleteComputation", ctxA, { id: s.result.computation.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.total, 0);
  });
});

describe("root — shareable computation link", () => {
  it("shares a computation and resolves the snapshot", () => {
    const sh = call("share", ctxA, {
      kind: "operation", a: 5, b: 6, op: "×",
      resultGlyph: "⟲⟐⟐", resultDecimal: 30,
    });
    assert.equal(sh.ok, true);
    assert.match(sh.result.link, /share=share_/);
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
});
