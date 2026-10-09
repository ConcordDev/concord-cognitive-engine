// ConKay knowledge layer, step 1 (plan: ~/.zuko/remaining-work/
// CONKAY-UNIVERSAL-KNOWLEDGE-LAYER-2026-10-09.md): universal entity /
// Property-as-Claim schema, claim status rules, the formulation engine
// (source record → proposed exact version), rule-of-mixtures receipts, the
// test plan, and demo 1 (USB Blend D) end to end.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateEntity, validateClaim, makeClaim, ENTITY_SCHEMA, listExtensions,
  parseFormulationText, sourceFormulation, checkComposition, proposeVersion, processVersion, uniformRangePosition,
  ruleOfMixturesDensity, mixtureDensity, buildTestPlan, buildFormulationReport, renderFormulationMarkdown, loadFixture,
  STANDARDS, PROPERTIES, units,
} from "../lib/conkay/knowledge/index.js";
import { validateAgainst } from "../lib/conkay/knowledge/json-schema-lite.js";
import registerConkayKnowledgeActions from "../domains/conkay-knowledge.js";

const blendD = () => loadFixture("usb-blend-d");
const calc = (receiptRef = "receipt:x:1") => ({ kind: "calculation", title: "calc", receiptRef });
const doc = (locator = "p.1") => ({ kind: "document", title: "a datasheet", url: "https://example.org/ds.pdf", locator });

function entity(over = {}) {
  return { schemaVersion: "1.0.0", id: "material:test", kind: "material", identity: { name: "Test", version: "1" }, ...over };
}

describe("universal entity schema", () => {
  it("accepts a minimal record and a record with every block", () => {
    assert.deepEqual(validateEntity(entity()).errors, []);
    const full = entity({
      composition: { basis: "mass", ingredients: [{ id: "a", name: "A", amount: { min: 1, max: 2, unit: "%" } }], statedTotal: null, exact: false },
      properties: [makeClaim({ id: "c1", subject: "material:test", property: "density", kind: "quantitative", value: 950, unit: "kg/m3", conditions: { temperature: "23 °C", method: "ASTM D792", specimen_preparation: "moulded" }, status: ["sourced"], support: "supported", evidence: [doc()] })],
      process: { steps: [{ id: "s1", action: "extrude", conditions: { temperature: { value: 200, unit: "°C" } } }] },
      evidence: [doc()],
      validation: { tests: [], confidence: "none", knownLimitations: ["none tested"] },
      safety: { hazards: [], intendedUseRestrictions: ["not for hydrogen service until tested"] },
      relationships: [{ type: "made_from", target: "material:x" }],
      extensions: { chemistry: { formula: "CaCO3" } },
    });
    const v = validateEntity(full);
    assert.deepEqual(v.errors, []);
    assert.ok(v.warnings.some((w) => /chemistry.*stub/.test(w)), "a stub extension is reported, not silently passed");
  });

  it("rejects bad shapes: unknown kind, missing identity, extra fields, bad id", () => {
    assert.ok(validateEntity(entity({ kind: "potion" })).errors.some((e) => /kind/.test(e)));
    assert.ok(validateEntity({ schemaVersion: "1.0.0", id: "x", kind: "material" }).errors.some((e) => /identity/.test(e)));
    assert.ok(validateEntity(entity({ colour: "red" })).errors.some((e) => /unexpected property "colour"/.test(e)));
    assert.ok(validateEntity(entity({ id: "Not An Id" })).errors.some((e) => /does not match/.test(e)));
  });

  it("the materials extension is implemented and the other disciplines are stubs", () => {
    const ext = Object.fromEntries(listExtensions().map((e) => [e.name, e.status]));
    assert.equal(ext.materials, "implemented");
    for (const d of ["chemistry", "fluids", "recipes", "engineering", "math", "electronics", "biology", "energy", "agriculture", "geology", "software"]) assert.equal(ext[d], "stub", d);
    const bad = entity({ composition: { basis: "mass", ingredients: [{ id: "a", name: "A", amount: { value: 100, unit: "%" } }] }, extensions: { materials: { polymerClass: "thermoplastic", constituents: [], mixingOrder: null, processingTemperatures: [], coolingProfile: null, curingProfile: "2 h at 120 °C" } } });
    assert.ok(validateEntity(bad).errors.some((e) => /thermoplastic has no curing profile/.test(e)));
  });

  it("the JSON Schema validator refuses keywords it does not enforce", () => {
    assert.throws(() => validateAgainst({ type: "string", format: "email" }, "x"), /unsupported keyword "format"/);
    assert.equal(ENTITY_SCHEMA.$defs.Claim.required.includes("evidence"), true);
  });
});

