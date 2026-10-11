// server/lib/conkay/knowledge/spec-rechecks.js
//
// Re-check every computed claim in the Sentinel/RAM spec with ConKay's own
// arithmetic and cited constants, and say agree / disagree. The document's
// numbers are inputs to be checked, never outputs to be trusted: each
// re-check states its inputs (with a source, or "doc" when the spec itself
// is the stated input, e.g. the salinity fit), the method, the tolerance
// (half a unit in the last digit the spec printed, or ±5 % where the spec
// says "about"/"~") and a receipt id = sha256 of the canonical inputs.
//
// Where a passage asserts something a conservation law or a sourced value
// rules out, the re-check also emits a "contradicted" claim carrying that
// law/source AND the calculation receipt (claims.js enforces both).

import crypto from "node:crypto";
import { SOURCES, sourceRef } from "../northstar/sources.js";
import { findPassage } from "./spec-parser.js";
import { makeClaim, validateClaim } from "./claims.js";
import { parseFormulationText, checkComposition } from "./formulation.js";
import { loadFixture } from "./index.js";
import { energyBalance } from "../physics/solvers/energy-balance.js";

export const RECHECK_VERSION = "1.0.0";

// Constants. Exact SI values; the rest from SOURCES (northstar/sources.js).
export const K = Object.freeze({
  c: 299792458, // m/s, exact (SI 2019)
  h: 6.62607015e-34, // J·s, exact
  e: 1.602176634e-19, // C, exact
  NA: 6.02214076e23, // 1/mol, exact
  get F() { return this.NA * this.e; }, // C/mol, exact product
  M_H2: 2.01588, // g/mol, NIST WebBook
  dG: 237.1, // kJ/mol, HyperPhysics (298 K, 1 atm)
  dH: 285.83, // kJ/mol, HyperPhysics
  HHV_btu_lb: 61013, LHV_btu_lb: 51585, // AFDC
  BTU_LB_TO_KJ_KG: 2.326, // exact (IT Btu, avoirdupois lb)
  pemSystem: 55, pemStack: 51, // kWh/kg, DOE 2022 status
  nirMaxUm: 3, // ISO 20473 NIR upper edge (µm)
  AU: 149597870700, // m, IAU 2012 exact
  moonA: 384400e3, // m, NASA fact sheet semimajor axis
});
const HHV_KWH = (K.HHV_btu_lb * K.BTU_LB_TO_KJ_KG) / 3600;
const LHV_KWH = (K.LHV_btu_lb * K.BTU_LB_TO_KJ_KG) / 3600;

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const sha = (v) => crypto.createHash("sha256").update(canonical(v)).digest("hex");

/** Decimal places printed in a number string ("4.90" → 2, "171,500" → 0). */
function decimals(text) {
  const m = String(text).match(/\.(\d+)/);
  return m ? m[1].length : 0;
}

// Each re-check: the passage it checks (anchor), the value the doc printed,
// how ConKay computes it, and the inputs with their provenance.
const BLEND_D = () => {
  const f = loadFixture("usb-blend-d");
  const p = parseFormulationText(typeof f === "string" ? f : f.text);
  return { parsed: p, check: checkComposition(p.ingredients) };
};
const nDot = () => 2.5 / K.M_H2; // mol/min from the doc's stated production rate
const kgPerH = () => (2.5 * 60) / 1000;

