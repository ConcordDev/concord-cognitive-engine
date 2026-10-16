// server/lib/conkay/knowledge/material-ir.js
//
// Blend D brief item 1: a typed material IR for a formulated material, so the
// physics registry's material.* solvers can read it off a design-graph
// Material node (props.formulation).
//
//   { schema, id, name, basis: "mass" | "volume" | "unknown", basisNote,
//     statedTotal, nominal: { rule, fractions: [{ id, pct }] } | null,
//     constituents: [{ id, name, classId, fraction: { min, max } (percent),
//       properties: { density: { lo, hi, unit: "kg/m3", claimRef } | null,
//         youngsModulus, poisson, conductivity, cte, meltTemperature: null } }] }
//
// Every property is a claim reference or null: a constituent the cited
// sources do not cover stays null and the solvers that need it say NOT
// COMPUTED with the constituent named. No property here is a fallback.

import crypto from "node:crypto";
import { sourceFormulation, proposeVersion, constituentClassOf, checkComposition } from "./formulation.js";
import { constituentDensity } from "./constituents.js";
import { CONSTITUENT_PROPERTIES as TABLES, UNKNOWN_PROPERTIES } from "./constituent-properties.js";
import { ruleOfMixturesDensity } from "./rule-of-mixtures.js";

export const MATERIAL_IR_SCHEMA = "conkay.material-ir/1";
export const BASES = Object.freeze(["mass", "volume", "unknown"]);
/** Every property a constituent can carry (null when no source has been read for that class). */
export const PROPERTY_KEYS = Object.freeze(["density", ...new Set(Object.values(TABLES).flatMap((t) => Object.keys(t)))]);

const summary = (c) => ({ lo: c.range ? c.range.min : c.value, hi: c.range ? c.range.max : c.value, unit: c.unit, claimRef: c.id, ...(c.flags?.length ? { flags: [...c.flags] } : {}) });

const PCT_EPS = 1e-9;

/** The material IR of a formulation source text (the knowledge layer's own parse, version and constituents). */
export function materialIrFromText(text, meta = {}) {
  const { record: source } = sourceFormulation(text, meta);
  const version = proposeVersion(source);
  const basis = source.composition.basis === "mass" || source.composition.basis === "volume" ? source.composition.basis : "unknown";
  return {
    schema: MATERIAL_IR_SCHEMA,
    id: source.id.replace(/:source$/, ""),
    name: source.identity.name,
    source: { id: source.id, fixture: meta.fixture || null },
    basis,
    basisNote: basis === "unknown" ? "the source does not say whether the percentages are by mass or by volume" : null,
    statedTotal: source.composition.statedTotal ? source.composition.statedTotal.value : null,
    nominal: version.ok ? { rule: version.rule, recordId: version.record.id, fractions: version.fractions.map((f) => ({ id: f.id, pct: f.pct })) } : null,
    constituents: source.composition.ingredients.map((x) => {
      const { classId } = constituentClassOf(x.name);
      const dc = classId ? constituentDensity(classId) : null;
      return {
        id: x.id,
        name: x.name,
        classId: classId || null,
        fraction: { min: x.amount.min, max: x.amount.max },
        properties: {
          ...Object.fromEntries(PROPERTY_KEYS.map((k) => [k, null])),
          ...Object.fromEntries(Object.entries((classId && TABLES[classId]) || {}).map(([k, c]) => [k, summary(c)])),
          density: dc && dc.range ? { lo: dc.range.min, hi: dc.range.max, unit: "kg/m3", claimRef: dc.id } : null,
        },
        ...((dc && !dc.range) || (classId && UNKNOWN_PROPERTIES[classId]) ? {
          unknown: {
            ...(dc && !dc.range ? { density: `no cited density (${dc.id})` } : {}),
            ...(classId && UNKNOWN_PROPERTIES[classId] ? { other: UNKNOWN_PROPERTIES[classId] } : {}),
          },
        } : {}),
      };
    }),
  };
}