describe("claim status rules", () => {
  const base = { id: "c", subject: "s", property: "density", kind: "quantitative", unit: "kg/m3" };

  it("a claim without evidence can't be Sourced, Measured, Computed or Validated", () => {
    for (const s of [["sourced"], ["measured"], ["computed"], ["validated"], ["estimated"]]) {
      const errs = validateClaim(makeClaim({ ...base, value: 950, status: s, support: "unsupported" }));
      assert.ok(errs.some((e) => /no evidence/.test(e)), `${s} without evidence must fail: ${errs}`);
    }
  });

  it("the author's own statement is not evidence", () => {
    const c = makeClaim({ ...base, value: 950, status: ["sourced"], evidence: [{ kind: "user_statement", title: "author", locator: "line 1" }] });
    assert.ok(validateClaim(c).some((e) => /no evidence/.test(e)));
    const sup = makeClaim({ ...base, status: ["unknown"], support: "supported", evidence: [{ kind: "user_statement", title: "author" }] });
    assert.ok(validateClaim(sup).some((e) => /needs evidence other than the author/.test(e)));
  });

  it("unknown stands alone and carries no value; a value needs a status and a unit", () => {
    assert.ok(validateClaim(makeClaim({ ...base, value: 950, status: ["unknown"] })).some((e) => /cannot carry a value/.test(e)));
    assert.ok(validateClaim(makeClaim({ ...base, status: ["unknown", "estimated"] })).some((e) => /cannot be combined/.test(e)));
    assert.ok(validateClaim(makeClaim({ ...base, status: ["sourced"], evidence: [doc()] })).some((e) => /no value or range/.test(e)));
    assert.ok(validateClaim(makeClaim({ ...base, unit: null, value: 950, status: ["sourced"], evidence: [doc()] })).some((e) => /needs a unit/.test(e)));
    assert.deepEqual(validateClaim(makeClaim({ ...base, status: ["unknown"] })), []);
  });

  it("each status needs its own kind of evidence", () => {
    assert.ok(validateClaim(makeClaim({ ...base, value: 950, status: ["sourced"], evidence: [doc(null)] })).some((e) => /locator/.test(e)));
    assert.ok(validateClaim(makeClaim({ ...base, value: 950, status: ["measured"], evidence: [doc()] })).some((e) => /test_record/.test(e)));
    assert.ok(validateClaim(makeClaim({ ...base, value: 950, status: ["validated", "sourced"], evidence: [doc()] })).some((e) => /validated needs a test_record/.test(e)));
    assert.ok(validateClaim(makeClaim({ ...base, value: 950, status: ["computed"], evidence: [doc()] })).some((e) => /receiptRef/.test(e)));
    const est = makeClaim({ ...base, value: 950, status: ["estimated"], evidence: [calc()] });
    const errs = validateClaim(est);
    assert.ok(errs.some((e) => /assumptions/.test(e)) && errs.some((e) => /uncertainty/.test(e)));
    const ok = makeClaim({ ...base, value: 950, status: ["estimated"], evidence: [calc()], uncertainty: { type: "range", low: 900, high: 1000 }, method: { kind: "estimate", assumptions: ["no voids"] } });
    assert.deepEqual(validateClaim(ok), []);
    const both = makeClaim({ ...base, value: 950, status: ["measured", "sourced", "validated"], evidence: [doc(), { kind: "test_record", title: "lab report 17", locator: "table 2" }], support: "supported" });
    assert.deepEqual(validateClaim(both), [], "flags that aren't mutually exclusive combine");
  });

  it("missing conditions come from the property catalog", () => {
    const c = makeClaim({ ...base, value: 950, conditions: { temperature: "23 °C" } });
    assert.deepEqual(c.missingConditions, ["method", "specimen_preparation"]);
  });
});

