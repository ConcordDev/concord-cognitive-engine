// Behavioral macro tests for server/domains/art.js — the four pure-compute
// color/composition/style macros the /lenses/art workbench drives
// (PaletteWorkshop + ArtActionPanel), plus the museum external-IO macros
// (ArtExplorer) asserted to validate+reject WITHOUT a network call.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39285):
// handlers registered via `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention,
// with `virtualArtifact.data = input`. Our harness therefore calls
// `fn(ctx, virtualArtifact, input)`, so a regression that confuses param
// positions surfaces here.
//
// These are NOT shape-only assertions and they DO NOT duplicate the museum
// parity suites (art-museum-domain-parity covers met/aic). They:
//   • drive each compute macro with the EXACT input the live components send
//     (PaletteWorkshop: {palette}/{baseColor,harmony,count}; ArtActionPanel:
//     {palette}/{elements,canvas}/{baseColor,harmony,count}/{attributes}),
//   • assert the EXACT fields the components render, with real computed values,
//   • assert validation-rejection on missing input,
//   • assert graceful degradation (empty palette/elements → ok:true message),
//   • assert a fail-CLOSED poisoned-numeric / malformed-hex contract: a
//     non-#RRGGBB hex or an Infinity/NaN/1e308 coordinate/axis is REJECTED
//     rather than leaking NaN/Infinity into the result under ok:true.
//   • External-IO museum macros validate+reject bad input WITHOUT fetching.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerArtActions from "../domains/art.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "art", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch exactly: handler(ctx, virtualArtifact, input) with
// virtualArtifact.data = input (server.js:39287).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`art.${name} not registered`);
  const virtualArtifact = { id: null, title: null, domain: "art", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerArtActions(registerLensAction); });

