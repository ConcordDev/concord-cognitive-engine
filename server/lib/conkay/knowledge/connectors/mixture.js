// server/lib/conkay/knowledge/connectors/mixture.js
//
// Knowledge-layer demo 2: a fluid mixture resolved through the connectors and
// computed only as far as the evidence supports, with the limits stated.
//
//   1. identify each component (PubChem: CID, formula, InChIKey, CAS by
//      contributor consensus, molar mass);
//   2. pure-component properties at the stated temperature and pressure (NIST
//      WebBook reference equations, with their stated uncertainties);
//   3. cross-check PubChem's experimental values against them (densities,
//      boiling points) and queue every conflict for review;
//   4. compute what the composition definition supports exactly: mass and mole
//      fractions from the volume fractions of the pure liquids before mixing,
//      the mixture molar mass, the atom balance;
//   5. compute the ideal-mixing (additive-volume, mass-weighted heat capacity)
//      values as a MODEL, under its own subject, never as the mixture's
//      properties;
//   6. leave the mixture's real density, heat capacity, viscosity, thermal
//      conductivity, flash point and bubble point unknown, with the test that
//      would establish each (verified standards only).
// Deterministic; the network is only reached through the getter it is given.

import { makeClaim } from "../claims.js";
import { testsFor } from "../properties.js";
import { sha256 } from "./fetcher.js";
import { identify, experimental } from "./pubchem.js";
import { isobar, NIST_FLUIDS } from "./nist-webbook.js";
import { checkClaims, crossCheckDensities, selectReference, interval, REVIEW_DECISION } from "./review.js";

export const MIXTURE_VERSION = "1.0.0";

export const DEMO2 = Object.freeze({
  name: "methanol-water, 40 vol% methanol",
  slug: "methanol-water-40vol",
  basis: "volume",
  basisDefinition: "volume fractions of the pure liquids measured separately at the stated temperature, before mixing",
  temperatureK: 293.15,
  pressurePa: 101325,
  components: [
    { name: "methanol", fraction: 0.4, nist: { pMPa: 0.101325, tLowK: 273.15, tHighK: 333.15, tIncK: 5 } },
    { name: "water", fraction: 0.6, nist: { pMPa: 0.101325, tLowK: 278.15, tHighK: 333.15, tIncK: 5 }, extra: [{ pMPa: 0.101325, tLowK: 277.15, tHighK: 277.15, tIncK: 1 }] },
  ],
  pubchemHeadings: ["Density", "Boiling Point", "Flash Point"],
});

const ELEMENTS = /([A-Z][a-z]?)(\d*)/g;
export function parseFormula(f) {
  const out = {};
  for (const [, el, n] of f.matchAll(ELEMENTS)) out[el] = (out[el] || 0) + (n ? Number(n) : 1);
  return out;
}

function receipt(solver, inputs, outputs) {
  const r = { solver, version: MIXTURE_VERSION, inputs, outputs };
  return { receipt: r, ref: `receipt:${sha256(JSON.stringify(r)).slice(0, 16)}` };
}
const calcEvidence = (ref, title) => ({ kind: "calculation", sourceId: null, title, url: null, document: null, author: null, date: null, retrieved: null, locator: null, excerpt: null, sha256: null, license: null, receiptRef: ref });