describe("units", () => {
  it("fractions keep their basis, temperatures are affine, densities go to kg/m³", () => {
    assert.deepEqual(units.normalizeFraction(65, "%"), { ok: true, value: 0.65, basis: "unspecified", original: { value: 65, unit: "%" } });
    assert.equal(units.normalizeFraction(5, "wt%").basis, "mass");
    assert.equal(units.normalizeFraction(5, "vol%", { basis: "mass" }).ok, false);
    assert.equal(units.normalizeFraction(120, "%").ok, false);
    assert.equal(units.normalizeTemperature(200, "°C").value, 473.15);
    assert.ok(Math.abs(units.normalizeTemperature(392, "°F").value - 473.15) < 1e-9);
    assert.equal(units.normalizeTemperature(-300, "°C").ok, false);
    assert.equal(units.normalizeDensity(0.956, "g/cm³").value, 956);
    assert.equal(units.normalizeDensity(1, "furlong").ok, false);
    const phi = units.massToVolumeFractions([0.5, 0.5], [1000, 2000]);
    assert.ok(Math.abs(phi[0] - 2 / 3) < 1e-12);
  });
});

describe("formulation engine", () => {
  it("parses Blend D: six ranged ingredients, stated total, process temperature, prose", () => {
    const p = parseFormulationText(blendD().text);
    assert.equal(p.title, "USB Blend D");
    assert.equal(p.descriptor, "Viscoelastic/Impact Resistant");
    assert.deepEqual(p.ingredients.map((g) => [g.name, g.min, g.max]), [
      ["HDPE base", 65, 70], ["HDPE/HC co-polymer", 10, 15], ["Basalt fiber", 5, 8], ["CaCO3", 3, 5], ["Graphene", 2, 3], ["Silica", 1, 2],
    ]);
    assert.equal(p.statedTotal.value, 100);
    assert.deepEqual(p.temperatures.map((t) => [t.value, t.unit]), [[200, "°C"]]);
    assert.equal(p.prose.length, 8);
    assert.deepEqual(p.unparsed, []);
  });

  it("the source record is immutable, hashed and keeps the verbatim text", () => {
    const { text } = blendD();
    const { record } = sourceFormulation(text, { slug: "usb-blend-d" });
    assert.equal(record.id, "formulation:usb-blend-d:source");
    assert.ok(Object.isFrozen(record) && Object.isFrozen(record.composition.ingredients[0].amount));
    assert.throws(() => { "use strict"; record.composition.ingredients[0].amount.min = 50; }, TypeError);
    assert.equal(record.evidence[0].excerpt, text);
    assert.match(record.provenance.contentSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(validateEntity(record).errors, []);
  });

  it("sum check: Blend D ranges give 86 % min / 103 % max; 100 % reachable but not fixed", () => {
    const { record } = sourceFormulation(blendD().text, { slug: "usb-blend-d" });
    const ings = record.composition.ingredients.map((g) => ({ id: g.id, min: g.amount.min, max: g.amount.max }));
    const c = checkComposition(ings, { value: 100 });
    assert.equal(c.minSumPct, 86);
    assert.equal(c.maxSumPct, 103);
    assert.equal(c.feasible, true);
    assert.equal(c.statedTotalWithinRange, true);
    assert.equal(c.statedTotalFixedByRanges, false);
    assert.equal(checkComposition([{ id: "a", min: 10, max: 20 }, { id: "b", min: 10, max: 20 }]).feasible, false, "can't reach 100");
    assert.equal(checkComposition([{ id: "a", min: 60, max: 70 }, { id: "b", min: 50, max: 60 }]).feasible, false, "can't get down to 100");
  });

  it("the proposed version stays inside every range and sums to exactly 100 %", () => {
    const { record } = sourceFormulation(blendD().text, { slug: "usb-blend-d" });
    const v = proposeVersion(record);
    assert.equal(v.ok, true);
    assert.equal(v.fractions.reduce((a, f) => a + f.units, 0), 1_000_000, "integer units of 0.0001 % sum to exactly 100 %");
    for (const f of v.fractions) assert.ok(f.pct >= f.min && f.pct <= f.max, `${f.id} ${f.pct} outside ${f.min}–${f.max}`);
    assert.deepEqual(v.fractions.map((f) => f.pct), [69.1177, 14.1176, 7.4706, 4.6471, 2.8235, 1.8235]);
    assert.equal(v.rule.name, "uniform-range-position");
    assert.equal(v.rule.lambdaExact, "14/17");
    assert.equal(v.record.provenance.rule.name, "uniform-range-position");
    assert.equal(v.record.relationships[0].target, record.id);
    assert.ok(v.rejected.some((x) => x.id === "hdpe-base" && !x.withinRange), "plain midpoint scaling would push HDPE above 70 %");
    assert.deepEqual(validateEntity(v.record).errors, []);
  });

  it("the rule holds for other ranges too (property check over many cases)", () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let k = 0; k < 300; k++) {
      const n = 2 + Math.floor(rnd() * 6);
      const ings = Array.from({ length: n }, (_, i) => { const a = Math.round(rnd() * 400) / 10; return { id: `i${i}`, name: `I${i}`, min: a, max: Math.round((a + rnd() * 30) * 10) / 10 }; });
      const c = checkComposition(ings);
      const r = uniformRangePosition(ings);
      assert.equal(r.ok, c.feasible, JSON.stringify(ings));
      if (!r.ok) continue;
      assert.equal(r.fractions.reduce((a, f) => a + f.units, 0), 1_000_000);
      for (const f of r.fractions) assert.ok(f.units >= Math.round(f.min * 1e4) && f.units <= Math.round(f.max * 1e4));
    }
  });

  it("the process version is a separate record: 200 °C recorded as a melt-processing temperature", () => {
    const { record } = sourceFormulation(blendD().text, { slug: "usb-blend-d" });
    const p = processVersion(record);
    assert.equal(p.id, "process:usb-blend-d:p1-as-stated");
    assert.equal(p.kind, "process");
    assert.equal(p.process.steps[0].conditions.temperatureK, 473.15);
    assert.match(p.process.steps[0].action, /melt processing/);
    assert.ok(p.process.missing.some((m) => /cooling profile/.test(m)));
    assert.deepEqual(validateEntity(p).errors, []);
  });
});

