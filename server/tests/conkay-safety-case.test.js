// ConKay nuclear Phase 1 (~/.zuko/remaining-work/CONKAY-NUCLEAR-TOPTIER-ROADMAP-2026-10-09.md §7):
// safety-case requirement records, hash-chained change log, screening-only
// vocabulary, support graph independence / common-cause screen, order-≤2
// minimal cut sets benchmarked on NUREG-0492, and the generic demo with a
// deliberately shared DC bus. Screening only, never a safety determination.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "../lib/conkay/index.js";
import {
  STATUSES, FORBIDDEN_VERDICT_WORDS, screeningStatus, forbiddenVerdicts, BANNER, PROPOSAL_STATUS,
  makeRequirement, checkRequirement, requirementStatus, ChangeLog, verifyChain,
  minimalCutSets, quantify, BENCHMARKS, independenceScreen, functionCutSets, validateSystem,
  runSafetyCaseDemo, demoSystem, systemToIR, dcFeedVariables, renderSafetyCaseMarkdown, regRef,
} from "../lib/conkay/safety-case/index.js";
import { iterateToPhysical } from "../lib/conkay/iterate/loop.js";
import { verifyReceipt } from "../lib/conkay/iterate/receipt.js";
import registerConkaySafetyActions from "../domains/conkay-safety.js";

const HEX = "a".repeat(64);
const AT = "2026-10-09T12:00:00Z";
const ENGINEER = { name: "Jordan Example", kind: "human" };

function completeRequirement(over = {}) {
  return makeRequirement({
    id: "R-1", text: "test requirement",
    source: [regRef("gdc-17")],
    owner: { name: "Alex Example", role: "responsible engineer" },
    implementation: { nodes: ["N1"] },
    analysis: [{ runId: "safety.cross-function@SC", receiptSha256: HEX }],
    acceptanceCriterion: { statement: "no findings", metric: { runId: "safety.cross-function@SC", output: "crossFunctionFindings", comparator: "==", value: 0 }, source: [regRef("gdc-17")] },
    verification: { method: "independent review", status: "performed", performedBy: "Sam Example", date: "2026-10-09" },
    reviewer: { name: "Jordan Example", role: "independent reviewer", signedOff: "2026-10-09" },
    history: { head: HEX, entries: 1 },
    ...over,
  });
}
const env = (n) => [{ runId: "safety.cross-function@SC", outputs: { crossFunctionFindings: { value: new Array(n).fill({}) } } }];

describe("screening-only vocabulary", () => {
  it("statuses are capped at screening; forbidden verdict words are refused", () => {
    assert.deepEqual([...STATUSES], ["incomplete", "screening_pass", "screening_fail", "needs_review"]);
    for (const w of FORBIDDEN_VERDICT_WORDS) {
      assert.throws(() => screeningStatus(w), /not a screening status/);
      assert.ok(!STATUSES.some((s) => s.includes(w)));
    }
    assert.deepEqual(forbiddenVerdicts({ a: { status: "approved" }, b: [{ verdict: "Safe" }], c: { status: "screening_pass" } }).map(([p]) => p), ["$.a.status", "$.b[0].verdict"]);
  });
  it("no demo output, action result or markdown uses a forbidden verdict word", () => {
    const r = runSafetyCaseDemo();
    assert.deepEqual(forbiddenVerdicts(r), []);
    const md = renderSafetyCaseMarkdown(r);
    assert.ok(md.startsWith(`> **${BANNER}**`));
    assert.doesNotMatch(md, /\b(safe|approved|compliant|certified|licensed)\b/i);
  });
});

