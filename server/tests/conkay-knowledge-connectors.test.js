// tests/conkay-knowledge-connectors.test.js
//
// Knowledge-layer step 2/4 slice: PubChem and NIST WebBook source connectors
// (identify -> extract -> preserve -> normalise -> check -> provenance ->
// review) and demo 2 (methanol-water). No network: everything replays the
// recorded excerpts captured on 2026-10-09 (scripts/conkay-capture-knowledge.mjs)
// or synthetic documents built here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { liveGetter, replayGetter, EvidenceStore, sha256 } from "../lib/conkay/knowledge/connectors/fetcher.js";
import { parseDensityValue, parseTemperatureValue, parsePressure } from "../lib/conkay/knowledge/connectors/parse-values.js";
import { identify, experimental, resolveName, pubchemUrls } from "../lib/conkay/knowledge/connectors/pubchem.js";
import { isobar, nistUrls, NIST_UNCERTAINTY, pageText } from "../lib/conkay/knowledge/connectors/nist-webbook.js";
import { checkClaims, interval } from "../lib/conkay/knowledge/connectors/review.js";
import { mixtureReport, renderMixtureMarkdown, DEMO2, parseFormula } from "../lib/conkay/knowledge/connectors/mixture.js";
import { validateClaim, makeClaim } from "../lib/conkay/knowledge/claims.js";
import { loadConnectorRecordings, SOURCES, STANDARDS } from "../lib/conkay/knowledge/index.js";

const REC = await loadConnectorRecordings();
const get = replayGetter(REC.recordings);
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));

function fakeFetch(script) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const r = script.shift();
    return { status: r.status, text: async () => r.body, headers: { get: () => "application/json" } };
  };
  f.calls = calls;
  return f;
}

describe("fetcher: retry only what is temporary, keep the original", () => {
  it("retries PubChem ServerBusy / 503 with backoff, then stores the 200 response by its SHA-256", async () => {
    const busy = JSON.stringify({ Fault: { Code: "PUGVIEW.ServerBusy", Message: "Too many requests or server too busy" } });
    const ok = JSON.stringify({ IdentifierList: { CID: [887] } });
    const f = fakeFetch([{ status: 503, body: busy }, { status: 200, body: busy }, { status: 200, body: ok }]);
    const slept = [];
    const store = new EvidenceStore();
    const g = liveGetter({ fetch: f, sleep: async (ms) => { slept.push(ms); }, retryDelayMs: 10, minIntervalMs: 0, store, now: () => "2026-10-09" });
    const d = await g("https://example.test/x");
    assert.equal(d.ok, true);
    assert.equal(d.attempts, 3);
    assert.equal(d.sha256, sha256(ok));
    assert.deepEqual(slept.filter((x) => x >= 10), [10, 20], "linear backoff on the two busy answers");
    assert.equal((await store.get(d.sha256)).body, ok);
    assert.equal(await store.get("0".repeat(64)), null);
  });

  it("a 404 / NotFound is a real answer (no data), never retried and never a value; exhausted retries say so", async () => {
    const nf = JSON.stringify({ Fault: { Code: "PUGVIEW.NotFound", Message: "No data found" } });
    const f = fakeFetch([{ status: 404, body: nf }]);
    const d = await liveGetter({ fetch: f, sleep: async () => {}, minIntervalMs: 0 })("https://example.test/y");
    assert.equal(d.notFound, true);
    assert.equal(f.calls.length, 1);
    const f2 = fakeFetch(Array.from({ length: 3 }, () => ({ status: 503, body: "busy" })));
    const d2 = await liveGetter({ fetch: f2, sleep: async () => {}, maxAttempts: 3, minIntervalMs: 0 })("https://example.test/z");
    assert.equal(d2.ok, false);
    assert.equal(d2.retryable, true);
    assert.match(d2.error, /temporary/);
  });

  it("replay never falls back to the network", async () => {
    const d = await replayGetter({})("https://pubchem.ncbi.nlm.nih.gov/anything");
    assert.equal(d.ok, false);
    assert.match(d.error, /never falls back/);
  });
});

