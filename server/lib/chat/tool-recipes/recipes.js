// server/lib/chat/tool-recipes/recipes.js
//
// Named multi-step workflows the chat agent can pick instead of improvising a
// tool chain. Each recipe declares its inputs (SI, with the dimension so a
// tagged value like "60 mm" is accepted), runs deterministic steps that call
// the same engines the individual tools use, and states the checks that
// decide pass/fail. No LLM anywhere in a recipe.

import { runChatCompute, toSI } from "../compute-si.js";
import * as engineering from "../../compute/engineering-compute.js";
import { solveBeam } from "../../conkay/chat/structures.js";
import { getMaterial } from "../../conkay/materials/index.js";
import * as chemistry from "../../compute/chemistry-compute.js";

const MATERIAL_IDS = ["steel-a36", "aluminum-6061-t6-b221", "aluminum-6061-t6", "concrete-30mpa"];
const lookupMaterial = (id) => getMaterial(id) || null;

/** Step helper: a recorded call. */
const step = (id, tool, input, output) => ({ id, tool, input, output });

export const RECIPES = [
  {
    id: "beam_sizing",
    title: "Size a simply supported rectangular beam (strength and deflection)",
    keywords: ["beam", "size", "depth", "span", "deflection", "bending", "footbridge", "girder", "joist"],
    inputs: {
      spanM: { dim: "length", unit: "m", required: true, desc: "span" },
      loadN: { dim: "force", unit: "N", required: true, desc: "point load at midspan" },
      widthM: { dim: "length", unit: "m", required: true, desc: "section width" },
      material: { type: "string", required: true, desc: `library id, one of ${MATERIAL_IDS.join(", ")}` },
      safetyFactor: { type: "number", required: true, desc: "required safety factor on yield" },
      deflectionLimit: { type: "number", required: false, desc: "deflection limit as span / n (default 360)" },
    },
    run(v) {
      const mat = lookupMaterial(v.material);
      if (!mat) return { error: `unknown material "${v.material}"; use one of ${MATERIAL_IDS.join(", ")}` };
      const ir = {
        kind: "beam", spanM: v.spanM, support: "simply-supported", material: mat.id, safetyFactor: v.safetyFactor,
        widthM: v.widthM, depthM: null, deflectionLimit: v.deflectionLimit ?? 360,
        loads: [{ type: "point", N: v.loadN, at: "midspan" }],
      };
      const b = solveBeam(ir);
      const steps = [step("solveBeam", "conkay.chat.structures.solveBeam", ir, b)];
      if (!b.ok || !b.section) return { error: b.error || b.note || "the beam could not be sized", steps };
      const dl = b.deflectionCheck;
      const checks = [
        { name: "strength", pass: b.hand.sigmaPa <= b.hand.allowablePa, detail: `sigma ${(b.hand.sigmaPa / 1e6).toFixed(1)} MPa vs allowable ${(b.hand.allowablePa / 1e6).toFixed(1)} MPa` },
        { name: "deflection", pass: !!dl?.pass, detail: `delta ${((dl?.deltaM ?? NaN) * 1000).toFixed(2)} mm vs allowable ${((dl?.allowableM ?? NaN) * 1000).toFixed(2)} mm (span/${dl?.ratio})` },
        { name: "hand_vs_FE", pass: !!(b.fe?.agrees?.sigma && b.fe?.agrees?.delta !== false), detail: `agree within ${(b.tolerance * 100).toFixed(0)}%` },
      ];
      return {
        steps, checks,
        result: {
          depthM: b.section.depthM, widthM: b.section.widthM, governs: b.governs, sizing: b.sizing,
          sigmaPa: b.hand.sigmaPa, allowablePa: b.hand.allowablePa, deltaM: dl?.deltaM ?? b.hand.deltaM,
          maxMomentNm: b.maxMoment.value, material: b.material.id,
        },
      };
    },
  },

  {
    id: "column_buckling",
    title: "Euler buckling of a pinned/fixed rectangular or general column",
    keywords: ["column", "buckling", "euler", "slenderness", "strut", "compression"],
    inputs: {
      lengthM: { dim: "length", unit: "m", required: true, desc: "unsupported length" },
      modulusPa: { dim: "stress", unit: "Pa", required: true, desc: "Young's modulus" },
      widthM: { dim: "length", unit: "m", required: false, desc: "rectangle width (with heightM)" },
      heightM: { dim: "length", unit: "m", required: false, desc: "rectangle height (with widthM)" },
      momentOfInertiaM4: { dim: "inertia", unit: "m4", required: false, desc: "second moment of area (instead of width and height)" },
      loadN: { dim: "force", unit: "N", required: false, desc: "applied axial load, for the factor of safety" },
      kFactor: { type: "number", required: false, desc: "effective length factor (1 pinned-pinned, 0.5 fixed-fixed, 0.7 fixed-pinned, 2 fixed-free)" },
    },
    run(v) {
      const input = { lengthM: v.lengthM, modulusPa: v.modulusPa, ...(v.kFactor ? { kFactor: v.kFactor } : {}) };
      if (v.momentOfInertiaM4) input.momentOfInertiaM4 = v.momentOfInertiaM4;
      else if (v.widthM && v.heightM) { input.widthM = v.widthM; input.heightM = v.heightM; }
      else return { error: "give widthM and heightM, or momentOfInertiaM4" };
      if (v.loadN) input.loadN = v.loadN;
      const out = runChatCompute("engineering.columnBuckling", engineering, "columnBuckling", input);
      const steps = [step("columnBuckling", "engineering.columnBuckling", input, out)];
      if (out.error) return { error: out.error, steps };
      const checks = [
        { name: "euler_valid", pass: out.slenderness == null || out.slenderness > 80, detail: out.slenderness == null ? "no area given: slenderness not checked" : `L/r = ${out.slenderness.toFixed(1)} (Euler needs a slender column; below ~80 inelastic buckling governs)` },
      ];
      if (out.factorOfSafety != null) checks.push({ name: "factor_of_safety", pass: out.factorOfSafety >= 1.67, detail: `FS ${out.factorOfSafety.toFixed(2)} vs 1.67 (AISC)` });
      return { steps, checks, result: { criticalLoadN: out.criticalLoadN, factorOfSafety: out.factorOfSafety, slenderness: out.slenderness ?? null, momentOfInertiaM4: out.momentOfInertiaM4, bucklingAxis: out.bucklingAxis ?? null } };
    },
  },

  {
    id: "unit_conversion",
    title: "Convert a quantity between units of the same dimension",
    keywords: ["convert", "conversion", "units", "unit", "psi", "mpa", "inches", "feet"],
    inputs: {
      value: { type: "number", required: true, desc: "the number" },
      from: { type: "string", required: true, desc: "unit it is in, e.g. psi, kN, mm, ft" },
      to: { type: "string", required: true, desc: "unit wanted" },
    },
    run(v) {
      for (const dim of ["force", "length", "stress", "inertia", "area", "moment"]) {
        const a = toSI({ value: v.value, unit: v.from }, dim);
        const b = toSI({ value: 1, unit: v.to }, dim);
        if (a != null && b != null) {
          const out = a / b;
          return { steps: [step("convert", "units", v, { dimension: dim, si: a, result: out })], checks: [{ name: "same_dimension", pass: true, detail: dim }], result: { value: out, unit: v.to, dimension: dim, si: a } };
        }
      }
      return { error: `cannot convert ${v.from} to ${v.to}: unknown unit or different dimensions` };
    },
  },

  {
    id: "material_compare",
    title: "Compare library materials: stiffness, strength, density and specific figures",
    keywords: ["material", "compare", "steel", "aluminum", "aluminium", "lighter", "stiffer", "specific"],
    inputs: { materials: { type: "array", required: true, desc: `two or more library ids, e.g. ${MATERIAL_IDS.slice(0, 2).join(", ")}` } },
    run(v) {
      const rows = [];
      for (const id of v.materials) {
        const m = lookupMaterial(id);
        if (!m) return { error: `unknown material "${id}"` };
        rows.push({ id: m.id, label: m.label, densityKgM3: m.densityKgM3, youngsModulusPa: m.youngsModulusPa, yieldPa: m.yieldPa,
          specificStiffness: m.youngsModulusPa / m.densityKgM3, specificStrength: m.yieldPa / m.densityKgM3 });
      }
      const best = (k) => rows.reduce((a, r) => (r[k] > a[k] ? r : a)).id;
      return { steps: [step("library", "conkay.materials", v, rows)], checks: [{ name: "all_in_library", pass: true, detail: `${rows.length} materials` }],
        result: { rows, highest: { youngsModulusPa: best("youngsModulusPa"), yieldPa: best("yieldPa"), specificStiffness: best("specificStiffness"), specificStrength: best("specificStrength") } } };
    },
  },

  {
    id: "wall_conduction",
    title: "Steady heat flow through a flat wall (Fourier)",
    keywords: ["heat", "conduction", "wall", "thermal", "insulation", "fourier", "r-value"],
    inputs: {
      conductivityWmK: { type: "number", required: true, desc: "thermal conductivity k, W/(m K)" },
      areaM2: { dim: "area", unit: "m2", required: true, desc: "wall area" },
      thicknessM: { dim: "length", unit: "m", required: true, desc: "wall thickness" },
      deltaTK: { type: "number", required: true, desc: "temperature difference across the wall, K" },
    },
    run(v) {
      const q = (v.conductivityWmK * v.areaM2 * v.deltaTK) / v.thicknessM;
      const R = v.thicknessM / (v.conductivityWmK * v.areaM2);
      return { steps: [step("fourier", "formula", v, { q, R })], checks: [{ name: "positive_heat_flow", pass: q >= 0, detail: "Q = k A dT / L" }],
        result: { heatFlowW: q, thermalResistanceKPerW: R, fluxWm2: q / v.areaM2 } };
    },
  },

  {
    id: "pipe_flow",
    title: "Pipe flow: Reynolds number, regime and pressure drop",
    keywords: ["pipe", "flow", "reynolds", "pressure drop", "laminar", "turbulent", "darcy", "water"],
    inputs: {
      densityKgM3: { type: "number", required: true, desc: "fluid density" },
      viscosityPaS: { type: "number", required: true, desc: "dynamic viscosity, Pa s" },
      velocityMs: { type: "number", required: true, desc: "mean velocity, m/s" },
      diameterM: { dim: "length", unit: "m", required: true, desc: "inner diameter" },
      lengthM: { dim: "length", unit: "m", required: true, desc: "pipe length" },
      roughnessM: { dim: "length", unit: "m", required: false, desc: "absolute roughness (default 4.5e-5, commercial steel)" },
    },
    run(v) {
      const Re = (v.densityKgM3 * v.velocityMs * v.diameterM) / v.viscosityPaS;
      const eps = v.roughnessM ?? 4.5e-5;
      let f; let regime; let basis;
      if (Re < 2300) { f = 64 / Re; regime = "laminar"; basis = "f = 64/Re"; }
      else {
        regime = Re < 4000 ? "transitional" : "turbulent";
        f = 0.25 / Math.log10(eps / (3.7 * v.diameterM) + 5.74 / Re ** 0.9) ** 2; basis = "Swamee-Jain";
      }
      const dp = f * (v.lengthM / v.diameterM) * (v.densityKgM3 * v.velocityMs ** 2) / 2;
      return { steps: [step("darcy", "formula", v, { Re, f, dp, basis })],
        checks: [{ name: "regime_known", pass: regime !== "transitional", detail: regime === "transitional" ? "Re 2300-4000: the friction factor is not reliable" : `${regime} (Re ${Re.toFixed(0)})` }],
        result: { reynolds: Re, regime, frictionFactor: f, frictionBasis: basis, pressureDropPa: dp } };
    },
  },

  {
    id: "pressure_vessel",
    title: "Thin-wall pressure vessel stress (cylinder or sphere)",
    keywords: ["pressure", "vessel", "tank", "boiler", "hoop", "thin-wall", "cylinder", "sphere"],
    inputs: {
      pressurePa: { dim: "stress", unit: "Pa", required: true, desc: "internal gauge pressure" },
      radiusM: { dim: "length", unit: "m", required: true, desc: "mean radius" },
      thicknessM: { dim: "length", unit: "m", required: true, desc: "wall thickness" },
      shape: { type: "string", required: false, desc: "cylinder (default) or sphere" },
      yieldPa: { dim: "stress", unit: "Pa", required: false, desc: "yield strength, for the safety factor" },
    },
    run(v) {
      const shape = String(v.shape || "cylinder").toLowerCase();
      if (shape !== "cylinder" && shape !== "sphere") return { error: 'shape must be "cylinder" or "sphere"' };
      const hoop = shape === "cylinder" ? (v.pressurePa * v.radiusM) / v.thicknessM : (v.pressurePa * v.radiusM) / (2 * v.thicknessM);
      const axial = (v.pressurePa * v.radiusM) / (2 * v.thicknessM);
      const slender = v.radiusM / v.thicknessM >= 10;
      const checks = [{ name: "thin_wall", pass: slender, detail: `r/t = ${(v.radiusM / v.thicknessM).toFixed(1)} (thin-wall formulas need r/t >= 10)` }];
      const result = { hoopStressPa: hoop, axialStressPa: axial, shape };
      if (v.yieldPa) { result.safetyFactor = v.yieldPa / hoop; checks.push({ name: "yield", pass: result.safetyFactor >= 1, detail: `SF ${result.safetyFactor.toFixed(2)} on yield` }); }
      return { steps: [step("thin_wall", "formula", v, result)], checks, result };
    },
  },

  {
    id: "reaction_balance",
    title: "Balance a chemical reaction and give molar masses",
    keywords: ["chemistry", "balance", "reaction", "stoichiometry", "molar", "equation", "reactants"],
    inputs: { equation: { type: "string", required: true, desc: 'e.g. "H2 + O2 -> H2O"' } },
    run(v) {
      const b = chemistry.balanceReaction({ equation: v.equation });
      const steps = [step("balanceReaction", "chemistry.balanceReaction", v, b)];
      if (!b?.ok) return { error: b?.error || "the equation could not be balanced", steps };
      const species = Object.keys(b.coefficients);
      const masses = {};
      for (const sp of species) {
        const m = chemistry.molecularAnalysis({ formula: sp });
        if (m?.ok) masses[sp] = m.molarMass;
      }
      steps.push(step("molarMasses", "chemistry.molecularAnalysis", species, masses));
      return { steps, checks: [{ name: "balanced", pass: true, detail: b.balanced }], result: { balanced: b.balanced, coefficients: b.coefficients, reactantCoeffs: b.reactantCoeffs, productCoeffs: b.productCoeffs, molarMassGPerMol: masses } };
    },
  },
];