/** Build the demo-2 report with a getter (live, capture or replay). */
export async function mixtureReport(get, spec = DEMO2) {
  const T = spec.temperatureK, P = spec.pressurePa;
  const reviews = [], claims = [], receipts = [], documents = [];
  const comps = [];
  for (const c of spec.components) {
    const id = await identify(c.name, get);
    reviews.push(...(id.reviews || []));
    if (!id.ok) return { ok: false, reason: `could not identify ${c.name}: ${id.reason}`, reviews };
    documents.push(...id.documents);
    const cas = id.identity.identifiers.cas;
    const fluid = NIST_FLUIDS[cas];
    const ref = [];
    if (fluid) {
      for (const req of [c.nist, ...(c.extra || [])]) {
        const iso = await isobar(cas, c.name, req, get);
        if (!iso.ok) { reviews.push({ kind: "source_unavailable", subject: c.name, reason: iso.reason, decision: REVIEW_DECISION }); continue; }
        reviews.push(...iso.reviews.map((r) => ({ ...r, decision: REVIEW_DECISION })));
        ref.push(...iso.claims);
        documents.push(...iso.documents);
      }
    } else {
      reviews.push({ kind: "source_does_not_cover", subject: c.name, reason: `no NIST fluid data set up for CAS ${cas}`, decision: REVIEW_DECISION });
    }
    const exp = [];
    for (const h of spec.pubchemHeadings) {
      const e = await experimental(id.cid, h, c.name, get);
      if (!e.ok) { reviews.push({ kind: "source_unavailable", subject: c.name, reason: `PubChem ${h}: ${e.error}`, decision: REVIEW_DECISION }); continue; }
      if (e.notFound) continue;
      reviews.push(...e.reviews.map((r) => ({ ...r, decision: REVIEW_DECISION })));
      exp.push(...e.claims);
      documents.push(e.document);
    }
    comps.push({ ...c, identity: id.identity, cid: id.cid, molarMass: id.molarMass, formula: id.identity.identifiers.molecularFormula, reference: ref, experimental: exp });
    claims.push(id.molarMass, ...ref, ...exp);
  }

  // cross-checks and conflicts (all sources together)
  const allRef = comps.flatMap((c) => c.reference);
  const xc = crossCheckDensities(comps.flatMap((c) => c.experimental), allRef);
  reviews.push(...xc.reviews);
  claims.push(...xc.checks.map((x) => x.computed));
  reviews.push(...checkClaims(claims.filter((c) => !c.id.includes(":density-check:"))));

  // pure-component inputs at the state (selection rule: NIST at exactly T, P)
  const at = (c, prop) => selectReference(c.reference, c.name, prop, T);
  const inputs = comps.map((c) => ({ name: c.name, fraction: c.fraction, M: c.molarMass, rho: at(c, "liquid_density"), cp: at(c, "specific_heat_capacity"), mu: at(c, "dynamic_viscosity"), k: at(c, "liquid_thermal_conductivity") }));
  const missing = inputs.filter((x) => !x.rho).map((x) => x.name);
  const mixtureSubject = spec.name, modelSubject = `${spec.name} (ideal-mixing model)`;
  const computed = [];
  if (!missing.length) {
    const sumPhi = inputs.reduce((a, x) => a + x.fraction, 0);
    if (Math.abs(sumPhi - 1) > 1e-12) reviews.push({ kind: "composition", subject: mixtureSubject, reason: `volume fractions sum to ${sumPhi}`, decision: REVIEW_DECISION });
    const mass = inputs.map((x) => x.fraction * x.rho.value);
    const mTot = mass.reduce((a, b) => a + b, 0);
    const w = mass.map((m) => m / mTot);
    const mol = inputs.map((x, i) => w[i] / x.M.value);
    const molTot = mol.reduce((a, b) => a + b, 0);
    const xm = mol.map((n) => n / molTot);
    const Mmix = inputs.reduce((a, x, i) => a + xm[i] * x.M.value, 0);
    // uncertainty of w from the density uncertainties (linear propagation)
    const relRho = inputs.map((x) => (interval(x.rho).hi - x.rho.value) / x.rho.value);
    const wHalf = w.map((wi) => wi * (1 - wi) * relRho.reduce((a, r) => a + r, 0));
    const r1 = receipt("mixture-composition", { basis: spec.basis, definition: spec.basisDefinition, components: inputs.map((x) => ({ name: x.name, volumeFraction: x.fraction, densityClaim: x.rho.id, density: x.rho.value, molarMassClaim: x.M.id, molarMass: x.M.value })), temperatureK: T, pressurePa: P }, { massFractions: w, moleFractions: xm, mixtureMolarMass: Mmix });
    receipts.push(r1.receipt);
    const cond = { temperature: T, pressure: P };
    inputs.forEach((x, i) => {
      computed.push(makeClaim({ id: `claim:${spec.slug}:mass-fraction:${x.name}`, subject: mixtureSubject, property: null, kind: "quantitative", value: w[i], unit: "1", label: `mass fraction of ${x.name}`, conditions: { ...cond, basis: "mass" }, uncertainty: { type: "range", low: w[i] - wHalf[i], high: w[i] + wHalf[i], note: "from the stated density uncertainties" }, method: { kind: "calculation", description: "w_i = phi_i rho_i / sum(phi_j rho_j) (volume fractions of the unmixed liquids)", standard: null, receiptRef: r1.ref, assumptions: [] }, status: ["computed"], support: "supported", evidence: [...x.rho.evidence, calcEvidence(r1.ref, "composition conversion")] }));
      computed.push(makeClaim({ id: `claim:${spec.slug}:mole-fraction:${x.name}`, subject: mixtureSubject, property: null, kind: "quantitative", value: xm[i], unit: "1", label: `mole fraction of ${x.name}`, conditions: { ...cond, basis: "mole" }, method: { kind: "calculation", description: "x_i = (w_i / M_i) / sum(w_j / M_j)", standard: null, receiptRef: r1.ref, assumptions: [] }, status: ["computed"], support: "supported", evidence: [...x.M.evidence, calcEvidence(r1.ref, "composition conversion")] }));
    });
    computed.push(makeClaim({ id: `claim:${spec.slug}:molar-mass`, subject: mixtureSubject, property: "molar_mass", kind: "quantitative", value: Mmix, unit: "g/mol", conditions: {}, method: { kind: "calculation", description: "M = sum(x_i M_i)", standard: null, receiptRef: r1.ref, assumptions: [] }, status: ["computed"], support: "supported", evidence: [calcEvidence(r1.ref, "mixture molar mass")] }));

    // atom balance per mole of mixture (stoichiometry only, no atomic weights needed)
    const atoms = {};
    comps.forEach((c, i) => { for (const [el, n] of Object.entries(parseFormula(c.formula))) atoms[el] = (atoms[el] || 0) + xm[i] * n; });
    const r2 = receipt("atom-balance", { formulas: comps.map((c) => c.formula), moleFractions: xm }, { atomsPerMole: atoms });
    receipts.push(r2.receipt);
    for (const [el, n] of Object.entries(atoms).sort()) computed.push(makeClaim({ id: `claim:${spec.slug}:atoms-${el.toLowerCase()}`, subject: mixtureSubject, property: null, kind: "quantitative", value: n, unit: "mol/mol", label: `${el} atoms per mole of mixture`, conditions: {}, method: { kind: "calculation", description: "sum over components of x_i x (atoms of the element in formula i)", standard: null, receiptRef: r2.ref, assumptions: [] }, status: ["computed"], support: "supported", evidence: [calcEvidence(r2.ref, "atom balance")] }));

    // ideal-mixing model (its own subject)
    const rhoId = inputs.reduce((a, x) => a + x.fraction * x.rho.value, 0);
    const rhoIdHalf = inputs.reduce((a, x) => a + x.fraction * (interval(x.rho).hi - x.rho.value), 0);
    const r3 = receipt("ideal-mixing-density", { volumeFractions: inputs.map((x) => x.fraction), densities: inputs.map((x) => x.rho.value) }, { density: rhoId });
    receipts.push(r3.receipt);
    computed.push(makeClaim({ id: `claim:${spec.slug}:ideal-density`, subject: modelSubject, property: "liquid_density", kind: "quantitative", value: rhoId, unit: "kg/m3", conditions: cond, uncertainty: { type: "range", low: rhoId - rhoIdHalf, high: rhoId + rhoIdHalf, note: "input density uncertainty only; says nothing about the model's error" }, method: { kind: "calculation", description: "rho_ideal = sum(phi_i rho_i) = total mass / total unmixed volume (additive volumes)", standard: null, receiptRef: r3.ref, assumptions: ["additive volumes: no excess volume on mixing"] }, status: ["computed"], support: "supported", evidence: [calcEvidence(r3.ref, "ideal-mixing density")], notes: ["a model value, not the mixture's measured density"] }));
    if (inputs.every((x) => x.cp)) {
      const cpId = inputs.reduce((a, x, i) => a + w[i] * x.cp.value, 0);
      const r4 = receipt("ideal-mixing-cp", { massFractions: w, cp: inputs.map((x) => x.cp.value) }, { cp: cpId });
      receipts.push(r4.receipt);
      computed.push(makeClaim({ id: `claim:${spec.slug}:ideal-cp`, subject: modelSubject, property: "specific_heat_capacity", kind: "quantitative", value: cpId, unit: "J/(kg.K)", conditions: cond, method: { kind: "calculation", description: "cp_ideal = sum(w_i cp_i)", standard: null, receiptRef: r4.ref, assumptions: ["no excess heat capacity on mixing"] }, status: ["computed"], support: "supported", evidence: [calcEvidence(r4.ref, "ideal-mixing heat capacity")], notes: ["a model value, not the mixture's heat capacity"] }));
    }
  }

  // the mixture's real properties: unknown, with the test that would establish each
  const unknownProps = [
    ["liquid_density", "the excess volume on mixing is not known from these sources, so the mixture's density is not the ideal-mixing value"],
    ["specific_heat_capacity", "the excess heat capacity is not known from these sources"],
    ["dynamic_viscosity", "no mixing rule for viscosity is validated here for this mixture"],
    ["liquid_thermal_conductivity", "no mixing rule for thermal conductivity is validated here for this mixture"],
    ["flash_point", "a mixture's flash point is not the mole- or mass-weighted pure values; only a test establishes it"],
    ["normal_boiling_point", "vapour-liquid equilibrium is not modelled: the mixture's bubble point is not computed"],
  ];
  const unknowns = unknownProps.map(([p, why]) => makeClaim({ id: `claim:${spec.slug}:${p.replace(/_/g, "-")}`, subject: mixtureSubject, property: p, kind: "quantitative", conditions: p === "flash_point" ? {} : { temperature: T, pressure: P }, status: ["unknown"], support: "unsupported", notes: [why], requiredEvidence: [{ kind: "test", property: p, reason: why }] }));
  const testPlan = unknowns.map((u) => ({ property: u.property, why: u.notes[0], tests: testsFor(u.property) || [], note: (testsFor(u.property) || []).length ? null : "no verified standard for this property is on file (standards.js); none is cited" }));

  const limits = [
    `State: ${T} K and ${P} Pa only; every pure-component value is NIST's at exactly this state.`,
    `Composition basis: ${spec.basisDefinition}.`,
    ...comps.map((c) => { const nb = c.reference.find((x) => x.property === "normal_boiling_point"); const ph = at(c, "liquid_density")?.conditions?.phase; return `${c.name}: phase at the state "${ph || "unknown"}"; NIST normal boiling point ${nb ? `${nb.value} K` : "not available"}.`; }),
    "The ideal-mixing values are a model with no excess volume or heat capacity; they are reported under their own subject and are not the mixture's properties.",
    "PubChem values are contributed records: kept with their contributor and location, cross-checked, never averaged; disagreements are queued for review.",
  ];
  return {
    ok: true, version: MIXTURE_VERSION, spec: { ...spec, components: spec.components.map(({ name, fraction }) => ({ name, fraction })) },
    components: comps.map((c) => ({ name: c.name, identity: c.identity, molarMass: c.molarMass.value, atState: Object.fromEntries(["liquid_density", "specific_heat_capacity", "dynamic_viscosity", "liquid_thermal_conductivity"].map((p) => { const r = at(c, p); return [p, r ? { value: r.value, unit: r.unit, uncertainty: r.uncertainty, claim: r.id } : null]; })) })),
    computed, unknowns, testPlan, crossChecks: xc.checks.map(({ computed: _c, ...x }) => x), claims, receipts,
    reviewQueue: reviews.map((r, i) => ({ id: `review-${String(i + 1).padStart(3, "0")}`, decision: REVIEW_DECISION, ...r })),
    limits, documents: dedupeDocs(documents),
  };
}

