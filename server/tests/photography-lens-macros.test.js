// Phase-2 behavioral macro tests for the photography lens PURE-COMPUTE
// calculators — the four macros the PhotographyActionPanel drives via
// lensRun('photography', …): exposureCalc / compositionAnalysis / gearRecommend
// / printSize, plus the pexels-search validation gates.
//
// COMPONENT-EXACT-SHAPE: the panel uses a local
//   callMacro(action, { artifact: { data: {…} } })
// wrapper, posting `input: { artifact: { data } }` to /api/lens/run. The live
// dispatch (server.js:39258) peels EXACTLY one redundant layer via
// peelRedundantArtifactWrapper when the body is the sole-key { artifact: { data
// } } shape, then invokes the LENS_ACTIONS handler as
//   handler(ctx, virtualArtifact, peeledInput)   // virtualArtifact.data === peeledInput
// This harness reproduces that EXACTLY: it drives the handler with the panel's
// literal { artifact: { data } } body run through the REAL peel, so a regression
// that breaks the double-wrap → dead-calculator path surfaces here (not a
// handler-ideal-shape test that passes while the component is dead in prod).
//
// Every test pins ACTUAL computed values (shutter speed, DoF, motion-blur,
// handheld; composition score + strength + suggestions; gear lens/lighting/
// accessory; print megapixels + max-print + quality) for the EXACT fields the
// component renders. Plus validation-rejection, degrade-graceful (no STATE — the
// pure calculators don't need it; pexels-search rejects pre-network), and a
// fail-CLOSED poisoned-numeric case (Infinity/NaN/1e999 can never reach a NaN/
// Infinity output).
//
// Hermetic: no server boot, no network, no LLM.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerPhotographyActions from "../domains/photography.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "photography", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Drive the EXACT production path: the component posts `input: body`; the
// dispatch peels the redundant artifact wrapper, then calls
// handler(ctx, { ...data: peeled }, peeled). We reproduce both arg positions.
function dispatch(name, ctx, body = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`photography.${name} not registered`);
  const peeled = peelRedundantArtifactWrapper(body || {});
  const virtualArtifact = { id: null, domain: "photography", type: "domain_action", data: peeled, meta: {} };
  return fn(ctx, virtualArtifact, peeled);
}

// The component's literal call shape: callMacro(action, { artifact: { data } }).
const wrap = (data) => ({ artifact: { data } });

before(() => { registerPhotographyActions(registerLensAction); });

const ctx = { actor: { userId: "user_a" }, userId: "user_a" };

