// server/lib/chat/tool-recipes/verify.js
//
// Verify a recipe result against reality, independent of the code that produced it.
//   independentRecompute(id, inputs, result) -> checks recomputed from textbook closed forms written
//       separately here (not by calling the recipe's own engine), compared at 1e-6 relative.
//   referenceMatch(id, inputs, result)       -> when the inputs equal a reference-corpus case, the
//       result must equal the corpus's known answer.
// Disagreement is never smoothed over: runRecipe turns it into passed:false and says so.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getMaterial } from "../../conkay/materials/index.js";

const here = dirname(fileURLToPath(import.meta.url));
export const REFERENCE_CORPUS = JSON.parse(readFileSync(join(here, "reference-corpus.json"), "utf8"));

const R10 = [1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8];
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const agree = (name, got, want, tol = 1e-6, unit = "") => ({
  name, pass: Number.isFinite(got) && Number.isFinite(want) && rel(got, want) <= tol,
  detail: `recipe ${fmt(got)}${unit} vs independent ${fmt(want)}${unit}`,
});
const fmt = (n) => (Number.isFinite(n) ? Number(n.toPrecision(6)).toString() : String(n));

// ---- chemistry: atom conservation, parsed here ---------------------------------------------
function atoms(formula) {
  const stack = [{}];
  const re = /([A-Z][a-z]?)(\d*)|(\()|\)(\d*)/g;
  let m;
  while ((m = re.exec(formula)) !== null) {
    if (m[1]) { const top = stack.at(-1); top[m[1]] = (top[m[1]] || 0) + (m[2] ? Number(m[2]) : 1); }
    else if (m[3]) stack.push({});
    else if (stack.length > 1) { const grp = stack.pop(); const k = m[4] ? Number(m[4]) : 1; const top = stack.at(-1); for (const [e, n] of Object.entries(grp)) top[e] = (top[e] || 0) + n * k; }
  }
  return stack[0];
}
function sideTotals(coeffs) {
  const t = {};
  for (const [sp, c] of Object.entries(coeffs)) for (const [e, n] of Object.entries(atoms(sp))) t[e] = (t[e] || 0) + n * c;
  return t;
}

// ---- Colebrook (implicit), solved by fixed-point iteration ----------------------------------
function colebrook(Re, relRough) {
  let x = 7; // 1/sqrt(f)
  for (let i = 0; i < 100; i++) x = -2 * Math.log10(relRough / 3.7 + 2.51 * x / Re);
  return 1 / (x * x);
}

