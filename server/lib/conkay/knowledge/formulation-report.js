// server/lib/conkay/knowledge/formulation-report.js
//
// Demo 1 runner: formulation text in, evidence report out. Deterministic: the
// same text gives the same report byte for byte (no clocks, no randomness, no
// network, no model). Steps:
//   1. immutable source record (verbatim text, sha256)
//   2. composition check (min/max sums, stated total)
//   3. proposed exact version (uniform-range-position rule, recorded)
//   4. process version as stated (separate record)
//   5. every statement → claims (claim-analyzer), with curated assessments
//   6. computed claims where justified: rule-of-mixtures density, only from
//      cited constituent densities; unknown when one is missing, plus a
//      clearly-labelled conditional estimate
//   7. flags (consistency, safety, underspecification, missing conditions)
//   8. test plan for every claim that isn't supported
//   9. self-check: every record and claim validated against the schema rules

import crypto from "node:crypto";
import { sourceFormulation, proposeVersion, processVersion, checkComposition, constituentClassOf, sha256 } from "./formulation.js";
import { analyzeStatements } from "./claim-analyzer.js";
import { makeClaim } from "./claims.js";
import { constituentDensity, CONSTITUENTS } from "./constituents.js";
import { ruleOfMixturesDensity } from "./rule-of-mixtures.js";
import { evidenceRef } from "./sources.js";
import { buildTestPlan } from "./test-plan.js";
import { underspecified } from "./extensions/materials.js";
import { validateEntity } from "./validate.js";
import { fromKgM3 } from "./units.js";

const receiptId = (kind, o) => `receipt:${kind}:${crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16)}`;
const calcRef = (receipt, title) => ({ kind: "calculation", sourceId: null, title, url: null, document: null, author: null, date: null, retrieved: null, locator: null, excerpt: null, sha256: null, license: null, receiptRef: receipt.id });
const g = (kgm3) => Math.round(fromKgM3(kgm3, "g/cm3") * 1000) / 1000;

// Conditional assumption for an unidentified polyethylene-family copolymer:
// the whole polyethylene density span MOL gives. Used ONLY in the
// conditional estimate, never as the copolymer's density.
const PE_FAMILY_SPAN = { lo: 910, hi: 970, doc: "mol-hdpe-catalogue-2023" };

const SPEC_NOTES = {
  graphene: "Graphene grade is unspecified: graphene nanoplatelets (multi-layer stacks, µm lateral size) and few-layer/monolayer graphene differ widely in thickness, surface area and dispersion, so claims attributed to 'graphene' are underspecified; the density used assumes nanoplatelets.",
  basalt_fiber: "Basalt fibre length (chopped vs milled vs continuous), diameter and sizing (silane/PE-compatible?) are unspecified; reinforcement in HDPE depends on them.",
  hdpe: "HDPE grade and melt flow rate (MFI) are unspecified; density (0.941–0.970 g/cm³ across grades), stiffness, impact and processability depend on the grade.",
  hdpe_hc_copolymer: "'HDPE/HC co-polymer' is not identifiable: comonomer(s), grade and supplier unknown. Its density is UNKNOWN and it blocks the strict density estimate.",
  silica: "Silica form is unspecified (fumed, precipitated or crystalline): density (2.2 amorphous vs 2.65 quartz g/cm³) and handling hazards differ by form; get the supplier SDS for the actual grade.",
  caco3: "CaCO3 grade is unspecified (ground vs precipitated, particle size, stearate surface treatment).",
};

