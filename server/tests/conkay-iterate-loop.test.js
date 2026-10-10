// ConKay north star (~/.zuko/remaining-work/CONKAY-NORTHSTAR-ITERATE-TO-PHYSICAL-2026-10-09.md):
// claim statuses hypothesis/contradicted + bins, whole-spec ingestion and
// re-checks of the Sentinel/RAM spec, the generic iterate-to-physical loop,
// and the Sentinel Milestone 1 demo with its two deliberate faults.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeClaim, validateClaim, promotionGate, parseSpecMarkdown, loadFixture } from "../lib/conkay/knowledge/index.js";
import { runRechecks } from "../lib/conkay/knowledge/spec-rechecks.js";
import { energyBalance } from "../lib/conkay/physics/solvers/energy-balance.js";
import { iterateToPhysical } from "../lib/conkay/iterate/loop.js";
import { verifyReceipt } from "../lib/conkay/iterate/receipt.js";
import { runSentinelM1, buildSentinelM1IR, DESIGN_VARIABLES, EXCLUDED_SOLVERS } from "../lib/conkay/demos/sentinel-m1.js";
import { runNorthStar, renderNorthStarMarkdown } from "../lib/conkay/northstar/index.js";
import { listSolvers } from "../lib/conkay/index.js";
import registerConkayNorthstarActions from "../domains/conkay-northstar.js";

const spec = () => loadFixture("sentinel-ram-spec-r1").text;
const stmt = { kind: "user_statement", title: "spec", locator: "line 1" };
const law = { kind: "law", sourceId: "law:energy-conservation", title: "First law" };
const calc = { kind: "calculation", title: "calc", receiptRef: "r:1" };
const base = { id: "c.x", subject: "s", property: "p", kind: "quantitative", value: 1, unit: "kW" };

describe("claim statuses: hypothesis, contradicted, bins", () => {
  it("contradicted needs a law/sourced basis AND the calculation", () => {
    const errs = (evidence) => validateClaim(makeClaim({ ...base, status: ["contradicted"], support: "contradicted", evidence }));
    assert.ok(errs([stmt, calc]).some((e) => /cited conservation law/.test(e)));
    assert.ok(errs([stmt, law]).some((e) => /calculation showing the conflict/.test(e)));
    assert.deepEqual(errs([stmt, law, calc]), []);
    const sourced = { kind: "url", title: "DOE", url: "https://example.org", locator: "table 1" };
    assert.deepEqual(errs([sourced, calc]), []);
  });
  it("hypothesis may rest on the author's statement alone, stands alone, and is never support", () => {
    assert.deepEqual(validateClaim(makeClaim({ ...base, status: ["hypothesis"], evidence: [stmt] })), []);
    assert.ok(validateClaim(makeClaim({ ...base, status: ["hypothesis", "computed"], evidence: [stmt, calc] })).some((e) => /cannot be combined/.test(e)));
    assert.ok(validateClaim(makeClaim({ ...base, status: ["hypothesis"], support: "supported", evidence: [stmt, law] })).some((e) => /not support/.test(e)));
    assert.ok(validateClaim(makeClaim({ ...base, status: ["hypothesis"], bin: "maybe", evidence: [stmt] })).length > 0);
  });
  it("an unsupported-as-stated claim never reaches fabrication or acceptance, even when 'computed'", () => {
    const c = makeClaim({ ...base, status: ["computed"], support: "supported", bin: "unsupported-as-stated", evidence: [calc] });
    assert.deepEqual(validateClaim(c), []);
    for (const stage of ["fabrication", "acceptance"]) {
      const g = promotionGate(c, stage);
      assert.equal(g.allowed, false);
      assert.match(g.reasons[0], /unsupported-as-stated/);
    }
    assert.equal(promotionGate(makeClaim({ ...base, status: ["computed"], bin: "research-stage", evidence: [calc] })).allowed, false);
    assert.equal(promotionGate(makeClaim({ ...base, status: ["hypothesis"], bin: "buildable", evidence: [stmt] })).allowed, false);
    const est = promotionGate(makeClaim({ ...base, status: ["estimated"], bin: "buildable", evidence: [calc] }));
    assert.deepEqual([est.allowed, est.screeningOnly], [true, true]);
  });
  it("the acceptance gate refuses a design resting on an unsupported claim although every check passes", () => {
    const lift = makeClaim({ id: "spec.lift", subject: "sentinel", property: "lift", kind: "quantitative", value: 15000, unit: "lb", status: ["computed"], bin: "unsupported-as-stated", evidence: [calc] });
    const r = runSentinelM1({ claims: [{ ...lift, usedAsInput: true }] });
    assert.equal(r.report.converged, true);
    assert.equal(r.gate.accepted, false);
    assert.ok(r.gate.blockers.some((b) => b.kind === "claim" && b.claim === "spec.lift"));
    // Without the claim, the only blocker left is the open mass budget: unknown masses block a PASS.
    const clean = runSentinelM1();
    assert.equal(clean.gate.accepted, false);
    assert.deepEqual(clean.gate.blockers.map((b) => `${b.kind}:${b.runId}`), ["unknown:mass.budget@sentinel"]);
  });
});

