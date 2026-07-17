// server/tests/creatures-portrait.test.js
//
// Honest procedural creature imagery — server/lib/creature-portrait.js and
// the creatures.portrait macro in server/domains/creatures.js.
//
// Concord's creature system is body-plan-based (topology + mass + height +
// a real tree of parts from server/lib/procedural-creature.js#generateCreature,
// already physics-validated). This suite proves the rendered SVG is a
// genuine FUNCTION of that real data, not fixed chrome around a fabricated
// image:
//   1. determinism — same blueprint in -> byte-identical SVG out.
//   2. part-count varies -> rendered ellipse count varies (and matches
//      parts.length exactly), using REAL generateCreature() output for two
//      very differently-shaped species (an amorphous 1-part slime vs a
//      9-part polyped spider).
//   3. mass/height varies -> rendered scale (viewBox) varies, using REAL
//      generateCreature() output across size bands (tiny vs colossal).
//   4. coatColor varies -> rendered fill hex varies.
//   5. the creatures.portrait macro wires this to a species id end-to-end,
//      deterministically, and fails honestly on a missing id.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateCreature } from "../lib/procedural-creature.js";
import { buildCreaturePortraitSvg, summarizePartCounts } from "../lib/creature-portrait.js";
import registerCreatureMacros, { coatFor } from "../domains/creatures.js";

function collectMacros() {
  const map = new Map();
  registerCreatureMacros((domain, name, handler) => {
    assert.equal(domain, "creatures");
    map.set(name, handler);
  });
  return map;
}

function countEllipses(svg) {
  return (svg.match(/<ellipse\b/g) || []).length;
}

function viewBoxOf(svg) {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  assert.ok(m, "svg must declare a viewBox");
  return { w: Number(m[1]), h: Number(m[2]) };
}