const RECHECKS = [
  { id: "raman.wavenumber", label: "Δν₁ = 3222.8 + 1.69 × 3.5", anchor: /3228\.715/, doc: "3228.715", unit: "cm⁻¹",
    inputs: { fitIntercept: [3222.8, "cm⁻¹", "doc"], fitSlope: [1.69, "cm⁻¹ per mass-%", "doc"], salinity: [3.5, "mass-%", "doc"] },
    compute: () => 3222.8 + 1.69 * 3.5, method: "stated linear fit (the fit itself is the doc's input, not re-sourced)" },
  { id: "raman.frequency", label: "ν = Δν × c", anchor: /96\.79\s*THz/, doc: "96.79", unit: "THz",
    inputs: { c: [K.c, "m/s", "si-2019-exact-constants"] },
    compute: () => (3228.715 * 100 * K.c) / 1e12, method: "ν = ṽ·c, ṽ in m⁻¹" },
  { id: "raman.wavelength", label: "λ = c/ν = 1/ṽ", anchor: /λ = c \/ ν = 3097/, doc: "3097", unit: "nm",
    inputs: { c: [K.c, "m/s", "si-2019-exact-constants"] }, compute: () => 1e7 / 3228.715, method: "λ = 1/ṽ" },
  { id: "raman.photon-energy", label: "E = hν", anchor: /E = hν = 0\.400/, doc: "0.400", unit: "eV",
    inputs: { h: [K.h, "J·s", "si-2019-exact-constants"], e: [K.e, "C", "si-2019-exact-constants"] },
    compute: () => (K.h * 3228.715 * 100 * K.c) / K.e, method: "E = h·c·ṽ / e" },
  { id: "raman.band", label: "3097 nm lies beyond the near-infrared upper edge", anchor: /3097 nm is mid-infrared/, doc: "3.097", unit: "µm (> NIR edge)",
    inputs: { nirUpperEdge: [K.nirMaxUm, "µm", "iso-20473"] }, compute: () => 1e4 / 3228.715, method: "compare λ with ISO 20473 band edges",
    agreeIf: (v) => v > K.nirMaxUm, note: "Agrees that 3097 nm is mid-IR. The spec puts the NIR edge 'near 2500 nm' (a spectroscopy convention); ISO 20473 puts it at 3 µm. 3.097 µm is mid-IR under both." },
  { id: "march.kj-per-mol", label: "March 38.62 kJ/mol = one 0.400 eV photon per molecule × N_A", anchor: /38\.62 kJ per mole/, doc: "38.62", unit: "kJ/mol",
    inputs: { NA: [K.NA, "1/mol", "si-2019-exact-constants"] }, compute: () => (K.h * 3228.715 * 100 * K.c * K.NA) / 1000, method: "N_A·h·c·ṽ",
    note: "ConKay finding: the March energy basis is exactly the photon energy per molecule, not the reaction energy (ΔG 237.1 kJ/mol)." },
  { id: "march.805w", label: "March 805 W = ṅ × 38.62 kJ/mol", anchor: /concluded 805 W/, doc: "805", unit: "W",
    inputs: { M_H2: [K.M_H2, "g/mol", "nist-webbook-h2"] }, compute: () => (nDot() * 38.62 * 1000) / 60, method: "ṅ·E/60",
    note: "Disagrees by ~0.9 %: 805 W reproduces only with M(H₂) = 2.000 g/mol (1.25 mol/min). With 2.01588 g/mol it is 798 W. Either way the basis is wrong (see h2.gibbs)." },
  { id: "electro.e-rev", label: "E_rev = ΔG/(2F)", anchor: /1\.229 V/, doc: "1.229", unit: "V",
    inputs: { dG: [K.dG, "kJ/mol", "hyperphysics-electrolysis"], F: [K.F, "C/mol", "si-2019-exact-constants"] }, compute: () => (K.dG * 1000) / (2 * K.F), method: "ΔG/(nF), n = 2" },
  { id: "electro.e-tn", label: "E_tn = ΔH/(2F)", anchor: /1\.481 V/, doc: "1.481", unit: "V",
    inputs: { dH: [K.dH, "kJ/mol", "hyperphysics-electrolysis"], F: [K.F, "C/mol", "si-2019-exact-constants"] }, compute: () => (K.dH * 1000) / (2 * K.F), method: "ΔH/(nF), n = 2" },
  { id: "h2.ndot", label: "ṅ = 2.5 g/min ÷ M(H₂)", anchor: /1\.240\s*mol/, doc: "1.240", unit: "mol/min",
    inputs: { rate: [2.5, "g/min", "doc"], M_H2: [K.M_H2, "g/mol", "nist-webbook-h2"] }, compute: nDot, method: "m-dot / M" },
  { id: "h2.kgph", label: "2.5 g/min in kg/h", anchor: /0\.150\s*kg/, doc: "0.150", unit: "kg/h", inputs: { rate: [2.5, "g/min", "doc"] }, compute: kgPerH, method: "×60/1000" },
  { id: "h2.gibbs", label: "Gibbs minimum: ṅ × ΔG", anchor: /Gibbs electrical minimum/, doc: "4.90", unit: "kW",
    inputs: { dG: [K.dG, "kJ/mol", "hyperphysics-electrolysis"], M_H2: [K.M_H2, "g/mol", "nist-webbook-h2"] }, compute: () => (nDot() * K.dG) / 60, method: "ṅ·ΔG / 60 s" },
  { id: "h2.thermoneutral", label: "Thermoneutral: ṅ × ΔH", anchor: /Thermoneutral, electricity/, doc: "5.91", unit: "kW",
    inputs: { dH: [K.dH, "kJ/mol", "hyperphysics-electrolysis"], M_H2: [K.M_H2, "g/mol", "nist-webbook-h2"] }, compute: () => (nDot() * K.dH) / 60, method: "ṅ·ΔH / 60 s" },
  { id: "h2.hhv-value", label: "HHV in kWh/kg", anchor: /HHV equivalent/, doc: "39.4", unit: "kWh/kg",
    inputs: { HHV: [K.HHV_btu_lb, "Btu/lb", "afdc-fuel-comparison"] }, compute: () => HHV_KWH, method: "Btu/lb × 2.326 kJ/kg ÷ 3600" },
  { id: "h2.hhv", label: "HHV rate: 39.4 kWh/kg × 0.150 kg/h", anchor: /HHV equivalent/, doc: "5.91", unit: "kW",
    inputs: { HHV: [K.HHV_btu_lb, "Btu/lb", "afdc-fuel-comparison"] }, compute: () => HHV_KWH * kgPerH(), method: "HHV × m-dot" },
  { id: "h2.lhv-value", label: "LHV in kWh/kg", anchor: /LHV equivalent/, doc: "33.3", unit: "kWh/kg",
    inputs: { LHV: [K.LHV_btu_lb, "Btu/lb", "afdc-fuel-comparison"] }, compute: () => LHV_KWH, method: "Btu/lb × 2.326 kJ/kg ÷ 3600" },
  { id: "h2.lhv", label: "LHV rate: 33.3 kWh/kg × 0.150 kg/h", anchor: /LHV equivalent/, doc: "5.00", unit: "kW",
    inputs: { LHV: [K.LHV_btu_lb, "Btu/lb", "afdc-fuel-comparison"] }, compute: () => LHV_KWH * kgPerH(), method: "LHV × m-dot" },
  { id: "h2.pem", label: "PEM system: 55 kWh/kg × 0.150 kg/h", anchor: /Current PEM system electricity/, doc: "8.3", unit: "kW",
    inputs: { pem: [K.pemSystem, "kWh/kg", "doe-pem-targets"] }, compute: () => K.pemSystem * kgPerH(), method: "specific energy × m-dot",
    note: "DOE 2022 status confirms 51 kWh/kg stack and 55 kWh/kg system. The spec's '~55–57.5' upper value was not found in the DOE table and is not re-checked." },
  { id: "loop.return", label: "Engine-alternator return 0.20 × LHV", anchor: /returns about 6\.7 kWh\/kg/, doc: "6.7", unit: "kWh/kg",
    inputs: { LHV: [K.LHV_btu_lb, "Btu/lb", "afdc-fuel-comparison"], eta: [0.2, "1", "doc (assumed conversion efficiency)"] }, compute: () => 0.2 * LHV_KWH, method: "η·LHV" },
  { id: "loop.efficiency", label: "η_loop ≈ 0.20 × 33.3 / 55", anchor: /eta_loop|η_loop/, doc: "0.12", unit: "1",
    inputs: { LHV: [K.LHV_btu_lb, "Btu/lb", "afdc-fuel-comparison"], pem: [K.pemSystem, "kWh/kg", "doe-pem-targets"], eta: [0.2, "1", "doc"] }, compute: () => (0.2 * LHV_KWH) / K.pemSystem, method: "returned / input energy per kg" },
  { id: "formulation.blend-d.min", label: "USB Blend D: sum of range minima", anchor: /USB Blend D; Sum of minima/, doc: "85", unit: "%",
    inputs: { recipe: ["usb-blend-d.txt", "text", "fixture ~/.zuko/usb-formulas Blend D (verbatim)"] }, compute: () => BLEND_D().check.minSumPct, method: "Σ min over the six ranges of the verbatim Blend D text",
    note: "ConKay reads 65+10+5+3+2+1 = 86 % from the Blend D text on file; the spec's 85 % is off by one point. Both agree the recipe cannot be read as a composition (the ranges do not fix 100 %)." },
  { id: "formulation.blend-d.max", label: "USB Blend D: sum of range maxima", anchor: /USB Blend D; Sum of minima/, doc: "103", unit: "%",
    inputs: { recipe: ["usb-blend-d.txt", "text", "fixture"] }, compute: () => BLEND_D().check.maxSumPct, method: "Σ max (70+15+8+5+3+2)" },
  ...[["blend-d", /USB Blend D; Sum of minima/, () => [BLEND_D().check.minSumPct, BLEND_D().check.maxSumPct], "ConKay's own sums from the Blend D text"],
    ["steel-usb", /Steel-USB reinforcement; Sum of minima/, () => [81, 97], "the spec's own sums (March ranges not on file)"],
    ["piezo-shell", /Piezoelectric outer shell; Sum of minima/, () => [78, 92], "the spec's own sums (March ranges not on file)"],
    ["sensory-layer", /Sensory layer; Sum of minima/, () => [72, 82], "the spec's own sums (March ranges not on file)"],
  ].map(([fid, anchor, sums, basis]) => ({
    id: `formulation.${fid}.reach-100`, label: `${fid}: can the ranges total 100 %?`, anchor, doc: "0", unit: "contradicted as a complete recipe (spec)",
    inputs: { sums: [sums().join("–"), "%", basis] }, compute: () => (sums()[0] <= 100 && sums()[1] >= 100 ? 1 : 0), method: "100 % ∈ [Σmin, Σmax] (mass balance)",
    agreeIf: (v) => v === 0, feasibility: true,
    note: fid === "blend-d"
      ? "Disagrees with 'contradicted': 100 % lies inside 86–103 %, so the Blend D ranges are underspecified (they admit many 100 % compositions; ConKay's #1038 proposed version is one), not impossible. No balance component is named, so it is still not a recipe."
      : `Agrees: even the range maxima total < 100 % (${sums()[1]} %), so no reading of these ranges is a complete recipe without an unnamed balance component (computed from ${basis}).`,
  })),
  { id: "scale.square-cube", label: "4000 lb × (35/10)³", anchor: /171\{?,?\}?500|171,500/, doc: "171,500", unit: "lb",
    inputs: { m1: [4000, "lb", "doc (Mark I, not measured)"], L: [3.5, "1", "doc (35 ft / 10 ft)"] }, compute: () => 4000 * 3.5 ** 3, method: "m ∝ L³ at equal density" },
  { id: "scale.ratio", label: "171,500 / 40,000", anchor: /about 4\.3 times lighter/, doc: "4.3", unit: "1", inputs: {}, compute: () => (4000 * 3.5 ** 3) / 40000, method: "ratio" },
  { id: "transit.mars", label: "1 AU in 2.5 days", anchor: /700 km\/s/, doc: "700", unit: "km/s", approx: true,
    inputs: { AU: [K.AU, "m", "iau-2012-b2"] }, compute: () => K.AU / (2.5 * 86400) / 1000, method: "average speed = distance / time",
    assumptions: ["straight-line 1 AU (spec's own average; real Earth–Mars range 0.5–2.5 AU gives 346–1731 km/s)", "constant speed, no acceleration or braking phase (a real profile needs a higher peak)"] },
  { id: "transit.moon", label: "Earth–Moon in 3.5 h", anchor: /30 km\/s/, doc: "30", unit: "km/s", approx: true,
    inputs: { a: [K.moonA, "m", "nasa-moon-fact-sheet"] }, compute: () => K.moonA / (3.5 * 3600) / 1000, method: "average speed = semimajor axis / time",
    assumptions: ["centre-to-centre mean distance (semimajor axis)", "constant speed, straight line"] },
];