describe("rule of mixtures (density)", () => {
  it("computes the mass-basis inverse rule exactly and records a receipt", () => {
    const inputs = [
      { id: "pe", fraction: { min: 50, max: 50 }, density: { lo: 950, hi: 950 }, claimRef: "c:pe" },
      { id: "caco3", fraction: { min: 50, max: 50 }, density: { lo: 2700, hi: 2700 }, claimRef: "c:ca" },
    ];
    const r = ruleOfMixturesDensity({ inputs, basis: "mass", pointFractions: [50, 50], assumptions: ["no voids"] });
    const expect = 1 / (0.5 / 950 + 0.5 / 2700);
    assert.equal(r.ok, true);
    assert.equal(r.status, "estimated");
    assert.ok(Math.abs(r.value - expect) < 1e-9);
    assert.ok(Math.abs(r.range.min - expect) < 1e-9 && Math.abs(r.range.max - expect) < 1e-9);
    assert.match(r.receipt.id, /^receipt:rule-of-mixtures-density:[0-9a-f]{16}$/);
    assert.match(r.receipt.formula, /1\/ρ = Σ w_i\/ρ_i/);
    assert.deepEqual(r.receipt.inputs.map((x) => x.claimRef), ["c:pe", "c:ca"]);
    assert.ok(Math.abs(mixtureDensity([0.5, 0.5], [950, 2700], "volume") - 1825) < 1e-9);
    const again = ruleOfMixturesDensity({ inputs, basis: "mass", pointFractions: [50, 50], assumptions: ["no voids"] });
    assert.equal(again.receipt.id, r.receipt.id, "receipts are deterministic");
  });

  it("the range brackets every feasible composition", () => {
    const inputs = [
      { id: "a", fraction: { min: 60, max: 80 }, density: { lo: 940, hi: 970 } },
      { id: "b", fraction: { min: 10, max: 30 }, density: { lo: 2400, hi: 3050 } },
      { id: "c", fraction: { min: 5, max: 15 }, density: { lo: 2000, hi: 2250 } },
    ];
    const r = ruleOfMixturesDensity({ inputs, basis: "mass" });
    for (let a = 60; a <= 80; a += 1) {
      for (let b = 10; b <= 30; b += 1) {
        const c = 100 - a - b;
        if (c < 5 || c > 15) continue;
        for (const pick of ["lo", "hi"]) {
          const rho = mixtureDensity([a / 100, b / 100, c / 100], inputs.map((x) => x.density[pick]), "mass");
          assert.ok(rho >= r.range.min - 1e-9 && rho <= r.range.max + 1e-9, `${a}/${b}/${c} ${pick}: ${rho} outside ${r.range.min}–${r.range.max}`);
        }
      }
    }
  });

  it("a constituent without a cited density makes the result unknown, never guessed", () => {
    const r = ruleOfMixturesDensity({ inputs: [{ id: "a", fraction: { min: 50, max: 50 }, density: { lo: 950, hi: 950 } }, { id: "mystery", fraction: { min: 50, max: 50 }, density: null }], basis: "mass" });
    assert.equal(r.ok, false);
    assert.equal(r.status, "unknown");
    assert.deepEqual(r.missing, ["mystery"]);
    assert.equal(r.receipt.result, "not computed");
  });
});