// Only the <ellipse> fills (the real per-part tint) — excludes the fixed
// dark canvas <rect> background, which is intentionally identical across
// every render and would otherwise falsely look like a "shared fill".
function fillsOf(svg) {
  return [...svg.matchAll(/<ellipse[^>]*\bfill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);
}

describe("creature-portrait: buildCreaturePortraitSvg (pure function)", () => {
  const sampleParts = [
    { name: "torso", kind: "torso", massKg: 40, dimensions: { x: 0.4, y: 0.3, z: 0.9 }, parent: "", attach: { x: 0, y: 0, z: 0 } },
    { name: "head", kind: "head", massKg: 5, dimensions: { x: 0.2, y: 0.2, z: 0.2 }, parent: "torso", attach: { x: 0, y: 0.2, z: 0.6 } },
    { name: "legFL", kind: "leg", massKg: 5, dimensions: { x: 0.08, y: 0.5, z: 0.08 }, parent: "torso", attach: { x: -0.3, y: -0.3, z: 0.4 } },
    { name: "legFR", kind: "leg", massKg: 5, dimensions: { x: 0.08, y: 0.5, z: 0.08 }, parent: "torso", attach: { x: 0.3, y: -0.3, z: 0.4 } },
  ];

  it("is deterministic: same blueprint -> byte-identical SVG", () => {
    const bp = { topology: "quadruped", massKg: 55, heightM: 1.2, coatColor: "#5a4632", parts: sampleParts, variant: null };
    const a = buildCreaturePortraitSvg(bp);
    const b = buildCreaturePortraitSvg(bp);
    assert.equal(a, b);
    // and a freshly-constructed equivalent object (not the same reference)
    // still produces the identical string — proves it's a pure function of
    // VALUES, not of object identity or hidden mutable state.
    const c = buildCreaturePortraitSvg({ topology: "quadruped", massKg: 55, heightM: 1.2, coatColor: "#5a4632", parts: sampleParts.map((p) => ({ ...p })), variant: null });
    assert.equal(a, c);
  });

  it("varies limb/appendage count with the real part count: a 1-part amorphous creature vs a 9-part polyped creature render different ellipse counts", () => {
    // Real generator output — not hand-crafted — for two genuinely
    // differently-shaped species.
    const slime = generateCreature({ description: "a tiny slime", topology: "amorphous" });
    const spider = generateCreature({ description: "a spider", topology: "polyped" });
    assert.ok(slime.parts.length < spider.parts.length, "test precondition: spider must have more real parts than slime");

    const slimeSvg = buildCreaturePortraitSvg({ ...slime, coatColor: "#8b5e3c" });
    const spiderSvg = buildCreaturePortraitSvg({ ...spider, coatColor: "#8b5e3c" });

    assert.equal(countEllipses(slimeSvg), slime.parts.length, "ellipse count must equal the real part count");
    assert.equal(countEllipses(spiderSvg), spider.parts.length, "ellipse count must equal the real part count");
    assert.ok(countEllipses(spiderSvg) > countEllipses(slimeSvg), "the many-legged creature must render more shapes than the single-blob creature");

    // The aria-label surfaces the real leg count for the polyped creature
    // and never claims legs for the amorphous one.
    const spiderLegs = summarizePartCounts(spider.parts).leg || 0;
    assert.ok(spiderLegs >= 6, "polyped generator should produce 6-8 legs");
    assert.match(spiderSvg, new RegExp(`${spiderLegs} legs?`));
    assert.doesNotMatch(slimeSvg, /\bleg/);
  });

  it("scales rendered size with real mass/height: a colossal creature's viewBox is larger than a tiny creature's", () => {
    const tiny = generateCreature({ description: "a tiny slime", topology: "amorphous" });
    const colossal = generateCreature({ description: "a colossal ancient dragon", topology: "winged_quadruped" });
    assert.ok(colossal.massKg > tiny.massKg * 50, "test precondition: colossal must be dramatically heavier");
    assert.ok(colossal.heightM > tiny.heightM * 5, "test precondition: colossal must be dramatically taller");

    const tinySvg = buildCreaturePortraitSvg({ ...tiny, coatColor: "#8b5e3c" });
    const colossalSvg = buildCreaturePortraitSvg({ ...colossal, coatColor: "#8b5e3c" });

    const tinyVb = viewBoxOf(tinySvg);
    const colossalVb = viewBoxOf(colossalSvg);
    assert.ok(colossalVb.w > tinyVb.w, `colossal viewBox width (${colossalVb.w}) must exceed tiny's (${tinyVb.w})`);
    assert.ok(colossalVb.h > tinyVb.h, `colossal viewBox height (${colossalVb.h}) must exceed tiny's (${tinyVb.h})`);

    // Same check holds pairwise for a mid-size creature too — monotonic,
    // not just a two-point coincidence.
    const mid = generateCreature({ description: "a wolf", topology: "quadruped" });
    const midSvg = buildCreaturePortraitSvg({ ...mid, coatColor: "#8b5e3c" });
    const midVb = viewBoxOf(midSvg);
    assert.ok(midVb.w >= tinyVb.w && midVb.w <= colossalVb.w);
  });

  it("tints every rendered part from the real coatColor: two different coat colors produce two different fill sets", () => {
    const bp = { topology: "quadruped", massKg: 55, heightM: 1.2, parts: sampleParts, variant: null };
    const brownSvg = buildCreaturePortraitSvg({ ...bp, coatColor: "#8b5e3c" });
    const blueSvg = buildCreaturePortraitSvg({ ...bp, coatColor: "#3a6ea5" });
    assert.notEqual(brownSvg, blueSvg);
    const brownFills = new Set(fillsOf(brownSvg));
    const blueFills = new Set(fillsOf(blueSvg));
    assert.ok(brownFills.size > 0 && blueFills.size > 0);
    for (const f of brownFills) assert.ok(!blueFills.has(f), `fill ${f} should not be shared between two different coat colors`);
  });

  it("never invents a variant label when none is real, but surfaces one when present", () => {
    const bp = { topology: "quadruped", massKg: 55, heightM: 1.2, coatColor: "#8b5e3c", parts: sampleParts };
    const noVariant = buildCreaturePortraitSvg({ ...bp, variant: null });
    const withVariant = buildCreaturePortraitSvg({ ...bp, variant: "brine-touched" });
    assert.doesNotMatch(noVariant, /variant/);
    assert.match(withVariant, /brine-touched/);
  });

  it("degrades gracefully on malformed/empty input instead of throwing", () => {
    assert.doesNotThrow(() => buildCreaturePortraitSvg({}));
    assert.doesNotThrow(() => buildCreaturePortraitSvg(null));
    assert.doesNotThrow(() => buildCreaturePortraitSvg({ parts: [{ name: "loop", kind: "torso", parent: "loop", attach: { x: 1, y: 1, z: 1 }, dimensions: { x: 1, y: 1, z: 1 } }] }));
    const svg = buildCreaturePortraitSvg({});
    assert.match(svg, /<svg/);
  });
});

describe("creatures.portrait macro", () => {
  it("resolves a species id to a deterministic SVG + real params", async () => {
    const macros = collectMacros();
    const r1 = await macros.get("portrait")({}, { species_id: "wolf" });
    const r2 = await macros.get("portrait")({}, { species_id: "wolf" });
    assert.equal(r1.ok, true);
    assert.equal(r1.svg, r2.svg, "same species_id must render the identical SVG across calls");
    assert.equal(r1.params.species_id, "wolf");
    assert.ok(r1.params.topology);
    assert.ok(r1.params.massKg > 0);
    assert.ok(r1.params.heightM > 0);
    assert.equal(r1.params.coatColor, coatFor("wolf", null));
    assert.equal(countEllipses(r1.svg), r1.params.partCount);
  });

  it("fails honestly with no fabricated fallback when species_id is missing", async () => {
    const macros = collectMacros();
    const r = await macros.get("portrait")({}, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_species_id");
    assert.equal(r.svg, undefined);
  });

  it("two different species render two different SVGs", async () => {
    const macros = collectMacros();
    const wolf = await macros.get("portrait")({}, { species_id: "wolf" });
    const spider = await macros.get("portrait")({}, { species_id: "spider" });
    assert.notEqual(wolf.svg, spider.svg);
  });

  it("an explicit dominant affinity uses the real elemental tint (matches coatFor), not the hash fallback", async () => {
    const macros = collectMacros();
    const r = await macros.get("portrait")({}, { species_id: "steam_wisp", dominant: "fire" });
    assert.equal(r.ok, true);
    assert.equal(r.params.coatColor, coatFor("steam_wisp", "fire"));
    assert.equal(r.params.coatColor, "#c0532a"); // VARIANT_TINT.fire
  });

  it("surfaces a real variant label onto the params + caption without inventing one when absent", async () => {
    const macros = collectMacros();
    const withVariant = await macros.get("portrait")({}, { species_id: "wolf", variant: "brine-touched" });
    const withoutVariant = await macros.get("portrait")({}, { species_id: "wolf" });
    assert.equal(withVariant.params.variant, "brine-touched");
    assert.match(withVariant.svg, /brine-touched/);
    assert.equal(withoutVariant.params.variant, null);
    assert.doesNotMatch(withoutVariant.svg, /variant/);
  });
});