describe("value parsing: as far as the text supports, no further", () => {
  it("density strings: relative density with its temperatures, units, and numbers with no unit kept as such", () => {
    assert.deepEqual(parseDensityValue("0.8100 at 0 °C/4 °C"), { ok: true, kind: "relative_density", value: 0.81, resolution: 0.00005, reference: "water", conditions: { temperature: 273.15, reference_temperature: 277.15 } });
    const g = parseDensityValue("0.9950 g/cu cm at 25 °C");
    assert.equal(g.kind, "liquid_density");
    assert.ok(near(g.valueKgM3, 995) && near(g.conditions.temperature, 298.15));
    assert.equal(parseDensityValue("0.7914 @ 20°C").kind, "unit_not_stated");
    assert.equal(parseDensityValue("0.917 g/cc at 0 °C (ice)").kind, "other_phase");
    assert.equal(parseDensityValue("density of sea water: approximately 1.025 g/cu cm at 25 °C").kind, "other_substance");
    assert.equal(parseDensityValue("Chemical and physical properties[Table#8152]").table, true);
    assert.ok(near(parseDensityValue("62.4 lb/cu ft at 60 °F").valueKgM3, 62.4 * 16.018463373960138));
  });

  it("temperatures: two scales are checked against each other; methods and pressures are read", () => {
    const ok = parseTemperatureValue("9.7 °C (49.5 °F) - closed cup");
    assert.ok(near(ok.valueK, 282.85) && ok.conditions.method === "closed cup" && ok.issues.length === 0);
    const bad = parseTemperatureValue("10 °C (60 °F)");
    assert.equal(bad.issues.length, 1, "60 °F is 15.6 °C, not 10 °C");
    const p = parseTemperatureValue("64.6 °C @760 [mm Hg]");
    assert.ok(near(p.conditions.pressure, 760 * 133.322387415));
    assert.deepEqual(parseTemperatureValue("64.00 to 65.00 °C. @ 760.00 mm Hg").rangeK, { min: 337.15, max: 338.15 });
    assert.equal(parseTemperatureValue("100").ok, false);
    assert.equal(parsePressure("no pressure here"), null);
  });
});

describe("PubChem connector (recorded excerpts)", () => {
  it("identifies methanol exactly: CID, formula, InChIKey, CAS by unanimous contributors, molar mass as a sourced claim", async () => {
    const m = await identify("methanol", get);
    assert.equal(m.ok, true);
    assert.equal(m.cid, 887);
    assert.deepEqual([m.identity.identifiers.molecularFormula, m.identity.identifiers.cas, m.identity.identifiers.inchiKey], ["CH4O", "67-56-1", "OKKJLVBELUTLKV-UHFFFAOYSA-N"]);
    assert.deepEqual(validateClaim(m.molarMass), []);
    assert.equal(m.molarMass.value, 32.042);
    assert.equal(m.reviews.length, 0);
  });

  it("water: the majority CAS is used and the contributors who disagree go to review, not to the bin", async () => {
    const w = await identify("water", get);
    assert.equal(w.identity.identifiers.cas, "7732-18-5");
    const r = w.reviews.find((x) => x.kind === "identifier_conflict");
    assert.ok(r && r.candidates.length === 3 && r.candidates[0].sources.length === 17);
  });

  it("an ambiguous or unknown name is not resolved by picking one", async () => {
    const amb = replayGetter({ [pubchemUrls.name("xylene")]: { body: JSON.stringify({ IdentifierList: { CID: [7809, 7929, 7237] } }), retrieved: "2026-10-09" } });
    const a = await resolveName("xylene", amb);
    assert.equal(a.ok, false);
    assert.equal(a.review.kind, "identity_ambiguous");
    const nf = replayGetter({ [pubchemUrls.name("unobtainium")]: { notFound: true, body: "", retrieved: "2026-10-09" } });
    assert.equal((await resolveName("unobtainium", nf)).review.kind, "identity_not_found");
  });

  it("experimental values become sourced claims with their exact location; unclear ones go to review", async () => {
    const d = await experimental(887, "Density", "methanol", get);
    for (const c of d.claims) {
      assert.deepEqual(validateClaim(c), [], c.id);
      assert.match(c.evidence[0].locator, /PUG View CID 887 > "Density" > Information \d+.*reference \d+: /);
      assert.match(c.evidence[0].sha256, /^[0-9a-f]{64}$/);
    }
    const rel = d.claims.filter((c) => c.property === "relative_density" && c.conditions.reference_temperature === 277.15);
    assert.deepEqual(rel.map((c) => c.value).sort(), [0.7866, 0.81]);
    assert.ok(d.reviews.some((r) => r.kind === "unit_not_stated" && /0\.7914/.test(r.text)));
    const wb = await experimental(962, "Boiling Point", "water", get);
    assert.ok(wb.reviews.some((r) => r.kind === "unit_not_stated" && r.text === "100"), "DrugBank lists a bare 100");
    const fp = await experimental(962, "Flash Point", "water", get);
    assert.equal(fp.notFound, true);
    assert.equal(fp.claims.length, 0);
  });
});