describe("whole-spec ingestion", () => {
  it("is deterministic and keeps line provenance and stated status", () => {
    const a = parseSpecMarkdown(spec(), { sourceId: "s" });
    assert.deepEqual(parseSpecMarkdown(spec(), { sourceId: "s" }), a);
    assert.equal(a.doc.sha256, "986817b3c27d840974f0969d2f1a5686f99ba0aa3065159822acfc5bca35419a");
    assert.ok(a.claims.length > 100);
    const lines = spec().split("\n");
    for (const c of a.claims) assert.ok(c.provenance.lines[0] >= 1 && c.provenance.lines[1] <= lines.length);
    const sprint = a.claims.find((c) => /Sprint/.test(c.text));
    assert.deepEqual([sprint.statedStatus, sprint.bin, sprint.quantities[0].range], [["contradicted"], "unsupported-as-stated", { min: 80, max: 100 }]);
    assert.equal(a.claims.find((c) => /^Sourced — traceable/.test(c.text)).kind, "definition");
    for (const k of ["component", "material", "dimension", "performance", "process", "environment"]) assert.ok(a.claims.some((c) => c.kind === k), k);
  });
});

describe("re-checks of the spec's computed claims", () => {
  const r = runRechecks(parseSpecMarkdown(spec(), { sourceId: "s" }));
  const row = (id) => r.rows.find((x) => x.id === id);
  it("matches known values", () => {
    const want = {
      "raman.frequency": 96.7944, "raman.wavelength": 3097.21, "raman.photon-energy": 0.40031, "h2.ndot": 1.24015,
      "h2.gibbs": 4.90067, "h2.thermoneutral": 5.90788, "h2.hhv": 5.91318, "h2.lhv": 4.99945, "h2.pem": 8.25,
      "loop.efficiency": 0.121199, "formulation.blend-d.min": 86, "formulation.blend-d.max": 103,
      "scale.square-cube": 171500, "transit.mars": 692.583, "transit.moon": 30.5079, "march.kj-per-mol": 38.624,
    };
    for (const [id, v] of Object.entries(want)) assert.ok(Math.abs(row(id).conkay.value - v) <= Math.abs(v) * 1e-5, `${id}: ${row(id).conkay.value}`);
  });
  it("agrees with the spec except where the arithmetic differs", () => {
    const disagree = r.rows.filter((x) => x.verdict === "disagree").map((x) => x.id).sort();
    assert.deepEqual(disagree, ["formulation.blend-d.min", "formulation.blend-d.reach-100", "march.805w"]);
    for (const x of r.rows) assert.match(x.receiptId, /^[0-9a-f]{64}$/);
    for (const c of r.claims) assert.deepEqual(validateClaim(c), [], c.id);
  });
  it("emits contradicted claims that carry their basis and calculation", () => {
    assert.ok(r.contradicted.length >= 6);
    for (const c of r.contradicted) {
      assert.deepEqual(c.errors, [], c.claim.id);
      assert.deepEqual(c.claim.status, ["contradicted"]);
      assert.equal(promotionGate(c.claim).allowed, false);
    }
  });
  it("energy balance: unmeasured recovery is rejected, a lossy loop cannot be self-sustaining", () => {
    const b = energyBalance({ inputs: [{ id: "in", energy: 55, unit: "kWh" }], outputs: [{ id: "out", energy: 6.66, unit: "kWh" }], recovered: [{ id: "regen", energy: 100, unit: "kWh" }], claim: "self-sustaining" });
    assert.deepEqual([b.rejected.map((x) => x.id), b.claimVerdict, b.totalIn], [["regen"], "contradicted", 55]);
    assert.throws(() => energyBalance({ inputs: [{ id: "a", energy: 1, unit: "kWh" }], outputs: [{ id: "b", energy: 1, unit: "J" }] }), /mixed units/);
  });
});

