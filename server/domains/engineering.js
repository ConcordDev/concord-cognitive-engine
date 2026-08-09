// server/domains/engineering.js
//
// Engineering lens — CAD + simulation domain (Fusion 360 / SimScale shape).
// Pure-compute macros plus a STATE-backed per-user store for parts,
// assemblies, load cases and FEA simulation jobs.
//
// All handlers return { ok: boolean, result?, error? } and never throw.

import { runFEA } from '../lib/simulation/fea-solver.js';
// boltedConnection (AISC allowable-shear) + transformerSizing (ANSI kVA
// ladder) are real, exported functions in engineering-compute.js that no
// registered macro called — genuinely unreachable at the macro layer (see
// docs/lens-specs/engineering-capability-map.md's "Deliberately left
// unsurfaced" section, now closed). Named imports mirror how server.js's
// structuralCheck/electricalCheck combinators already consume this module's
// other named exports (eng.columnBuckling, eng.voltageDrop, …).
import { boltedConnection, transformerSizing, sectionProperties } from '../lib/compute/engineering-compute.js';
// checkThermalGate is the thermal-stress cross-check adapter (Wave E,
// Cross-System Multi-Physics CAD): given the SAME nodes/members/loads/
// supports model shape this file's own `runFEA` action already accepts
// from a caller, it feeds a temperature-swing (ΔT) load alongside the
// mechanical one through the identical, unmodified runFEA solver — see
// server/lib/asset-gen/thermal-gate.js for the real formula (σ_thermal =
// E·cte·ΔT) and the honest mechanical-vs-combined labeling.
import { checkThermalGate, DEFAULT_DELTA_T_C } from '../lib/asset-gen/thermal-gate.js';
// solveCircuit is a genuine textbook nodal-analysis (KCL) DC circuit
// solver (Cross-System Multi-Physics CAD, electrical leg) — a real
// resistor/source network solve, distinct from this domain's existing
// `voltageDrop`/electrical.js's NEC ampacity+sizing tables, neither of
// which solves a multi-node network. See server/lib/simulation/
// circuit-solver.js for the full method + the honest grounded-voltage-
// source scope limitation (plain nodal analysis, not full MNA).
import { solveCircuit } from '../lib/simulation/circuit-solver.js';
// checkAeroGate is the aero-on-structure cross-check adapter (Cross-System
// Multi-Physics CAD, aero leg) — sibling to checkThermalGate above: given
// the SAME nodes/members/loads/supports model shape, it feeds a
// quadratic free-stream drag load (q=0.5·ρ·v², F=q·Cd·A — the same
// formula already used by physics-compute.js's dragForce/windLoad) per
// member through the identical, unmodified runFEA solver. See
// server/lib/asset-gen/aero-gate.js for the full honest-scope note (a
// deliberate uniform-free-stream approximation — no wake/turbulence/
// member-interference modeled) and the never-blended mechanical-vs-
// combined labeling.
import { checkAeroGate } from '../lib/asset-gen/aero-gate.js';
// checkFsiGate is Wave W1-B's non-Newtonian fluid-structure interaction
// gate — a SIBLING to checkThermalGate/checkAeroGate above (same
// {nodes,members,loads,supports} beam-frame model shape, same unchanged
// runFEA), not an extension of either: it is two-way (the wall's own
// deflection changes the channel gap the flow sees, solved as a Picard
// fixed-point iteration), where thermal/aero are one-way overlays. See
// server/lib/asset-gen/fsi-gate.js for the full honest-scope note (a
// screening-level "local pressure-gradient intensity as wall-load proxy"
// approximation, laminar-only, and four genuinely-reachable honest
// failure states: did_not_converge / coupling_diverged / gap_collapsed /
// non_laminar_regime_unsupported).
import { checkFsiGate } from '../lib/asset-gen/fsi-gate.js';
import { powerLawPipeFlow, carreauPipeFlow, generalisedReynolds, HONEST_BOUNDARY } from '../lib/simulation/non-newtonian-flow.js';
// runMultiPhysicsBundle is the closing leg of Cross-System Multi-Physics
// CAD — a COMPOSITION layer over the three legs above, not a fourth
// physics engine: it lets a caller request thermalStressCheck's and/or
// aeroLoadCheck's checks against ONE beam-frame model in a single call
// (plus, optionally, an entirely independent circuitSolve request), and
// NEVER collapses different physical domains into one fabricated
// "combined" score. See server/lib/asset-gen/multi-physics-bundle.js for
// the full design-decision writeup (why electrical is excluded from the
// structural bundle, and the genuine opt-in simultaneous thermal+aero
// combined-loads solve).
import { runMultiPhysicsBundle } from '../lib/asset-gen/multi-physics-bundle.js';

// ── Material library (mechanical properties — SI + imperial) ───────────────
// E in MPa, yield/ultimate in MPa, density in kg/m³, CTE in 1e-6/K.
const MATERIAL_LIBRARY = {
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
};

// ── Parametric primitives — geometry + section properties ──────────────────
// Returns volume (m³), mass (kg), surface area, and section props where
// applicable. Cross-section moment of inertia for beam-shaped primitives.
function computePrimitive(kind, p, densityKgM3) {
  const d = densityKgM3 || 7850;
  const round = (v) => Math.round(v * 1e9) / 1e9;
  let volume = 0, surfaceArea = 0, bbox = [0, 0, 0];
  // Section (area/Ix/Iy) math is delegated to the shared compute primitive
  // (lib/compute/engineering-compute.js#sectionProperties) so it's reusable
  // outside this file (e.g. server/domains/hvac.js's hangerSpanCheck, which
  // needs a real duct wall's hollow-section properties) — same formulas,
  // this is a pure delegation, not a behavior change.
  let section = sectionProperties(kind, p);
  switch (kind) {
    case 'box': {
      const [w, h, l] = [p.width || 0.1, p.height || 0.1, p.length || 0.1];
      volume = w * h * l;
      surfaceArea = 2 * (w * h + h * l + w * l);
      bbox = [w, h, l];
      break;
    }
    case 'cylinder': {
      const [r, len] = [p.radius || 0.05, p.length || 0.2];
      volume = Math.PI * r * r * len;
      surfaceArea = 2 * Math.PI * r * (r + len);
      bbox = [2 * r, 2 * r, len];
      break;
    }
    case 'tube': {
      const ro = p.radius || 0.05;
      const ri = Math.min(p.innerRadius || 0.04, ro - 1e-6);
      const len = p.length || 0.2;
      volume = Math.PI * (ro * ro - ri * ri) * len;
      surfaceArea = 2 * Math.PI * (ro + ri) * len + 2 * Math.PI * (ro * ro - ri * ri);
      bbox = [2 * ro, 2 * ro, len];
      break;
    }
    case 'rect-tube': {
      // Hollow rectangular tube — a rectangular duct's real wall geometry.
      // Outer width/height, wall thickness. Mesh preview (partMesh, below)
      // renders the outer shell only, matching the same simplification the
      // 'tube' case already uses for round ducts.
      const w = p.width || 0.1, h = p.height || 0.1, t = p.wallThickness ?? 0.001, len = p.length || 0.2;
      const wi = Math.max(0, w - 2 * t), hi = Math.max(0, h - 2 * t);
      volume = (w * h - wi * hi) * len;
      surfaceArea = 2 * (w * h + h * len + w * len); // outer-shell surface (matches the mesh's outer-only render)
      bbox = [w, h, len];
      break;
    }
    case 'sphere': {
      const r = p.radius || 0.05;
      volume = (4 / 3) * Math.PI * r ** 3;
      surfaceArea = 4 * Math.PI * r * r;
      bbox = [2 * r, 2 * r, 2 * r];
      break;
    }
    case 'i-beam': {
      // flange width bf, total depth d, flange/web thickness tf/tw, length L
      const bf = p.flangeWidth || 0.1;
      const dh = p.height || 0.2;
      const tf = p.flangeThickness || 0.012;
      const tw = p.webThickness || 0.008;
      const len = p.length || 1.0;
      const area = 2 * bf * tf + (dh - 2 * tf) * tw;
      volume = area * len;
      surfaceArea = (2 * bf + 4 * tf + 2 * (dh - 2 * tf)) * len + 2 * area;
      bbox = [bf, dh, len];
      break;
    }
    default: {
      const [w, h, l] = [p.width || 0.1, p.height || 0.1, p.length || 0.1];
      volume = w * h * l;
      surfaceArea = 2 * (w * h + h * l + w * l);
      bbox = [w, h, l];
    }
  }
  return {
    kind,
    volume: round(volume),
    mass: round(volume * d),
    surfaceArea: round(surfaceArea),
    boundingBox: { x: round(bbox[0]), y: round(bbox[1]), z: round(bbox[2]) },
    section: section
      ? {
          area: round(section.area),
          Ix: round(section.Ix),
          Iy: round(section.Iy),
        }
      : null,
  };
}

