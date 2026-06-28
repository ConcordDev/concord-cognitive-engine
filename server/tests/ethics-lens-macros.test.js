// Behavioral macro tests for server/domains/ethics.js — the multi-framework /
// stakeholder-map / decision-matrix / bias-checklist / ethics-review /
// case-library substrate that the /lenses/ethics DecisionToolkit drives.
//
// This file mirrors the REAL LENS_ACTIONS dispatch: every ethics handler is
// registered via `registerLensAction(domain, action, handler)` and invoked as
// `handler(ctx, virtualArtifact, input)` — the 3-ARG convention with
// `virtualArtifact.data === input`. The dispatch ALSO peels exactly one
// redundant `{ artifact: { data } }` wrapper (lens-input-normalize.js); we peel
// the same way before calling so the harness is byte-identical to production.
// (Harness copied from server/tests/geology-lens-macros.test.js.)
//
// These are NOT shape-only assertions. They pin ACTUAL computed values for
// KNOWN inputs (the multi-framework verdict + composite + agreement bands, the
// weighted decision-matrix winner, the vulnerability-amplified stakeholder
// exposure, the bias risk score), CRUD round-trips through real STATE, the EXACT
// field names the six DecisionToolkit sub-panels render (so a dead-surface
// regression surfaces here), validation-rejection, graceful degradation, and a
// fail-CLOSED poisoned-numeric contract: Infinity/NaN/"1e999"/"Infinity" inputs
// are clamped/rejected and NEVER leak Infinity/NaN (serialized null) into the
// result, and NEVER throw a 500.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEthicsActions from "../domains/ethics.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "ethics", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the live dispatch exactly: peel one redundant artifact wrapper, then
// handler(ctx, virtualArtifact, input) with virtualArtifact.data = input.
function call(name, ctx, rawInput = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`ethics.${name} not registered`);
  const input = peelRedundantArtifactWrapper(rawInput);
  const virtualArtifact = { id: null, title: rawInput?.title ?? null, domain: "ethics", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerEthicsActions(registerLensAction); });

beforeEach(() => {
  // No boot, no network. The ethics macros are pure-compute + STATE; any
  // network reach is a leak.
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "eth_user_a" }, userId: "eth_user_a" };
const ctxB = { actor: { userId: "eth_user_b" }, userId: "eth_user_b" };

// Assert no value in the (possibly nested) object is a non-finite number.
function assertNoNonFinite(obj, path = "root") {
  if (obj == null) return;
  if (typeof obj === "number") {
    assert.ok(Number.isFinite(obj), `non-finite number at ${path}: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertNoNonFinite(v, `${path}[${i}]`)); return; }
  if (typeof obj === "object") { for (const k of Object.keys(obj)) assertNoNonFinite(obj[k], `${path}.${k}`); }
}

// ── registration: every lens-driven macro is present ───────────────────────
describe("ethics — registration (every macro the six DecisionToolkit panels call)", () => {
  it("registers all macros the components dispatch", () => {
    for (const m of [
      "multiFrameworkDilemma", "listMultiFramework",
      "stakeholderMap", "listStakeholderMaps",
      "decisionMatrix", "listDecisionMatrices",
      "biasChecklistTemplate", "biasChecklist", "listBiasChecklists",
      "submitReview", "addReviewOpinion", "recordVerdict", "listReviews",
      "archiveCase", "searchCases", "deleteCase",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing ethics.${m}`);
    }
  });
});