describe("NIST WebBook connector (recorded excerpts)", () => {
  const req = DEMO2.components[0].nist;

  it("isobar values are sourced claims with the stated equation uncertainty where it applies, unknown where it does not", async () => {
    const r = await isobar("67-56-1", "methanol", req, get);
    assert.equal(r.ok, true);
    const at = (p) => r.claims.find((c) => c.property === p && c.conditions.temperature === 293.15);
    assert.equal(at("liquid_density").value, 791.01);
    assert.deepEqual(at("liquid_density").uncertainty.type, "pct");
    assert.equal(at("liquid_density").uncertainty.value, 0.1);
    assert.equal(at("dynamic_viscosity").uncertainty.value, 2);
    assert.equal(at("specific_heat_capacity").uncertainty.type, "unknown", "NIST states no Cp uncertainty for methanol");
    assert.ok(near(at("specific_heat_capacity").value, 2504.6), "J/(g K) -> J/(kg K)");
    for (const c of r.claims) assert.deepEqual(validateClaim(c), [], c.id);
    assert.equal(r.claims.find((c) => c.property === "normal_boiling_point").value, 337.632);
    assert.equal(r.reviews.length, 0);
  });

  it("every uncertainty statement the connector applies is verbatim on the recorded page (drift check)", () => {
    for (const [id, rules] of Object.entries(NIST_UNCERTAINTY)) {
      const page = Object.entries(REC.recordings).find(([u]) => u.includes(`Action=Load&ID=${id}&`))[1];
      const text = pageText(page.body);
      for (const [p, u] of Object.entries(rules)) if (p !== "equationOfState") assert.ok(text.includes(u.excerpt), `${id} ${p}`);
    }
  });

  it("a range the source moves (water asked from 273.15 K: NIST starts at the triple point) is reported, with the temperatures returned", async () => {
    const r2 = { pMPa: 0.101325, tLowK: 273.15, tHighK: 283.15, tIncK: 5 };
    const tsv = "Temperature (K)\tPressure (MPa)\tDensity (kg/m3)\tPhase\n273.16\t0.10132\t999.84\tliquid\n278.16\t0.10132\t999.97\tliquid\n283.16\t0.10132\t999.70\tliquid\n";
    const g = replayGetter({ [nistUrls.isobar("C7732185", r2)]: { body: tsv, retrieved: "2026-10-09" }, [nistUrls.page("C7732185", r2)]: { body: "", retrieved: "2026-10-09" } });
    const r = await isobar("7732-18-5", "water", r2, g);
    assert.ok(r.reviews.some((x) => x.kind === "range_adjusted_by_source" && /273\.16/.test(x.reason)));
    assert.deepEqual(r.claims.map((c) => c.conditions.temperature), [273.16, 278.16, 283.16]);
    assert.ok(r.claims.every((c) => c.uncertainty.type === "unknown"), "no statement on the page: no uncertainty applied");
    assert.ok(r.reviews.some((x) => x.kind === "uncertainty_statement_not_found"));
    const none = await isobar("64-17-5", "ethanol", r2, g);
    assert.equal(none.ok, false);
    assert.equal(none.reviews[0].kind, "source_does_not_cover");
  });
});

describe("review: conflicts are queued, never resolved", () => {
  const mk = (id, v, unit, half, conditions = { temperature: 300, pressure: 101325 }) => makeClaim({ id, subject: "x", property: "liquid_density", kind: "quantitative", value: v, unit, conditions, uncertainty: { type: "range", low: v - half, high: v + half }, status: ["sourced"], support: "supported", evidence: [{ kind: "url", sourceId: "s", title: "t", url: "https://a.test", locator: "row 1" }] });
  it("non-overlapping intervals at the same state are a conflict listing every candidate; values at other states are not compared", () => {
    const r = checkClaims([mk("claim:a", 1000, "kg/m3", 0.5), mk("claim:b", 1002, "kg/m3", 0.5), mk("claim:c", 1000.2, "kg/m3", 0.5), mk("claim:d", 900, "kg/m3", 0.5, { temperature: 350, pressure: 101325 })]);
    const c = r.find((x) => x.kind === "conflict");
    assert.equal(c.candidates.length, 3);
    assert.equal(c.decision, "pending_human_review");
    assert.ok(!("chosen" in c) && !("value" in c));
    assert.deepEqual(interval(mk("claim:e", 10, "1", 1)), { lo: 9, hi: 11 });
  });
});