// ── STATE-backed per-user store ────────────────────────────────────────────
function engState() {
  const STATE = globalThis._concordSTATE;
  if (!STATE) return null;
  if (!STATE.engineeringLens) STATE.engineeringLens = {};
  const s = STATE.engineeringLens;
  if (!(s.parts instanceof Map)) s.parts = new Map(); // userId -> Array<part>
  if (!(s.assemblies instanceof Map)) s.assemblies = new Map(); // userId -> Array<asm>
  if (!(s.loadCases instanceof Map)) s.loadCases = new Map(); // userId -> Array<lc>
  if (!(s.jobs instanceof Map)) s.jobs = new Map(); // userId -> Array<job>
  return s;
}
function persist() {
  if (typeof globalThis._concordSaveStateDebounced === 'function') {
    try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
  }
}
const egActor = (ctx) => ctx?.actor?.userId || ctx?.userId || 'anon';
const egId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const egList = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
const egClean = (v, max = 120) => String(v == null ? '' : v).trim().slice(0, max);

// Low/moderate/high/overstressed banding for a utilization ratio — same
// thresholds (0.4 / 0.75 / 1.0) the runFEA action's own inline `contour`
// computation uses below, factored out here (read-only, no behavior change
// to runFEA) so the feaScene action (R5/E23 — Godot 3D FEA visualization)
// can reuse the identical banding without duplicating or drifting from it.
function utilizationBand(u) {
  if (u > 1) return 'overstressed';
  if (u > 0.75) return 'high';
  if (u > 0.4) return 'moderate';
  return 'low';
}

