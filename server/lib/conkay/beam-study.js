// server/lib/conkay/beam-study.js
//
// The ConKay workspace's structural study: a parametric I-beam, a material,
// a support case and one point load, turned into a real beam-frame model for
// lib/simulation/fea-solver.js — and the textbook formula for the same case,
// so the UI can say "FEA agrees with the hand calculation" only when it does.
//
// Everything here is deterministic. Nothing is estimated for display: section
// properties come from lib/compute/engineering-compute.js#sectionProperties,
// stiffness and yield from the engineering material library, stresses and
// deflections from the solver. Units: inputs in mm / N, solver in SI.

import { sectionProperties } from "../compute/engineering-compute.js";

export const BEAM_SUPPORTS = ["simply-supported", "cantilever", "fixed"];

const DIM_KEYS = ["length", "height", "flangeWidth", "flangeThickness", "webThickness"];

/** Validate a dims object (mm). Returns { ok, dims } or { ok:false, error }. */
export function cleanBeamDims(raw = {}) {
  const dims = {};
  for (const k of DIM_KEYS) {
    const n = Number(raw?.[k]);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: `${k} must be a positive number (mm)` };
    dims[k] = n;
  }
  if (dims.length > 50_000) return { ok: false, error: "length must be at most 50000 mm" };
  if (2 * dims.flangeThickness >= dims.height) {
    return { ok: false, error: "the two flanges are thicker than the beam is tall" };
  }
  if (dims.webThickness >= dims.flangeWidth) {
    return { ok: false, error: "the web is wider than the flanges" };
  }
  return { ok: true, dims };
}

/**
 * Build the FEA model for one study.
 * @param {{ dims: object, material: { E: number, yield: number }, support?: string,
 *           loadN?: number, segments?: number }} input  E and yield in MPa
 */
export function buildBeamStudy(input = {}) {
  const clean = cleanBeamDims(input.dims);
  if (!clean.ok) return clean;
  const { dims } = clean;
  const mat = input.material;
  if (!mat || !(mat.E > 0) || !(mat.yield > 0)) return { ok: false, error: "material with E and yield required" };
  const support = BEAM_SUPPORTS.includes(input.support) ? input.support : "simply-supported";
  const P = Math.abs(Number(input.loadN));
  if (!Number.isFinite(P) || P <= 0) return { ok: false, error: "loadN must be a positive force (N)" };
  let n = Math.round(Number(input.segments) || 8);
  n = Math.max(2, Math.min(40, n + (n % 2))); // even, so a node sits at midspan

  const m = (mm) => mm / 1000;
  const sec = sectionProperties("i-beam", {
    flangeWidth: m(dims.flangeWidth),
    height: m(dims.height),
    flangeThickness: m(dims.flangeThickness),
    webThickness: m(dims.webThickness),
  });
  const L = m(dims.length);
  const E = mat.E * 1e6; // Pa
  const fy = mat.yield * 1e6; // Pa

  const nodes = Array.from({ length: n + 1 }, (_, i) => ({ id: `N${i}`, x: (L * i) / n, y: 0, z: 0 }));
  const members = Array.from({ length: n }, (_, i) => ({
    id: `M${i + 1}`,
    nodeI: `N${i}`,
    nodeJ: `N${i + 1}`,
    area: sec.area,
    momentI: sec.Ix,
    Iy: sec.Iy,
    elasticModulus: E,
    allowableStress: fy,
    depthIn: m(dims.height), // extreme fibre c = depth / 2
  }));

  // Out-of-plane and torsion are held at every support so the planar case is
  // stable; in-plane rotation is what distinguishes pinned from fixed.
  const pinned = ["x", "y", "z", "rx", "ry"];
  const roller = ["y", "z", "rx", "ry"];
  const fixed = ["x", "y", "z", "rx", "ry", "rz"];
  let supports;
  let loadNode;
  if (support === "cantilever") {
    supports = [{ nodeId: "N0", fixedDOF: fixed }];
    loadNode = `N${n}`;
  } else if (support === "fixed") {
    supports = [{ nodeId: "N0", fixedDOF: fixed }, { nodeId: `N${n}`, fixedDOF: fixed }];
    loadNode = `N${n / 2}`;
  } else {
    supports = [{ nodeId: "N0", fixedDOF: pinned }, { nodeId: `N${n}`, fixedDOF: roller }];
    loadNode = `N${n / 2}`;
  }

  // Textbook result for the same case (Roark / any mechanics text).
  const c = m(dims.height) / 2;
  const Mmax = support === "cantilever" ? P * L : support === "fixed" ? (P * L) / 8 : (P * L) / 4;
  const deflection =
    support === "cantilever" ? (P * L ** 3) / (3 * E * sec.Ix)
      : support === "fixed" ? (P * L ** 3) / (192 * E * sec.Ix)
      : (P * L ** 3) / (48 * E * sec.Ix);

  return {
    ok: true,
    dims,
    support,
    loadN: P,
    loadNode,
    section: { areaMm2: sec.area * 1e6, IxMm4: sec.Ix * 1e12, IyMm4: sec.Iy * 1e12 },
    model: { nodes, members, loads: [{ nodeId: loadNode, Fy: -P }], supports },
    handCheck: {
      maxStressMPa: (Mmax * c) / sec.Ix / 1e6,
      maxDeflectionMm: deflection * 1000,
    },
  };
}

/**
 * Reduce a solver result to the numbers the workspace shows, plus whether
 * the FEA agrees with the hand calculation (within `tolerance`).
 */
export function summarizeBeamStudy(study, fea, material, tolerance = 0.02) {
  const maxStressMPa = Math.max(...fea.stresses.map((s) => s.combinedStress)) / 1e6;
  const maxDeflectionMm = Math.max(...fea.displacements.map((d) => d.magnitude)) * 1000;
  const utilization = fea.summary.maxUtilization;
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
  const stressErr = rel(maxStressMPa, study.handCheck.maxStressMPa);
  const deflErr = rel(maxDeflectionMm, study.handCheck.maxDeflectionMm);
  return {
    maxStressMPa,
    maxDeflectionMm,
    utilization,
    safetyFactor: material.yield / Math.max(maxStressMPa, 1e-9),
    pass: fea.summary.allPass,
    handCheck: {
      ...study.handCheck,
      stressError: stressErr,
      deflectionError: deflErr,
      agrees: stressErr <= tolerance && deflErr <= tolerance,
      tolerance,
    },
    warnings: fea.warnings || [],
  };
}
