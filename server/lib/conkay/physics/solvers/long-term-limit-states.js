// server/lib/conkay/physics/solvers/long-term-limit-states.js
//
// The long-term limit states the coverage table listed as gaps
// (Q42 / K1 / K2 / A#15): galvanic corrosion at bolted joints,
// uniform corrosion section loss on bolts and plates, and fatigue —
// AISC Appendix 3 at joints (the input contract in
// compiler/schemas/bolt-joint-inputs.v1.json already specified those
// fields as "planned"; this file implements them) plus a Basquin
// screening check for actuators, which have no AISC detail category.
//
// Input discipline (same as the AISC strength solvers): nothing is
// defaulted that the design must declare. Environment, design life,
// allowable loss and fatigue duty are props on the node; absent, the
// solver returns NOT_COMPUTED naming the missing declaration. The
// environment vocabulary is the input contract's own enum.

import { registerSolver } from "../registry.js";

export const ENVIRONMENTS = ["indoor-dry", "outdoor-urban", "outdoor-rural", "marine-atmospheric", "marine-submerged", "chemical"];

function readEnvironment(ctx, id) {
  const env = ctx.get(id, "props.environment");
  if (env == null) return { error: `${id} declares no props.environment (one of ${ENVIRONMENTS.join(", ")}): long-term exposure cannot be assessed without it` };
  if (!ENVIRONMENTS.includes(env)) return { error: `${id}: props.environment "${env}" is not one of ${ENVIRONMENTS.join(", ")}` };
  return { env };
}

// ── Galvanic corrosion at a bolted joint ────────────────────────────
// Potentials: mid-range values from the standard published galvanic
// series for seawater (V vs SCE, the series tabulated in ASTM G82 /
// MIL-STD-889 practice). More positive = more noble (cathodic); the
// less noble member of a couple is the anode and corrodes first.
export const GALVANIC_SERIES_V_SCE = {
  "cfrp-quasi-iso": 0.20, "cfrp-hexply-8552-agp193pw": 0.20,
  "iso-3506-a4-80": -0.05, "stainless-316": -0.05,
  "titanium-ti6al4v": -0.07,
  "iso-3506-a2-70": -0.08, "stainless-304": -0.08,
  "copper-c11000": -0.36,
  "cast-iron-gray-30": -0.61,
  "astm-a307": -0.61, "astm-a325": -0.61, "astm-a490": -0.61,
  "steel-a36": -0.61, "steel-a992": -0.61, "steel-4140": -0.61, "steel-8620": -0.61,
  "aluminum-6061-t6": -0.74, "aluminum-6061-t6-b221": -0.74,
  "aluminum-7075-t6": -0.78,
  "aluminum-5052-h32": -0.79,
};

// Compatibility limits on ΔV (MIL-STD-889 practice): immersion
// tolerates the least; an indoor-dry joint has no electrolyte path.
const GALVANIC_LIMIT_V = {
  "marine-submerged": 0.15,
  "marine-atmospheric": 0.25,
  "chemical": 0.25,
  "outdoor-urban": 0.25,
  "outdoor-rural": 0.25,
  "indoor-dry": Infinity,
};

const jointTargets = (g) => g.nodesOfKind("Joint").map((n) => n.id)
  .filter((id) => {
    const kinds = g.children(id).map((k) => k.kind);
    return kinds.includes("Bolt") && kinds.includes("Plate");
  });

function jointParts(ctx, id) {
  const kids = ctx.children(id, "CONTAINS");
  return { bolts: kids.filter((k) => k.kind === "Bolt"), plates: kids.filter((k) => k.kind === "Plate") };
}

