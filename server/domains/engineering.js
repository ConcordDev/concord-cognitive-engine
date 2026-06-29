// server/domains/engineering.js
//
// Engineering lens — CAD + simulation domain (Fusion 360 / SimScale shape).
// Pure-compute macros plus a STATE-backed per-user store for parts,
// assemblies, load cases and FEA simulation jobs.
//
// All handlers return { ok: boolean, result?, error? } and never throw.

import { runFEA } from '../lib/simulation/fea-solver.js';

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
  let section = null;
  switch (kind) {
    case 'box': {
      const [w, h, l] = [p.width || 0.1, p.height || 0.1, p.length || 0.1];
      volume = w * h * l;
      surfaceArea = 2 * (w * h + h * l + w * l);
      bbox = [w, h, l];
      section = { area: w * h, Ix: (w * h ** 3) / 12, Iy: (h * w ** 3) / 12 };
      break;
    }
    case 'cylinder': {
      const [r, len] = [p.radius || 0.05, p.length || 0.2];
      volume = Math.PI * r * r * len;
      surfaceArea = 2 * Math.PI * r * (r + len);
      bbox = [2 * r, 2 * r, len];
      section = { area: Math.PI * r * r, Ix: (Math.PI * r ** 4) / 4, Iy: (Math.PI * r ** 4) / 4 };
      break;
    }
    case 'tube': {
      const ro = p.radius || 0.05;
      const ri = Math.min(p.innerRadius || 0.04, ro - 1e-6);
      const len = p.length || 0.2;
      volume = Math.PI * (ro * ro - ri * ri) * len;
      surfaceArea = 2 * Math.PI * (ro + ri) * len + 2 * Math.PI * (ro * ro - ri * ri);
      bbox = [2 * ro, 2 * ro, len];
      section = {
        area: Math.PI * (ro * ro - ri * ri),
        Ix: (Math.PI / 4) * (ro ** 4 - ri ** 4),
        Iy: (Math.PI / 4) * (ro ** 4 - ri ** 4),
      };
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
      const Ix =
        (bf * dh ** 3) / 12 - ((bf - tw) * (dh - 2 * tf) ** 3) / 12;
      const Iy = (2 * tf * bf ** 3) / 12 + ((dh - 2 * tf) * tw ** 3) / 12;
      section = { area, Ix, Iy };
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
      const rawTargetGap = params?.targetGap ?? artifact?.data?.targetGap;
      const targetGap = parseFloat(rawTargetGap);
      // Fail CLOSED when targetGap was SUPPLIED but is non-finite (NaN /
      // Infinity / "1e999"): silently dropping the fit verdict and returning
      // ok:true would hide a poisoned gap from the caller.
      if (rawTargetGap != null && rawTargetGap !== '' && !Number.isFinite(targetGap)) {
        return { ok: false, error: 'invalid_targetGap' };
      }
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
        // box (default)
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
      const fea = runFEA({ nodes, members, loads, supports });
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
      // Fail CLOSED on a present-but-poisoned overheadRate / buildQty (NaN /
      // Infinity / overflow) rather than substituting a default — those values
      // scale every rolled-up cost, so a silent default returning ok:true lies.
      if (params?.overheadRate != null) {
        const n = parseFloat(params.overheadRate);
        if (!Number.isFinite(n)) return { ok: false, error: 'invalid_overheadRate' };
      }
      if (params?.buildQty != null) {
        const n = parseInt(params.buildQty, 10);
        if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'invalid_buildQty' };
      }
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
}