describe("requirement records", () => {
  it("a complete record has all eight traceability fields", () => {
    assert.deepEqual(checkRequirement(completeRequirement()), { complete: true, missing: [] });
  });
  it("each missing field makes it INCOMPLETE and is listed", () => {
    for (const f of ["source", "owner", "implementation", "analysis", "acceptanceCriterion", "verification", "reviewer", "history"]) {
      const c = checkRequirement(completeRequirement({ [f]: null }));
      assert.equal(c.complete, false, f);
      assert.ok(c.missing.some((m) => m.field === f), f);
    }
    assert.ok(checkRequirement(completeRequirement({ acceptanceCriterion: { statement: "x", metric: {}, source: [] } })).missing.some((m) => /not sourced/.test(m.reason)));
  });
  it("owner and reviewer must be distinct named humans; ConKay is refused", () => {
    for (const name of ["ConKay", "Grok Bot", "automated check", ""]) assert.ok(checkRequirement(completeRequirement({ owner: { name } })).missing.some((m) => m.field === "owner"), name);
    assert.ok(checkRequirement(completeRequirement({ reviewer: { name: "conkay" } })).missing.some((m) => m.field === "reviewer"));
    assert.ok(checkRequirement(completeRequirement({ reviewer: { name: "alex example", signedOff: "x" } })).missing.some((m) => /different person/.test(m.reason)));
  });
  it("links must resolve; a stale receipt is reported", () => {
    const c = checkRequirement(completeRequirement(), { nodeIds: new Set(["N1"]), runIds: new Set(["safety.cross-function@SC"]), receipts: new Set(["b".repeat(64)]) });
    assert.ok(c.missing.some((m) => /stale/.test(m.reason)));
    assert.ok(checkRequirement(completeRequirement(), { nodeIds: new Set() }).missing.some((m) => /not in the design/.test(m.reason)));
  });
  it("status: screening_fail / needs_review / screening_pass, never more", () => {
    assert.equal(requirementStatus(completeRequirement(), env(1)).status, "screening_fail");
    assert.equal(requirementStatus(completeRequirement(), env(0)).status, "screening_pass");
    assert.equal(requirementStatus(completeRequirement({ reviewer: { name: "Jordan Example" } }), env(0)).status, "needs_review");
    assert.equal(requirementStatus(completeRequirement({ owner: null }), env(0)).status, "incomplete");
  });
});

describe("hash-chained change log", () => {
  const build = () => {
    const log = new ChangeLog();
    log.append({ at: AT, actor: { name: "ConKay", kind: "tool" }, action: "create", target: "R-1", change: { text: "x" } });
    log.append({ at: AT, actor: { name: "ConKay", kind: "tool" }, action: "propose", target: "N1", change: { to: "DC-BUS-2" } });
    log.append({ at: AT, actor: ENGINEER, action: "accept-proposal", target: "N1", change: { proposal: "P-1" } });
    return log;
  };
  it("verifies, and entries are frozen", () => {
    const log = build();
    assert.equal(verifyChain(log.entries()).valid, true);
    assert.throws(() => { log.entries()[0].action = "note"; }, TypeError);
  });
  it("detects edits, removals and reordering", () => {
    const e = JSON.parse(JSON.stringify(build().entries()));
    const edited = JSON.parse(JSON.stringify(e)); edited[1].change.to = "DC-BUS-1";
    assert.deepEqual([verifyChain(edited).valid, verifyChain(edited).brokenAt], [false, 1]);
    assert.equal(verifyChain([e[0], e[2]]).valid, false);
    assert.equal(verifyChain([e[1], e[0], e[2]]).valid, false);
    const rehashedMiddle = JSON.parse(JSON.stringify(e)); rehashedMiddle[1].hash = "f".repeat(64);
    assert.equal(verifyChain(rehashedMiddle).brokenAt, 1);
  });
  it("human-only actions are refused for ConKay or any tool", () => {
    const log = new ChangeLog();
    for (const action of ["accept-proposal", "sign-off", "change-requirement"]) {
      assert.throws(() => log.append({ at: AT, actor: { name: "ConKay", kind: "tool" }, action, target: "x" }), /human decision/);
      assert.throws(() => log.append({ at: AT, actor: { name: "ConKay", kind: "human" }, action, target: "x" }), /not a human/);
    }
  });
});