// ── multiFrameworkDilemma — three-lens scoring + recommendation ────────────
describe("ethics.multiFrameworkDilemma — verdict + composite the panel renders", () => {
  it("ranks an honest beneficial option above a deceptive one (known verdict)", () => {
    const r = call("multiFrameworkDilemma", ctxA, {
      dilemma: "How to handle layoffs",
      options: [
        { name: "Honest transparent layoff", description: "honest consent respect dignity", benefitScore: 60, harmScore: 20 },
        { name: "Deceptive exploit", description: "deceive manipulate exploit harm", benefitScore: 80, harmScore: 90 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.recommended, "Honest transparent layoff");
    // The renderer reads o.scores.{utilitarian,deontological,virtue}, composite,
    // agreement. Pin the exact computed values.
    const honest = r.result.options.find((o) => o.name === "Honest transparent layoff");
    const deceptive = r.result.options.find((o) => o.name === "Deceptive exploit");
    assert.deepEqual(honest.scores, { utilitarian: 70, deontological: 100, virtue: 100 });
    assert.equal(honest.composite, 90);
    // Deception is penalised hard on deontology/virtue → frameworks conflict.
    assert.deepEqual(deceptive.scores, { utilitarian: 45, deontological: 0, virtue: 0 });
    assert.equal(deceptive.agreement, "frameworks-conflict");
    assert.ok(r.result.conflicted.includes("Deceptive exploit"));
    assertNoNonFinite(r.result);
  });

  it("derives benefit/harm from keywords when scores are omitted", () => {
    const r = call("multiFrameworkDilemma", ctxA, {
      dilemma: "d",
      options: [{ name: "Care", description: "help protect care benefit" }],
    });
    assert.equal(r.ok, true);
    // 4 positive keywords (help/protect/care/benefit) → benefit = 4*20 = 80.
    assert.equal(r.result.options[0].benefit, 80);
    assert.equal(r.result.options[0].harm, 0);
    assertNoNonFinite(r.result);
  });

  it("validation-rejection: missing dilemma / missing options", () => {
    assert.match(call("multiFrameworkDilemma", ctxA, { options: [{ name: "A" }] }).error, /dilemma text required/i);
    assert.match(call("multiFrameworkDilemma", ctxA, { dilemma: "d", options: [] }).error, /at least one option required/i);
  });

  it("fail-CLOSED: poisoned 1e999/Infinity harm/benefit never leak Infinity/NaN", () => {
    const r = call("multiFrameworkDilemma", ctxA, {
      dilemma: "d",
      options: [{ name: "A", description: "help protect care", benefitScore: "1e999", harmScore: "Infinity" }],
    });
    assert.equal(r.ok, true);
    // Non-finite scores fall back to keyword-derived; never Infinity.
    assert.ok(Number.isFinite(r.result.options[0].benefit));
    assert.ok(Number.isFinite(r.result.options[0].harm));
    assert.ok(Number.isFinite(r.result.options[0].composite));
    assertNoNonFinite(r.result);
  });
});

// ── decisionMatrix — weighted winner + poisoned-weight fail-closed ─────────
describe("ethics.decisionMatrix — weighted score winner the panel renders", () => {
  it("picks the higher weighted-total option (known winner + percent)", () => {
    const r = call("decisionMatrix", ctxA, {
      title: "Vendor choice",
      criteria: [{ name: "fairness", weight: 0.6 }, { name: "cost", weight: 0.4 }],
      options: [
        { name: "A", scores: { fairness: 8, cost: 4 } }, // 0.6*8 + 0.4*4 = 6.4
        { name: "B", scores: { fairness: 5, cost: 9 } }, // 0.6*5 + 0.4*9 = 6.6
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.winner, "B");
    const a = r.result.options.find((o) => o.name === "A");
    assert.equal(a.total, 6.4);
    assert.equal(a.percent, 64); // renderer reads o.percent + o.breakdown[].{criterion,raw,weighted}
    assert.equal(a.breakdown.find((b) => b.criterion === "fairness").weighted, 4.8);
    assertNoNonFinite(r.result);
  });

  it("validation-rejection: missing criteria / missing options", () => {
    assert.match(call("decisionMatrix", ctxA, { options: [{ name: "A" }] }).error, /at least one criterion required/i);
    assert.match(call("decisionMatrix", ctxA, { criteria: [{ name: "c", weight: 1 }] }).error, /at least one option required/i);
  });

  it("fail-CLOSED: a poisoned 1e999/Infinity weight never makes the normalized weight NaN", () => {
    // Pre-fix: Number('1e999')||0 = Infinity → weightSum = Infinity →
    // Infinity/Infinity = NaN → weighted NaN, percent NaN leaked into output.
    const r = call("decisionMatrix", ctxA, {
      title: "Poison",
      criteria: [{ name: "a", weight: "1e999" }, { name: "b", weight: 1 }],
      options: [{ name: "X", scores: { a: "Infinity", b: 5 } }],
    });
    assert.equal(r.ok, true);
    for (const o of r.result.options) {
      assert.ok(Number.isFinite(o.total), `total ${o.total}`);
      assert.ok(Number.isFinite(o.percent), `percent ${o.percent}`);
      for (const b of o.breakdown) assert.ok(Number.isFinite(b.weighted), `weighted ${b.weighted}`);
    }
    assertNoNonFinite(r.result);
  });

  it("degrade-graceful: non-string criterion/option names + non-numeric scores never throw", () => {
    const r = call("decisionMatrix", ctxA, {
      title: 123,
      criteria: [{ name: 5, weight: "abc" }, { name: "real", weight: 1 }],
      options: [{ name: null, scores: { real: "not-a-number" } }],
    });
    assert.equal(r.ok, true);
    assertNoNonFinite(r.result);
  });
});

// ── stakeholderMap — vulnerability-amplified exposure + best option ────────
describe("ethics.stakeholderMap — weighted impact table the panel renders", () => {
  it("amplifies negative impact on vulnerable stakeholders and picks the best option", () => {
    const r = call("stakeholderMap", ctxA, {
      title: "Plant closure",
      options: ["keep", "cut"],
      stakeholders: [
        { name: "Workers", group: "staff", vulnerability: 80, impacts: { keep: 50, cut: -60 } },
        { name: "Shareholders", group: "owners", vulnerability: 0, impacts: { keep: -10, cut: 40 } },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.bestOption, "keep");
    const workers = r.result.stakeholders.find((s) => s.name === "Workers");
    // -60 * (1 + 80/100) = -108 weighted (renderer reads impacts[opt].weighted).
    assert.equal(workers.impacts.cut.weighted, -108);
    assert.equal(workers.impacts.keep.weighted, 50); // positive impact NOT amplified
    const cut = r.result.optionTotals.find((o) => o.option === "cut");
    assert.equal(cut.vulnerableHarmed, 1);
    assertNoNonFinite(r.result);
  });

  it("validation-rejection: missing options / missing stakeholders", () => {
    assert.match(call("stakeholderMap", ctxA, { stakeholders: [{ name: "x" }] }).error, /at least one option required/i);
    assert.match(call("stakeholderMap", ctxA, { options: ["a"] }).error, /at least one stakeholder required/i);
  });

  it("fail-CLOSED: poisoned 1e999/Infinity vulnerability + impact clamp, never leak Infinity", () => {
    const r = call("stakeholderMap", ctxA, {
      title: "Poison",
      options: ["x"],
      stakeholders: [{ name: "V", vulnerability: "1e999", impacts: { x: "-Infinity" } }],
    });
    assert.equal(r.ok, true);
    const v = r.result.stakeholders[0];
    assert.ok(Number.isFinite(v.vulnerability) && v.vulnerability <= 100);
    assert.ok(Number.isFinite(v.impacts.x.weighted));
    assert.ok(Number.isFinite(v.netExposure));
    assertNoNonFinite(r.result);
  });
});

// ── biasChecklist + template — risk scoring round-trip ─────────────────────
describe("ethics.biasChecklist — risk score + template the panel renders", () => {
  it("returns the 10-item canonical template the form renders", () => {
    const r = call("biasChecklistTemplate", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.items.length, 10);
    // renderer reads item.{key,label,prompt}.
    assert.equal(r.result.items[0].key, "confirmation");
    assert.ok(typeof r.result.items[0].label === "string" && r.result.items[0].prompt.length > 0);
  });

  it("computes the risk score from flagged biases (known value)", () => {
    const r = call("biasChecklist", ctxA, {
      decision: "Promote internal candidate",
      responses: { confirmation: { flagged: true }, anchoring: { flagged: true, note: "first offer" } },
    });
    assert.equal(r.ok, true);
    // 2 of 10 flagged → 20% → moderate (renderer reads riskScore/riskLevel/flaggedCount/totalCount).
    assert.equal(r.result.flaggedCount, 2);
    assert.equal(r.result.totalCount, 10);
    assert.equal(r.result.riskScore, 20);
    assert.equal(r.result.riskLevel, "moderate");
    assert.equal(r.result.items.find((i) => i.key === "anchoring").note, "first offer");
    assertNoNonFinite(r.result);
  });

  it("validation-rejection: missing decision text", () => {
    assert.match(call("biasChecklist", ctxA, {}).error, /decision text required/i);
  });

  it("degrade-graceful: a non-object responses field never throws + risk is finite", () => {
    const r = call("biasChecklist", ctxA, { decision: "d", responses: "not-an-object" });
    assert.equal(r.ok, true);
    assert.equal(r.result.flaggedCount, 0);
    assert.ok(Number.isFinite(r.result.riskScore));
    assertNoNonFinite(r.result);
  });
});

// ── list round-trips + per-user isolation ──────────────────────────────────
describe("ethics list macros — STATE round-trip + per-user isolation", () => {
  it("multiFrameworkDilemma → listMultiFramework round-trips and is user-scoped", () => {
    call("multiFrameworkDilemma", ctxA, { dilemma: "d1", options: [{ name: "O" }] });
    call("multiFrameworkDilemma", ctxA, { dilemma: "d2", options: [{ name: "O" }] });
    const list = call("listMultiFramework", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.analyses.length, 2);
    // newest first.
    assert.equal(list.result.analyses[0].dilemma, "d2");
    // user B sees none of A's analyses.
    assert.equal(call("listMultiFramework", ctxB, {}).result.analyses.length, 0);
  });

  it("stakeholderMap / decisionMatrix / biasChecklist each list back their record", () => {
    call("stakeholderMap", ctxA, { title: "M", options: ["a"], stakeholders: [{ name: "s", impacts: { a: 5 } }] });
    assert.equal(call("listStakeholderMaps", ctxA, {}).result.maps.length, 1);
    call("decisionMatrix", ctxA, { title: "X", criteria: [{ name: "c", weight: 1 }], options: [{ name: "o", scores: { c: 5 } }] });
    assert.equal(call("listDecisionMatrices", ctxA, {}).result.matrices.length, 1);
    call("biasChecklist", ctxA, { decision: "dec", responses: {} });
    assert.equal(call("listBiasChecklists", ctxA, {}).result.checklists.length, 1);
  });
});

// ── ethics review workflow — open → deliberating → decided ──────────────────
describe("ethics review workflow — submit / opine / verdict lifecycle", () => {
  it("walks a review from open through a verdict with a stance tally", () => {
    const ctx = { actor: { userId: "eth_rev_u" }, userId: "eth_rev_u" };
    const rev = call("submitReview", ctx, { title: "Layoffs", dilemma: "should we lay off staff?" });
    assert.equal(rev.ok, true);
    assert.equal(rev.result.status, "open");

    const op = call("addReviewOpinion", ctx, { reviewId: rev.result.id, stance: "approve", rationale: "necessary" });
    assert.equal(op.result.status, "deliberating");
    assert.equal(op.result.opinions.length, 1);
    assert.equal(op.result.opinions[0].stance, "approve");

    const vd = call("recordVerdict", ctx, { reviewId: rev.result.id, decision: "proceed", rationale: "consensus" });
    assert.equal(vd.result.status, "decided");
    assert.equal(vd.result.verdict.decision, "proceed");
    assert.equal(vd.result.verdict.tally.approve, 1);

    assert.equal(call("listReviews", ctx, {}).result.reviews.length, 1);
  });

  it("validation-rejection: bad stance, missing fields, opinions after decided", () => {
    const ctx = { actor: { userId: "eth_rev_u2" }, userId: "eth_rev_u2" };
    assert.match(call("submitReview", ctx, { dilemma: "d" }).error, /title required/i);
    const rev = call("submitReview", ctx, { title: "T", dilemma: "d" }).result;
    assert.match(call("addReviewOpinion", ctx, { reviewId: rev.id, stance: "maybe" }).error, /invalid stance/i);
    call("recordVerdict", ctx, { reviewId: rev.id, decision: "x" });
    assert.match(call("addReviewOpinion", ctx, { reviewId: rev.id, stance: "approve", rationale: "y" }).error, /already decided/i);
    assert.match(call("addReviewOpinion", ctx, { reviewId: "missing", stance: "approve" }).error, /review not found/i);
  });
});

// ── case library — archive / search / delete ───────────────────────────────
describe("ethics.searchCases — archive / filter / delete round-trip", () => {
  it("archives a case, finds it by query and tag, and deletes it", () => {
    const ctx = { actor: { userId: "eth_case_u" }, userId: "eth_case_u" };
    const c = call("archiveCase", ctx, {
      title: "Trolley Problem", dilemma: "divert the trolley?", resolution: "divert",
      reasoning: "minimize deaths", framework: "Utilitarian", tags: ["Classic", "Trolley"],
    });
    assert.equal(c.ok, true);
    assert.deepEqual(c.result.tags, ["classic", "trolley"]); // lowercased

    const byQuery = call("searchCases", ctx, { query: "trolley" });
    assert.equal(byQuery.result.total, 1);
    assert.deepEqual(byQuery.result.allTags, ["classic", "trolley"]);

    const byTag = call("searchCases", ctx, { tag: "classic" });
    assert.equal(byTag.result.total, 1);
    const byFramework = call("searchCases", ctx, { framework: "utilitarian" });
    assert.equal(byFramework.result.total, 1);
    // a non-matching query returns empty (distinct from an error).
    assert.equal(call("searchCases", ctx, { query: "nonexistent" }).result.total, 0);

    const del = call("deleteCase", ctx, { caseId: c.result.id });
    assert.equal(del.ok, true);
    assert.equal(call("searchCases", ctx, {}).result.total, 0);
  });

  it("validation-rejection: missing required fields / missing case on delete", () => {
    const ctx = { actor: { userId: "eth_case_u2" }, userId: "eth_case_u2" };
    assert.match(call("archiveCase", ctx, { dilemma: "d", resolution: "r" }).error, /title required/i);
    assert.match(call("archiveCase", ctx, { title: "t", resolution: "r" }).error, /dilemma required/i);
    assert.match(call("archiveCase", ctx, { title: "t", dilemma: "d" }).error, /resolution required/i);
    assert.match(call("deleteCase", ctx, { caseId: "nope" }).error, /case not found/i);
  });
});

// ── double-wrap dispatch parity — the dead-surface bug class ────────────────
describe("ethics — { artifact:{ data } } double-wrap is peeled like production", () => {
  it("decisionMatrix reads through a sole-key artifact wrapper identically to flat input", () => {
    const wrapped = call("decisionMatrix", ctxA, {
      artifact: { data: { title: "W", criteria: [{ name: "a", weight: 1 }], options: [{ name: "X", scores: { a: 6 } }] } },
    });
    assert.equal(wrapped.ok, true);
    assert.equal(wrapped.result.winner, "X");
    assert.equal(wrapped.result.options[0].total, 6);
  });

  it("multiFrameworkDilemma reads through the wrapper (the historical blank-calc bug)", () => {
    const wrapped = call("multiFrameworkDilemma", ctxA, {
      artifact: { data: { dilemma: "wrapped dilemma", options: [{ name: "O", description: "honest" }] } },
    });
    assert.equal(wrapped.ok, true);
    assert.equal(wrapped.result.dilemma, "wrapped dilemma");
  });
});