/** Build the full report for a formulation text. */
export function buildFormulationReport(text, meta = {}) {
  const { record: source, parsed } = sourceFormulation(text, meta);
  const base = source.id.replace(/^formulation:/, "").replace(/:source$/, "");
  const ings = source.composition.ingredients.map((x) => ({ id: x.id, name: x.name, min: x.amount.min, max: x.amount.max }));
  const check = checkComposition(ings, source.composition.statedTotal);
  const checkReceipt = { solver: "composition-sum-check", solverVersion: "1.0.0", inputs: ings, outputs: check, arithmetic: "integer units of 0.0001 %" };
  checkReceipt.id = receiptId("composition-sum-check", checkReceipt);

  const version = proposeVersion(source);
  const proc = processVersion(source);
  const polymerText = ings.map((x) => x.name).join(" ");

  // 5. statements → claims
  const statements = [];
  for (const ing of parsed.ingredients) {
    for (const cl of ing.clauses) statements.push({ text: cl, locator: ing.locator, quote: ing.quote, attributedTo: source.composition.ingredients.find((x) => x.name === ing.name)?.id });
  }
  for (const p of parsed.prose) statements.push({ text: p.text, locator: p.locator, section: p.section });
  const claims = analyzeStatements(statements, { base, subject: source.id, polymerText, sourceTitle: source.identity.name });

  if (parsed.statedTotal) {
    claims.push(makeClaim({
      id: `claim:${base}:total`, subject: source.id, property: "composition_verification", kind: "qualitative",
      statement: parsed.statedTotal.quote, status: ["unknown"], support: "partially_supported",
      assertedBy: { source: source.identity.name, locator: parsed.statedTotal.locator, quote: parsed.statedTotal.quote },
      evidence: [calcRef(checkReceipt, "composition sum check")],
      requiredEvidence: [
        { kind: "record", property: null, reason: "an explicit formulation version with exact fractions (proposed below; needs the formulator's confirmation)", testPlanRef: null },
        { kind: "test", property: "composition_verification", reason: "verify each batch's as-made composition against that version", testPlanRef: "test:composition_verification" },
      ],
      flags: ["composition-sum-not-fixed"],
      notes: [check.note],
    }));
  }
  for (const t of parsed.temperatures) {
    claims.push(makeClaim({
      id: `claim:${base}:process-temperature`, subject: proc.id, property: "processing_temperature", kind: "qualitative",
      statement: t.quote, conditions: {}, status: ["unknown"], support: "partially_supported",
      assertedBy: { source: source.identity.name, locator: t.locator, quote: t.quote },
      evidence: [evidenceRef("exxonmobil-hma016"), evidenceRef("mol-hdpe-catalogue-2023")],
      requiredEvidence: [{ kind: "test", property: "processing_temperature", reason: "DSC of the actual HDPE grade and compound, and MFR, to confirm the melt window", testPlanRef: "test:processing_temperature" }],
      flags: ["cure-terminology"],
      notes: [`${t.value} ${t.unit} is above HDPE's melting peak (133 °C for ExxonMobil HMA 016, ASTM D3418) and inside the 180–220 °C melt temperatures MOL recommends for HDPE blow-moulding grades, so it is plausible as a MELT-PROCESSING temperature. HDPE is a thermoplastic: it is melted and cooled, not cured. Recorded in process version ${proc.id} as a melt-processing temperature.`],
    }));
  }

  // 6. computed claims: rule-of-mixtures density
  const densityInputs = ings.map((x) => {
    const { classId } = constituentClassOf(x.name);
    const dc = classId ? constituentDensity(classId) : null;
    const d = dc && dc.range ? { lo: dc.range.min, hi: dc.range.max } : null;
    return { id: x.id, classId, fraction: { min: x.min, max: x.max }, density: d, claimRef: dc ? dc.id : null };
  });
  const pointPct = version.ok ? ings.map((x) => version.fractions.find((f) => f.id === x.id).pct) : null;
  const strict = ruleOfMixturesDensity({
    inputs: densityInputs, basis: "mass", pointFractions: pointPct,
    assumptions: ["mass-fraction basis (the source does not say wt% or vol%)", "additive volumes, no voids", "constituent densities are class-level intervals from the cited sources"],
    label: "strict",
  });
  const receipts = [checkReceipt, strict.receipt];
  const computed = [];
  const densitySubject = version.ok ? version.record.id : source.id;
  computed.push(makeClaim({
    id: `claim:${base}:density-strict`, subject: densitySubject, property: "density", kind: "quantitative", unit: "kg/m3",
    conditions: { method: "rule of mixtures (mass basis)" },
    status: strict.ok ? ["estimated"] : ["unknown"], support: strict.ok ? "supported" : "unsupported",
    value: strict.ok ? strict.value : null, range: strict.ok ? strict.range : null,
    uncertainty: strict.ok ? { type: "range", low: strict.range.min, high: strict.range.max, note: null } : null,
    method: { kind: "estimate", description: "rule of mixtures from cited constituent densities", standard: null, receiptRef: strict.receipt.id, assumptions: strict.receipt.assumptions },
    evidence: [calcRef(strict.receipt, "rule-of-mixtures density (strict)")],
    requiredEvidence: [{ kind: "test", property: "density", reason: "measure the moulded compound's density", testPlanRef: "test:density" }],
    label: strict.ok ? "estimated (rule of mixtures, assumes no voids)" : `unknown: ${strict.receipt.reason}`,
    flags: strict.ok ? [] : ["density-not-computable"],
  }));

  let conditional = null;
  if (!strict.ok) {
    const assumed = densityInputs.map((x) => (x.density ? x : { ...x, density: { lo: PE_FAMILY_SPAN.lo, hi: PE_FAMILY_SPAN.hi }, claimRef: `ASSUMPTION A1 (${PE_FAMILY_SPAN.doc})` }));
    const assumptions = [
      `A1: every ingredient without a cited density (${strict.missing.join(", ")}) is assumed to be a polyethylene-family polymer with density 0.910–0.970 g/cm³ (MOL HDPE catalogue p.4, 'Polyethylene density (0.910–0.970 g/cm³)'). NOT established for the actual copolymer.`,
      "A2: mass-fraction basis (the source does not say wt% or vol%)",
      "A3: 'graphene' is graphene nanoplatelets (xGnP-class true density 2.0–2.25 g/cm³)",
      "A4: additive volumes, no voids (real moulded parts usually have some porosity, which lowers density)",
    ];
    const cond = ruleOfMixturesDensity({ inputs: assumed, basis: "mass", pointFractions: pointPct, assumptions, label: "conditional" });
    const vol = ruleOfMixturesDensity({ inputs: assumed, basis: "volume", pointFractions: pointPct, assumptions: [...assumptions.slice(0, 1), "volume-fraction basis (alternative reading of the unstated basis)", ...assumptions.slice(2)], label: "conditional-volume-basis" });
    receipts.push(cond.receipt, vol.receipt);
    conditional = { mass: cond, volume: vol };
    computed.push(makeClaim({
      id: `claim:${base}:density-conditional`, subject: densitySubject, property: "density", kind: "quantitative", unit: "kg/m3",
      conditions: { method: "rule of mixtures (mass basis), conditional on assumptions A1–A4" },
      status: ["estimated"], support: "partially_supported",
      value: cond.value, range: cond.range,
      uncertainty: { type: "range", low: cond.range.min, high: cond.range.max, note: "composition ranges × constituent density intervals; excludes voids and the A1 assumption's own error" },
      method: { kind: "estimate", description: "rule of mixtures, conditional", standard: null, receiptRef: cond.receipt.id, assumptions },
      evidence: [calcRef(cond.receipt, "rule-of-mixtures density (conditional)"), ...[...new Set(densityInputs.filter((x) => x.claimRef).map((x) => x.classId))].flatMap((c) => constituentDensity(c).evidence)],
      requiredEvidence: [
        { kind: "identification", property: null, reason: "identify the HDPE/HC copolymer to remove assumption A1", testPlanRef: null },
        { kind: "test", property: "density", reason: "measure the moulded compound's density (ASTM D792)", testPlanRef: "test:density" },
      ],
      label: "estimated (rule of mixtures, assumes no voids) — CONDITIONAL on A1–A4; screening only, not a property of record",
      flags: ["conditional-estimate"],
      notes: [`volume-basis reading of the same numbers: ${g(vol.range.min)}–${g(vol.range.max)} g/cm³ (nominal ${g(vol.value)})`],
    }));
  }

  // 7. flags
  const flags = buildFlags({ source, check, checkReceipt, claims, computed, proc, parsed });

  // 8. test plan
  const allClaims = [...claims, ...computed];
  const testPlan = buildTestPlan(allClaims, { formulationVersion: version.ok ? version.record.id : "(no feasible version)", processVersion: proc.id });

  // 9. self-check
  const records = [source, ...(version.ok ? [version.record] : []), proc, ...Object.values(CONSTITUENTS)];
  const selfCheck = { records: records.map((r) => ({ id: r.id, ...validateEntity(r) })), claims: allClaims.map((c) => ({ id: c.id, errors: validateEntity.claim(c) })) };
  selfCheck.ok = selfCheck.records.every((r) => r.ok) && selfCheck.claims.every((c) => c.errors.length === 0);

  return {
    reportVersion: "1.0.0",
    fixture: meta.fixture || null,
    sourceSha256: sha256(String(text)),
    source,
    parsed: { title: parsed.title, descriptor: parsed.descriptor, ingredients: parsed.ingredients.length, prose: parsed.prose.length, sections: parsed.sections.map((s) => s.title), unparsed: parsed.unparsed },
    compositionCheck: { ...check, receiptRef: checkReceipt.id },
    proposedVersion: version.ok ? { record: version.record, fractions: version.fractions, rule: version.rule, rejectedAlternative: version.rejected } : { error: version.error },
    processVersion: proc,
    claims,
    computed,
    conditionalDensity: conditional ? { massBasis: conditional.mass.range && { ...conditional.mass.range, nominal: conditional.mass.value }, volumeBasis: { ...conditional.volume.range, nominal: conditional.volume.value } } : null,
    receipts,
    unsupportedClaims: allClaims.filter((c) => c.support !== "supported").map((c) => ({ id: c.id, property: c.property, statement: c.statement, label: c.label, support: c.support, status: c.status })),
    flags,
    testPlan,
    selfCheck,
  };
}