function tolerance(r) {
  if (r.approx) return { kind: "relative", value: 0.05 };
  return { kind: "absolute", value: 0.5 * 10 ** -decimals(r.doc) };
}

/**
 * Run every re-check against a parsed spec. Returns rows plus ConKay claims
 * (computed when the arithmetic agrees; the doc's own number stays the
 * doc's assertion either way).
 */
export function runRechecks(parsed) {
  const rows = [];
  for (const r of RECHECKS) {
    const passage = findPassage(parsed, r.anchor);
    const docValue = Number(String(r.doc).replace(/,/g, ""));
    const value = r.compute();
    const tol = tolerance(r);
    const diff = Math.abs(value - docValue);
    const agree = r.agreeIf ? r.agreeIf(value) : tol.kind === "relative" ? diff <= tol.value * Math.abs(docValue) : diff <= tol.value + 1e-12;
    const inputs = Object.fromEntries(Object.entries(r.inputs).map(([k, [v, unit, src]]) => [k, { value: v, unit, source: src }]));
    const receiptId = sha({ recheck: r.id, version: RECHECK_VERSION, inputs, method: r.method, value });
    rows.push({
      id: r.id, label: r.label,
      passage: passage ? { id: passage.id, lines: passage.provenance.lines, statedStatus: passage.statedStatus } : null,
      doc: { value: docValue, text: r.doc, unit: r.unit },
      conkay: { value, unit: r.unit },
      tolerance: tol,
      deltaPct: docValue && !r.feasibility ? ((value - docValue) / docValue) * 100 : null,
      verdict: agree ? "agree" : "disagree",
      method: r.method,
      inputs,
      assumptions: r.assumptions || [],
      note: r.note || null,
      anchorRx: r.anchor,
      kind: r.feasibility ? "feasibility" : "numeric",
      receiptId,
    });
  }
  return { version: RECHECK_VERSION, docSha256: parsed.doc.sha256, rows, contradicted: contradictedClaims(rows, parsed), claims: rows.map(toClaim) };
}

