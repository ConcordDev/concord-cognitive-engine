// server/lib/asset-gen/mass-properties.js
//
// Program C, Stage 3 — material/mass grounding. Pure geometry math
// (tetrahedron decomposition against the origin, the standard technique for
// closed-mesh volume/centroid) plus a real-material density lookup so a
// generated part's mass derives from real SI physics, not an invented
// number.
//
// This module is deliberately standalone — it does NOT live in
// server/domains/math.js (that CAS is symbolic algebra only, zero geometry
// concepts) and does NOT modify server/domains/engineering.js.

// ── Material library ─────────────────────────────────────────────────────
// server/domains/engineering.js's `MATERIAL_LIBRARY` is a private
// (non-exported) module-level const, reachable only through the
// `engineering.materialLibrary` registered lens action — there is no import
// path into it without editing that file, which is out of scope here. The
// table below is a byte-for-byte transcription of the same object literal
// (E in MPa, yield/ultimate in MPa, density in kg/m³, cte in 1e-6/K).
// server/tests/mass-properties.test.js cross-checks EVERY entry below
// against the LIVE engine (booted via the lensRun/CAS harness per
// CLAUDE.md's "compute-don't-guess" doctrine: `lensRun("engineering",
// "materialLibrary", { params: { id } })`) so any future drift between the
// two copies fails the test instead of silently diverging.
export const MATERIAL_LIBRARY = Object.freeze({
  'steel-a36': {
    label: 'ASTM A36 Structural Steel', category: 'metal',
    E: 200000, yield: 250, ultimate: 400, density: 7850, poisson: 0.26,
    cte: 11.7, thermalK: 50, costPerKg: 1.1,
  },
  'steel-a992': {
    label: 'ASTM A992 Steel (50 ksi)', category: 'metal',
    E: 200000, yield: 345, ultimate: 450, density: 7850, poisson: 0.30,
    cte: 11.7, thermalK: 50, costPerKg: 1.2,
  },
  'steel-4140': {
    label: 'AISI 4140 Alloy Steel', category: 'metal',
    E: 205000, yield: 415, ultimate: 655, density: 7850, poisson: 0.29,
    cte: 12.3, thermalK: 42, costPerKg: 2.4,
  },
  'aluminum-6061-t6': {
    label: 'Aluminum 6061-T6', category: 'metal',
    E: 68900, yield: 276, ultimate: 310, density: 2700, poisson: 0.33,
    cte: 23.6, thermalK: 167, costPerKg: 2.8,
  },
  'aluminum-7075-t6': {
    label: 'Aluminum 7075-T6', category: 'metal',
    E: 71700, yield: 503, ultimate: 572, density: 2810, poisson: 0.33,
    cte: 23.4, thermalK: 130, costPerKg: 6.5,
  },
  'titanium-ti6al4v': {
    label: 'Titanium Ti-6Al-4V (Grade 5)', category: 'metal',
    E: 113800, yield: 880, ultimate: 950, density: 4430, poisson: 0.34,
    cte: 8.6, thermalK: 6.7, costPerKg: 35,
  },
  'stainless-304': {
    label: 'Stainless Steel 304', category: 'metal',
    E: 193000, yield: 215, ultimate: 505, density: 8000, poisson: 0.29,
    cte: 17.3, thermalK: 16.2, costPerKg: 4.5,
  },
  'abs-plastic': {
    label: 'ABS Plastic', category: 'polymer',
    E: 2300, yield: 40, ultimate: 44, density: 1050, poisson: 0.35,
    cte: 90, thermalK: 0.17, costPerKg: 2.0,
  },
  'pla-plastic': {
    label: 'PLA (3D-print)', category: 'polymer',
    E: 3500, yield: 50, ultimate: 60, density: 1240, poisson: 0.36,
    cte: 68, thermalK: 0.13, costPerKg: 2.2,
  },
  'cfrp': {
    label: 'Carbon Fiber Reinforced Polymer', category: 'composite',
    E: 70000, yield: 600, ultimate: 600, density: 1600, poisson: 0.28,
    cte: 2.0, thermalK: 7, costPerKg: 40,
  },
  'concrete-30mpa': {
    label: 'Concrete (30 MPa)', category: 'ceramic',
    E: 30000, yield: 30, ultimate: 30, density: 2400, poisson: 0.20,
    cte: 10, thermalK: 1.7, costPerKg: 0.1,
  },
  'douglas-fir': {
    label: 'Douglas Fir (structural lumber)', category: 'wood',
    E: 13100, yield: 50, ultimate: 50, density: 510, poisson: 0.30,
    cte: 4.5, thermalK: 0.12, costPerKg: 0.6,
  },
});

/** Look up a material by key. Returns null (never throws) when unknown. */
export function getMaterial(key) {
  return MATERIAL_LIBRARY[key] ? { key, ...MATERIAL_LIBRARY[key] } : null;
}