function buildFlags({ source, check, checkReceipt, claims, computed, proc, parsed }) {
  const flags = [];
  const f = (id, severity, title, detail, evidence = [], claimsRef = []) => flags.push({ id, severity, title, detail, evidence, claims: claimsRef });
  const claimsWith = (flag) => claims.filter((c) => c.flags.includes(flag)).map((c) => c.id);

  if (!check.exact) {
    f("composition-sum-not-fixed", check.feasible ? "warning" : "error", "Stated ranges don't fix the total",
      `Ingredient ranges sum to ${check.minSumPct} % (all at minimum) to ${check.maxSumPct} % (all at maximum). 'Total: ${check.statedTotalPct ?? "?"} %' is ${check.statedTotalWithinRange ? "reachable but not determined" : "NOT reachable"} by the ranges, so an explicit version with exact fractions is required (one is proposed by a recorded rule).`,
      [calcRef(checkReceipt, "composition sum check")], claimsWith("composition-sum-not-fixed"));
  }
  if (source.composition.basis === "unspecified") {
    f("composition-basis-unspecified", "warning", "Composition basis not stated", "Percentages carry no basis (wt%, vol%?). Compounding recipes are normally by mass, but the source must say; the density estimate assumes mass basis and shows the volume-basis reading alongside.");
  }
  if (parsed.temperatures.length) {
    f("cure-terminology", "warning", "'Cure temperature' for a thermoplastic",
      "HDPE is a thermoplastic: it is melt-processed (melted, shaped, cooled), not cured. 200 °C is above HDPE's ~133 °C melting peak and within typical 180–220 °C HDPE melt temperatures, so it is recorded as a melt-processing temperature in the process version. Missing: where it is measured (barrel/melt/mould), time at temperature, equipment, cooling profile.",
      [evidenceRef("exxonmobil-hma016"), evidenceRef("mol-hdpe-catalogue-2023")], claimsWith("cure-terminology"));
  }
  const contra = claims.filter((c) => c.flags.includes("hydrogen-containment-contradicted"));
  if (contra.length) {
    f("hydrogen-containment-contradicted", "error", "'Hydrogen stays contained' conflicts with the literature",
      "Hydrogen permeates HDPE (permeation is 'inevitable' in HDPE/PA Type IV liners; HDPE H2 permeability 5.88×10⁻¹⁴ cm³·cm/(cm²·s·Pa) at 288 K, 70 MPa, ~3.4× PA6). Containment is UNSUPPORTED for Blend D pending permeation testing of the compound (ASTM D1434 / ISO 15105-1 screening; CSA/ANSI CHMC 2 or ISO 11114-5 at pressure) and vessel-level qualification (ISO 19881 / SAE J2579), including after impact.",
      [evidenceRef("li-2023-h2-liner-review"), evidenceRef("dong-2023-pa6-hdpe-permeability")], contra.map((c) => c.id));
  }
  const over = claimsWith("hydrogen-compatibility-overstated");
  if (over.length) {
    f("hydrogen-compatibility-overstated", "warning", "'Inherently resistant to hydrogen' / 'no degradation' overstated",
      "No metal-type embrittlement, but dissolved hydrogen plasticises HDPE and decompression can blister or collapse liners. Needs exposure + decompression-cycle testing (CSA/ANSI CHMC 2) at the service pressure and temperature.",
      [evidenceRef("li-2023-h2-liner-review")], over);
  }
  const u = underspecified(source.extensions.materials);
  for (const c of u.constituents) {
    const ing = source.composition.ingredients.find((x) => x.id === c.ingredientId);
    const { classId } = constituentClassOf(ing.name);
    f(`underspecified:${c.ingredientId}`, classId === "hdpe_hc_copolymer" ? "error" : "warning", `${ing.name}: ${c.missing.join(", ")} not specified`,
      SPEC_NOTES[classId] || `Unspecified: ${c.missing.join(", ")}.`);
  }
  if (u.process.length || proc.process.missing.length) f("process-underspecified", "warning", "Process underspecified", `Not stated: ${proc.process.missing.join("; ")}.`);
  const vague = claimsWith("vague-wording");
  if (vague.length) f("vague-wording", "info", "Wording that names no measurable property or condition", "'structural integrity' and 'splitting cycles' need a measurable definition (which property, which conditions).", [], vague);
  const cmp = claimsWith("comparison-target-not-on-record");
  if (cmp.length) f("comparison-target-not-on-record", "warning", "Comparisons with the 'marine blend' can't be checked", "The marine blend's formulation and data aren't on record; ingest it as its own source record first.", [], cmp);
  const roles = claims.filter((c) => c.attributedTo && c.property).map((c) => c.id);
  if (roles.length) f("ingredient-roles-are-hypotheses", "info", "Ingredient roles are hypotheses about the composite", "Each ingredient's stated role (e.g. 'graphene: thermal conductivity') is a claim about the COMPOSITE. Constituent properties do not predict composite behaviour (dispersion, interface, loading thresholds), so none of these is computed from constituents; each needs a composite test.", [], roles);
  const comp = claims.filter((c) => ["vessel_containment", "pressure_containment"].includes(c.property)).map((c) => c.id);
  if (comp.length) f("component-level-claims", "warning", "Claims only a finished part can settle", "Containment, seal integrity and pressure resistance belong to the vessel (geometry, wall, liner, fittings), not the material; material tests are necessary but not sufficient (ISO 19881 / SAE J2579).", [evidenceRef("li-2023-h2-liner-review")], comp);
  const missing = [...claims, ...computed].filter((c) => c.property && c.missingConditions.length);
  if (missing.length) {
    f("missing-conditions", "warning", `${missing.length} claims state no test conditions`,
      missing.map((c) => `${c.id}: ${c.missingConditions.join(", ")}`).join("\n"), [], missing.map((c) => c.id));
  }
  if (computed.some((c) => c.flags.includes("density-not-computable"))) {
    f("density-conditional", "info", "Density only estimable under an assumption", "The strict rule-of-mixtures density is UNKNOWN because the HDPE/HC copolymer has no cited density. A conditional estimate (assumption A1: polyethylene-family 0.910–0.970 g/cm³) is reported separately, for screening only.");
  }
  f("safety-records-missing", "warning", "No SDS on record for any constituent; intended use is a hydrogen pressure vessel",
    "Hazards depend on the exact grades (e.g. silica form, nanoplatelet handling): attach each supplier's SDS. A hydrogen pressure-containing part is a regulated application; acceptance must come from the vessel standard (ISO 19881 / SAE J2579), not from material claims.");
  return flags;
}

