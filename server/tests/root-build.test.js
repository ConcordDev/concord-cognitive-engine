// Root build tests — the F-E row 13 build's server claims, exercised
// through the REAL domain actions (legacy 3-arg registry harness, the
// parity suite's shape):
//   S-ROOT-1: the keyboard's value folds its tokens (chips ≡ value);
//             the evaluator names the other reading of an ambiguous run;
//             the lib enumerates every reading of a written string.
//   S-ROOT-3: the export provider surfaces the caller's computations.
//   S-ROOT-5: renameComputation relabels the caller's own entries only.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerRootActions from "../domains/root.js";
import { collectLensExport, _clearLensExportProvidersForTests } from "../lib/lens-export.js";
import { glyphStringReadings, decimalToRefusalGlyphs } from "../lib/refusal-algebra/conversion.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`root.${name}`);
  if (!fn) throw new Error(`root.${name} not registered`);
  const virtualArtifact = { id: null, domain: "root", type: "domain_action", data: params, meta: {} };
  return fn(ctx, virtualArtifact, params);
}

before(() => { registerRootActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("S-ROOT-1 — ambiguity resolved explicitly", () => {
  it("the keyboard's value folds its tokens: Pivot Refusal Bridge is 38, not 11", () => {
    const r = call("glyphLookup", ctxA, { terms: "Pivot Refusal Bridge" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.tokens.map((t) => t.digit), [1, 0, 2]);
    assert.equal(r.result.glyphString, "⟲⟐⊚");
    assert.equal(r.result.decimal, 38);
  });

  it("the lib enumerates both readings of the written form of 38", () => {
    const readings = glyphStringReadings(decimalToRefusalGlyphs(38));
    assert.deepEqual(readings.map((r) => r.decimal), [11, 38]);
    assert.equal(readings[1].label, "Pivot · Refusal · Bridge");
  });

  it("an unambiguous string has exactly one reading", () => {
    assert.deepEqual(glyphStringReadings("⟲⟐").map((r) => r.decimal), [6]);
  });

  it("the evaluator names the other reading of an ambiguous glyph run", () => {
    const r = call("evaluate", ctxA, { expression: "⟲⟐⊚ + 1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decimal, 12); // greedy rule: 11 + 1, stated not silent
    assert.equal(r.result.warnings.length, 1);
    assert.match(r.result.warnings[0], /read as 11 by compounds/);
    assert.match(r.result.warnings[0], /digit by digit it is 38/);
  });

  it("an unambiguous expression carries no warning", () => {
    const r = call("evaluate", ctxA, { expression: "⟲⟐ + 1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decimal, 7);
    assert.deepEqual(r.result.warnings, []);
  });

  it("the tutorial teaches the ambiguity with a code-derived 38 example", () => {
    const r = call("tutorial", ctxA);
    assert.equal(r.ok, true);
    const conv = r.result.lessons.find((l) => l.id === "conversion");
    assert.match(conv.body, /never picks one in secret/);
    const ex38 = conv.examples.find((e) => e.input === "38");
    assert.ok(ex38);
    assert.equal(ex38.glyph, "⟲⟐⊚");
    assert.match(ex38.reading, /Read as compounds the same string is 11/);
  });
});

describe("S-ROOT-5 — rename", () => {
  it("relabels the caller's own entry and history shows it", () => {
    const s = call("save", ctxA, { kind: "operation", a: 4, b: 7, op: "+" });
    const id = s.result.computation.id;
    const r = call("renameComputation", ctxA, { id, label: "warm-up sum" });
    assert.equal(r.ok, true);
    assert.equal(r.result.computation.label, "warm-up sum");
    const h = call("history", ctxA);
    assert.equal(h.result.computations[0].label, "warm-up sum");
    assert.ok(h.result.computations[0].createdAt, "entries carry their date");
  });

  it("cannot rename another user's entry", () => {
    const s = call("save", ctxA, { kind: "operation", a: 1, b: 2, op: "+" });
    const r = call("renameComputation", ctxB, { id: s.result.computation.id, label: "hijack" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("refuses an empty label", () => {
    const s = call("save", ctxA, { kind: "operation", a: 1, b: 2, op: "+" });
    const r = call("renameComputation", ctxA, { id: s.result.computation.id, label: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /label is required/);
  });
});

describe("S-ROOT-3 — export provider", () => {
  it("surfaces the caller's computations, and only the caller's", async () => {
    _clearLensExportProvidersForTests();
    registerRootActions(register); // re-register the provider after the clear
    call("save", ctxA, { kind: "operation", a: 5, b: 6, op: "×", resultGlyph: "⟐⊚⟐", resultDecimal: 30 });
    call("save", ctxB, { kind: "operation", a: 1, b: 1, op: "+", resultGlyph: "⊚", resultDecimal: 2 });
    const out = await collectLensExport({
      runMacro: async () => ({ ok: true, artifacts: [] }),
      domain: "root",
      ctx: ctxA,
      limit: 50,
    });
    assert.equal(out.ok, true);
    const titles = out.artifacts.map((a) => a.title);
    assert.ok(titles.includes("5 × 6"), `expected A's computation in ${JSON.stringify(titles)}`);
    assert.ok(!titles.includes("1 + 1"), "B's computation must not surface for A");
  });
});
