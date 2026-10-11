// server/lib/asset-gen/sword-mass.js
//
// Per-part mass, centre of mass and point of balance for the sword
// archetype. The whole-mesh path weighs a sword as one solid of one
// material; a real sword is a steel blade, guard and pommel with a wooden
// grip over a steel tang. Each part's volume and centroid here come from the
// same stations generateSwordMesh lofts (round sections are the mesh's
// n-sided polygons, not true circles), and the total is checked against the
// mesh's own enclosed volume.

import { SWORD_DEFAULTS, bladeProfileAt, generateSwordMesh } from "./parametric-mesh.js";
import { getMaterial, meshVolume } from "./mass-properties.js";

export const DEFAULT_SWORD_MATERIALS = Object.freeze({
  blade: "steel-4140",
  guard: "steel-a36",
  pommel: "steel-a36",
  tang: "steel-4140",
  grip: "douglas-fir",
});

// Reference for a European arming sword (owner's brief,
// CLAUDE-CAD-GENERAL-DESIGN-2026-10-07.md): about 1.1 kg, point of balance
// 10–15 cm in front of the guard.
export const ARMING_SWORD_REFERENCE = Object.freeze({
  massKg: 1.1,
  massTolerance: 0.15,
  pointOfBalanceM: [0.10, 0.15],
  source: "arming sword: about 1.1 kg, point of balance 10–15 cm in front of the guard",
});

// Realistic arming-sword proportions: a flattened-diamond blade section (a
// flat across half the width) that keeps its width to the last
// 15% and tapers in thickness from 6.5 mm (distal taper), a 20 cm bar guard
// about 10 × 10 mm in section, and a steel pommel of about 0.2 kg.
export const ARMING_SWORD_PARAMS = Object.freeze({
  bladeLength: 0.76,
  bladeBaseWidth: 0.05,
  bladeBaseThickness: 0.0065,
  bladeSegments: 12,
  bladeTipStart: 0.85,
  bladeTipWidthRatio: 0.55,
  bladeTipThicknessRatio: 0.4,
  guardWidth: 0.2,
  guardThickness: 0.01,
  guardLength: 0.01,
  hiltLength: 0.1,
  hiltRadius: 0.014,
  pommelRadius: 0.022,
  pommelLength: 0.028,
  hiltSides: 12,
  tangWidth: 0.012,
  tangThickness: 0.005,
  bladeFlat: 0.5,
});

const polyArea = (r, n) => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);

function material(key) {
  const m = getMaterial(key);
  if (!m) throw new Error(`sword_mass_unknown_material: "${key}"`);
  return m;
}

/**
 * @param {object} [params] sword params (SWORD_DEFAULTS overridden)
 * @param {object} [materials] per-part material keys (DEFAULT_SWORD_MATERIALS overridden)
 */
export function swordMassBreakdown(params = {}, materials = {}) {
  const p = { ...SWORD_DEFAULTS, ...params };
  const mats = { ...DEFAULT_SWORD_MATERIALS, ...materials };
  const n = p.hiltSides;
  const xGripStart = p.pommelLength;
  const xGuardStart = xGripStart + p.hiltLength;
  const xBladeStart = xGuardStart + p.guardLength;

  // Pommel: frustum of an n-gon, pommelRadius → hiltRadius over pommelLength.
  const A1 = polyArea(p.pommelRadius, n);
  const A2 = polyArea(p.hiltRadius, n);
  const s12 = Math.sqrt(A1 * A2);
  const pommelV = (p.pommelLength / 3) * (A1 + A2 + s12);
  const pommelX = (p.pommelLength * (A1 + 2 * s12 + 3 * A2)) / (4 * (A1 + s12 + A2));

  // Grip envelope, with a rectangular steel tang inside it.
  const gripEnvelopeV = A2 * p.hiltLength;
  const inradius = p.hiltRadius * Math.cos(Math.PI / n);
  if (Math.hypot(p.tangWidth, p.tangThickness) / 2 > inradius) {
    throw new Error("sword_mass_bad_param: the tang does not fit inside the grip");
  }
  const tangV = p.tangWidth * p.tangThickness * p.hiltLength;
  const gripX = xGripStart + p.hiltLength / 2;

  // Guard: a rectangular bar.
  const guardV = p.guardWidth * p.guardThickness * p.guardLength;
  const guardX = xGuardStart + p.guardLength / 2;

  // Blade: section area 2·hw·ht·(1 + flat) (flat = 0 is the diamond),
  // piecewise linear in hw and ht, so area is
  // quadratic and x·area cubic on each piece: Simpson's rule is exact.
  const breaks = [0, ...(p.bladeTipStart > 0 ? [p.bladeTipStart] : []), 1];
  let bladeV = 0;
  let bladeMoment = 0;
  for (let i = 0; i < breaks.length - 1; i++) {
    const [t0, t1] = [breaks[i], breaks[i + 1]];
    const tm = (t0 + t1) / 2;
    const area = (t) => { const q = bladeProfileAt(p, t); return 2 * q.halfWidth * q.halfThickness * (1 + (p.bladeFlat || 0)); };
    const x = (t) => xBladeStart + t * p.bladeLength;
    const len = (t1 - t0) * p.bladeLength;
    bladeV += (len / 6) * (area(t0) + 4 * area(tm) + area(t1));
    bladeMoment += (len / 6) * (x(t0) * area(t0) + 4 * x(tm) * area(tm) + x(t1) * area(t1));
  }
  const bladeX = bladeMoment / bladeV;

  const parts = [
    { part: "pommel", material: mats.pommel, volume_m3: pommelV, cgX_m: pommelX },
    { part: "grip", material: mats.grip, volume_m3: gripEnvelopeV - tangV, cgX_m: gripX },
    { part: "tang", material: mats.tang, volume_m3: tangV, cgX_m: gripX },
    { part: "guard", material: mats.guard, volume_m3: guardV, cgX_m: guardX },
    { part: "blade", material: mats.blade, volume_m3: bladeV, cgX_m: bladeX },
  ].map((q) => {
    const m = material(q.material);
    return { ...q, density_kgm3: m.density, mass_kg: q.volume_m3 * m.density };
  });

  const mass = parts.reduce((s, q) => s + q.mass_kg, 0);
  const cgX = parts.reduce((s, q) => s + q.mass_kg * q.cgX_m, 0) / mass;
  const volume = parts.reduce((s, q) => s + q.volume_m3, 0);
  const mesh = generateSwordMesh(p);
  const meshV = Math.abs(meshVolume(mesh.positions, mesh.indices));
  const pob = cgX - xBladeStart;

  const ref = ARMING_SWORD_REFERENCE;
  const massOk = Math.abs(mass - ref.massKg) / ref.massKg <= ref.massTolerance;
  const pobOk = pob >= ref.pointOfBalanceM[0] && pob <= ref.pointOfBalanceM[1];
  return {
    parts,
    mass_kg: mass,
    cgX_m: cgX,
    guardFaceX_m: xBladeStart,
    pointOfBalance_m: pob,
    volume_m3: volume,
    meshVolume_m3: meshV,
    volumeAgreement: Math.abs(volume - meshV) / meshV,
    referenceCheck: {
      reference: ref.source,
      massOk,
      pointOfBalanceOk: pobOk,
      realistic: massOk && pobOk,
      note: massOk && pobOk
        ? "matches the arming-sword reference"
        : `does not match the arming-sword reference${massOk ? "" : ` (mass ${mass.toFixed(2)} kg)`}${pobOk ? "" : ` (balance ${(pob * 100).toFixed(1)} cm from the guard)`}`,
    },
  };
}