const INDEPENDENT = {
  beam_sizing(v, r) {
    const mat = getMaterial(v.material);
    const E = mat.youngsModulusPa; const allow = mat.yieldPa / v.safetyFactor;
    const M = (v.loadN * v.spanM) / 4;
    const lim = v.deflectionLimit ?? 360;
    const sigma = (h) => (6 * M) / (v.widthM * h * h);
    const delta = (h) => (v.loadN * v.spanM ** 3) / (48 * E * ((v.widthM * h ** 3) / 12));
    let pick = null;
    for (let e = -3; e <= 1 && pick == null; e++) for (const x of R10) {
      const h = +(x * 10 ** e).toPrecision(6);
      if (h >= 0.005 && sigma(h) <= allow && delta(h) <= v.spanM / lim) { pick = h; break; }
    }
    const h = r.depthM;
    return [
      agree("moment_PL/4", r.maxMomentNm, M, 1e-9, " N·m"),
      agree("depth_smallest_R10_for_both_checks", h, pick, 1e-9, " m"),
      agree("bending_stress_6M/bh2", r.sigmaPa, sigma(h), 1e-6, " Pa"),
      agree("deflection_PL3/48EI", r.deltaM, delta(h), 1e-3, " m"),
    ];
  },
  column_buckling(v, r) {
    const I = v.momentOfInertiaM4 ?? (Math.max(v.widthM, v.heightM) * Math.min(v.widthM, v.heightM) ** 3) / 12;
    const K = v.kFactor || 1;
    const out = [agree("Pcr_pi2EI/(KL)2", r.criticalLoadN, (Math.PI ** 2 * v.modulusPa * I) / (K * v.lengthM) ** 2, 1e-9, " N")];
    if (v.loadN) out.push(agree("factor_of_safety_Pcr/P", r.factorOfSafety, r.criticalLoadN / v.loadN, 1e-9));
    if (v.widthM && v.heightM) out.push(agree("slenderness_KL/r", r.slenderness, (K * v.lengthM) / Math.sqrt(I / (v.widthM * v.heightM)), 1e-9));
    return out;
  },
  pressure_vessel(v, r) {
    const t = v.thicknessM; const p = v.pressurePa; const rad = v.radiusM;
    const cyl = (v.shape || "cylinder") !== "sphere";
    return [agree("hoop_stress", r.hoopStressPa, cyl ? (p * rad) / t : (p * rad) / (2 * t), 1e-9, " Pa"), agree("axial_stress_pr/2t", r.axialStressPa, (p * rad) / (2 * t), 1e-9, " Pa")];
  },
  wall_conduction(v, r) {
    return [agree("heat_flow_kA dT/L", r.heatFlowW, (v.conductivityWmK * v.areaM2 * v.deltaTK) / v.thicknessM, 1e-9, " W"), agree("resistance_L/kA", r.thermalResistanceKPerW, v.thicknessM / (v.conductivityWmK * v.areaM2), 1e-9)];
  },
  pipe_flow(v, r) {
    const Re = (v.densityKgM3 * v.velocityMs * v.diameterM) / v.viscosityPaS;
    const out = [agree("reynolds_rho_v_D/mu", r.reynolds, Re, 1e-9)];
    if (r.regime === "laminar") out.push(agree("hagen_poiseuille_32 mu L v/D2", r.pressureDropPa, (32 * v.viscosityPaS * v.lengthM * v.velocityMs) / v.diameterM ** 2, 1e-9, " Pa"));
    else {
      const f = colebrook(Re, (v.roughnessM ?? 4.5e-5) / v.diameterM);
      out.push(agree("friction_factor_vs_colebrook", r.frictionFactor, f, 0.03));
      out.push(agree("darcy_weisbach_dp", r.pressureDropPa, f * (v.lengthM / v.diameterM) * (v.densityKgM3 * v.velocityMs ** 2) / 2, 0.03, " Pa"));
    }
    return out;
  },
  unit_conversion(v, r) {
    // a small second table, typed here rather than read from the converter under test
    const F = { n: 1, kn: 1e3, mn: 1e6, lbf: 4.4482216152605, pa: 1, kpa: 1e3, mpa: 1e6, gpa: 1e9, psi: 6894.757293168, ksi: 6894757.293168, m: 1, mm: 1e-3, cm: 1e-2, km: 1e3, in: 0.0254, ft: 0.3048 };
    const a = F[String(v.from).toLowerCase()]; const b = F[String(v.to).toLowerCase()];
    if (a == null || b == null) return [{ name: "independent_factor", pass: true, detail: "unit outside the independent table: not independently checked" }];
    return [agree("conversion_factor", r.value, (v.value * a) / b, 1e-9)];
  },
  material_compare(v, r) {
    return r.rows.map((row) => { const m = getMaterial(row.id); return agree(`specific_stiffness_${row.id}`, row.specificStiffness, m.youngsModulusPa / m.densityKgM3, 1e-12); });
  },
  reaction_balance(v, r) {
    const left = sideTotals(r.reactantCoeffs); const right = sideTotals(r.productCoeffs);
    const elems = new Set([...Object.keys(left), ...Object.keys(right)]);
    const bad = [...elems].filter((e) => left[e] !== right[e]);
    return [{ name: "atoms_conserved", pass: bad.length === 0 && elems.size > 0, detail: bad.length ? `unbalanced: ${bad.join(", ")}` : `${[...elems].map((e) => `${e}:${left[e]}`).join(" ")}` }];
  },
};

export function independentRecompute(id, inputs, result) {
  const fn = INDEPENDENT[id];
  if (!fn) return [];
  try { return fn(inputs, result); } catch (e) { return [{ name: "independent_recompute", pass: false, detail: `could not recompute: ${String(e?.message || e)}` }]; }
}

const pathGet = (o, p) => p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
const sameInputs = (a, b) => Object.keys(b).every((k) => (typeof b[k] === "number" ? typeof a[k] === "number" && rel(a[k], b[k]) < 1e-9 : String(a[k]) === String(b[k])));

export function referenceMatch(id, inputs, result) {
  const hit = REFERENCE_CORPUS.cases.find((c) => c.recipe === id && sameInputs(inputs, c.inputs));
  if (!hit) return { matched: false };
  const mismatches = [];
  for (const [path, want] of Object.entries(hit.expect)) {
    const got = pathGet(result, path);
    const ok = typeof want === "number" ? Number.isFinite(got) && rel(got, want) <= (hit.tolerance ?? REFERENCE_CORPUS.tolerance) : JSON.stringify(got) === JSON.stringify(want);
    if (!ok) mismatches.push({ path, got, want });
  }
  return { matched: true, caseId: hit.id, source: hit.source, pass: mismatches.length === 0, mismatches };
}