function toClaim(row) {
  const realSources = Object.values(row.inputs).map((i) => i.source).filter((s) => SOURCES[s]);
  const evidence = [
    { kind: "user_statement", title: "Sentinel/RAM spec rev 1.0", locator: row.passage ? `lines ${row.passage.lines.join("-")}` : null, excerpt: `the spec prints ${row.doc.text} ${row.doc.unit}` },
    ...[...new Set(realSources)].map((s) => sourceRef(s)),
    { kind: "calculation", title: `ConKay re-check ${row.id}`, excerpt: row.method, sha256: row.receiptId, receiptRef: row.receiptId },
  ];
  return makeClaim({
    id: `recheck.${row.id}`,
    subject: "sentinel-ram-spec-r1",
    property: row.id,
    kind: "quantitative",
    value: row.conkay.value,
    unit: row.conkay.unit,
    status: ["computed"],
    support: "supported",
    flags: [row.verdict === "agree" ? "spec-value-agrees" : "spec-value-disagrees"],
    method: { kind: "calculation", description: row.method, standard: null, receiptRef: row.receiptId, assumptions: row.assumptions },
    evidence,
    statement: `${row.label}: spec ${row.doc.text} ${row.doc.unit}, ConKay ${+row.conkay.value.toPrecision(6)} ${row.conkay.unit} (${row.verdict})`,
  });
}