/** Errors in a material IR ([] when valid). */
export function validateMaterialIr(ir) {
  const errors = [];
  if (!ir || typeof ir !== "object") return ["the material IR is not an object"];
  if (ir.schema !== MATERIAL_IR_SCHEMA) errors.push(`schema must be ${MATERIAL_IR_SCHEMA}`);
  if (!BASES.includes(ir.basis)) errors.push(`basis must be one of ${BASES.join(", ")} (say "unknown" when the source does not state it)`);
  const cs = Array.isArray(ir.constituents) ? ir.constituents : [];
  if (!cs.length) errors.push("a material needs at least one constituent");
  const seen = new Set();
  for (const c of cs) {
    if (!c?.id || seen.has(c.id)) errors.push(`constituent id missing or duplicated (${c?.id})`);
    seen.add(c?.id);
    const f = c?.fraction;
    if (!f || !Number.isFinite(f.min) || !Number.isFinite(f.max)) { errors.push(`${c?.id}: fraction {min, max} must be numbers (percent)`); continue; }
    if (f.min < 0 || f.max < 0) errors.push(`${c.id}: a fraction cannot be negative`);
    if (f.min > f.max) errors.push(`${c.id}: fraction min ${f.min} > max ${f.max}`);
    if (f.max > 100) errors.push(`${c.id}: a fraction cannot exceed 100 %`);
    const d = c.properties?.density;
    if (d != null && !(d.lo > 0 && d.hi >= d.lo)) errors.push(`${c.id}: density interval must be 0 < lo <= hi`);
  }
  if (ir.nominal) {
    const ids = new Set(cs.map((c) => c.id));
    const sum = ir.nominal.fractions.reduce((a, f) => a + f.pct, 0);
    if (Math.abs(sum - 100) > 1e-6) errors.push(`the nominal fractions sum to ${+sum.toFixed(6)} %, not 100 %`);
    for (const f of ir.nominal.fractions) {
      if (!ids.has(f.id)) errors.push(`nominal fraction for unknown constituent ${f.id}`);
      const c = cs.find((x) => x.id === f.id);
      if (c && (f.pct < c.fraction.min - PCT_EPS || f.pct > c.fraction.max + PCT_EPS)) errors.push(`${f.id}: nominal ${f.pct} % is outside its range ${c.fraction.min}–${c.fraction.max} %`);
    }
  }
  return errors;
}

/**
 * Mass fractions → volume fractions: φ_i = (w_i/ρ_i) / Σ_j (w_j/ρ_j).
 * w: point mass fractions in percent (sum 100). densities: [{ lo, hi }] kg/m³ (lo == hi for a point).
 * φ_i rises with ρ_j (j ≠ i) and falls with ρ_i, so its exact bounds over the density box are
 * φ_i,max at (ρ_i = lo, ρ_j = hi) and φ_i,min at (ρ_i = hi, ρ_j = lo). Nominal: every ρ at its midpoint.
 * Returns { ok, phi: [{ pct, min, max }] } or { ok:false, missing } when a density is unknown.
 */
export function massToVolumeFractions(w, densities) {
  if (!Array.isArray(w) || w.length !== densities.length || !w.length) throw new Error("mass fractions and densities must be equal-length non-empty lists");
  if (w.some((x) => !Number.isFinite(x) || x < 0)) throw new Error("mass fractions must be non-negative numbers (percent)");
  const sum = w.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 1e-6) throw new Error(`mass fractions must sum to 100 % (got ${sum})`);
  const missing = densities.map((d, i) => (d && d.lo > 0 && d.hi >= d.lo ? null : i)).filter((i) => i != null);
  if (missing.length) return { ok: false, missing };
  const phiAt = (i, rho) => {
    const v = w.map((x, j) => x / rho[j]);
    return (100 * v[i]) / v.reduce((a, b) => a + b, 0);
  };
  const mid = densities.map((d) => (d.lo + d.hi) / 2);
  return {
    ok: true,
    phi: w.map((_, i) => ({
      pct: phiAt(i, mid),
      max: phiAt(i, densities.map((d, j) => (j === i ? d.lo : d.hi))),
      min: phiAt(i, densities.map((d, j) => (j === i ? d.hi : d.lo))),
    })),
  };
}