describe("iterate-to-physical loop: Sentinel Milestone 1", () => {
  const r = runSentinelM1();
  const R = r.report;
  const at = (list, id) => list.find((c) => c.runId === id);
  it("catches both deliberate faults", () => {
    assert.equal(at(R.initial, "structural.tube-bending@bracket").status, "FAIL");
    assert.equal(at(R.initial, "requirement.check@R-duration").status, "FAIL");
    assert.equal(at(R.initial, "electrical.budget@sentinel").status, "FAIL");
    assert.ok(at(R.initial, "electrical.budget@sentinel").outputs.operatingDurationHours.value < 1);
  });
  it("repairs them with bounded design changes and re-runs the coupled checks", () => {
    assert.equal(R.converged, true);
    assert.equal(R.checks.filter((c) => c.status === "FAIL").length, 0);
    const acc = R.repairs.filter((x) => x.result === "accepted");
    assert.deepEqual(acc.map((x) => `${x.variable}:${x.after}`), ["battery.parallel:13S3P", "battery.parallel:13S5P", 'bracket.section:1" × 0.065" 6061-T6']);
    assert.ok(R.repairs.some((x) => x.result === "reverted"));
    const batteryRepair = acc[1];
    assert.ok(batteryRepair.rerun.includes("stability.static@sentinel") && batteryRepair.rerun.includes("mass.budget@sentinel"));
    assert.ok(at(R.checks, "stability.static@sentinel").outputs.stabilityMargin.value > at(R.initial, "stability.static@sentinel").outputs.stabilityMargin.value);
  });
  it("never changes a requirement or locked input", () => {
    const ir = buildSentinelM1IR();
    const payload = R.finalDesign.nodes.find((n) => n.id === "payload");
    assert.equal(ir.nodes.find((n) => n.id === "payload").props.mass, "20 kg");
    assert.equal(payload.props.mass, 20); // compiled to SI (kg), unchanged by the loop
    assert.equal(R.finalDesign.requirements.length, ir.requirements.length);
    const bad = iterateToPhysical(ir, { designVariables: [{ id: "cheat", node: "payload", options: [{ label: "20", set: { "props.mass": 20 } }, { label: "5", set: { "props.mass": 5 } }] }] });
    assert.equal(bad.ok, false);
    assert.match(bad.errors[0], /locked input/);
  });
  it("lists requirement changes as options only, when no bounded variable can fix a check", () => {
    const x = iterateToPhysical(buildSentinelM1IR(), { designVariables: DESIGN_VARIABLES.filter((v) => v.id !== "battery.parallel"), excludeSolvers: EXCLUDED_SOLVERS });
    assert.equal(x.report.converged, false);
    const opt = x.report.requirementOptions.find((o) => o.runId === "requirement.check@R-duration");
    assert.match(opt.option, /relax/);
    assert.equal(opt.applied, false);
  });
  it("keeps domains separate and lists unknown mass instead of zeroing it", () => {
    for (const d of ["mass.budget", "geometry.clearance", "stability.static", "structural.bending", "electrical.power", "energy.solar", "conservation.energy", "actuation.torque"]) assert.ok(R.byDomain[d], d);
    assert.equal(R.score, undefined);
    const unknown = at(R.checks, "mass.budget@sentinel").outputs.unknownItems.value.map((u) => u.id);
    assert.ok(unknown.includes("compute") && unknown.includes("armor"));
    // #1037 mass states: unknown masses are placeholders with no mass value (never zero),
    // datasheet masses are sourced with a URL and variant, and the payload stays a requirement.
    const ir = buildSentinelM1IR();
    for (const n of ir.nodes.filter((x) => x.props?.massState?.state === "placeholder")) {
      assert.equal(n.props.mass, undefined, n.id);
      assert.ok(unknown.includes(n.id), n.id);
    }
    for (const n of ir.nodes.filter((x) => x.props?.massState?.state === "sourced")) assert.ok(/^https:\/\//.test(n.props.massState.source.url) && n.props.massState.variant, n.id);
    const byState = at(R.checks, "mass.budget@sentinel").outputs.massByState.value;
    assert.equal(byState.requirement, 20);
    assert.equal(byState.sourced, 6 * 0.85 + 0.83 + 6.4);
    for (const s of listSolvers().filter((x) => ["mass.budget", "electrical.budget", "stability.static"].includes(x.id))) assert.ok(s.regime && s.units && s.tolerance && s.screening != null, s.id);
  });
  it("is deterministic, and its receipt is invalidated by an input or solver-version change", () => {
    assert.equal(runSentinelM1().report.receipt.sha256, R.receipt.sha256);
    const ir = buildSentinelM1IR();
    assert.deepEqual(verifyReceipt(R.receipt, ir), { valid: true, reasons: [] });
    const heavier = buildSentinelM1IR();
    heavier.nodes.find((n) => n.id === "payload").props.mass = "25 kg";
    assert.match(verifyReceipt(R.receipt, heavier).reasons[0], /input design IR changed/);
    const old = { ...R.receipt, solvers: { ...R.receipt.solvers, "mass.budget": "0.9.0" } };
    assert.ok(verifyReceipt(old, ir).reasons.some((x) => /mass.budget is now 1.1.0/.test(x)));
  });
});

describe("the same loop runs other designs", () => {
  it("repairs an overstressed I-beam through the existing beam.fea solver", () => {
    const ir = {
      design: { id: "beam-demo" },
      nodes: [{ id: "B1", kind: "Beam", material: "steel-a36", geometry: { shape: "i-beam", length: "2 m", height: "100 mm", flangeWidth: "60 mm", flangeThickness: "4 mm", webThickness: "4 mm" }, props: { support: "simply-supported" } }],
      loadCases: [{ id: "lc1", loads: [{ target: "B1", pointLoad: "20 kN" }] }],
    };
    const vars = [{ id: "flange", node: "B1", options: [4, 8, 12, 16].map((t) => ({ label: `${t} mm`, set: { "geometry.flangeThickness": t / 1000 } })) }];
    const x = iterateToPhysical(ir, { designVariables: vars });
    assert.equal(x.ok, true);
    assert.equal(x.report.initial.find((c) => c.runId === "beam.fea@B1").status, "FAIL");
    assert.equal(x.report.converged, true);
    assert.ok(x.report.repairs.some((rp) => rp.result === "accepted" && rp.variable === "flange"));
  });
});

describe("north-star report and lens actions", () => {
  it("renders the report and serves the actions", () => {
    const ns = runNorthStar();
    assert.deepEqual(ns.invalidClaims, []);
    const md = renderNorthStarMarkdown(ns);
    for (const s of ["Re-check", "Failed member", "13S2P", "Claims that remain hypothesis or contradicted"]) assert.ok(md.includes(s), s);
    const actions = {};
    registerConkayNorthstarActions((d, n, fn) => { actions[`${d}.${n}`] = fn; });
    assert.equal(actions["conkay_northstar.recheck-spec"](null, null, { fixture: "sentinel-ram-spec-r1" }).ok, true);
    assert.equal(actions["conkay_northstar.ingest-spec"](null, null, {}).ok, false);
    const s = actions["conkay_northstar.sentinel-m1"]();
    assert.equal(s.result.report.converged, true);
  });
});