export const galvanicCorrosion = registerSolver({
  id: "joint.galvanic-corrosion",
  version: "1.0.0",
  domain: "corrosion.galvanic",
  fidelity: 1,
  screening: true,
  method: "Galvanic series (seawater, V vs SCE): ΔV between bolt and plate materials vs the environment's compatibility limit (0.15 V submerged / 0.25 V exposed, MIL-STD-889 practice); indoor-dry joints have no electrolyte path",
  reference: "ASTM G82 galvanic series for seawater; MIL-STD-889 dissimilar-metals compatibility bands",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts, plates } = jointParts(ctx, id);
    const covers = [id, ...bolts.map((b) => b.id), ...plates.map((p) => p.id)];
    const envR = readEnvironment(ctx, id);
    if (envR.error) return { notComputed: envR.error, covers };
    const { env } = envR;
    const inputs = { environment: { value: env } };
    const failures = [];
    const warnings = [];
    const pairs = [];
    for (const b of bolts) {
      const bm = ctx.material(b.id);
      const bV = bm ? GALVANIC_SERIES_V_SCE[bm.id] : undefined;
      if (bV === undefined) return { notComputed: `${b.id}: material "${bm?.id || "none"}" is not in the galvanic series table — its corrosion potential is not known to this solver`, covers };
      inputs[`${b.id}.galvanicPotential`] = { value: bV, unit: "V vs SCE", source: "galvanic series (seawater)" };
      for (const p of plates) {
        const pm = ctx.material(p.id);
        const pV = pm ? GALVANIC_SERIES_V_SCE[pm.id] : undefined;
        if (pV === undefined) return { notComputed: `${p.id}: material "${pm?.id || "none"}" is not in the galvanic series table — its corrosion potential is not known to this solver`, covers };
        inputs[`${p.id}.galvanicPotential`] = { value: pV, unit: "V vs SCE", source: "galvanic series (seawater)" };
        const dV = Math.abs(bV - pV);
        const anode = bV < pV ? b.id : pV < bV ? p.id : null;
        pairs.push({ bolt: b.id, plate: p.id, deltaV: Number(dV.toFixed(3)), anode });
        const limit = GALVANIC_LIMIT_V[env];
        if (dV > limit) {
          failures.push(`${b.id}–${p.id}: ΔV ${dV.toFixed(2)} V exceeds the ${limit} V compatibility limit for a ${env} environment; ${anode} is the anode and will corrode preferentially — isolate the metals or change one material`);
        } else if (env !== "indoor-dry" && dV > limit - 0.10) {
          warnings.push(`${b.id}–${p.id}: ΔV ${dV.toFixed(2)} V is within 0.10 V of the ${env} limit (${limit} V)`);
        }
      }
    }
    if (env === "indoor-dry") warnings.push("Environment declared indoor-dry: no continuous electrolyte, so galvanic attack is not expected; ΔV values are reported for the record (condensation would change this).");
    return {
      inputs,
      outputs: { pairs: { value: pairs }, environment: { value: env }, limitV: { value: GALVANIC_LIMIT_V[env] === Infinity ? null : GALVANIC_LIMIT_V[env] } },
      failures,
      warnings,
      assumptions: [
        "Potentials are passive-state seawater series values; a depassivated stainless surface sits ~0.4 V lower and would change the pairing.",
        "Area ratio is not modelled: a small anode coupled to a large cathode corrodes faster than ΔV alone suggests.",
      ],
      covers,
    };
  },
});