const shortTitle = (t) => { const s = t.split(" (")[0].split(" — ")[0]; return s.length > 90 ? `${s.slice(0, 87)}…` : s; };

/** Markdown rendering of a report (used for the PR description and the lens). */
export function renderFormulationMarkdown(r) {
  const L = [];
  const pct = (x) => `${x.toFixed(4)} %`;
  L.push(`## ${r.source.identity.name}: evidence report`, "");
  L.push(`Source record \`${r.source.id}\` (immutable; sha256 \`${r.sourceSha256.slice(0, 16)}…\`). Basis: **${r.source.composition.basis}**.`, "");
  L.push("### Composition check", "");
  L.push(`Ranges sum to **${r.compositionCheck.minSumPct} %** (all minimum) … **${r.compositionCheck.maxSumPct} %** (all maximum). Stated total ${r.compositionCheck.statedTotalPct} %: ${r.compositionCheck.note}.`, "");
  if (r.proposedVersion.record) {
    const pv = r.proposedVersion;
    L.push(`### Proposed version \`${pv.record.id}\``, "");
    L.push(`Rule **${pv.rule.name}** v${pv.rule.version}: ${pv.rule.statement}. λ = ${pv.rule.lambdaExact} = ${pv.rule.lambda.toFixed(6)}. Proportional scaling of midpoints was rejected because it leaves a range (${pv.rejectedAlternative.filter((x) => !x.withinRange).map((x) => `${x.id} → ${x.pct.toFixed(2)} %`).join(", ") || "none here"}).`, "");
    L.push("| Ingredient | Range | Proposed |", "|---|---|---|");
    for (const f of pv.fractions) L.push(`| ${f.name} | ${f.min}–${f.max} % | ${pct(f.pct)} |`);
    L.push(`| **Total** | ${r.compositionCheck.minSumPct}–${r.compositionCheck.maxSumPct} % | **${pct(pv.fractions.reduce((a, f) => a + f.units, 0) / 10000)}** |`, "");
    L.push("Proposed by arithmetic, not a formulation decision: the formulator confirms or replaces it.", "");
  }
  L.push(`### Process version \`${r.processVersion.id}\``, "");
  for (const s of r.processVersion.process.steps) L.push(`- ${s.action}: ${s.conditions.temperature.value} ${s.conditions.temperature.unit} (${s.conditions.temperatureK} K). Stated as: "${s.statedAs}"`);
  L.push(`- Missing: ${r.processVersion.process.missing.join("; ")}`, "");
  L.push("### Computed / estimated claims", "");
  for (const c of r.computed) {
    const range = c.range ? `${g(c.range.min)}–${g(c.range.max)} g/cm³ (nominal ${g(c.value)})` : "no value";
    L.push(`- \`${c.id}\` [${c.status.join(", ")}] ${range}: ${c.label}. Receipt \`${c.method.receiptRef}\`.`);
    for (const a of c.method.assumptions) L.push(`  - ${a}`);
    for (const n of c.notes) L.push(`  - ${n}`);
  }
  L.push("", "Constituent densities used (sourced, class-level):", "");
  L.push("| Constituent | Density | Sources |", "|---|---|---|");
  for (const e of Object.values(CONSTITUENTS)) {
    const d = e.properties[0];
    L.push(`| ${e.identity.name} | ${d.range ? `${g(d.range.min)}–${g(d.range.max)} g/cm³` : "**unknown**"} | ${d.evidence.map((x) => `[${shortTitle(x.title)}](${x.url}) (${x.locator})`).join("; ") || "none: identify it first"} |`);
  }
  L.push("", "Impact, permeability and the other composite properties are NOT computed from constituents.", "");
  L.push("### Flags", "");
  for (const fl of r.flags) {
    L.push(`- **[${fl.severity}] ${fl.title}** (\`${fl.id}\`): ${fl.detail.split("\n").length > 3 ? `${fl.detail.split("\n").length} claims; see report JSON` : fl.detail.replace(/\n/g, "; ")}`);
    for (const e of fl.evidence.filter((x) => x.url)) L.push(`  - Evidence: [${e.title}](${e.url}), ${e.locator}`);
  }
  L.push("", `### Claims not established (${r.unsupportedClaims.length}): every status is unknown unless computed above`, "");
  L.push("| Claim | Property | Support | Statement |", "|---|---|---|---|");
  for (const c of r.unsupportedClaims) L.push(`| \`${c.id.replace(/^claim:[^:]+:/, "")}\` | ${c.property || "—"} | ${c.support} | ${(c.statement || c.label || "").replace(/\|/g, "/")} |`);
  L.push("", "### Test plan", "");
  L.push("| Priority | Property | Standards | Settles |", "|---|---|---|---|");
  for (const t of r.testPlan.items) L.push(`| ${t.priority} | ${t.label}${t.scope === "component" ? " *(vessel level)*" : ""} | ${[...new Set(t.tests.flatMap((x) => x.standards.map((s) => s.designation)))].join(", ")} | ${t.settles.length} claim(s) |`);
  L.push("", `Self-check: ${r.selfCheck.ok ? "every record and claim passes the schema and claim rules" : "FAILED"}.`);
  return L.join("\n");
}
