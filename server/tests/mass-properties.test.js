/**
 * Program C, Stage 3 — material/mass grounding.
 *
 * Pins: volume of known primitives against analytic formulas, center-of-mass
 * of symmetric meshes at their expected centroid, and — per CLAUDE.md's
 * "compute-don't-guess" doctrine — that this module's transcribed
 * MATERIAL_LIBRARY is byte-identical to the LIVE
 * `engineering.materialLibrary` registered lens action (booted through the
 * lensRun/CAS harness), so a generated sword's mass derives from real,
 * verified-against-the-engine SI density rather than an invented number.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { lensRun } from "./depth/_harness.js";
import {
  meshVolume,
  centerOfMass,
  massProperties,
  getMaterial,
  MATERIAL_LIBRARY,
} from "../lib/asset-gen/mass-properties.js";
import { generateSwordMesh, loftClosedTube } from "../lib/asset-gen/parametric-mesh.js";

// A hand-built unit cube {positions, indices} — NOT reusing loftClosedTube's
// own box construction, so this test doesn't just check parametric-mesh.js
// against itself.
const UNIT_CUBE = {
  positions: [
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0, // z=0 face verts 0-3
    0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1, // z=1 face verts 4-7
  ],
  indices: [
    // -z (bottom, outward normal -z): CCW seen from below
    0, 2, 1,  0, 3, 2,
    // +z (top)
    4, 5, 6,  4, 6, 7,
    // -y
    0, 1, 5,  0, 5, 4,
    // +y
    3, 7, 6,  3, 6, 2,
    // -x
    0, 4, 7,  0, 7, 3,
    // +x
    1, 2, 6,  1, 6, 5,
  ],
};

describe("meshVolume — known-primitive analytic checks", () => {
  it("hand-built unit cube has volume 1", () => {
    const v = meshVolume(UNIT_CUBE.positions, UNIT_CUBE.indices);
    assert.ok(Math.abs(Math.abs(v) - 1) < 1e-9, `volume ${v}`);
  });

  it("loftClosedTube box of arbitrary dimensions matches width×height×length", () => {
    const w = 0.3, h = 0.05, l = 2.4;
    const box = loftClosedTube("rect", [
      { x: 0, halfWidth: w / 2, halfThickness: h / 2 },
      { x: l, halfWidth: w / 2, halfThickness: h / 2 },
    ]);
    const v = meshVolume(box.positions, box.indices);
    const expected = w * h * l;
    // Float32Array-precision coordinates (loftClosedTube's native output
    // type) carry ~7 significant decimal digits — 1e-6 relative is the
    // honest bound, not 1e-9.
    assert.ok(Math.abs(Math.abs(v) - expected) / expected < 1e-6);
  });

  it("throws on malformed (non-multiple-of-3) positions/indices — honest failure, not a silent NaN", () => {
    assert.throws(() => meshVolume([0, 0], [0]));
    assert.throws(() => meshVolume([0, 0, 0], []));
  });
});

describe("centerOfMass — symmetric-mesh centroid checks", () => {
  it("unit cube spanning [0,1]^3 has centroid at (0.5,0.5,0.5)", () => {
    const com = centerOfMass(UNIT_CUBE.positions, UNIT_CUBE.indices);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(com[i] - 0.5) < 1e-9, `axis ${i}: ${com[i]}`);
  });

  it("a box loft from x=0 to x=L, centered on Y/Z, has centroid at (L/2, 0, 0)", () => {
    const L = 3.7;
    const box = loftClosedTube("rect", [
      { x: 0, halfWidth: 0.2, halfThickness: 0.1 },
      { x: L, halfWidth: 0.2, halfThickness: 0.1 },
    ]);
    const com = centerOfMass(box.positions, box.indices);
    assert.ok(Math.abs(com[0] - L / 2) < 1e-6);
    assert.ok(Math.abs(com[1]) < 1e-6);
    assert.ok(Math.abs(com[2]) < 1e-6);
  });

  it("a cone (base at x=0, apex at x=h) has centroid at x = h/4 from the base (solid-cone theorem)", () => {
    const h = 3;
    const cone = loftClosedTube(
      "circle",
      [{ x: 0, halfWidth: 0.5, halfThickness: 0.5 }, { x: h, halfWidth: 0, halfThickness: 0 }],
      { sides: 96, pointEnd: true, capEnd: false },
    );
    const com = centerOfMass(cone.positions, cone.indices);
    assert.ok(Math.abs(com[0] - h / 4) / (h / 4) < 0.002, `x centroid ${com[0]}, expected ~${h / 4}`);
  });
});

describe("MATERIAL_LIBRARY — cross-checked against the LIVE engineering engine (compute-don't-guess)", () => {
  it("every transcribed entry is byte-identical to engineering.materialLibrary's live output", async () => {
    for (const key of Object.keys(MATERIAL_LIBRARY)) {
      const live = await lensRun("engineering", "materialLibrary", { params: { id: key } });
      assert.equal(live.ok, true, `engineering.materialLibrary(${key}) should succeed`);
      const expected = MATERIAL_LIBRARY[key];
      for (const field of ["label", "category", "E", "yield", "ultimate", "density", "poisson", "cte", "thermalK", "costPerKg"]) {
        assert.equal(
          live.result[field], expected[field],
          `field "${field}" for material "${key}": transcribed=${expected[field]} live=${live.result[field]}`,
        );
      }
    }
  });

  it("the live engine has no material this module doesn't also carry (no silent additions missed)", async () => {
    const live = await lensRun("engineering", "materialLibrary", { params: {} });
    assert.equal(live.ok, true);
    const liveIds = live.result.materials.map((m) => m.id).sort();
    const localIds = Object.keys(MATERIAL_LIBRARY).sort();
    assert.deepEqual(liveIds, localIds);
  });

  it("getMaterial returns null (never throws) for an unknown key", () => {
    assert.equal(getMaterial("unobtainium"), null);
  });
});

describe("massProperties — real SI density grounds a generated part's mass", () => {
  it("a steel-a36 box's mass equals volume × the REAL looked-up density (7850 kg/m³ per the live engine)", () => {
    const w = 0.1, h = 0.02, l = 0.5; // meters
    const box = loftClosedTube("rect", [
      { x: 0, halfWidth: w / 2, halfThickness: h / 2 },
      { x: l, halfWidth: w / 2, halfThickness: h / 2 },
    ]);
    const props = massProperties(box, "steel-a36");
    const expectedVolume = w * h * l;
    // Float32Array-precision mesh coordinates (loftClosedTube's output type)
    // carry ~7 significant decimal digits, so a strict 1e-9 relative
    // tolerance is tighter than the input precision allows — 1e-6 is the
    // honest bound for float32-sourced geometry.
    assert.ok(Math.abs(props.volume_m3 - expectedVolume) / expectedVolume < 1e-6);
    assert.equal(props.material.density, MATERIAL_LIBRARY["steel-a36"].density);
    assert.ok(Math.abs(props.mass_kg - expectedVolume * MATERIAL_LIBRARY["steel-a36"].density) / (expectedVolume * MATERIAL_LIBRARY["steel-a36"].density) < 1e-6);
  });

  it("a generated sword mesh gets a physically-grounded mass from real steel density", () => {
    const mesh = generateSwordMesh({ bladeSegments: 12, hiltSides: 8 });
    const props = massProperties(mesh, "steel-a36");
    assert.ok(props.volume_m3 > 0, "sword must enclose positive volume");
    assert.equal(props.material.key, "steel-a36");
    assert.equal(props.material.density, 7850);
    assert.ok(Math.abs(props.mass_kg - props.volume_m3 * 7850) < 1e-9);
    // Sanity band for a real one-handed sword: well under 5 kg, well over 0.1 kg.
    assert.ok(props.mass_kg > 0.1 && props.mass_kg < 5, `mass_kg out of sane sword range: ${props.mass_kg}`);
    // centerOfMass should sit inside the blade's overall length envelope.
    assert.ok(props.centerOfMass[0] >= 0 && props.centerOfMass[0] <= mesh.meta.totalLength);
  });

  it("throws (honest failure, not a fabricated mass) for an unknown material key", () => {
    const mesh = generateSwordMesh();
    assert.throws(() => massProperties(mesh, "unobtainium-9000"));
  });
});