// ── Uniform corrosion section loss (Bolt / Plate) ───────────────────
// Rates are screening midpoints of the published bands for each
// environment (ISO 9223 corrosivity categories for the atmospheric
// classes; standard seawater immersion range for marine-submerged).
export const UNIFORM_CORROSION_MM_PER_YR = {
  "carbon-steel": { "indoor-dry": 0.010, "outdoor-rural": 0.030, "outdoor-urban": 0.050, "marine-atmospheric": 0.080, "marine-submerged": 0.150, "chemical": 0.100 },
  "cast-iron": { "indoor-dry": 0.012, "outdoor-rural": 0.035, "outdoor-urban": 0.058, "marine-atmospheric": 0.090, "marine-submerged": 0.170, "chemical": 0.115 },
  "stainless": { "indoor-dry": 0.001, "outdoor-rural": 0.001, "outdoor-urban": 0.001, "marine-atmospheric": 0.002, "marine-submerged": 0.005, "chemical": 0.003 },
  "aluminum": { "indoor-dry": 0.001, "outdoor-rural": 0.0015, "outdoor-urban": 0.002, "marine-atmospheric": 0.004, "marine-submerged": 0.008, "chemical": 0.005 },
  "copper": { "indoor-dry": 0.002, "outdoor-rural": 0.003, "outdoor-urban": 0.005, "marine-atmospheric": 0.010, "marine-submerged": 0.035, "chemical": 0.015 },
  "titanium": { "indoor-dry": 0.0002, "outdoor-rural": 0.0002, "outdoor-urban": 0.0002, "marine-atmospheric": 0.0002, "marine-submerged": 0.0002, "chemical": 0.0002 },
};

export function corrosionFamily(materialId) {
  if (!materialId) return null;
  if (materialId.startsWith("iso-3506") || materialId.startsWith("stainless")) return "stainless";
  if (materialId.startsWith("aluminum")) return "aluminum";
  if (materialId.startsWith("copper")) return "copper";
  if (materialId.startsWith("titanium")) return "titanium";
  if (materialId.startsWith("cast-iron")) return "cast-iron";
  if (materialId.startsWith("astm-") || materialId.startsWith("steel-")) return "carbon-steel";
  return null;
}

export const uniformCorrosion = registerSolver({
  id: "part.uniform-corrosion",
  version: "1.0.0",
  domain: "corrosion",
  fidelity: 1,
  screening: true,
  method: "Uniform penetration = rate(material family, environment) × design life; section loss vs the design's declared allowable fraction (plate: depth/thickness; bolt: area loss from radial penetration)",
  reference: "ISO 9223 atmospheric corrosivity bands; standard seawater immersion rates",
  targets: (g) => ["Bolt", "Plate"].flatMap((k) => g.nodesOfKind(k).map((n) => n.id)),
  run(ctx, id) {
    const node = ctx.node(id);
    const covers = [id];
    const mat = ctx.material(id);
    const family = corrosionFamily(mat?.id);
    if (!family) return { notComputed: `${id}: no uniform-corrosion rate for material "${mat?.id || "none"}" (non-metals and unlisted alloys are not rated by this solver)`, covers };
    const envR = readEnvironment(ctx, id);
    if (envR.error) return { notComputed: envR.error, covers };
    const life = ctx.get(id, "props.designLifeYears");
    if (!(Number.isFinite(life) && life > 0)) return { notComputed: `${id} declares no props.designLifeYears: section loss needs a design life`, covers };
    const allowable = ctx.get(id, "props.allowableSectionLoss");
    if (!(Number.isFinite(allowable) && allowable > 0 && allowable <= 1)) return { notComputed: `${id} declares no props.allowableSectionLoss (a fraction in (0, 1]): the design must state how much section it may lose`, covers };
    const rate = UNIFORM_CORROSION_MM_PER_YR[family][envR.env];
    const penetrationMm = rate * life;
    let sectionLoss;
    let dimensionMm;
    if (node.kind === "Plate") {
      const t = ctx.get(id, "geometry.thickness");
      if (t == null) return { notComputed: `${id} has no thickness`, covers };
      dimensionMm = t * 1000;
      sectionLoss = penetrationMm / dimensionMm;
    } else {
      const d = ctx.get(id, "geometry.diameter");
      if (d == null) return { notComputed: `${id} has no diameter`, covers };
      dimensionMm = d * 1000;
      const remaining = Math.max(0, dimensionMm - 2 * penetrationMm);
      sectionLoss = 1 - (remaining / dimensionMm) ** 2;
    }
    const warnings = [];
    if (family === "stainless" && envR.env === "marine-submerged") warnings.push("Stainless submerged: the uniform rate assumes a passive surface; crevice and pitting attack are local and are not modelled here.");
    if (family === "aluminum") warnings.push("Aluminum section loss in practice is pitting-dominated; the uniform figure is a screening average.");
    return {
      inputs: {
        material: { value: mat.id }, family: { value: family }, environment: { value: envR.env },
        rate: { value: rate, unit: "mm/yr" }, designLifeYears: { value: life },
        allowableSectionLoss: { value: allowable }, dimension: { value: dimensionMm, unit: "mm" },
      },
      outputs: {
        penetration: { value: Number(penetrationMm.toFixed(4)), unit: "mm" },
        sectionLossFraction: { value: Number(sectionLoss.toFixed(4)) },
      },
      margins: [{ check: `${id} section loss over ${life} yr (${envR.env})`, demand: sectionLoss, capacity: allowable, unit: "fraction" }],
      warnings,
      assumptions: [
        "One penetration depth applied to the section (single-face equivalent); a member wetted on two faces loses section roughly twice as fast — declare a shorter life or lower allowable to cover it.",
        "Rates are screening midpoints of published bands, not site-specific measurements.",
      ],
      covers,
    };
  },
});

