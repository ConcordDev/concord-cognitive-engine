// Sword per-part mass and balance (CLAUDE-CAD-GENERAL-DESIGN-2026-10-07.md:
// "Sword: per-part materials (wood grip on a steel tang). Balance and mass
// must match real arming swords: about 1.1 kg, balance about 10–15 cm in
// front of the guard").

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { swordMassBreakdown, ARMING_SWORD_PARAMS } from "../lib/asset-gen/sword-mass.js";
import { generateSwordMesh, profilePoints } from "../lib/asset-gen/parametric-mesh.js";
import { meshVolume } from "../lib/asset-gen/mass-properties.js";

describe("sword per-part mass", () => {
  it("the part volumes add up to the mesh's own enclosed volume", () => {
    for (const p of [{}, ARMING_SWORD_PARAMS]) {
      const r = swordMassBreakdown(p);
      assert.ok(r.volumeAgreement < 1e-6, `parts vs mesh differ by ${r.volumeAgreement}`);
    }
  });

  it("each part has its own material: the grip is wood, the tang inside it steel", () => {
    const r = swordMassBreakdown(ARMING_SWORD_PARAMS);
    const by = Object.fromEntries(r.parts.map((q) => [q.part, q]));
    assert.equal(by.grip.material, "douglas-fir");
    assert.equal(by.tang.material, "steel-4140");
    assert.ok(by.grip.density_kgm3 < 1000 && by.tang.density_kgm3 > 7000);
    const steelGrip = swordMassBreakdown(ARMING_SWORD_PARAMS, { grip: "steel-a36" });
    assert.ok(steelGrip.mass_kg > r.mass_kg + 0.1, "a steel grip is much heavier");
  });

  it("point of balance is the mass-weighted CG measured from the guard's blade face", () => {
    const r = swordMassBreakdown(ARMING_SWORD_PARAMS);
    const cg = r.parts.reduce((s, q) => s + q.mass_kg * q.cgX_m, 0) / r.mass_kg;
    assert.ok(Math.abs(r.pointOfBalance_m - (cg - r.guardFaceX_m)) < 1e-12);
  });

  it("the arming-sword preset matches the reference (about 1.1 kg, balance 10–15 cm)", () => {
    const r = swordMassBreakdown(ARMING_SWORD_PARAMS);
    assert.ok(Math.abs(r.mass_kg - 1.1) / 1.1 <= 0.15, `mass ${r.mass_kg}`);
    assert.ok(r.pointOfBalance_m >= 0.10 && r.pointOfBalance_m <= 0.15, `PoB ${r.pointOfBalance_m}`);
    assert.equal(r.referenceCheck.realistic, true);
  });

  it("the old defaults are not called realistic, and say why", () => {
    const r = swordMassBreakdown({});
    assert.equal(r.referenceCheck.realistic, false);
    assert.match(r.referenceCheck.note, /balance .* cm from the guard/);
  });

  it("a tang wider than the grip is refused", () => {
    assert.throws(() => swordMassBreakdown({ ...ARMING_SWORD_PARAMS, tangWidth: 0.05 }), /tang does not fit/);
  });
});

describe("sword mesh: blade profile and flattened-diamond section", () => {
  it("defaults still give the original geometry (bladeTipStart 0, bladeFlat 0)", () => {
    const a = generateSwordMesh({});
    const b = generateSwordMesh({ bladeTipStart: 0, bladeFlat: 0, bladeTipWidthRatio: 1, bladeTipThicknessRatio: 1 });
    assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
    assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
  });

  it("the hexagon profile with flat 0 is the diamond's area; its area is 2·hw·ht·(1+flat)", () => {
    const area = (pts) => Math.abs(pts.reduce((s, [y, z], i) => { const [y2, z2] = pts[(i + 1) % pts.length]; return s + y * z2 - y2 * z; }, 0)) / 2;
    assert.ok(Math.abs(area(profilePoints("hexagon", 0, 0)) - area(profilePoints("diamond"))) < 1e-12);
    assert.ok(Math.abs(area(profilePoints("hexagon", 0, 0.5)) - 2 * 1.5) < 1e-12);
  });

  it("the arming-sword mesh is a closed solid with the volume the parts predict", () => {
    const mesh = generateSwordMesh(ARMING_SWORD_PARAMS);
    const v = meshVolume(mesh.positions, mesh.indices);
    assert.ok(v > 0, "outward winding");
    const r = swordMassBreakdown(ARMING_SWORD_PARAMS);
    assert.ok(Math.abs(v - r.volume_m3) / r.volume_m3 < 1e-6);
  });

  it("bad profile parameters are refused", () => {
    assert.throws(() => generateSwordMesh({ bladeFlat: 1 }), /bladeFlat/);
    assert.throws(() => generateSwordMesh({ bladeTipStart: 1 }), /bladeTipStart/);
    assert.throws(() => generateSwordMesh({ bladeTipStart: 0.8, bladeTipWidthRatio: 0 }), /bladeTipWidthRatio/);
  });
});