let fetchCalls = 0;
beforeEach(() => {
  // No boot, no network, no LLM. Any handler that reaches for the network in a
  // pure-compute test marks itself as a leak via fetchCalls.
  fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error("network disabled in tests"); };
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("art — registration (every lens-driven compute + museum macro present)", () => {
  it("registers the macros the art workbench + explorer call", () => {
    for (const m of [
      "colorHarmony", "compositionScore", "generatePalette", "styleClassify",
      "met-search", "met-object", "aic-search",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing art.${m}`);
    }
  });
});

// ── colorHarmony — the PaletteWorkshop + ArtActionPanel "Harmony" input shape.
describe("art.colorHarmony — real hue/temperature/score for a known palette", () => {
  it("detects complementary + analogous relations and renders fields", () => {
    // Red/cyan are ~180° apart (complementary); two near-reds are analogous.
    const r = call("colorHarmony", ctxA, { palette: ["#ff0000", "#00ffff", "#ff1a00"] });
    assert.equal(r.ok, true);
    const res = r.result;
    // Every field the components render is present + real.
    assert.equal(res.paletteSize, 3);
    assert.ok(Number.isFinite(res.harmonyScore) && res.harmonyScore >= 0 && res.harmonyScore <= 100);
    assert.ok(["warm", "cool", "balanced"].includes(res.temperature));
    assert.ok(Array.isArray(res.harmonies));
    assert.ok(res.harmonies.some(h => h.type === "complementary"), "expected a complementary pair");
    assert.ok(res.harmonies.some(h => h.type === "analogous"), "expected an analogous pair");
    assert.ok(Number.isFinite(res.dominantHue) && res.dominantHue >= 0 && res.dominantHue <= 360);
    // Each harmony entry carries the colors[] the panel paints.
    for (const h of res.harmonies) {
      assert.equal(h.colors.length, 2);
      assert.ok(h.colors.every(c => /^#[0-9a-f]{6}$/i.test(c)));
    }
  });

  it("accepts the {hex} object form too (same path PaletteWorkshop maps to hexes)", () => {
    const r = call("colorHarmony", ctxA, { palette: [{ hex: "#3498db" }, { hex: "#db7734" }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.paletteSize, 2);
  });

  it("degrade-graceful: empty palette → ok:true with an honest message, no NaN", () => {
    const r = call("colorHarmony", ctxA, { palette: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No palette provided.");
  });

  it("fail-CLOSED: a malformed hex is REJECTED, never leaks NaN harmonyScore", () => {
    const r = call("colorHarmony", ctxA, { palette: ["#zzzzzz", "#00ff00"] });
    assert.equal(r.ok, false);
    assert.match(r.error, /hex/i);
  });

  it("fail-CLOSED: a poisoned non-string entry is rejected", () => {
    const r = call("colorHarmony", ctxA, { palette: ["#ff0000", 1e308] });
    assert.equal(r.ok, false);
  });

  it("never touches the network", () => { assert.equal(fetchCalls, 0); });
});

// ── compositionScore — ArtActionPanel "Composition" input shape.
describe("art.compositionScore — real geometry scoring for placed elements", () => {
  it("computes overall + per-axis scores + rating from element positions", () => {
    const r = call("compositionScore", ctxA, {
      elements: [
        { x: 640, y: 360, width: 200, height: 200, weight: 2 },
        { x: 1280, y: 720, width: 150, height: 150 },
      ],
      canvas: { width: 1920, height: 1080 },
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.ok(Number.isFinite(res.overall) && res.overall >= 0 && res.overall <= 100);
    assert.ok(["excellent", "good", "fair", "needs_work"].includes(res.rating));
    // Every score the panel renders is finite + bounded.
    for (const k of ["ruleOfThirds", "goldenRatio", "balance", "whitespace", "visualFlow"]) {
      assert.ok(Number.isFinite(res.scores[k]) && res.scores[k] >= 0 && res.scores[k] <= 100, `${k} = ${res.scores[k]}`);
    }
    assert.equal(res.elementCount, 2);
    // overall is the documented weighted blend of the axes.
    const expected = Math.round(
      res.scores.ruleOfThirds * 0.25 + res.scores.goldenRatio * 0.15 +
      res.scores.balance * 0.25 + res.scores.whitespace * 0.15 + res.scores.visualFlow * 0.2);
    assert.equal(res.overall, expected);
  });

  it("degrade-graceful: empty elements → ok:true with an honest message", () => {
    const r = call("compositionScore", ctxA, { elements: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No elements to analyze.");
  });

  it("fail-CLOSED: an Infinity coordinate is REJECTED, never leaks NaN scores", () => {
    const r = call("compositionScore", ctxA, {
      elements: [{ x: Infinity, y: 0, width: 10, height: 10 }],
      canvas: { width: 1920, height: 1080 },
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /finite/i);
  });

  it("fail-CLOSED: an overflow-to-Infinity width and a non-finite canvas are rejected", () => {
    // "1e999" overflows the double to Infinity → must be rejected (NaN/Infinity poison).
    assert.equal(call("compositionScore", ctxA, { elements: [{ x: 1, y: 1, width: "1e999", height: 10 }], canvas: { width: 1920, height: 1080 } }).ok, false);
    assert.equal(call("compositionScore", ctxA, { elements: [{ x: 1, y: 1, width: 10, height: 10 }], canvas: { width: "NaN", height: 1080 } }).ok, false);
  });
});

// ── generatePalette — PaletteWorkshop + ArtActionPanel "Palette" input shape.
describe("art.generatePalette — deterministic harmony palettes from a seed", () => {
  it("returns N swatches with hex + role for a complementary seed", () => {
    const r = call("generatePalette", ctxA, { baseColor: "#3498db", harmony: "complementary", count: 5 });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.harmony, "complementary");
    assert.equal(res.baseColor, "#3498db");
    assert.equal(res.palette.length, 5);
    // First entry is the base; complement is 180° opposite.
    assert.equal(res.palette[0].role, "base");
    assert.equal(res.palette[1].role, "complement");
    for (const c of res.palette) {
      assert.ok(/^#[0-9a-f]{6}$/i.test(c.hex), `bad hex ${c.hex}`);
      assert.equal(typeof c.role, "string");
    }
  });

  it("defaults harmony to analogous and clamps count low-bound", () => {
    const r = call("generatePalette", ctxA, { baseColor: "#ff0000" });
    assert.equal(r.ok, true);
    assert.equal(r.result.harmony, "analogous");
    assert.equal(r.result.palette.length, 5); // default count
  });

  it("fail-CLOSED: a malformed baseColor is REJECTED, never emits #NaN swatches", () => {
    const r = call("generatePalette", ctxA, { baseColor: "not-a-color", count: 4 });
    assert.equal(r.ok, false);
    assert.match(r.error, /hex/i);
  });

  it("fail-CLOSED: a poisoned Infinity count is clamped, never unbounded/NaN", () => {
    const r = call("generatePalette", ctxA, { baseColor: "#3498db", harmony: "analogous", count: Infinity });
    assert.equal(r.ok, true);
    // clamped into the [2,24] envelope — finite count, no #NaN swatches.
    assert.ok(r.result.palette.length >= 2 && r.result.palette.length <= 24);
    assert.ok(r.result.palette.every(c => /^#[0-9a-f]{6}$/i.test(c.hex)));
  });
});

// ── styleClassify — ArtActionPanel "Style" input shape.
describe("art.styleClassify — nearest-style match from 8 axes", () => {
  it("matches an Impressionism-shaped profile to Impressionism, top-ranked", () => {
    // Exactly the Impressionism reference profile → similarity 100, top match.
    const r = call("styleClassify", ctxA, {
      attributes: { brushwork: 80, colorSaturation: 70, contrast: 40, perspective: 40, detail: 30, abstraction: 40, lineWeight: 20, texture: 70 },
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.topMatch.style, "Impressionism");
    assert.equal(res.topMatch.similarity, 100);
    assert.equal(res.confidence, "high");
    // allMatches is the full ranked list (10 styles), descending.
    assert.equal(res.allMatches.length, 10);
    for (let i = 1; i < res.allMatches.length; i++) {
      assert.ok(res.allMatches[i - 1].similarity >= res.allMatches[i].similarity, "not descending");
    }
  });

  it("defaults all absent axes to 50 (still classifies, ok:true)", () => {
    const r = call("styleClassify", ctxA, { attributes: {} });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.topMatch.style, "string");
    assert.ok(Number.isFinite(r.result.topMatch.similarity));
  });

  it("fail-CLOSED: a poisoned Infinity/NaN axis is clamped, never leaks non-finite similarity", () => {
    const r = call("styleClassify", ctxA, {
      attributes: { brushwork: Infinity, colorSaturation: NaN, contrast: 1e308 },
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.topMatch.similarity), "similarity must stay finite");
    assert.ok(r.result.allMatches.every(m => Number.isFinite(m.similarity)));
  });
});

// ── Museum external-IO — ArtExplorer drives these; assert validate+reject
//    WITHOUT a network call (the live endpoints are never touched in tests).
describe("art museum external-IO — validate+reject without fetching", () => {
  it("met-search rejects an empty query and never fetches", async () => {
    const r = await call("met-search", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /query required/);
    assert.equal(fetchCalls, 0);
  });

  it("met-object rejects a non-positive / non-finite objectId and never fetches", async () => {
    assert.equal((await call("met-object", ctxA, {})).ok, false);
    assert.equal((await call("met-object", ctxA, { objectId: -1 })).ok, false);
    assert.equal((await call("met-object", ctxA, { objectId: "NaN" })).ok, false);
    assert.equal(fetchCalls, 0);
  });

  it("aic-search rejects an empty query and never fetches", async () => {
    const r = await call("aic-search", ctxA, { query: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /query required/);
    assert.equal(fetchCalls, 0);
  });
});
