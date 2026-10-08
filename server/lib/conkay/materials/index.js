// server/lib/conkay/materials/index.js
//
// Materials as computational objects for the ConKay design graph, in SI.
//
// The structural and general materials come from
// lib/asset-gen/mass-properties.js, whose table is drift-checked against the
// live engineering domain (tests/mass-properties.test.js); nothing is
// re-typed here. Fastener grades are added below with their standard. A
// property the source does not give is null, and solvers report "not
// computed" for anything that needs it. There is no fallback density.

import { MATERIAL_LIBRARY as GENERAL } from "../../asset-gen/mass-properties.js";

const MPA = 1e6;
const KSI = 6894757.293168;

function fromGeneral(id, m) {
  return {
    id,
    label: m.label,
    category: m.category,
    densityKgM3: m.density ?? null,
    youngsModulusPa: m.E != null ? m.E * MPA : null,
    poisson: m.poisson ?? null,
    yieldPa: m.yield != null ? m.yield * MPA : null,
    ultimatePa: m.ultimate != null ? m.ultimate * MPA : null,
    costPerKgUsd: m.costPerKg ?? null,
    basis: "library",
    source: "engineering material library (lib/asset-gen/mass-properties.js)",
  };
}

// Bolt grades. Strengths are the standards' specified minimums.
const FASTENERS = {
  "astm-a307": {
    label: "ASTM A307 Grade A bolt", category: "fastener",
    densityKgM3: 7850, youngsModulusPa: 200e9, poisson: 0.29,
    yieldPa: null, ultimatePa: 60 * KSI, costPerKgUsd: null,
    source: "ASTM A307-21 Grade A: tensile strength 60 ksi min (no yield specified)",
  },
  "astm-a325": {
    label: "ASTM F3125 Grade A325 bolt", category: "fastener",
    densityKgM3: 7850, youngsModulusPa: 200e9, poisson: 0.29,
    yieldPa: 92 * KSI, ultimatePa: 120 * KSI, costPerKgUsd: null,
    source: "ASTM F3125/F3125M-19 Grade A325: Fu 120 ksi, Fy 92 ksi min",
  },
  "astm-a490": {
    label: "ASTM F3125 Grade A490 bolt", category: "fastener",
    densityKgM3: 7850, youngsModulusPa: 200e9, poisson: 0.29,
    yieldPa: 130 * KSI, ultimatePa: 150 * KSI, costPerKgUsd: null,
    source: "ASTM F3125/F3125M-19 Grade A490: Fu 150 ksi, Fy 130 ksi min",
  },
  "iso-3506-a2-70": {
    label: "Stainless bolt ISO 3506-1 A2-70 (304)", category: "fastener",
    densityKgM3: 7900, youngsModulusPa: 193e9, poisson: 0.29,
    yieldPa: 450 * MPA, ultimatePa: 700 * MPA, costPerKgUsd: null,
    source: "ISO 3506-1:2020 property class A2-70: Rm 700 MPa, Rp0.2 450 MPa min",
  },
  "iso-3506-a4-80": {
    label: "Stainless bolt ISO 3506-1 A4-80 (316)", category: "fastener",
    densityKgM3: 8000, youngsModulusPa: 193e9, poisson: 0.29,
    yieldPa: 600 * MPA, ultimatePa: 800 * MPA, costPerKgUsd: null,
    source: "ISO 3506-1:2020 property class A4-80: Rm 800 MPa, Rp0.2 600 MPa min",
  },
};