export default function registerEngineeringActions(registerLensAction) {
  // ─── toleranceAnalysis (existing — kept) ─────────────────────────────────
  registerLensAction('engineering', 'toleranceAnalysis', (ctx, artifact, params) => {
    try {
      const parts = artifact?.data?.parts || params?.parts || [];
      if (parts.length === 0) {
        return { ok: true, result: { message: 'Add parts with nominal dimensions and tolerances.' } };
      }
      const r4 = (v) => Math.round(v * 10000) / 10000;
      const analyzed = parts.map((p) => {
        const nominal = parseFloat(p.nominal) || 0;
        const tolerance = parseFloat(p.tolerance) || 0.01;
        return {
          part: p.name, nominal, tolerance,
          min: r4(nominal - tolerance), max: r4(nominal + tolerance),
          toleranceClass: tolerance <= 0.001 ? 'precision' : tolerance <= 0.01 ? 'standard' : 'loose',
        };
      });
      const stackNominal = analyzed.reduce((s, p) => s + p.nominal, 0);
      const stackTolerance = analyzed.reduce((s, p) => s + p.tolerance, 0);
      const rss = Math.sqrt(analyzed.reduce((s, p) => s + p.tolerance ** 2, 0));
      return {
        ok: true,
        result: {
          parts: analyzed,
          stackUp: {
            nominal: r4(stackNominal), worstCaseTolerance: r4(stackTolerance),
            rssTolerance: r4(rss), worstCaseMin: r4(stackNominal - stackTolerance),
            worstCaseMax: r4(stackNominal + stackTolerance),
          },
          method: 'Worst-case + RSS statistical',
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── toleranceChain — directional stack-up visual chain ──────────────────
  // Each link has a direction (+1 / -1) so the chain models a real gap/fit.
  registerLensAction('engineering', 'toleranceChain', (ctx, artifact, params) => {
    try {
      const links = artifact?.data?.links || params?.links || [];
      if (links.length === 0) {
        return { ok: true, result: { message: 'Add chain links: { name, nominal, tolerance, direction }.' } };
      }
      // Normalize away -0 so the component never renders "-0.000", and round.
      const r4 = (v) => (Math.round(v * 10000) / 10000) + 0;
      // Coerce a numeric to a finite value or fall back — non-finite (NaN /
      // Infinity) poisoned input must never reach the computed output.
      const finiteOr = (v, fb) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : fb;
      };
      let cumNominal = 0;
      let cumWorst = 0;
      let sumSq = 0;
      const chain = links.map((l, i) => {
        const dir = finiteOr(l.direction, 1) >= 0 ? 1 : -1;
        const nominal = finiteOr(l.nominal, 0) * dir;
        const tol = Math.abs(finiteOr(l.tolerance, 0.01));
        cumNominal += nominal;
        cumWorst += tol;
        sumSq += tol * tol;
        return {
          index: i,
          name: l.name || `Link ${i + 1}`,
          direction: dir > 0 ? '+' : '-',
          nominal: r4(nominal),
          tolerance: r4(tol),
          cumulativeNominal: r4(cumNominal),
          cumulativeWorstCase: r4(cumWorst),
        };
      });
      const rss = Math.sqrt(sumSq);
      // The "gap" is the closing dimension of the chain.
      const targetGap = parseFloat(params?.targetGap ?? artifact?.data?.targetGap);
      let fitVerdict = null;
      if (Number.isFinite(targetGap)) {
        // Use rounded bounds so the verdict matches the displayed envelope and
        // doesn't flicker on floating-point dust when minGap is exactly 0.
        const minGap = r4(cumNominal - cumWorst);
        const maxGap = r4(cumNominal + cumWorst);
        fitVerdict = {
          targetGap,
          worstCaseFits: targetGap >= minGap && targetGap <= maxGap,
          interferenceRisk: minGap < 0,
        };
      }
      return {
        ok: true,
        result: {
          chain,
          closingDimension: {
            nominal: r4(cumNominal),
            worstCaseTolerance: r4(cumWorst),
            rssTolerance: r4(rss),
            worstCaseMin: r4(cumNominal - cumWorst),
            worstCaseMax: r4(cumNominal + cumWorst),
            rssMin: r4(cumNominal - rss),
            rssMax: r4(cumNominal + rss),
          },
          fitVerdict,
          method: 'Directional 1-D tolerance chain (worst-case + RSS)',
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── stressAnalysis (existing — kept) ────────────────────────────────────
  registerLensAction('engineering', 'stressAnalysis', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const force = parseFloat(data.forceNewtons) || 0;
      const area = parseFloat(data.crossSectionMm2) || 1;
      const yieldStrength = parseFloat(data.yieldStrengthMPa) || 250;
      const stress = force / area;
      const safetyFactor = stress > 0 ? yieldStrength / stress : Infinity;
      return {
        ok: true,
        result: {
          appliedForce: `${force} N`,
          crossSection: `${area} mm²`,
          appliedStress: `${Math.round(stress * 100) / 100} MPa`,
          yieldStrength: `${yieldStrength} MPa`,
          safetyFactor: Math.round(safetyFactor * 100) / 100,
          status:
            safetyFactor >= 3 ? 'safe'
              : safetyFactor >= 1.5 ? 'acceptable'
              : safetyFactor >= 1 ? 'marginal'
              : 'FAILURE — stress exceeds yield',
          recommendation:
            safetyFactor < 2
              ? 'Increase cross-section or use stronger material'
              : 'Design is within safe limits',
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── unitConvert (existing — kept) ───────────────────────────────────────
  registerLensAction('engineering', 'unitConvert', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const value = parseFloat(data.value) || 0;
      const from = (data.from || 'mm').toLowerCase();
      const to = (data.to || 'in').toLowerCase();
      const conversions = {
        'mm-in': (v) => v / 25.4, 'in-mm': (v) => v * 25.4,
        'm-ft': (v) => v * 3.28084, 'ft-m': (v) => v / 3.28084,
        'kg-lb': (v) => v * 2.20462, 'lb-kg': (v) => v / 2.20462,
        'n-lbf': (v) => v * 0.22481, 'lbf-n': (v) => v / 0.22481,
        'mpa-psi': (v) => v * 145.038, 'psi-mpa': (v) => v / 145.038,
        'c-f': (v) => (v * 9) / 5 + 32, 'f-c': (v) => ((v - 32) * 5) / 9,
        'nm-ftlb': (v) => v * 0.7376, 'ftlb-nm': (v) => v / 0.7376,
        'l-gal': (v) => v * 0.264172, 'gal-l': (v) => v / 0.264172,
      };
      const key = `${from}-${to}`;
      const converter = conversions[key];
      if (!converter) {
        return {
          ok: true,
          result: {
            error: `Conversion ${from} → ${to} not supported`,
            supported: Object.keys(conversions).map((k) => k.replace('-', ' → ')),
          },
        };
      }
      const result = converter(value);
      return {
        ok: true,
        result: {
          input: `${value} ${from}`,
          output: `${Math.round(result * 10000) / 10000} ${to}`,
          conversion: `${from} → ${to}`,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── materialLibrary — mechanical property database ──────────────────────
  registerLensAction('engineering', 'materialLibrary', (ctx, artifact, params) => {
    try {
      const id = params?.id || artifact?.data?.id;
      if (id) {
        const m = MATERIAL_LIBRARY[id];
        if (!m) return { ok: false, error: `Unknown material: ${id}` };
        return { ok: true, result: { id, ...m } };
      }
      const category = params?.category;
      const materials = Object.entries(MATERIAL_LIBRARY)
        .filter(([, m]) => !category || m.category === category)
        .map(([k, m]) => ({ id: k, ...m }));
      const categories = [...new Set(Object.values(MATERIAL_LIBRARY).map((m) => m.category))];
      return { ok: true, result: { materials, categories, count: materials.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── parametricSolid — geometry/section props from parameters ────────────
  registerLensAction('engineering', 'parametricSolid', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const kind = egClean(data.kind || 'box', 24);
      const matId = data.material;
      const mat = matId ? MATERIAL_LIBRARY[matId] : null;
      const density = mat ? mat.density : parseFloat(data.density) || 7850;
      const geom = computePrimitive(kind, data.params || data, density);
      let structural = null;
      // If a beam-shaped primitive + span + load given, give a quick check.
      if (geom.section && data.span && data.pointLoad) {
        const span = parseFloat(data.span);
        const P = parseFloat(data.pointLoad);
        const E = mat ? mat.E * 1e6 : 200e9; // Pa
        const I = geom.section.Ix; // m^4
        const c = geom.boundingBox.y / 2;
        const maxMoment = (P * span) / 4; // simply supported, center load
        const maxStress = (maxMoment * c) / I / 1e6; // MPa
        const maxDeflection = (P * span ** 3) / (48 * E * I); // m
        const sf = mat ? mat.yield / Math.max(maxStress, 1e-9) : null;
        structural = {
          maxBendingMomentNm: Math.round(maxMoment * 100) / 100,
          maxBendingStressMPa: Math.round(maxStress * 1000) / 1000,
          maxDeflectionMm: Math.round(maxDeflection * 1e6) / 1000,
          safetyFactor: sf == null ? null : Math.round(sf * 100) / 100,
          loadCase: 'Simply supported beam, central point load',
        };
      }
      return {
        ok: true,
        result: {
          ...geom,
          material: mat ? { id: matId, label: mat.label, density: mat.density } : null,
          structural,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── partMesh — triangle mesh for the 3-D parametric geometry viewer ─────
  // Returns a flat positions array + faces so a Three.js BufferGeometry can be
  // built client-side. Deterministic — same params always yield the same mesh.
  registerLensAction('engineering', 'partMesh', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const kind = egClean(data.kind || 'box', 24);
      // Sanitize geometry params to FINITE positive numbers — a poisoned
      // dimension (NaN / Infinity) must never reach a Three.js BufferGeometry
      // vertex, where it would corrupt the mesh / crash the renderer.
      const rawP = data.params || data;
      const p = {};
      for (const [k, v] of Object.entries(rawP || {})) {
        const n = parseFloat(v);
        p[k] = Number.isFinite(n) && n > 0 ? n : undefined;
      }
      const positions = []; // flat [x,y,z, x,y,z, ...]
      const indices = []; // triangle vertex indices
      const pushQuad = (a, b, c, d) => {
        const base = positions.length / 3;
        for (const v of [a, b, c, d]) positions.push(v[0], v[1], v[2]);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      let bbox = [0, 0, 0];
      if (kind === 'cylinder' || kind === 'tube') {
        const ro = p.radius || 0.05;
        const len = p.length || 0.2;
        const seg = 28;
        const h = len / 2;
        for (let i = 0; i < seg; i++) {
          const a0 = (i / seg) * Math.PI * 2;
          const a1 = ((i + 1) / seg) * Math.PI * 2;
          pushQuad(
            [Math.cos(a0) * ro, -h, Math.sin(a0) * ro],
            [Math.cos(a1) * ro, -h, Math.sin(a1) * ro],
            [Math.cos(a1) * ro, h, Math.sin(a1) * ro],
            [Math.cos(a0) * ro, h, Math.sin(a0) * ro],
          );
        }
        bbox = [2 * ro, len, 2 * ro];
      } else if (kind === 'sphere') {
        const r = p.radius || 0.05;
        const seg = 18;
        for (let i = 0; i < seg; i++) {
          for (let j = 0; j < seg; j++) {
            const t0 = (i / seg) * Math.PI;
            const t1 = ((i + 1) / seg) * Math.PI;
            const f0 = (j / seg) * Math.PI * 2;
            const f1 = ((j + 1) / seg) * Math.PI * 2;
            const sp = (t, f) => [
              r * Math.sin(t) * Math.cos(f),
              r * Math.cos(t),
              r * Math.sin(t) * Math.sin(f),
            ];
            pushQuad(sp(t0, f0), sp(t1, f0), sp(t1, f1), sp(t0, f1));
          }
        }
        bbox = [2 * r, 2 * r, 2 * r];
      } else if (kind === 'i-beam') {
        const bf = p.flangeWidth || 0.1;
        const dh = p.height || 0.2;
        const tf = p.flangeThickness || 0.012;
        const tw = p.webThickness || 0.008;
        const len = p.length || 1.0;
        const L = len / 2;
        // Approximate an I-beam as a stretched box for the preview silhouette.
        const aabb = (w, hh, dd) => {
          const x = w / 2, y = hh / 2, z = dd / 2;
          const v = [
            [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
            [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
          ];
          pushQuad(v[0], v[1], v[2], v[3]);
          pushQuad(v[5], v[4], v[7], v[6]);
          pushQuad(v[4], v[0], v[3], v[7]);
          pushQuad(v[1], v[5], v[6], v[2]);
          pushQuad(v[3], v[2], v[6], v[7]);
          pushQuad(v[4], v[5], v[1], v[0]);
        };
        // top flange, web, bottom flange, all length-L
        const flange = (yc) => {
          const verts = [
            [-bf / 2, yc - tf / 2, -L], [bf / 2, yc - tf / 2, -L],
            [bf / 2, yc + tf / 2, -L], [-bf / 2, yc + tf / 2, -L],
            [-bf / 2, yc - tf / 2, L], [bf / 2, yc - tf / 2, L],
            [bf / 2, yc + tf / 2, L], [-bf / 2, yc + tf / 2, L],
          ];
          pushQuad(verts[0], verts[1], verts[2], verts[3]);
          pushQuad(verts[5], verts[4], verts[7], verts[6]);
          pushQuad(verts[4], verts[0], verts[3], verts[7]);
          pushQuad(verts[1], verts[5], verts[6], verts[2]);
          pushQuad(verts[3], verts[2], verts[6], verts[7]);
          pushQuad(verts[4], verts[5], verts[1], verts[0]);
        };
        flange(dh / 2 - tf / 2);
        flange(-dh / 2 + tf / 2);
        // web as a thin box
        const wy = (dh - 2 * tf) / 2;
        const webV = [
          [-tw / 2, -wy, -L], [tw / 2, -wy, -L], [tw / 2, wy, -L], [-tw / 2, wy, -L],
          [-tw / 2, -wy, L], [tw / 2, -wy, L], [tw / 2, wy, L], [-tw / 2, wy, L],
        ];
        pushQuad(webV[0], webV[1], webV[2], webV[3]);
        pushQuad(webV[5], webV[4], webV[7], webV[6]);
        pushQuad(webV[4], webV[0], webV[3], webV[7]);
        pushQuad(webV[1], webV[5], webV[6], webV[2]);
        void aabb;
        bbox = [bf, dh, len];
      } else {
        // box (default) — also covers 'rect-tube' (outer-shell mesh only,
        // same simplification the cylinder/tube case above uses: the visual
        // preview renders the outer surface, wall thickness only affects
        // the section/mass math above, not the mesh).
        const w = p.width || 0.1, h = p.height || 0.1, l = p.length || 0.1;
        const x = w / 2, y = h / 2, z = l / 2;
        const v = [
          [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
          [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
        ];
        pushQuad(v[0], v[1], v[2], v[3]);
        pushQuad(v[5], v[4], v[7], v[6]);
        pushQuad(v[4], v[0], v[3], v[7]);
        pushQuad(v[1], v[5], v[6], v[2]);
        pushQuad(v[3], v[2], v[6], v[7]);
        pushQuad(v[4], v[5], v[1], v[0]);
        bbox = [w, h, l];
      }
      const round = (v) => Math.round(v * 1e6) / 1e6;
      return {
        ok: true,
        result: {
          kind,
          positions: positions.map(round),
          indices,
          vertexCount: positions.length / 3,
          triangleCount: indices.length / 3,
          boundingBox: { x: round(bbox[0]), y: round(bbox[1]), z: round(bbox[2]) },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── saveLoadCase / listLoadCases — load-case definition store ───────────
  registerLensAction('engineering', 'saveLoadCase', (ctx, artifact, params) => {
    try {
      const s = engState();
      if (!s) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const userId = egActor(ctx);
      const cases = egList(s.loadCases, userId);
      const lc = {
        id: data.id && cases.find((c) => c.id === data.id) ? data.id : egId('lc'),
        name: egClean(data.name || 'Load Case', 80),
        loads: Array.isArray(data.loads) ? data.loads : [],
        supports: Array.isArray(data.supports) ? data.supports : [],
        gravity: !!data.gravity,
        note: egClean(data.note || '', 240),
        updatedAt: new Date().toISOString(),
      };
      const idx = cases.findIndex((c) => c.id === lc.id);
      if (idx >= 0) cases[idx] = { ...cases[idx], ...lc };
      else cases.push({ ...lc, createdAt: lc.updatedAt });
      persist();
      return { ok: true, result: { loadCase: lc, count: cases.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction('engineering', 'listLoadCases', (ctx) => {
    try {
      const s = engState();
      if (!s) return { ok: true, result: { loadCases: [] } };
      const cases = egList(s.loadCases, egActor(ctx));
      return { ok: true, result: { loadCases: cases, count: cases.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction('engineering', 'deleteLoadCase', (ctx, artifact, params) => {
    try {
      const s = engState();
      if (!s) return { ok: false, error: 'state unavailable' };
      const id = params?.id || artifact?.data?.id;
      const cases = egList(s.loadCases, egActor(ctx));
      const next = cases.filter((c) => c.id !== id);
      s.loadCases.set(egActor(ctx), next);
      persist();
      return { ok: true, result: { deleted: cases.length - next.length, count: next.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── meshGenerate — beam-frame discretisation ────────────────────────────
  // Subdivides each member into N sub-elements so a deflection curve can be
  // plotted. Returns the refined node/element list ready to feed runFEA.
  registerLensAction('engineering', 'meshGenerate', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const model = data.model || data;
      const nodes = Array.isArray(model.nodes) ? model.nodes : [];
      const members = Array.isArray(model.members) ? model.members : [];
      if (nodes.length === 0 || members.length === 0) {
        return { ok: false, error: 'model must have nodes and members' };
      }
      const divisions = Math.max(1, Math.min(parseInt(params?.divisions ?? data.divisions) || 4, 20));
      const meshNodes = nodes.map((n) => ({ id: String(n.id), x: n.x, y: n.y, z: n.z || 0 }));
      const meshMembers = [];
      const byId = new Map(meshNodes.map((n) => [n.id, n]));
      let mi = 0;
      for (const m of members) {
        const ni = byId.get(String(m.nodeI));
        const nj = byId.get(String(m.nodeJ));
        if (!ni || !nj) continue;
        if (divisions === 1) {
          meshMembers.push({ ...m, id: `${m.id}` });
          continue;
        }
        let prev = ni.id;
        for (let k = 1; k <= divisions; k++) {
          const t = k / divisions;
          let nodeId;
          if (k === divisions) {
            nodeId = nj.id;
          } else {
            nodeId = `${m.id}_s${k}`;
            meshNodes.push({
              id: nodeId,
              x: ni.x + (nj.x - ni.x) * t,
              y: ni.y + (nj.y - ni.y) * t,
              z: (ni.z || 0) + ((nj.z || 0) - (ni.z || 0)) * t,
            });
          }
          meshMembers.push({
            id: `${m.id}_e${k}`,
            parent: m.id,
            nodeI: prev,
            nodeJ: nodeId,
            area: m.area,
            momentI: m.momentI,
            elasticModulus: m.elasticModulus,
            allowableStress: m.allowableStress,
            material: m.material,
          });
          mi++;
          prev = nodeId;
        }
      }
      const totalLen = members.reduce((s, m) => {
        const ni = byId.get(String(m.nodeI));
        const nj = byId.get(String(m.nodeJ));
        if (!ni || !nj) return s;
        return s + Math.hypot(nj.x - ni.x, nj.y - ni.y, (nj.z || 0) - (ni.z || 0));
      }, 0);
      return {
        ok: true,
        result: {
          mesh: { nodes: meshNodes, members: meshMembers },
          stats: {
            divisions,
            originalNodes: nodes.length,
            originalMembers: members.length,
            meshNodes: meshNodes.length,
            meshElements: meshMembers.length || mi,
            avgElementLength:
              meshMembers.length > 0
                ? Math.round((totalLen / meshMembers.length) * 1000) / 1000
                : 0,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── runFEA — full mesh+solve, persists a sim job ────────────────────────
  registerLensAction('engineering', 'runFEA', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const model = data.model || data;
      const nodes = Array.isArray(model.nodes) ? model.nodes : [];
      const members = Array.isArray(model.members) ? model.members : [];
      if (nodes.length === 0 || members.length === 0) {
        return { ok: false, error: 'model must have at least one node and one member' };
      }
      // Optional gravity body-load — distribute member self-weight to nodes.
      const loads = Array.isArray(model.loads) ? [...model.loads] : [];
      const supports = Array.isArray(model.supports) ? model.supports : [];
      const t0 = Date.now();
      // Honest ConKay HUD beats (K1): forward the real solve phases
      // (assemble → solve → postprocess) to the caller's macro:stage stream
      // when this ran via /api/lens/run with a run id. No-op otherwise.
      const fea = runFEA({ nodes, members, loads, supports, onStage: ctx?.emitMacroStage });
      const elapsedMs = Date.now() - t0;
      if (!fea.ok) return { ok: false, error: fea.error || 'FEA solve failed' };

      // Colour-mapped contour bands for the result overlay.
      const maxUtil = fea.summary.maxUtilization || 1e-9;
      const contour = (fea.utilization || []).map((u) => {
        const ratio = u.utilization / Math.max(maxUtil, 1e-9);
        const band =
          u.utilization > 1 ? 'overstressed'
            : u.utilization > 0.75 ? 'high'
            : u.utilization > 0.4 ? 'moderate'
            : 'low';
        return { id: u.id, utilization: u.utilization, ratio, band, pass: u.pass };
      });

      // Persist as a sim job for history.
      const s = engState();
      let jobId = null;
      if (s) {
        const jobs = egList(s.jobs, egActor(ctx));
        jobId = egId('sim');
        jobs.unshift({
          id: jobId,
          name: egClean(data.name || 'FEA run', 80),
          type: 'fea-frame',
          status: 'completed',
          elapsedMs,
          summary: fea.summary,
          createdAt: new Date().toISOString(),
        });
        if (jobs.length > 50) jobs.length = 50;
        persist();
      }
      return {
        ok: true,
        result: {
          jobId,
          elapsedMs,
          displacements: fea.displacements,
          memberForces: fea.memberForces,
          stresses: fea.stresses,
          utilization: fea.utilization,
          reactions: fea.reactions,
          contour,
          summary: fea.summary,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── thermalStressCheck — ΔT-driven thermal stress, combined with the
  // existing mechanical FEA (Wave E, Cross-System Multi-Physics CAD) ───────
  // Sibling to `runFEA` above: accepts the identical nodes/members/loads/
  // supports model shape, plus a temperature swing (`deltaT`, °C) and a
  // MATERIAL_LIBRARY key (`material`). Returns BOTH the closed-form
  // fully-restrained thermal stress per member (a real textbook formula,
  // hand-verifiable, no solver call) and the REAL combined-vs-mechanical-
  // only utilization from two actual runFEA solves — never blended into a
  // single fabricated number. See server/lib/asset-gen/thermal-gate.js for
  // the full honesty/scope caveats (a statically-determinate free-ended
  // model can genuinely carry less thermal stress than the fully-restrained
  // bound — `combinedUtilization` is a conservative worst-case screening
  // check, not a certified indeterminate thermal-FE answer).
  registerLensAction('engineering', 'thermalStressCheck', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const model = data.model || data;
      const nodes = Array.isArray(model.nodes) ? model.nodes : [];
      const members = Array.isArray(model.members) ? model.members : [];
      if (nodes.length === 0 || members.length === 0) {
        return { ok: false, error: 'model must have at least one node and one member' };
      }
      const loads = Array.isArray(model.loads) ? model.loads : [];
      const supports = Array.isArray(model.supports) ? model.supports : [];
      const rawDeltaT = params?.deltaT ?? data.deltaT;
      const deltaT = rawDeltaT === undefined || rawDeltaT === null || rawDeltaT === ''
        ? DEFAULT_DELTA_T_C
        : Number(rawDeltaT);
      const material = params?.material ?? data.material ?? 'steel-a36';

      const check = checkThermalGate({ nodes, members, loads, supports }, { deltaT, material });
      // checkThermalGate never fabricates a pass: a hard precondition
      // failure (bad model, unknown material, non-finite ΔT, missing
      // supports, or a solver error) always carries `reason` and no
      // numeric utilization — surface that as an honest macro error
      // rather than wrapping it as a successful `result`.
      if (check.reason) {
        return { ok: false, error: check.reason, ...(check.error ? { detail: check.error } : {}) };
      }
      return { ok: true, result: check };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── circuitSolve — DC nodal-analysis circuit solver (Wave E, Cross-
  // System Multi-Physics CAD, electrical leg) ──────────────────────────────
  // Sibling to `thermalStressCheck` above: a genuine textbook KCL nodal
  // solve (see server/lib/simulation/circuit-solver.js for the full method)
  // over a caller-supplied resistor/voltage-source/current-source network.
  // Never fabricates a result — a singular matrix (floating sub-network,
  // no ground reference), a disconnected node, an unsupported floating
  // voltage source, or any malformed input surfaces as an honest
  // `ok:false, error` with a real reason, not a numeric guess.
  registerLensAction('engineering', 'circuitSolve', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const model = data.model || data;
      const nodes = Array.isArray(model.nodes) ? model.nodes : [];
      const elements = Array.isArray(model.elements) ? model.elements : [];
      const groundNodeId = params?.groundNodeId ?? data.groundNodeId ?? model.groundNodeId;

      const solved = solveCircuit({ nodes, elements, groundNodeId });
      if (!solved.ok) {
        return { ok: false, error: solved.reason, ...(solved.nodeId ? { nodeId: solved.nodeId } : {}) };
      }
      return { ok: true, result: solved };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── aeroLoadCheck — quadratic free-stream drag load, combined with the
  // existing mechanical FEA (Cross-System Multi-Physics CAD, aero leg) ─────
  // Sibling to `thermalStressCheck` above: accepts the identical
  // nodes/members/loads/supports model shape, plus a flow velocity
  // (`velocity`, m/s) and direction (`direction`, a radian angle or
  // {x,y,z} vector). Returns BOTH the dynamic pressure + per-member drag
  // force (real formula, hand-verifiable, no solver call) and the REAL
  // combined-vs-mechanical-only utilization from two actual runFEA
  // solves — never blended into a single fabricated number. See
  // server/lib/asset-gen/aero-gate.js for the full honesty/scope caveats
  // (a deliberate uniform-free-stream approximation with no wake,
  // turbulence, or member-to-member interference — a screening check,
  // not a certified CFD result).
  registerLensAction('engineering', 'aeroLoadCheck', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const model = data.model || data;
      const nodes = Array.isArray(model.nodes) ? model.nodes : [];
      const members = Array.isArray(model.members) ? model.members : [];
      if (nodes.length === 0 || members.length === 0) {
        return { ok: false, error: 'model must have at least one node and one member' };
      }
      const loads = Array.isArray(model.loads) ? model.loads : [];
      const supports = Array.isArray(model.supports) ? model.supports : [];
      const velocity = params?.velocity ?? data.velocity;
      const direction = params?.direction ?? data.direction;
      const airDensity = params?.airDensity ?? data.airDensity;
      const defaultCd = params?.defaultCd ?? data.defaultCd;
      const defaultArea = params?.defaultArea ?? data.defaultArea;

      const check = checkAeroGate(
        { nodes, members, loads, supports },
        {
          velocity: velocity === undefined || velocity === null || velocity === '' ? undefined : Number(velocity),
          ...(direction !== undefined && direction !== null ? { direction } : {}),
          ...(airDensity !== undefined && airDensity !== null && airDensity !== '' ? { airDensity: Number(airDensity) } : {}),
          ...(defaultCd !== undefined && defaultCd !== null && defaultCd !== '' ? { defaultCd: Number(defaultCd) } : {}),
          ...(defaultArea !== undefined && defaultArea !== null && defaultArea !== '' ? { defaultArea: Number(defaultArea) } : {}),
        }
      );
      // checkAeroGate never fabricates a pass: a hard precondition
      // failure (bad model, invalid velocity/direction/air density,
      // missing supports, missing per-member aero geometry, or a solver
      // error) always carries `reason` and no numeric utilization —
      // surface that as an honest macro error rather than wrapping it as
      // a successful `result`.
      if (check.reason) {
        return { ok: false, error: check.reason, ...(check.error ? { detail: check.error } : {}), ...(check.memberIds ? { memberIds: check.memberIds } : {}) };
      }
      return { ok: true, result: check };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── fsiCheck — non-Newtonian fluid-structure interaction gate (Wave
  // W1-B) ───────────────────────────────────────────────────────────────
  // A wall beam model (the SAME nodes/members/loads/supports shape this
  // file's own runFEA/thermalStressCheck/aeroLoadCheck accept — but,
  // unlike those, every member MUST lie along global X; see
  // fsi-gate.js's orientation-guard hazard note) plus a driving pressure
  // drop and a non-Newtonian fluid description. Iterates a real Picard
  // fixed-point coupling (flow on the current gap → wall load → real
  // runFEA deflection → gap update) rather than a one-shot overlay.
  // NEVER fabricates a pass: `did_not_converge`, `coupling_diverged`,
  // `gap_collapsed`, and `non_laminar_regime_unsupported` are all real,
  // reachable outcomes surfaced as honest macro errors, never silently
  // downgraded to a fabricated success.
  registerLensAction('engineering', 'fsiCheck', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const model = data.model || data;
      const nodes = Array.isArray(model.nodes) ? model.nodes : [];
      const members = Array.isArray(model.members) ? model.members : [];
      if (nodes.length === 0 || members.length === 0) {
        return { ok: false, error: 'model must have at least one node and one member' };
      }
      const loads = Array.isArray(model.loads) ? model.loads : [];
      const supports = Array.isArray(model.supports) ? model.supports : [];

      const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
      const fluidModel = params?.fluidModel ?? data.fluidModel ?? 'powerLaw';
      const check = checkFsiGate(
        { nodes, members, loads, supports },
        {
          fluidModel,
          K: num(params?.K ?? data.K),
          n: num(params?.n ?? data.n),
          mu0: num(params?.mu0 ?? data.mu0),
          muInf: num(params?.muInf ?? data.muInf),
          lambda: num(params?.lambda ?? data.lambda),
          deltaP: num(params?.deltaP ?? data.deltaP),
          density: num(params?.density ?? data.density),
          nominalGap: Array.isArray(params?.nominalGap ?? data.nominalGap)
            ? (params?.nominalGap ?? data.nominalGap)
            : num(params?.nominalGap ?? data.nominalGap),
          channelWidth: num(params?.channelWidth ?? data.channelWidth),
          relaxation: num(params?.relaxation ?? data.relaxation),
          maxIters: num(params?.maxIters ?? data.maxIters),
          gapTolerance: num(params?.gapTolerance ?? data.gapTolerance),
        }
      );
      // checkFsiGate never fabricates a pass: any hard precondition
      // failure (bad model, unsupported member orientation, invalid
      // fluid/pressure/density input, non-laminar regime) or coupling
      // failure (did_not_converge / coupling_diverged / gap_collapsed)
      // always carries `reason` and no numeric utilization — surface
      // that as an honest macro error rather than wrapping it as a
      // successful `result`.
      if (check.reason) {
        return {
          ok: false,
          error: check.reason,
          ...(check.memberIds ? { memberIds: check.memberIds } : {}),
          ...(check.residualHistory ? { residualHistory: check.residualHistory } : {}),
          ...(check.Re !== undefined ? { Re: check.Re, regime: check.regime } : {}),
        };
      }
      return { ok: true, result: check };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── nonNewtonianFlow — standalone non-Newtonian pipe-flow primitive
  // (Wave W1-B) ───────────────────────────────────────────────────────────
  // The FLUID side of fsiCheck above, exposed on its own: a real
  // power-law (Rabinowitsch-Mooney closed form) or Carreau (bisection +
  // adaptive-quadrature numeric) laminar pipe-flow computation, plus the
  // generalized (Metzner-Reed) Reynolds number classification. Useful
  // for a caller who wants the flow-only number without a structural
  // model at all. See server/lib/simulation/non-newtonian-flow.js.
  registerLensAction('engineering', 'nonNewtonianFlow', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const fluidModel = params?.fluidModel ?? data.fluidModel ?? 'powerLaw';
      const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
      const diameter = num(params?.diameter ?? data.diameter);
      const lengthM = num(params?.lengthM ?? data.lengthM);
      const pressureDropPa = num(params?.pressureDropPa ?? data.pressureDropPa);
      const n = num(params?.n ?? data.n);
      const density = num(params?.density ?? data.density);

      if (![diameter, lengthM, pressureDropPa, n].every((v) => Number.isFinite(v)) || diameter <= 0 || lengthM <= 0 || n <= 0) {
        return { ok: false, error: 'bad_flow_input' };
      }

      let flowRate;
      if (fluidModel === 'carreau') {
        const mu0 = num(params?.mu0 ?? data.mu0);
        const muInf = num(params?.muInf ?? data.muInf);
        const lambda = num(params?.lambda ?? data.lambda);
        if (![mu0, muInf, lambda].every((v) => Number.isFinite(v)) || mu0 <= 0 || muInf < 0 || lambda < 0) {
          return { ok: false, error: 'bad_fluid_params' };
        }
        flowRate = carreauPipeFlow({ mu0, muInf, lambda, n, diameter, lengthM, pressureDropPa });
      } else if (fluidModel === 'powerLaw') {
        const K = num(params?.K ?? data.K);
        if (!Number.isFinite(K) || K <= 0) return { ok: false, error: 'bad_fluid_params' };
        flowRate = powerLawPipeFlow({ K, n, diameter, lengthM, pressureDropPa });
      } else {
        return { ok: false, error: 'unsupported_fluid_model', fluidModel };
      }

      const meanVelocity = flowRate / (Math.PI * (diameter / 2) * (diameter / 2));
      let reynolds = null;
      if (Number.isFinite(density) && density > 0) {
        const K = params?.K ?? data.K ?? params?.mu0 ?? data.mu0; // reference viscosity index for the screening Re check
        const re = generalisedReynolds({ K: Number(K), n, density, velocity: meanVelocity, diameter });
        reynolds = { value: re.value, regime: re.regime };
      }

      return { ok: true, result: { flowRate, meanVelocity, reynolds, honestBoundary: HONEST_BOUNDARY } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── multiPhysicsCheck — unified multi-physics bundle over ONE beam-frame
  // model (Cross-System Multi-Physics CAD, closing leg) ────────────────────
  // Thin wrapper around runMultiPhysicsBundle, following the exact same
  // registration pattern as thermalStressCheck/aeroLoadCheck/circuitSolve
  // above. `params.legs` requests any of { thermal, aero } — each `true`
  // (module defaults) or an options object (deltaT/material for thermal;
  // velocity/direction/airDensity/defaultCd/defaultArea for aero) — against
  // the SAME model this file's own runFEA/thermalStressCheck/aeroLoadCheck
  // already accept. `params.electrical` is an entirely SEPARATE, optional
  // circuit-network request (its own {nodes,elements,groundNodeId} model) —
  // see multi-physics-bundle.js for why it is never folded into the
  // structural `allPass` or any structural utilization number: a circuit
  // solve and a beam-frame stress check are not commensurable (different
  // model shape, different units), so blending them would be exactly the
  // false-precision fabrication CLAUDE.md's honesty invariant forbids.
  // `params.simultaneous:true` (requires BOTH legs.thermal and legs.aero)
  // additionally runs a genuine simultaneous thermal+aero combined-loads
  // solve — real superposition through one real runFEA call, reported as
  // `simultaneous.simultaneousUtilization`, distinct from the independent
  // per-leg `ok`s. Never fabricates a pass: each leg's own honest failure
  // (bad model, unknown material, missing supports, missing aero geometry,
  // solver error) surfaces under that leg's own key without aborting
  // sibling legs that succeeded.
  registerLensAction('engineering', 'multiPhysicsCheck', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const model = data.model || data;
      const nodes = Array.isArray(model.nodes) ? model.nodes : [];
      const members = Array.isArray(model.members) ? model.members : [];
      const loads = Array.isArray(model.loads) ? model.loads : [];
      const supports = Array.isArray(model.supports) ? model.supports : [];
      const legs = params?.legs ?? data.legs;
      const electrical = params?.electrical ?? data.electrical;
      const simultaneous = (params?.simultaneous ?? data.simultaneous) === true;

      const needsStructuralModel = !!(legs && (legs.thermal || legs.aero));
      if (needsStructuralModel && (nodes.length === 0 || members.length === 0)) {
        return { ok: false, error: 'model must have at least one node and one member' };
      }

      const bundle = runMultiPhysicsBundle(
        { nodes, members, loads, supports },
        { legs, electrical, simultaneous }
      );
      // A bad bundle REQUEST (e.g. no legs at all) is an honest top-level
      // failure; a bad INDIVIDUAL leg still returns ok:true at the bundle
      // level with that leg's own failure nested under legs.<name> (or
      // under `electrical`) — see multi-physics-bundle.js.
      if (!bundle.ok) {
        return { ok: false, error: bundle.reason };
      }
      return { ok: true, result: bundle };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── feaScene — self-contained 3D-visualization payload (R5/E23) ────────
  // runFEA's own result (above) omits the input geometry — a caller that
  // already holds the model (the web engineering lens page, which built the
  // nodes/members client-side) merges them back in itself. A native/stateless
  // 3D client (the Godot world-lens-godot FEA scene builder, or any other
  // out-of-process renderer) has no such client-held model, so it needs one
  // JSON that carries BOTH the real geometry (node positions, member
  // connectivity) AND the real computed results (per-member stress/
  // utilization, reactions, displacements) in a single response.
  //
  // This is purely an assembly step: the SAME runFEA() call, the SAME
  // computed numbers — never reshaped, rounded, or approximated. Nodes/
  // members/supports/loads are echoed back verbatim from the input (the
  // real geometry the caller sent), merged by member id with the solver's
  // own stresses/utilization arrays (which runFEA guarantees are in 1:1
  // order with the input `members` array — see fea-solver.js's
  // computeMemberForces/computeStresses/checkUtilization, each a plain
  // `.map()` over `members`).
  registerLensAction('engineering', 'feaScene', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const model = data.model || data;
      const nodes = Array.isArray(model.nodes) ? model.nodes : [];
      const members = Array.isArray(model.members) ? model.members : [];
      const loads = Array.isArray(model.loads) ? model.loads : [];
      const supports = Array.isArray(model.supports) ? model.supports : [];
      if (nodes.length === 0 || members.length === 0) {
        return { ok: false, error: 'model must have at least one node and one member' };
      }

      const fea = runFEA({ nodes, members, loads, supports, onStage: ctx?.emitMacroStage });
      if (!fea.ok) return { ok: false, error: fea.error || 'FEA solve failed' };

      // Index the solver's per-member results by id (falling back to
      // positional index — same 1:1 order guarantee runFEA's own contour
      // block above relies on) so a member missing an id still merges.
      const utilById = new Map((fea.utilization || []).map((u) => [String(u.id), u]));
      const stressById = new Map((fea.stresses || []).map((s) => [String(s.id), s]));

      const sceneNodes = nodes.map((n) => ({
        id: String(n.id), x: n.x, y: n.y, z: n.z || 0,
      }));

      const sceneMembers = members.map((m, i) => {
        const util = utilById.get(String(m.id)) || fea.utilization?.[i] || null;
        const stress = stressById.get(String(m.id)) || fea.stresses?.[i] || null;
        const utilization = util ? util.utilization : 0;
        return {
          id: String(m.id),
          nodeI: String(m.nodeI),
          nodeJ: String(m.nodeJ),
          utilization,
          band: utilizationBand(utilization),
          pass: util ? !!util.pass : true,
          combinedStress: stress ? stress.combinedStress : 0,
          axialStress: stress ? stress.axialStress : 0,
          bendingStress: stress ? stress.bendingStress : 0,
          allowableStress: util ? util.allowableStress : null,
        };
      });

      return {
        ok: true,
        result: {
          format: 'concord-fea-scene/v1',
          nodes: sceneNodes,
          members: sceneMembers,
          supports,
          loads,
          displacements: fea.displacements,
          reactions: fea.reactions,
          summary: fea.summary,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── listSimJobs — FEA run history ───────────────────────────────────────
  registerLensAction('engineering', 'listSimJobs', (ctx) => {
    try {
      const s = engState();
      if (!s) return { ok: true, result: { jobs: [] } };
      const jobs = egList(s.jobs, egActor(ctx));
      return { ok: true, result: { jobs, count: jobs.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── savePart / listParts / deletePart — parametric part store ───────────
  registerLensAction('engineering', 'savePart', (ctx, artifact, params) => {
    try {
      const s = engState();
      if (!s) return { ok: false, error: 'state unavailable' };
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const userId = egActor(ctx);
      const parts = egList(s.parts, userId);
      const matId = data.material;
      const mat = matId ? MATERIAL_LIBRARY[matId] : null;
      const geom = computePrimitive(
        egClean(data.kind || 'box', 24),
        data.params || data,
        mat ? mat.density : parseFloat(data.density) || 7850,
      );
      const part = {
        id: data.id && parts.find((p) => p.id === data.id) ? data.id : egId('part'),
        name: egClean(data.name || 'Part', 80),
        kind: geom.kind,
        params: data.params || {},
        material: matId || null,
        geometry: geom,
        updatedAt: new Date().toISOString(),
      };
      const idx = parts.findIndex((p) => p.id === part.id);
      if (idx >= 0) parts[idx] = { ...parts[idx], ...part };
      else parts.push({ ...part, createdAt: part.updatedAt });
      persist();
      return { ok: true, result: { part, count: parts.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction('engineering', 'listParts', (ctx) => {
    try {
      const s = engState();
      if (!s) return { ok: true, result: { parts: [] } };
      const parts = egList(s.parts, egActor(ctx));
      return { ok: true, result: { parts, count: parts.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction('engineering', 'deletePart', (ctx, artifact, params) => {
    try {
      const s = engState();
      if (!s) return { ok: false, error: 'state unavailable' };
      const id = params?.id || artifact?.data?.id;
      const parts = egList(s.parts, egActor(ctx));
      const next = parts.filter((p) => p.id !== id);
      s.parts.set(egActor(ctx), next);
      persist();
      return { ok: true, result: { deleted: parts.length - next.length, count: next.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── bom (existing — kept) ───────────────────────────────────────────────
  registerLensAction('engineering', 'bom', (ctx, artifact, params) => {
    try {
      const items = artifact?.data?.bomItems || artifact?.data?.items || params?.items || [];
      if (items.length === 0) {
        return { ok: true, result: { message: 'Add BOM items with part number, quantity, and cost.' } };
      }
      const bom = items.map((i) => {
        const qty = parseInt(i.quantity) || 1;
        const cost = parseFloat(i.unitCost) || 0;
        return {
          partNumber: i.partNumber || i.name,
          description: i.description || '',
          quantity: qty, unitCost: cost,
          extendedCost: Math.round(qty * cost * 100) / 100,
          leadTime: i.leadTime || 'stock',
          supplier: i.supplier || 'TBD',
        };
      });
      const totalCost = bom.reduce((s, b) => s + b.extendedCost, 0);
      const totalParts = bom.reduce((s, b) => s + b.quantity, 0);
      const longestLead = bom
        .filter((b) => b.leadTime !== 'stock')
        .sort((a, b) => (parseInt(b.leadTime) || 0) - (parseInt(a.leadTime) || 0))[0];
      return {
        ok: true,
        result: {
          bom, totalLineItems: bom.length, totalParts,
          totalCost: Math.round(totalCost * 100) / 100,
          criticalPath: longestLead?.partNumber || 'All in stock',
          uniqueSuppliers: [...new Set(bom.map((b) => b.supplier))].length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── bomRollup — cost rollup + supplier links + procurement summary ──────
  registerLensAction('engineering', 'bomRollup', (ctx, artifact, params) => {
    try {
      const items = artifact?.data?.items || params?.items || [];
      if (items.length === 0) {
        return { ok: true, result: { message: 'Add BOM items: { partNumber, quantity, unitCost, supplier, leadTimeDays }.' } };
      }
      // finiteOr coerces poisoned numeric (NaN / Infinity / overflow) input to a
      // finite fallback so no computed cost is ever a non-finite lie.
      const finiteOr = (v, fb) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : fb;
      };
      const intOr = (v, fb) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : fb;
      };
      const overheadRate = finiteOr(params?.overheadRate ?? 0.15, 0.15);
      const buildQty = Math.max(1, intOr(params?.buildQty ?? 1, 1));
      const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
      const rows = items.map((i) => {
        const qty = (intOr(i.quantity, 1) || 1) * buildQty;
        const unit = finiteOr(i.unitCost, 0);
        const lead = intOr(i.leadTimeDays, 0);
        const supplier = egClean(i.supplier || 'TBD', 60);
        const ext = qty * unit;
        // Supplier link — search query against common distributors.
        const q = encodeURIComponent(i.partNumber || i.name || '');
        return {
          partNumber: i.partNumber || i.name || 'PART',
          description: egClean(i.description || '', 160),
          quantity: qty,
          unitCost: r2(unit),
          extendedCost: r2(ext),
          leadTimeDays: lead,
          supplier,
          supplierLinks: {
            mcmaster: `https://www.mcmaster.com/${q}`,
            digikey: `https://www.digikey.com/en/products/result?keywords=${q}`,
            grainger: `https://www.grainger.com/search?searchQuery=${q}`,
          },
        };
      });
      const materialCost = rows.reduce((s, r) => s + r.extendedCost, 0);
      const overhead = materialCost * overheadRate;
      const totalCost = materialCost + overhead;
      const leadDays = Math.max(0, ...rows.map((r) => r.leadTimeDays));
      const critical = rows
        .slice()
        .sort((a, b) => b.leadTimeDays - a.leadTimeDays)
        .filter((r) => r.leadTimeDays > 0)
        .slice(0, 3)
        .map((r) => ({ partNumber: r.partNumber, leadTimeDays: r.leadTimeDays }));
      // Per-supplier rollup.
      const bySupplier = {};
      for (const r of rows) {
        if (!bySupplier[r.supplier]) bySupplier[r.supplier] = { lineItems: 0, cost: 0 };
        bySupplier[r.supplier].lineItems += 1;
        bySupplier[r.supplier].cost += r.extendedCost;
      }
      return {
        ok: true,
        result: {
          rows,
          buildQty,
          rollup: {
            lineItems: rows.length,
            totalParts: rows.reduce((s, r) => s + r.quantity, 0),
            materialCost: r2(materialCost),
            overheadRate,
            overhead: r2(overhead),
            totalCost: r2(totalCost),
            costPerUnit: r2(totalCost / buildQty),
            procurementLeadDays: leadDays,
          },
          criticalPath: critical,
          bySupplier: Object.entries(bySupplier).map(([name, v]) => ({
            supplier: name, lineItems: v.lineItems, cost: r2(v.cost),
          })),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── connectionCheck — AISC bolted-connection allowable shear ────────────
  // Real math: R = Fv · Ab · n · planes (see boltedConnection() header). This
  // macro is a thin passthrough — no math is re-derived here. The compute fn
  // never throws; on invalid input it returns { error, inputs } instead of a
  // computed value, which this handler surfaces as an honest { ok:false }
  // rather than nesting a fabricated success around it.
  registerLensAction('engineering', 'connectionCheck', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const r = boltedConnection({
        boltDiameter: data.boltDiameter,
        boltGrade: data.boltGrade,
        numBolts: data.numBolts,
        loadType: data.loadType,
      });
      if (r.error) return { ok: false, error: r.error, inputs: r.inputs };
      return { ok: true, result: r };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── transformerSizing — ANSI kVA-ladder transformer selection ──────────
  // Real math: required = loadKva·growthFactor, selected = next standard
  // ANSI kVA size, primaryAmps from the selected size (see transformerSizing()
  // header). Thin passthrough, same honest-failure contract as above.
  registerLensAction('engineering', 'transformerSizing', (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const r = transformerSizing({
        loadKva: data.loadKva,
        voltage: data.voltage,
        phase: data.phase,
        powerFactor: data.powerFactor,
        growthFactor: data.growthFactor,
      });
      if (r.error) return { ok: false, error: r.error, inputs: r.inputs };
      return { ok: true, result: r };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── mint-and-list — Program C's CAS→FEA→GLB pipeline → real marketplace ──
  // V1.2 Wave C (Creation → Economy Loop). Takes a COMPLETED, already-run
  // asset-gen output (`generateValidatedAsset` in
  // server/lib/asset-gen/generate-asset.js, or the equivalent fields off a
  // promoted evo_assets row: archetype/material/glbPath/massProps/feaResult)
  // plus a price, and does both steps every other real-money creative path
  // already does: mint a real DTU (via dtu.create — populates both the SQL
  // row and STATE.dtus, unlike forge-marketplace.js's raw-SQL insert), then
  // list it on the real marketplace (marketplace.list — the same macro the
  // Creator lens Listings tab uses, backed by purchaseWithRoyalties' 95%
  // creator / 5% platform royalty cascade). See
  // server/lib/asset-gen/asset-marketplace.js for the full honesty contract:
  // an asset with no passing FEA check is refused by default, never minted
  // with a fabricated "verified" claim.
  registerLensAction('engineering', 'mint-and-list', async (ctx, _artifact, params = {}) => {
    try {
      const { assetGenResult, price, currency, title, description, allowUnverified } = params || {};
      if (!assetGenResult || typeof assetGenResult !== 'object') {
        return { ok: false, error: 'assetGenResult (a completed generateValidatedAsset/asset-gen output) is required' };
      }
      const { mintAndListGeneratedAsset } = await import('../lib/asset-gen/asset-marketplace.js');
      const result = await mintAndListGeneratedAsset(ctx, assetGenResult, price, {
        currency, title, description, allowUnverified: allowUnverified === true,
      });
      if (!result.ok) return { ok: false, error: result.reason, ...result };
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