// ── Fatigue at a joint: AISC 360 Appendix 3 ─────────────────────────
// Table A-3.1 constants (Cf in ksi³·cycles) and threshold stress
// ranges F_TH (ksi). Design stress range F_SR = (Cf/N)^(1/3); below
// F_TH the detail has effectively infinite life, so the allowable at
// N cycles is max(F_SR, F_TH).
export const AISC_FATIGUE_CATEGORIES = {
  "A": { cf: 250e8, fthKsi: 24 },
  "B": { cf: 120e8, fthKsi: 16 },
  "B'": { cf: 61e8, fthKsi: 12 },
  "C": { cf: 44e8, fthKsi: 10 },
  "C'": { cf: 44e8, fthKsi: 12 },
  "D": { cf: 22e8, fthKsi: 7 },
  "E": { cf: 11e8, fthKsi: 4.5 },
  "E'": { cf: 3.9e8, fthKsi: 2.6 },
};
const KSI_PA = 6.894757e6;

export const jointFatigue = registerSolver({
  id: "joint.fatigue",
  version: "1.0.0",
  domain: "fatigue",
  fidelity: 1,
  method: "AISC 360-16 Appendix 3: F_SR = (Cf/N)^(1/3) per Table A-3.1 category; allowable = max(F_SR, F_TH); check ΔF ≤ allowable",
  reference: "AISC 360-16 Appendix 3, Table A-3.1 (design stress range) and Eq. A-3-1",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts } = jointParts(ctx, id);
    const covers = [id, ...bolts.map((b) => b.id)];
    const category = ctx.get(id, "props.fatigueCategory");
    if (category == null) return { notComputed: `${id} declares no props.fatigueCategory (AISC Appendix 3 Table A-3.1 detail category): the S–N curve cannot be chosen without it`, covers };
    const cat = AISC_FATIGUE_CATEGORIES[category];
    if (!cat) return { notComputed: `${id}: props.fatigueCategory "${category}" is not an AISC Table A-3.1 category`, covers };
    const cycles = ctx.get(id, "props.fatigueCycles");
    if (!(Number.isFinite(cycles) && cycles > 0)) return { notComputed: `${id} declares no props.fatigueCycles: the design cycle count is required`, covers };
    const rangePa = ctx.get(id, "props.fatigueStressRange");
    if (!(Number.isFinite(rangePa) && rangePa > 0)) return { notComputed: `${id} declares no props.fatigueStressRange (SI Pa after compile): the effective stress range ΔF is required`, covers };
    const fsrKsi = Math.cbrt(cat.cf / cycles);
    const allowableKsi = Math.max(fsrKsi, cat.fthKsi);
    const allowablePa = allowableKsi * KSI_PA;
    return {
      inputs: {
        fatigueCategory: { value: category }, fatigueCycles: { value: cycles },
        stressRange: { value: rangePa, unit: "Pa" },
      },
      outputs: {
        designStressRange: { value: Math.round(fsrKsi * KSI_PA), unit: "Pa" },
        thresholdStressRange: { value: Math.round(cat.fthKsi * KSI_PA), unit: "Pa" },
        allowableStressRange: { value: Math.round(allowablePa), unit: "Pa" },
        infiniteLife: { value: rangePa <= cat.fthKsi * KSI_PA },
      },
      margins: [{ check: `${id} fatigue (category ${category}, ${cycles} cycles)`, demand: rangePa, capacity: allowablePa, unit: "Pa" }],
      assumptions: [
        "The declared category is the design's own classification of the detail per Table A-3.1; this solver does not classify details.",
        "Constant-amplitude stress range; variable-amplitude spectra need Miner's-rule summation, which is not modelled.",
      ],
      covers,
    };
  },
});