// Handbook typical values for materials the engineering table lacks (the
// plan's list: composites, rubber, glass, polycarbonate, foam, gear steel,
// cast iron, copper). These are typical, not specified minimums, and are
// labelled so; use them for screening. Composites are entered as
// quasi-isotropic laminates: ply-level (anisotropic) analysis is not done,
// and they have no yield point.
const TYPICAL = {
  "cfrp-quasi-iso": {
    label: "CFRP laminate, quasi-isotropic (T300-class carbon/epoxy, Vf ≈ 0.6)", category: "composite",
    densityKgM3: 1550, youngsModulusPa: 50e9, poisson: 0.3, yieldPa: null, ultimatePa: 600 * MPA, costPerKgUsd: null,
    source: "typical quasi-isotropic carbon/epoxy laminate (CMH-17 class values), screening only",
  },
  "gfrp-quasi-iso": {
    label: "GFRP laminate, quasi-isotropic (E-glass/epoxy)", category: "composite",
    densityKgM3: 1900, youngsModulusPa: 20e9, poisson: 0.3, yieldPa: null, ultimatePa: 250 * MPA, costPerKgUsd: null,
    source: "typical quasi-isotropic E-glass/epoxy laminate, screening only",
  },
  "rubber-natural": {
    label: "Natural rubber (about 60 Shore A)", category: "elastomer",
    densityKgM3: 920, youngsModulusPa: 3 * MPA, poisson: 0.49, yieldPa: null, ultimatePa: 20 * MPA, costPerKgUsd: null,
    source: "typical natural rubber compound; small-strain modulus",
  },
  "glass-soda-lime": {
    label: "Soda-lime glass, annealed", category: "glass",
    densityKgM3: 2500, youngsModulusPa: 70e9, poisson: 0.22, yieldPa: null, ultimatePa: 40 * MPA, costPerKgUsd: null,
    source: "typical annealed float glass; strength is a design-level tensile value, brittle",
  },
  "polycarbonate": {
    label: "Polycarbonate", category: "polymer",
    densityKgM3: 1200, youngsModulusPa: 2.3e9, poisson: 0.37, yieldPa: 62 * MPA, ultimatePa: 65 * MPA, costPerKgUsd: null,
    source: "typical general-purpose polycarbonate",
  },
  "foam-eps-30": {
    label: "Expanded polystyrene foam, 30 kg/m³", category: "foam",
    densityKgM3: 30, youngsModulusPa: 10 * MPA, poisson: 0.1, yieldPa: null, ultimatePa: 0.2 * MPA, costPerKgUsd: null,
    source: "typical EPS 30 kg/m³; modulus and strength are compressive",
  },
  "steel-8620": {
    label: "AISI 8620 gear steel, annealed", category: "metal",
    densityKgM3: 7850, youngsModulusPa: 205e9, poisson: 0.29, yieldPa: 385 * MPA, ultimatePa: 536 * MPA, costPerKgUsd: null,
    source: "typical AISI 8620 annealed; carburized case properties not modelled",
  },
  "cast-iron-gray-30": {
    label: "Gray cast iron, ASTM A48 Class 30", category: "metal",
    densityKgM3: 7150, youngsModulusPa: 100e9, poisson: 0.26, yieldPa: null, ultimatePa: 207 * MPA, costPerKgUsd: null,
    source: "ASTM A48 Class 30: 30 ksi tensile min; E varies with section (typical value), brittle",
  },
  "copper-c11000": {
    label: "Copper C11000 (ETP), annealed", category: "metal",
    densityKgM3: 8890, youngsModulusPa: 117e9, poisson: 0.34, yieldPa: 69 * MPA, ultimatePa: 220 * MPA, costPerKgUsd: null,
    source: "typical C11000 annealed",
  },
};

export const MATERIALS = Object.freeze({
  ...Object.fromEntries(Object.entries(GENERAL).map(([id, m]) => [id, Object.freeze(fromGeneral(id, m))])),
  ...Object.fromEntries(Object.entries(FASTENERS).map(([id, m]) => [id, Object.freeze({ id, basis: "specified minimum", ...m })])),
  ...Object.fromEntries(Object.entries(TYPICAL).map(([id, m]) => [id, Object.freeze({ id, basis: "typical", ...m })])),
});

// Plain-language names. "stainless" is ambiguous on its own; it resolves by
// what the part is (a fastener gets A2-70, anything else 304 sheet/bar), and
// the edit parser reports which one it picked.
const ALIASES = {
  "a307": "astm-a307", "a325": "astm-a325", "a490": "astm-a490",
  "a2-70": "iso-3506-a2-70", "a2": "iso-3506-a2-70", "a4-80": "iso-3506-a4-80", "a4": "iso-3506-a4-80",
  "304": "stainless-304", "a36": "steel-a36", "a992": "steel-a992", "4140": "steel-4140",
  "6061": "aluminum-6061-t6", "aluminium": "aluminum-6061-t6", "aluminum": "aluminum-6061-t6",
  "titanium": "titanium-ti6al4v",
  "cfrp": "cfrp-quasi-iso", "carbon fibre": "cfrp-quasi-iso", "carbon fiber": "cfrp-quasi-iso", "carbon": "cfrp-quasi-iso",
  "gfrp": "gfrp-quasi-iso", "fiberglass": "gfrp-quasi-iso", "fibreglass": "gfrp-quasi-iso",
  "rubber": "rubber-natural", "glass": "glass-soda-lime", "pc": "polycarbonate", "polycarbonate": "polycarbonate",
  "foam": "foam-eps-30", "eps": "foam-eps-30", "8620": "steel-8620", "cast iron": "cast-iron-gray-30", "copper": "copper-c11000",
};

export function getMaterial(id) {
  return MATERIALS[id] || null;
}

/**
 * Resolve a material from an id or a plain name. For "stainless" or "steel"
 * the node kind decides. Returns { id, note? } or null.
 */
export function resolveMaterialName(name, { kind } = {}) {
  const key = String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  const direct = (k) => (MATERIALS[k] ? k : ALIASES[k] || null);
  if (direct(key)) return { id: direct(key) };
  // "A2-70 stainless", "grade A325 bolt": a specific grade named in the phrase wins.
  for (const word of key.split(" ")) {
    if (direct(word)) return { id: direct(word) };
  }
  const byLabel = Object.values(MATERIALS).find((m) => m.label.toLowerCase() === key);
  if (byLabel) return { id: byLabel.id };
  const isFastener = kind === "Bolt";
  if (/\bstainless\b/.test(key)) {
    return isFastener
      ? { id: "iso-3506-a2-70", note: 'read "stainless" as ISO 3506 A2-70, the common stainless bolt grade' }
      : { id: "stainless-304", note: 'read "stainless" as 304 stainless' };
  }
  if (/\bsteel\b/.test(key)) {
    return isFastener
      ? { id: "astm-a325", note: 'read "steel" as an ASTM F3125 A325 structural bolt' }
      : { id: "steel-a36", note: 'read "steel" as ASTM A36' };
  }
  return null;
}