describe("demo 2: methanol-water 40 vol% at 20 °C", () => {
  let r;
  it("builds from recordings; every claim passes the claim rules", async () => {
    r = await mixtureReport(get);
    assert.equal(r.ok, true, r.reason);
    for (const c of [...r.claims, ...r.computed, ...r.unknowns]) assert.deepEqual(validateClaim(c), [], c.id);
  });

  it("composition conversions recomputed independently: mass, mole fractions, molar mass, atom balance", () => {
    const rhoM = 791.01, rhoW = 998.21, MM = 32.042, MW = 18.015;
    const w = (0.4 * rhoM) / (0.4 * rhoM + 0.6 * rhoW);
    const x = (w / MM) / (w / MM + (1 - w) / MW);
    const v = Object.fromEntries(r.computed.map((c) => [c.id.split(":").slice(2).join(":"), c.value]));
    assert.ok(near(v["mass-fraction:methanol"], w) && near(v["mass-fraction:water"], 1 - w));
    assert.ok(near(v["mole-fraction:methanol"], x));
    assert.ok(near(v["molar-mass"], x * MM + (1 - x) * MW));
    assert.ok(near(v["atoms-c"], x) && near(v["atoms-h"], 4 * x + 2 * (1 - x)) && near(v["atoms-o"], 1));
    assert.deepEqual(parseFormula("CH4O"), { C: 1, H: 4, O: 1 });
  });

  it("the ideal-mixing values are a model under its own subject; the mixture's real properties are unknown with a test", () => {
    const ideal = r.computed.find((c) => c.id.endsWith(":ideal-density"));
    assert.match(ideal.subject, /ideal-mixing model/);
    assert.ok(near(ideal.value, 0.4 * 791.01 + 0.6 * 998.21));
    for (const u of r.unknowns) { assert.deepEqual(u.status, ["unknown"]); assert.equal(u.value, null); }
    const plan = Object.fromEntries(r.testPlan.map((t) => [t.property, t]));
    assert.deepEqual(plan.liquid_density.tests[0].standards.map((s) => s.designation), ["ASTM D4052"]);
    assert.deepEqual(plan.dynamic_viscosity.tests[0].standards.map((s) => s.designation), ["ASTM D445"]);
    assert.deepEqual(plan.flash_point.tests[0].standards.map((s) => s.designation), ["ASTM D56"]);
    assert.deepEqual(plan.specific_heat_capacity.tests[0].standards.map((s) => s.designation), ["ASTM E1269"]);
    assert.match(plan.liquid_thermal_conductivity.tests[0].standards[0].note, /engine coolants/, "the standard's scope limit is carried to the plan");
    for (const d of ["ASTM D4052", "ASTM D445", "ASTM D56", "ASTM E1269", "ASTM D7896", "ASTM D1078", "ASTM E324"]) assert.match(STANDARDS[d].url, /^https:\/\/store\.astm\.org\//);
  });

  it("cross-checks: methanol's relative densities agree with NIST to 0.03 %; HSDB's 0.9950 g/cm3 for water at 25 °C does not", () => {
    const rel = r.crossChecks.filter((x) => /relative density x water/.test(x.reading));
    assert.ok(rel.length === 2 && rel.every((x) => x.agreesWithinUncertainty && Math.abs(x.relativeDifference) < 4e-4));
    const hsdb = r.crossChecks.find((x) => x.valueKgM3 === 995);
    assert.equal(hsdb.agreesWithinUncertainty, false);
    assert.ok(r.reviewQueue.some((q) => q.kind === "disagrees_with_reference"));
  });

  it("the review queue holds the real problems in the sources, all pending a person", () => {
    const kinds = new Set(r.reviewQueue.map((q) => q.kind));
    for (const k of ["identifier_conflict", "unit_not_stated", "other_phase", "different_substance", "conflict", "missing_conditions", "disagrees_with_reference"]) assert.ok(kinds.has(k), k);
    assert.ok(r.reviewQueue.every((q) => q.decision === "pending_human_review"));
    const fp = r.reviewQueue.find((q) => q.kind === "conflict" && q.property === "flash_point");
    assert.equal(fp.method, "closed cup");
    assert.ok(!r.reviewQueue.some((q) => q.kind === "unparsed" && /will float/.test(q.text || "")), "commentary stays with its value");
  });

  it("every document is identified by URL, SHA-256 and retrieval date; recordings are excerpts with the full-response hash", () => {
    for (const d of r.documents) { assert.match(d.sha256, /^[0-9a-f]{64}$/); assert.equal(d.retrieved, "2026-10-09"); }
    for (const rec of Object.values(REC.recordings)) if (!rec.notFound) assert.match(rec.fullSha256, /^[0-9a-f]{64}$/);
    assert.match(SOURCES.pubchem.connector, /^built/);
    assert.match(SOURCES.nist_webbook.connector, /^built/);
  });

  it("is deterministic and renders markdown; the lens action replays without network", async () => {
    const again = await mixtureReport(get);
    assert.deepEqual(again, r);
    assert.match(renderMixtureMarkdown(r), /## Unknown \(what would establish it\)/);
    const actions = {};
    const { default: register } = await import("../domains/conkay-knowledge.js");
    register((d, n, fn) => { actions[`${d}.${n}`] = fn; });
    const a = await actions["conkay_knowledge.mixture-report"]({}, null, {});
    assert.equal(a.ok, true);
    assert.equal(a.result.recordedOn, "2026-10-09");
  });
});