// ── Fatigue screening for actuators: Basquin S–N ────────────────────
// Actuators have no AISC detail category; this is a screening fit
// only: σa = σ'f·(2N)^b with σ'f = 0.9·Su, b = −0.085 (Shigley's).
export const BASQUIN_B = -0.085;

export const actuatorFatigueScreening = registerSolver({
  id: "actuator.fatigue-screening",
  version: "1.0.0",
  domain: "fatigue",
  fidelity: 1,
  screening: true,
  method: "Basquin S–N screening: Nf = 0.5·(σa / (0.9·Su))^(1/b), σa = stress range / 2, b = −0.085; declared cycles vs computed life",
  reference: "Shigley's Mechanical Engineering Design, Basquin equation and σ'f ≈ 0.9·Su screening fit for steels",
  targets: (g) => g.nodesOfKind("Actuator").map((n) => n.id),
  run(ctx, id) {
    const covers = [id];
    const stressRangePa = ctx.get(id, "props.fatigue.stressRangePa");
    const cycles = ctx.get(id, "props.fatigue.cycles");
    if (!(Number.isFinite(stressRangePa) && stressRangePa > 0)) return { notComputed: `${id} declares no props.fatigue.stressRangePa: fatigue screening needs the cyclic stress range at the part`, covers };
    if (!(Number.isFinite(cycles) && cycles > 0)) return { notComputed: `${id} declares no props.fatigue.cycles: fatigue screening needs the design cycle count`, covers };
    const mat = ctx.material(id);
    if (!mat || mat.ultimatePa == null) return { notComputed: `${id} has no material ultimate strength`, covers };
    const sigmaF = 0.9 * mat.ultimatePa;
    // Basquin is written in stress AMPLITUDE (half the peak-to-peak range); the declared prop is the range.
    // Using the range as the amplitude doubled the stress and shortened the computed life ~3,500x.
    const amplitudePa = stressRangePa / 2;
    const life = 0.5 * Math.pow(amplitudePa / sigmaF, 1 / BASQUIN_B);
    return {
      inputs: {
        stressRange: { value: stressRangePa, unit: "Pa" }, stressAmplitude: { value: amplitudePa, unit: "Pa" }, cycles: { value: cycles },
        [`${id}.Su`]: { value: mat.ultimatePa, unit: "Pa", source: mat.source },
      },
      outputs: { cyclesToFailure: { value: Math.round(life) }, sigmaFPrime: { value: Math.round(sigmaF), unit: "Pa" } },
      margins: [{ check: `${id} fatigue life`, demand: cycles, capacity: life, unit: "cycles" }],
      warnings: [
        "Screening fit only: a single Basquin line, no mean-stress correction, no surface/size/reliability Marin factors, no spectrum (Miner) summation.",
      ],
      assumptions: ["Fully reversed cycling at a constant stress range (R = −1)."],
      covers,
    };
  },
});