function dedupeDocs(docs) {
  const seen = new Map();
  for (const d of docs) if (d && !seen.has(d.url)) seen.set(d.url, d);
  return [...seen.values()];
}

const g = (x, d = 5) => (typeof x === "number" ? Number(x.toPrecision(d)).toString() : String(x));

export function renderMixtureMarkdown(r) {
  if (!r.ok) return `# Mixture report\n\nNot computed: ${r.reason}\n`;
  return [
    `# ${r.spec.name}: knowledge-layer demo 2`,
    "",
    `State ${r.spec.temperatureK} K, ${r.spec.pressurePa} Pa. Composition: ${r.spec.components.map((c) => `${c.name} ${g(c.fraction * 100, 3)} vol%`).join(", ")} (${r.spec.basisDefinition}).`,
    "",
    "## Components (identified, then measured by reference sources)",
    ...r.components.map((c) => `- ${c.name}: PubChem CID ${c.identity.identifiers.pubchemCid}, ${c.identity.identifiers.molecularFormula}, CAS ${c.identity.identifiers.cas}, InChIKey ${c.identity.identifiers.inchiKey}, M ${c.molarMass} g/mol; at the state: ${Object.entries(c.atState).map(([p, v]) => (v ? `${p} ${g(v.value)} ${v.unit}${v.uncertainty?.type === "pct" ? ` (±${v.uncertainty.value} %)` : " (uncertainty not stated)"}` : `${p} not available`)).join("; ")}`),
    "",
    "## Computed (receipts in the report)",
    ...r.computed.map((c) => `- ${c.label || c.property} [${c.subject}]: ${g(c.value, 6)} ${c.unit}${c.notes?.length ? ` (${c.notes.join("; ")})` : ""}`),
    "",
    "## Unknown (what would establish it)",
    ...r.testPlan.map((t) => `- ${t.property}: ${t.why}. ${t.tests.length ? `Test: ${t.tests.flatMap((x) => x.standards.map((s) => `${s.designation} (${s.title})`)).join("; ")}` : t.note}`),
    "",
    "## Cross-checks against the reference values",
    ...r.crossChecks.map((x) => `- ${x.claim}: ${x.reading}: ${g(x.valueKgM3, 6)} vs ${x.referenceKgM3} kg/m3 (${(x.relativeDifference * 100).toFixed(3)} %) ${x.agreesWithinUncertainty ? "agrees" : "DISAGREES"} within the combined uncertainty`),
    "",
    `## Review queue (${r.reviewQueue.length} items, all ${REVIEW_DECISION})`,
    ...r.reviewQueue.map((q) => `- ${q.id} ${q.kind} [${q.subject}${q.property ? ` / ${q.property}` : ""}]: ${q.reason}`),
    "",
    "## Limits",
    ...r.limits.map((l) => `- ${l}`),
    "",
    "## Documents",
    ...r.documents.map((d) => `- ${d.url} (sha256 ${d.sha256}, retrieved ${d.retrieved}${d.excerpt ? ", recorded excerpt" : ""})`),
    "",
  ].join("\n");
}