describe("minimal cut sets: NUREG-0492 benchmarks", () => {
  it("Figure VII-10: C and A·B", () => {
    const b = BENCHMARKS["nureg-0492-fig-VII-10"];
    assert.deepEqual(minimalCutSets(b.ft, b.top), [["C"], ["A", "B"]]);
  });
  it("pressure tank (Fig. VIII-14): K2, T, S·S1, S·K1, S·R; Table VIII-1 quantification", () => {
    const b = BENCHMARKS["nureg-0492-pressure-tank"];
    const cs = minimalCutSets(b.ft, b.top);
    assert.deepEqual(cs, [["K2"], ["T"], ["K1", "S"], ["R", "S"], ["S", "S1"]]);
    const q = quantify(cs, b.probabilities);
    assert.ok(Math.abs(q.rareEvent - 3.5016e-5) < 1e-12);
    // Handbook prints P(E1) ≅ 3.4×10⁻⁵ but its own importances (14 %, 86 %) follow from 3.5×10⁻⁵.
    const imp = Object.fromEntries(q.terms.map((t) => [t.cutSet.join("·"), Math.round(t.importance * 100)]));
    assert.deepEqual([imp.T, imp.K2], [14, 86]);
    assert.ok(q.minCutUpperBound <= q.rareEvent);
  });
  it("k-of-n gates, truncation, determinism, cycles", () => {
    const ft = { gates: { TOP: { type: "atleast", k: 2, inputs: ["A", "B", "C"] } } };
    assert.deepEqual(minimalCutSets(ft, "TOP"), [["A", "B"], ["A", "C"], ["B", "C"]]);
    const b = BENCHMARKS["nureg-0492-pressure-tank"];
    assert.deepEqual(minimalCutSets(b.ft, b.top, { maxOrder: 1 }), [["K2"], ["T"]]);
    const shuffled = { gates: Object.fromEntries(Object.entries(b.ft.gates).reverse().map(([k, g]) => [k, { ...g, inputs: [...g.inputs].reverse() }])) };
    assert.deepEqual(minimalCutSets(shuffled, b.top), minimalCutSets(b.ft, b.top));
    assert.throws(() => minimalCutSets({ gates: { X: { type: "or", inputs: ["Y"] }, Y: { type: "and", inputs: ["X", "Z"] } } }, "X"), /cycle/);
  });
});

describe("support graph independence screen", () => {
  it("validates kinds, references and cycles", () => {
    const s = demoSystem();
    s.supports["DC-BUS-1"].supportKind = "magic";
    s.components["DHR-A-HX"].requires.push("NOPE");
    s.supports["ROOM-A"].requires = ["DHR-HVAC-LOOP"];
    s.supports["DHR-HVAC-LOOP"] = { supportKind: "hvac", requires: ["ROOM-A"] };
    const e = validateSystem(s);
    assert.ok(e.some((x) => /kind "magic"/.test(x)) && e.some((x) => /unknown support NOPE/.test(x)) && e.some((x) => /cycle/.test(x)));
  });
  it("redundant feeds (anyOf) are not single failures; the shared bus is", () => {
    const f = independenceScreen(demoSystem());
    assert.deepEqual([...new Set(f.map((x) => x.support))], ["DC-BUS-1"]);
    assert.deepEqual(f.map((x) => x.kind).sort(), ["common-cause-trains", "common-cause-trains", "cross-function"]);
    assert.deepEqual(f.find((x) => x.function === "SF-DHR").paths.map((p) => p.text), ["DC-BUS-1 → DHR-A-VALVE → DHR-A", "DC-BUS-1 → DHR-B-VALVE → DHR-B"]);
    const cs = functionCutSets(demoSystem());
    assert.deepEqual(cs["SF-DHR"].filter((s) => s.length === 1), [["DC-BUS-1"]]);
    assert.ok(cs["SF-DHR"].some((s) => s.join() === "BATT-1,CHGR-1"));
  });
});

