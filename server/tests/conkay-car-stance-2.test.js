// Car stance pass 2 (car-design brief item 0): a sculpted hood. The electric car's hood was one flat slab with the
// fender crowns (0.817 m at the front axle under 0.840 m crowns) although the section solve put it at ~0.745 m:
// the around-section fairing works on a radius field polar about a point inside each section, where a flat or dished
// top is convex in angle, so a Gaussian around the section lifts it. Measured on the kernel (2026-10-16): top-ray
// fairing 0.02 rad (band 25-50 deg) + a 0.6 m hood fillet + the cooling core 50 mm lower gives 0.773 m under
// 0.839 m crowns, the hood falling to ~0.73 m at the nose; fairness windows: hood/fender 50.6 (24.6), door 97.3 (97.3).
// The kernel option is off by default, so every other body is unchanged.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { ELECTRIC_BODY_CHOICES, CAD_BODY_DEFAULTS, CAD_BODY_OPTIONAL, CAD_BODY_BASIS } from "../lib/conkay/cad/body-params.js";
import { EV_LAYOUT_CHOICES, LAYOUT_DESIGN_CHOICES } from "../lib/conkay/compiler/car-layout.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const shell = (fuel) => buildCarFromLibrary(BRIEF, { config: fuel ? { fuelType: fuel } : {} }).ir.nodes.find((n) => n.id === "BODY_SHELL").geometry;
const kernel = readFileSync(fileURLToPath(new URL("../lib/conkay/cad/conkay_body_occ.py", import.meta.url)), "utf8");

describe("sculpted hood", () => {
  it("the kernel option is off by default (None) and per-ray when set", () => {
    assert.match(kernel, /"fairSigmaThetaTop": None, "fairTopBand": None, "fairTopBandStartDeg": None, "fairTopBandEndDeg": None/);
    assert.match(kernel, /st_k = \[stt \+ \(st - stt\) \* _smoothstep\(t1, t2, math\.degrees\(th\)\) for th in ths\]/);
    assert.equal(CAD_BODY_DEFAULTS.fairSigmaThetaTop, undefined);
    for (const k of ["fairSigmaThetaTop", "fairTopBandStartDeg", "fairTopBandEndDeg"]) { assert.ok(CAD_BODY_OPTIONAL.numbers.includes(k), k); assert.ok(CAD_BODY_BASIS[k], k); }
  });
  it("the electric body carries the top-ray fairing, its band and the 0.6 m hood fillet, each with its measured basis", () => {
    const g = shell("electric");
    assert.equal(g.fairSigmaThetaTop, 0.02);
    assert.equal(g.fairTopBandStartDeg, 25);
    assert.equal(g.fairTopBandEndDeg, 50);
    assert.equal(g.fairHoodCloseRadius, "600 mm");
    assert.match(ELECTRIC_BODY_CHOICES.fairSigmaThetaTop.basis, /0\.773 m under 0\.839 m crowns/);
  });
  it("the front-engine body keeps the global fairing (no top-ray option, 6 m hood fill)", () => {
    const g = shell(null);
    assert.equal(g.fairSigmaThetaTop, undefined);
    assert.equal(g.fairHoodCloseRadius, "6000 mm");
  });
  it("the electric cooling core sits 50 mm lower (bottom 0.15 m, engineBottomZ's allowance); the front-engine car's does not move", () => {
    assert.equal(EV_LAYOUT_CHOICES.radiatorCenterZ.value, 0.40);
    assert.equal(LAYOUT_DESIGN_CHOICES.radiatorCenterZ.value, 0.45);
    const z = (fuel) => parseFloat(buildCarFromLibrary(BRIEF, { config: fuel ? { fuelType: fuel } : {} }).ir.nodes.find((n) => n.id === "RADIATOR").position.z);
    assert.equal(z("electric"), 0.4);
    assert.equal(z(null), 0.45);
  });
});