// ── Registration ─────────────────────────────────────────────────
describe("photography — calculator registration", () => {
  it("registers every macro the PhotographyActionPanel + PexelsBrowser call", () => {
    for (const m of ["exposureCalc", "compositionAnalysis", "gearRecommend", "printSize", "pexels-search"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing photography.${m}`);
    }
  });
});

// ── exposureCalc ─────────────────────────────────────────────────
// Panel sends { artifact: { data: { iso, aperture, ev } } }; renders
// result.shutterSpeed (2xl headline), result.depthOfField, result.motionBlur,
// result.handheld, result.iso, result.aperture, result.ev.
describe("photography.exposureCalc — component-exact contract", () => {
  it("computes shutter speed + DoF/motion/handheld for the panel's exact input", () => {
    const r = dispatch("exposureCalc", ctx, wrap({ iso: 100, aperture: 5.6, ev: 12 }));
    assert.equal(r.ok, true);
    // EXACT rendered fields the panel reads off r.result:
    assert.equal(r.result.shutterSpeed, "1/4325s");     // 2xl headline
    assert.equal(r.result.depthOfField, "moderate");    // f/5.6 → moderate
    assert.equal(r.result.motionBlur, "frozen");        // fast shutter
    assert.equal(r.result.handheld, "ok");
    assert.equal(r.result.iso, 100);                    // echoed badge
    assert.equal(r.result.aperture, "f/5.6");           // already-prefixed; panel renders verbatim
    assert.equal(r.result.ev, 12);
  });

  it("shallow DoF + motion blur on a wide aperture, long-exposure scene", () => {
    const r = dispatch("exposureCalc", ctx, wrap({ iso: 100, aperture: 1.4, ev: 2 }));
    assert.equal(r.ok, true);
    assert.equal(r.result.depthOfField, "shallow");     // f/1.4 ≤ 2.8
    assert.equal(r.result.motionBlur, "likely");        // slow shutter
    assert.match(r.result.shutterSpeed, /^(\d+s|1\/\d+s)$/);
  });

  it("DEGRADE-GRACEFUL: empty data yields a finite default exposure (no NaN)", () => {
    const r = dispatch("exposureCalc", ctx, wrap({}));
    assert.equal(r.ok, true);
    assert.equal(r.result.iso, 100);                    // default
    assert.equal(r.result.aperture, "f/5.6");           // default
    assert.equal(r.result.ev, 12);
    assert.match(r.result.shutterSpeed, /^(\d+s|1\/\d+s)$/);
  });

  it("FAIL-CLOSED poisoned numeric: Infinity/NaN/1e999 collapse to finite defaults", () => {
    const r = dispatch("exposureCalc", ctx, wrap({ iso: "1e999", aperture: "Infinity", ev: "NaN" }));
    assert.equal(r.ok, true);
    // parseInt('1e999') → 1 (truthy), parseFloat('Infinity') → Infinity? guard via || fallback.
    // Whatever the parse, the readable shutter string must never be NaN/Infinity.
    assert.match(r.result.shutterSpeed, /^(\d+s|1\/\d+s)$/);
    assert.ok(!/NaN|Infinity/.test(r.result.shutterSpeed), "shutterSpeed must not leak NaN/Infinity");
    assert.ok(["shallow", "moderate", "deep"].includes(r.result.depthOfField));
  });
});

// ── compositionAnalysis ──────────────────────────────────────────
// Panel sends { artifact: { data: { compositionRules } } }; renders
// result.score (2xl), result.strength, result.rulesApplied.length,
// result.suggestions.
describe("photography.compositionAnalysis — component-exact contract", () => {
  it("scores applied rules and reports strength + suggestions", () => {
    const r = dispatch("compositionAnalysis", ctx, wrap({ compositionRules: ["rule-of-thirds", "leading-lines", "depth"] }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.rulesApplied, ["rule-of-thirds", "leading-lines", "depth"]);
    assert.equal(r.result.score, 38);                   // round(3/8*100)
    assert.equal(r.result.strength, "strong-composition"); // ≥3 applied
    assert.equal(r.result.suggestions.length, 3);       // top-3 unapplied
    assert.ok(Array.isArray(r.result.allRules));
  });

  it("basic-composition with one rule; no-rules-applied when empty", () => {
    const one = dispatch("compositionAnalysis", ctx, wrap({ compositionRules: ["symmetry"] }));
    assert.equal(one.result.strength, "basic-composition");
    assert.equal(one.result.score, 13);                 // round(1/8*100)
    const none = dispatch("compositionAnalysis", ctx, wrap({ compositionRules: [] }));
    assert.equal(none.result.strength, "no-rules-applied");
    assert.equal(none.result.score, 0);
  });

  it("VALIDATION: unknown + XSS rule strings are filtered out (no injection in score)", () => {
    const r = dispatch("compositionAnalysis", ctx, wrap({ compositionRules: ["bogus", "<script>alert(1)</script>", "framing"] }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.rulesApplied, ["framing"]); // only the real rule survives
    assert.equal(r.result.score, 13);
  });

  it("DEGRADE-GRACEFUL: missing compositionRules → empty applied, score 0", () => {
    const r = dispatch("compositionAnalysis", ctx, wrap({}));
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.rulesApplied, []);
    assert.equal(r.result.score, 0);
  });
});

// ── gearRecommend ────────────────────────────────────────────────
// Panel sends { artifact: { data: { genre, budget } } }; renders
// result.recommendation.lens / .lighting / .accessory, result.tip,
// result.genre, result.budget.
describe("photography.gearRecommend — component-exact contract", () => {
  it("returns a genre-matched recommendation triple + tip", () => {
    const r = dispatch("gearRecommend", ctx, wrap({ genre: "portrait", budget: "high" }));
    assert.equal(r.ok, true);
    assert.equal(r.result.recommendation.lens, "85mm f/1.8");
    assert.equal(r.result.recommendation.lighting, "Softbox or natural window light");
    assert.equal(r.result.recommendation.accessory, "Reflector");
    assert.equal(r.result.genre, "portrait");
    assert.equal(r.result.budget, "high");
    assert.match(r.result.tip, /bokeh/i);
  });

  it("landscape genre + its sharpness tip", () => {
    const r = dispatch("gearRecommend", ctx, wrap({ genre: "landscape", budget: "medium" }));
    assert.equal(r.result.recommendation.lens, "16-35mm f/4");
    assert.match(r.result.tip, /f\/8-f\/11/);
  });

  it("DEGRADE-GRACEFUL: unknown/empty genre falls back to the general kit", () => {
    const unknown = dispatch("gearRecommend", ctx, wrap({ genre: "<script>", budget: "low" }));
    assert.equal(unknown.ok, true);
    assert.equal(unknown.result.recommendation.lens, "24-70mm f/2.8"); // general fallback
    assert.equal(unknown.result.genre, "<script>".toLowerCase());
    const empty = dispatch("gearRecommend", ctx, wrap({}));
    assert.equal(empty.result.genre, "general");
    assert.equal(empty.result.recommendation.lens, "24-70mm f/2.8");
  });
});

// ── printSize ────────────────────────────────────────────────────
// Panel sends { artifact: { data: { widthPixels, heightPixels, dpi } } };
// renders result.megapixels (2xl), result.resolution, result.maxPrintAt300DPI,
// result.maxPrintAt150DPI, result.quality.
describe("photography.printSize — component-exact contract", () => {
  it("computes megapixels + max print dimensions + quality tier", () => {
    const r = dispatch("printSize", ctx, wrap({ widthPixels: 4000, heightPixels: 3000, dpi: 300 }));
    assert.equal(r.ok, true);
    assert.equal(r.result.megapixels, 12);
    assert.equal(r.result.resolution, "4000 x 3000");
    assert.equal(r.result.maxPrintAt300DPI, "13.3\" x 10\"");
    assert.equal(r.result.maxPrintAt150DPI, "26.7\" x 20\"");
    assert.equal(r.result.quality, "professional");     // ≥4000px
  });

  it("web-only quality on a small image", () => {
    const r = dispatch("printSize", ctx, wrap({ widthPixels: 800, heightPixels: 600, dpi: 72 }));
    assert.equal(r.result.quality, "web-only");
    assert.equal(r.result.megapixels, 0.5);
  });

  it("DEGRADE-GRACEFUL: empty data → finite default 12MP at 4000x3000", () => {
    const r = dispatch("printSize", ctx, wrap({}));
    assert.equal(r.ok, true);
    assert.equal(r.result.megapixels, 12);
    assert.equal(r.result.resolution, "4000 x 3000");
  });

  it("FAIL-CLOSED poisoned numeric: Infinity/NaN/1e999 → finite megapixels", () => {
    const r = dispatch("printSize", ctx, wrap({ widthPixels: "Infinity", heightPixels: "1e999", dpi: "NaN" }));
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.megapixels), "megapixels must be finite");
    assert.ok(!/NaN|Infinity/.test(r.result.maxPrintAt300DPI), "max print must not leak NaN/Infinity");
    assert.ok(["professional", "good", "web-only"].includes(r.result.quality));
  });
});

// ── pexels-search — pre-network validation gates only (no wire) ──
// PexelsBrowser sends FLAT input { query, perPage } (no artifact wrap → the
// handler reads params.query / params.perPage). We never reach the network: the
// validation rejects empty/whitespace queries first.
describe("photography.pexels-search — validation gates (no network)", () => {
  it("VALIDATION-REJECT: empty query is refused before any HTTP call", async () => {
    const prev = process.env.PEXELS_API_KEY;
    process.env.PEXELS_API_KEY = "test-key-so-we-pass-the-key-gate";
    try {
      const r = await dispatch("pexels-search", ctx, { query: "", perPage: 24 });
      assert.equal(r.ok, false);
      assert.equal(r.error, "query required");
      const ws = await dispatch("pexels-search", ctx, { query: "   ", perPage: 24 });
      assert.equal(ws.ok, false);
      assert.equal(ws.error, "query required");
    } finally {
      if (prev === undefined) delete process.env.PEXELS_API_KEY; else process.env.PEXELS_API_KEY = prev;
    }
  });

  it("VALIDATION-REJECT: missing PEXELS_API_KEY is refused with a clear error", async () => {
    const prev = process.env.PEXELS_API_KEY;
    delete process.env.PEXELS_API_KEY;
    try {
      const r = await dispatch("pexels-search", ctx, { query: "mountain", perPage: 24 });
      assert.equal(r.ok, false);
      assert.match(r.error, /PEXELS_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.PEXELS_API_KEY = prev;
    }
  });
});