describe("demo: shared DC bus caught, fixes proposed, never applied", () => {
  const r = runSafetyCaseDemo();
  it("finds the shared bus with paths and keeps the design of record unchanged", () => {
    assert.equal(r.ok, true);
    assert.equal(r.banner, BANNER);
    assert.equal(r.findings.length, 3);
    assert.equal(r.designOfRecord.unchanged, true);
    assert.deepEqual(r.cutSets["SF-ECCS"].order1, [["DC-BUS-1"]]);
  });
  it("proposes separate DC buses per train, pending a human decision, re-analysed clean", () => {
    assert.deepEqual(r.proposals.map((p) => [p.change.node, p.change.from, p.change.to, p.status, p.appliedToDesignOfRecord]), [
      ["DHR-B-VALVE", "DC-BUS-1", "DC-BUS-2", PROPOSAL_STATUS, false],
      ["ECCS-B-VALVE", "DC-BUS-1", "DC-BUS-2", PROPOSAL_STATUS, false],
    ]);
    assert.equal(r.reanalysis.findingsAfter.length, 0);
    for (const c of Object.values(r.reanalysis.cutSetsAfter)) assert.deepEqual(c.order1, []);
    assert.ok(r.reanalysis.checksBefore.every((c) => c.engineStatus === "FAIL"));
    assert.ok(r.reanalysis.checksAfter.every((c) => c.engineStatus === "PASS"));
    assert.ok(r.signOffs.some((s) => s.item === "P-1" && /accept-proposal/.test(s.needed)));
  });
  it("requirements: screening_fail on the design of record, incomplete without named humans", () => {
    for (const q of r.requirements) {
      assert.equal(q.designOfRecord.status, "screening_fail");
      assert.equal(q.proposedDesign.status, "incomplete");
      assert.deepEqual(q.designOfRecord.missing.map((m) => m.field).sort(), ["owner", "reviewer", "verification"]);
    }
    assert.equal(r.changeLog.verification.valid, true);
    assert.ok(r.changeLog.entries.every((e) => e.actor.kind === "tool" && ["create", "link-analysis", "propose"].includes(e.action)));
  });
  it("success criteria are locked: the loop refuses to relax them", () => {
    const sys = demoSystem();
    const x = iterateToPhysical(systemToIR(sys), { designVariables: [{ id: "relax", node: "SF-DHR", options: [{ label: "1 of 2", set: { "props.successCriterion.k": 1 } }, { label: "0 of 2", set: { "props.successCriterion.k": 0 } }] }] });
    assert.equal(x.ok, false);
    assert.match(x.errors[0], /locked input/);
    assert.equal(r.loop.requirementsUnchanged, true);
  });
  it("is deterministic and its receipt is invalidated by a design change", () => {
    const again = runSafetyCaseDemo();
    assert.equal(again.loop.receipt.sha256, r.loop.receipt.sha256);
    assert.equal(again.changeLog.verification.head, r.changeLog.verification.head);
    const ir = systemToIR(demoSystem());
    assert.equal(verifyReceipt(r.loop.receipt, ir).valid, true);
    const fixed = demoSystem();
    fixed.components["DHR-B-VALVE"].dcBus = "DC-BUS-2";
    assert.equal(verifyReceipt(r.loop.receipt, systemToIR(fixed)).valid, false);
    assert.equal(dcFeedVariables(demoSystem()).length, 2);
  });
});

describe("lens action", () => {
  it("conkay_safety.case-report returns the banner, report and markdown", () => {
    const a = {};
    registerConkaySafetyActions((d, n, f) => { a[`${d}.${n}`] = f; });
    const out = a["conkay_safety.case-report"]();
    assert.equal(out.ok, true);
    assert.equal(out.result.banner, BANNER);
    assert.match(out.result.markdown, /Human sign-offs needed/);
    assert.deepEqual(a["conkay_safety.cut-sets"](null, null, { ft: BENCHMARKS["nureg-0492-fig-VII-10"].ft, top: "T" }).result.cutSets, [["C"], ["A", "B"]]);
    assert.equal(a["conkay_safety.verify-log"](null, null, { entries: out.result.report.changeLog.entries }).result.valid, true);
  });
});