/** The density assumptions the formulation report states for its strict reading (kept verbatim for receipt identity). */
export const STRICT_DENSITY_ASSUMPTIONS = Object.freeze([
  "mass-fraction basis (the source does not say wt% or vol%)",
  "additive volumes, no voids",
  "constituent densities are class-level intervals from the cited sources",
]);

/**
 * The strict rule-of-mixtures density of a material IR: every constituent at its cited density interval,
 * the composition ranges propagated, the nominal at the proposed version. Shared by the formulation
 * report and the material.density-rom solver, so both produce the same receipt.
 */
export function strictDensity(ir) {
  const inputs = ir.constituents.map((c) => ({
    id: c.id, classId: c.classId, fraction: { min: c.fraction.min, max: c.fraction.max },
    density: c.properties.density ? { lo: c.properties.density.lo, hi: c.properties.density.hi } : null,
    claimRef: c.properties.density ? c.properties.density.claimRef : (c.classId ? constituentDensity(c.classId)?.id || null : null),
  }));
  const pointPct = ir.nominal ? ir.constituents.map((c) => ir.nominal.fractions.find((f) => f.id === c.id).pct) : null;
  const basis = ir.basis === "volume" ? "volume" : "mass";
  return { inputs, pointPct, result: ruleOfMixturesDensity({ inputs, basis, pointFractions: pointPct, assumptions: [...STRICT_DENSITY_ASSUMPTIONS], label: "strict" }) };
}

/** The assumed span for a polymer the sources do not identify (assumption A1 of the conditional estimate). */
export const PE_FAMILY_SPAN = Object.freeze({ lo: 910, hi: 970, doc: "mol-hdpe-catalogue-2023" });

/**
 * The conditional (screening) density when the strict one is unknown: every constituent without a cited density
 * is assumed polyethylene-family (A1), with the mass and the volume reading of the unstated basis. Shared by the
 * formulation report and material.density-rom (one receipt for both). Never a property of record.
 */
export function conditionalDensity({ inputs, missing, pointPct }) {
  const assumed = inputs.map((x) => (x.density ? x : { ...x, density: { lo: PE_FAMILY_SPAN.lo, hi: PE_FAMILY_SPAN.hi }, claimRef: `ASSUMPTION A1 (${PE_FAMILY_SPAN.doc})` }));
  const assumptions = [
    `A1: every ingredient without a cited density (${missing.join(", ")}) is assumed to be a polyethylene-family polymer with density 0.910–0.970 g/cm³ (MOL HDPE catalogue p.4, 'Polyethylene density (0.910–0.970 g/cm³)'). NOT established for the actual copolymer.`,
    "A2: mass-fraction basis (the source does not say wt% or vol%)",
    "A3: 'graphene' is graphene nanoplatelets (xGnP-class true density 2.0–2.25 g/cm³)",
    "A4: additive volumes, no voids (real moulded parts usually have some porosity, which lowers density)",
  ];
  const mass = ruleOfMixturesDensity({ inputs: assumed, basis: "mass", pointFractions: pointPct, assumptions, label: "conditional" });
  const volume = ruleOfMixturesDensity({ inputs: assumed, basis: "volume", pointFractions: pointPct, assumptions: [...assumptions.slice(0, 1), "volume-fraction basis (alternative reading of the unstated basis)", ...assumptions.slice(2)], label: "conditional-volume-basis" });
  return { assumed, assumptions, mass, volume };
}

/** The composition-sum check of a material IR, with the formulation report's receipt (same construction, same id). */
export function compositionCheck(ir) {
  const ings = ir.constituents.map((c) => ({ id: c.id, name: c.name, min: c.fraction.min, max: c.fraction.max }));
  const check = checkComposition(ings, ir.statedTotal == null ? null : { value: ir.statedTotal });
  const receipt = { solver: "composition-sum-check", solverVersion: "1.0.0", inputs: ings, outputs: check, arithmetic: "integer units of 0.0001 %" };
  receipt.id = `receipt:composition-sum-check:${crypto.createHash("sha256").update(JSON.stringify(receipt)).digest("hex").slice(0, 16)}`;
  return { check, receipt };
}