const LAW = {
  energy: { kind: "law", sourceId: "law:energy-conservation", title: "First law of thermodynamics (energy conservation)", excerpt: "output energy cannot exceed input energy" },
  gibbs: { kind: "law", sourceId: "law:gibbs-minimum-work", title: "Second law: minimum electrical work for a reaction is ΔG", excerpt: "splitting water needs ≥ ΔG per mole however it is driven" },
  photon: { kind: "law", sourceId: "law:photon-energy", title: "Planck relation E = hν (one photon, one quantum)", excerpt: "a single photon delivers hν; less than the bond energy cannot break it alone" },
  geometry: { kind: "law", sourceId: "law:square-cube", title: "Square-cube law: mass ∝ L³ at constant density", excerpt: "geometric similarity" },
  kinematics: { kind: "law", sourceId: "law:average-speed", title: "Average speed = distance / time", excerpt: "kinematics" },
};

/**
 * The contradicted claims, each with its basis and the calculation that shows
 * the conflict (both required by claims.js).
 */
function contradictedClaims(rows, parsedRef) {
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  const calc = (r) => ({ kind: "calculation", title: `ConKay re-check ${r.id}`, excerpt: r.method, sha256: r.receiptId, receiptRef: r.receiptId });
  const loop = energyBalance({
    inputs: [{ id: "electricity-to-electrolyzer", energy: K.pemSystem, unit: "kWh/kg", status: "sourced" }],
    outputs: [{ id: "electricity-returned", energy: 0.2 * LHV_KWH, unit: "kWh/kg", status: "computed" }],
    claim: "self-sustaining",
  });
  const loopReceipt = sha({ energyBalance: loop });
  const out = [
    { id: "contra.march-emitter-1.61kw", anchor: /March emitter estimate/, subject: "QCL emitter power for 2.5 g/min H2", statement: "March emitter estimate 1.61 kW", value: 1.61, unit: "kW", bin: "unsupported-as-stated",
      evidence: [LAW.gibbs, sourceRef("hyperphysics-electrolysis"), calc(by["h2.gibbs"])], note: `Gibbs floor is ${by["h2.gibbs"].conkay.value.toFixed(2)} kW at this rate; 1.61 kW is below the minimum work.` },
    { id: "contra.photon-splitting", anchor: /irradiating seawater at 96\.79 THz/, subject: "96.79 THz photon splitting water", statement: "irradiating seawater at 96.79 THz dissociates it", value: by["raman.photon-energy"].conkay.value, unit: "eV", bin: "unsupported-as-stated",
      evidence: [LAW.photon, calc(by["raman.photon-energy"])], note: "0.400 eV per photon vs ≥ 1.229 eV per electron-pair equivalent (ΔG/2F) and ~4.8 eV O–H bond (spec's figure, not re-sourced)." },
    { id: "contra.near-infrared", anchor: /3097 nm is mid-infrared/, subject: "96.79 THz band", statement: "96.79 THz is near-infrared", value: by["raman.band"].conkay.value, unit: "µm", bin: "unsupported-as-stated",
      evidence: [sourceRef("iso-20473", "standard"), calc(by["raman.band"])] },
    { id: "contra.indefinite-operation", anchor: /one battery start, indefinite operation/, subject: "closed H2 loop", statement: "one battery start, indefinite operation", value: loop.ratio, unit: "1", bin: "unsupported-as-stated",
      evidence: [LAW.energy, sourceRef("doe-pem-targets"), sourceRef("afdc-fuel-comparison"), { kind: "calculation", title: "energy balance of the closed loop", excerpt: "returned / input energy per kg H2", sha256: loopReceipt, receiptRef: loopReceipt }],
      note: `Returns ${(loop.ratio * 100).toFixed(1)} % of the input per cycle; net ${loop.net.toFixed(1)} kWh/kg.` },
    { id: "contra.mark3-mass-pair", anchor: /March Mark III operational mass/, subject: "Mark I / Mark III masses", statement: "4,000 lb Mark I and 40,000 lb Mark III at the same construction", value: by["scale.square-cube"].conkay.value, unit: "lb", bin: "unsupported-as-stated",
      evidence: [LAW.geometry, calc(by["scale.square-cube"])] },
    { id: "contra.transit-times", anchor: /Earth–Mars distance/, subject: "Mars 2.5 d / Moon 3.5 h", statement: "stated interplanetary transit times", value: by["transit.mars"].conkay.value, unit: "km/s", bin: "unsupported-as-stated",
      evidence: [LAW.kinematics, sourceRef("iau-2012-b2"), sourceRef("nasa-moon-fact-sheet"), calc(by["transit.mars"]), calc(by["transit.moon"])],
      note: "Average speeds alone; no thrust/propellant budget exists to reach them (spec 7.2)." },
    ...["steel-usb", "piezo-shell", "sensory-layer"].map((fid) => {
      const r = by[`formulation.${fid}.reach-100`];
      return { id: `contra.formulation-${fid}`, anchor: r.anchorRx, subject: `${fid} formulation`, statement: `${fid} ranges as a complete recipe`, value: Number(String(r.inputs.sums.value).split("–")[1]), unit: "%", bin: "research-stage",
        evidence: [{ kind: "law", sourceId: "law:mass-balance", title: "Mass balance: mass fractions of a complete recipe sum to 100 %", excerpt: "Σ wᵢ = 1" }, calc(r)], note: r.note };
    }),
  ];
  return out.map((c) => {
    const passage = parsedRef && c.anchor ? findPassage(parsedRef, c.anchor) : null;
    const claim = makeClaim({ id: c.id, subject: c.subject, property: "assertion", kind: "quantitative", value: c.value, unit: c.unit, status: ["contradicted"], support: "contradicted", bin: c.bin, evidence: c.evidence, statement: c.statement, notes: c.note ? [c.note] : [] });
    const errors = validateClaim(claim);
    return { claim, errors, passage: passage ? { id: passage.id, lines: passage.provenance.lines } : null };
  });
}

export { RECHECKS };