function toArrays(positions, indices) {
  const pos = positions instanceof Float32Array || positions instanceof Float64Array
    ? positions
    : Float64Array.from(positions);
  const idx = indices instanceof Uint32Array || indices instanceof Uint16Array
    ? indices
    : Uint32Array.from(indices);
  if (pos.length === 0 || pos.length % 3 !== 0) {
    throw new Error(`mass_properties_bad_positions: length ${pos.length} not a positive multiple of 3`);
  }
  if (idx.length === 0 || idx.length % 3 !== 0) {
    throw new Error(`mass_properties_bad_indices: length ${idx.length} not a positive multiple of 3`);
  }
  return { pos, idx };
}

/**
 * Signed volume of a closed triangle mesh via tetrahedron decomposition
 * against the origin: V = Σ dot(a, cross(b,c)) / 6 over every triangle
 * (a,b,c). Requires globally-consistent outward winding (every directed
 * edge (a,b) appears once and its reverse (b,a) appears once on the
 * neighboring triangle) — see parametric-mesh.js's loftClosedTube, which is
 * built and tested to satisfy this.
 *
 * The RAW signed value is returned (not forced positive) so a caller can
 * detect inverted winding as a negative volume rather than have it silently
 * masked — see massProperties() below, which takes the magnitude for the
 * physical mass.
 *
 * @param {Float32Array|number[]} positions flat [x0,y0,z0, x1,y1,z1, ...]
 * @param {Uint32Array|number[]} indices flat triangle index triples
 * @returns {number} signed volume (same units³ as the position coordinates)
 */
export function meshVolume(positions, indices) {
  const { pos, idx } = toArrays(positions, indices);
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i] * 3, ib = idx[i + 1] * 3, ic = idx[i + 2] * 3;
    const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2];
    const bx = pos[ib], by = pos[ib + 1], bz = pos[ib + 2];
    const cx = pos[ic], cy = pos[ic + 1], cz = pos[ic + 2];
    const crossX = by * cz - bz * cy;
    const crossY = bz * cx - bx * cz;
    const crossZ = bx * cy - by * cx;
    vol += (ax * crossX + ay * crossY + az * crossZ) / 6;
  }
  return vol;
}

/**
 * Tetrahedron-volume-weighted centroid of a closed triangle mesh: each
 * triangle (a,b,c) forms a tetrahedron with the origin whose centroid is
 * (a+b+c)/4 (the 4th vertex, the origin, contributes 0); the mesh centroid
 * is the volume-weighted average of all tetrahedron centroids. Robust to
 * winding sign (both the per-tet volume and its contribution to the sum
 * flip together, so the ratio — the actual centroid — is unaffected).
 *
 * @param {Float32Array|number[]} positions
 * @param {Uint32Array|number[]} indices
 * @returns {[number, number, number]} [x, y, z]
 */
export function centerOfMass(positions, indices) {
  const { pos, idx } = toArrays(positions, indices);
  let vSum = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i] * 3, ib = idx[i + 1] * 3, ic = idx[i + 2] * 3;
    const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2];
    const bx = pos[ib], by = pos[ib + 1], bz = pos[ib + 2];
    const cxp = pos[ic], cyp = pos[ic + 1], czp = pos[ic + 2];
    const crossX = by * czp - bz * cyp;
    const crossY = bz * cxp - bx * czp;
    const crossZ = bx * cyp - by * cxp;
    const vTet = (ax * crossX + ay * crossY + az * crossZ) / 6;
    vSum += vTet;
    cx += vTet * (ax + bx + cxp) / 4;
    cy += vTet * (ay + by + cyp) / 4;
    cz += vTet * (az + bz + czp) / 4;
  }
  if (vSum === 0) {
    throw new Error("mass_properties_zero_volume: cannot compute center of mass of a zero-volume mesh");
  }
  return [cx / vSum, cy / vSum, cz / vSum];
}

/**
 * Ground a mesh in real material physics: volume (via meshVolume) × real SI
 * density (via the MATERIAL_LIBRARY lookup) = mass. Coordinates are assumed
 * to be in meters (SI), matching parametric-mesh.js's parameter units, so
 * volume comes out in m³ and mass in kg directly — no unit-conversion
 * fudge factor.
 *
 * @param {{positions:Float32Array|number[], indices:Uint32Array|number[]}} mesh
 * @param {string} materialKey key into MATERIAL_LIBRARY, e.g. "steel-a36"
 * @returns {{
 *   volume_m3:number, volumeSigned_m3:number, mass_kg:number,
 *   centerOfMass:[number,number,number],
 *   material:{key:string,label:string,category:string,density:number,yield:number,ultimate:number,E:number}
 * }}
 * @throws on an unknown materialKey or a degenerate (zero-volume) mesh — honest failure, never a fabricated mass.
 */
export function massProperties(mesh, materialKey) {
  const mat = getMaterial(materialKey);
  if (!mat) {
    throw new Error(`mass_properties_unknown_material: "${materialKey}" is not in MATERIAL_LIBRARY`);
  }
  const volumeSigned_m3 = meshVolume(mesh.positions, mesh.indices);
  const volume_m3 = Math.abs(volumeSigned_m3);
  if (volume_m3 === 0) {
    throw new Error("mass_properties_zero_volume: mesh encloses zero volume");
  }
  const com = centerOfMass(mesh.positions, mesh.indices);
  return {
    volume_m3,
    volumeSigned_m3,
    mass_kg: volume_m3 * mat.density,
    centerOfMass: com,
    material: mat,
  };
}