describe("test plan", () => {
  it("every unsupported property gets a test item citing only verified standards", () => {
    const claims = [
      makeClaim({ id: "c1", subject: "s", property: "impact_resistance", status: ["unknown"], requiredEvidence: [{ kind: "test", property: "impact_resistance", reason: "x", testPlanRef: "test:impact_resistance" }] }),
      makeClaim({ id: "c2", subject: "s", property: "hydrogen_permeability", status: ["unknown"], requiredEvidence: [{ kind: "test", property: "hydrogen_permeability", reason: "x", testPlanRef: "test:hydrogen_permeability" }] }),
    ];
    const plan = buildTestPlan(claims, { formulationVersion: "f:v1", processVersion: "p:1" });
    const props = plan.items.map((i) => i.property);
    assert.ok(props.includes("impact_resistance") && props.includes("hydrogen_permeability"));
    const impact = plan.items.find((i) => i.property === "impact_resistance");
    const designations = impact.tests.flatMap((t) => t.standards.map((s) => s.designation));
    for (const d of ["ASTM D256", "ASTM D6110", "ISO 179-1", "ISO 180", "ASTM D3763"]) assert.ok(designations.includes(d), d);
    for (const s of plan.items.flatMap((i) => i.tests.flatMap((t) => t.standards))) {
      assert.ok(STANDARDS[s.designation], `${s.designation} is not in the verified list`);
      assert.match(s.url, /^https:\/\//);
    }
    assert.equal(plan.items[0].priority, "P0 prerequisite");
  });

  it("every catalogued property has at least one test and every cited standard is verified", () => {
    for (const [id, p] of Object.entries(PROPERTIES)) {
      assert.ok(p.tests.length > 0, id);
      for (const t of p.tests) for (const d of t.standards) assert.ok(STANDARDS[d], `${id}: ${d}`);
    }
  });
});

describe("demo 1: USB Blend D end to end", () => {
  const { text, meta } = blendD();
  const r = buildFormulationReport(text, meta);

  it("is deterministic and self-consistent", () => {
    assert.equal(JSON.stringify(buildFormulationReport(text, meta)), JSON.stringify(r));
    assert.equal(r.selfCheck.ok, true, JSON.stringify(r.selfCheck.records.filter((x) => !x.ok).concat(r.selfCheck.claims.filter((c) => c.errors.length))));
  });

  it("every statement in the text becomes a claim; none is established by the text itself", () => {
    const fromText = r.claims.filter((c) => c.assertedBy);
    assert.ok(fromText.length >= 30);
    for (const c of fromText) {
      assert.deepEqual(c.status, ["unknown"], c.id);
      assert.notEqual(c.support, "supported", c.id);
      assert.ok(c.requiredEvidence.length > 0, `${c.id} has no required evidence`);
      assert.match(c.assertedBy.locator, /^line \d+$/);
    }
    for (const s of ["bends not breaks on impact", "surface hardness", "weather and UV stability", "Hydrogen stays contained through the crash.", "No degradation from fuel contact."]) {
      assert.ok(fromText.some((c) => c.statement === s), `missing claim for "${s}"`);
    }
  });

  it("the containment claim is contradicted by cited literature, and compatibility is only partly supported", () => {
    const contained = r.claims.find((c) => c.statement === "Hydrogen stays contained through the crash." && c.property === "hydrogen_permeability");
    assert.equal(contained.support, "contradicted");
    assert.ok(contained.evidence.some((e) => /polym15183715/.test(e.title) && /Table 4/.test(e.locator)));
    const compat = r.claims.find((c) => /inherently resistant/.test(c.statement || "") && c.property === "hydrogen_compatibility");
    assert.equal(compat.support, "partially_supported");
    assert.equal(compat.subject, "material:hdpe", "the sentence is about HDPE itself, not the blend");
  });

  it("flags: sum range, cure terminology, hydrogen, graphene / basalt / HDPE grade, basis, missing conditions", () => {
    const ids = r.flags.map((f) => f.id);
    for (const id of ["composition-sum-not-fixed", "cure-terminology", "hydrogen-containment-contradicted", "hydrogen-compatibility-overstated",
      "underspecified:graphene", "underspecified:basalt-fiber", "underspecified:hdpe-base", "underspecified:hdpe-hc-co-polymer",
      "composition-basis-unspecified", "missing-conditions", "component-level-claims", "ingredient-roles-are-hypotheses"]) {
      assert.ok(ids.includes(id), `missing flag ${id}`);
    }
    const h2 = r.flags.find((f) => f.id === "hydrogen-containment-contradicted");
    assert.equal(h2.severity, "error");
    assert.ok(h2.evidence.length >= 2 && h2.evidence.every((e) => /^https:\/\//.test(e.url)));
    const cure = r.flags.find((f) => f.id === "cure-terminology");
    assert.ok(cure.evidence.some((e) => /133 °C/.test(e.excerpt)) && cure.evidence.some((e) => /180–220/.test(e.excerpt)));
    assert.match(r.flags.find((f) => f.id === "composition-sum-not-fixed").detail, /86 %.*103 %/);
  });

  it("density: strict estimate is unknown (copolymer unidentified); the conditional one is labelled and bracketed", () => {
    const strict = r.computed.find((c) => c.id.endsWith("density-strict"));
    assert.deepEqual(strict.status, ["unknown"]);
    assert.equal(strict.value, null);
    const cond = r.computed.find((c) => c.id.endsWith("density-conditional"));
    assert.deepEqual(cond.status, ["estimated"]);
    assert.match(cond.label, /estimated \(rule of mixtures, assumes no voids\)/);
    assert.match(cond.label, /CONDITIONAL/);
    assert.ok(cond.method.assumptions.some((a) => /^A1:/.test(a) && /NOT established/.test(a)));
    assert.ok(cond.range.min > 1000 && cond.range.max < 1120 && cond.value > cond.range.min && cond.value < cond.range.max, JSON.stringify(cond.range));
    const receipt = r.receipts.find((x) => x.id === cond.method.receiptRef);
    assert.ok(receipt && receipt.result === "computed");
    assert.ok(receipt.inputs.some((i) => i.claimRef && /ASSUMPTION A1/.test(i.claimRef)));
    assert.ok(cond.evidence.some((e) => /PubChem CID 10112/.test(e.title)));
    // nothing else is computed from constituents
    assert.deepEqual([...new Set(r.computed.map((c) => c.property))], ["density"]);
  });

  it("the test plan covers every unsupported property with standards", () => {
    const planned = new Set(r.testPlan.items.map((i) => i.property));
    for (const c of [...r.claims, ...r.computed]) {
      if (c.support === "supported") continue;
      for (const req of c.requiredEvidence.filter((x) => x.kind === "test")) assert.ok(planned.has(req.property), `${c.id} → ${req.property} not planned`);
    }
    for (const p of ["impact_resistance", "tensile_properties", "density", "hydrogen_permeability", "hydrogen_compatibility", "melt_flow_rate", "thermal_transitions", "uv_weathering", "saltwater_resistance"]) {
      assert.ok(planned.has(p), p);
    }
    const perm = r.testPlan.items.find((i) => i.property === "hydrogen_permeability");
    assert.deepEqual(perm.tests.flatMap((t) => t.standards.map((s) => s.designation)), ["ASTM D1434", "ISO 15105-1", "CSA/ANSI CHMC 2", "ISO 11114-5"]);
    assert.match(perm.acceptance, /ISO 19881/);
  });

  it("renders a markdown report", () => {
    const md = renderFormulationMarkdown(r);
    assert.match(md, /## USB Blend D: evidence report/);
    assert.match(md, /\| HDPE base \| 65–70 % \| 69\.1177 % \|/);
    assert.match(md, /\*\*100\.0000 %\*\*/);
    assert.match(md, /ASTM D3763/);
  });
});

describe("conkay_knowledge lens actions", () => {
  const actions = {};
  registerConkayKnowledgeActions((domain, name, fn) => { actions[`${domain}.${name}`] = fn; });

  it("registers formulation-report, schema, validate, fixtures", () => {
    assert.deepEqual(Object.keys(actions).sort(), ["conkay_knowledge.fixtures", "conkay_knowledge.formulation-report", "conkay_knowledge.schema", "conkay_knowledge.validate"]);
  });

  it("formulation-report runs the Blend D fixture and free text; refuses empty input", () => {
    const run = actions["conkay_knowledge.formulation-report"];
    const a = run({}, null, { fixture: "usb-blend-d" });
    assert.equal(a.ok, true);
    assert.equal(a.result.report.proposedVersion.fractions.length, 6);
    assert.match(a.result.markdown, /USB Blend D/);
    const b = run({}, null, { text: "Test mix:\n- HDPE: 90-95% — impact\n- CaCO3: 5-10% — hardness\nTotal: 100%", name: "test mix" });
    assert.equal(b.ok, true);
    assert.equal(b.result.report.source.id, "formulation:test-mix:source");
    assert.equal(run({}, null, {}).ok, false);
    assert.equal(run({}, null, { fixture: "nope" }).ok, false);
    assert.equal(run({}, null, { text: "no ingredients here" }).ok, false);
  });

  it("validate reports claim-rule violations", () => {
    const bad = entity({ properties: [makeClaim({ id: "c", subject: "material:test", property: "density", kind: "quantitative", value: 950, unit: "kg/m3", status: ["validated"] })] });
    const v = actions["conkay_knowledge.validate"]({}, null, { record: bad });
    assert.equal(v.ok, true);
    assert.equal(v.result.ok, false);
  });
});
