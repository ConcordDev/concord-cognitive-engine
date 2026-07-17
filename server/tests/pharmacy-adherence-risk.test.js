// Behavioral tests for pharmacy.adherence-risk — an honest, deterministic
// adherence-RISK heuristic computed ONLY from real logged data already
// stored in server/domains/pharmacy.js's STATE.pharmacyLens (medications,
// schedules, doses, refills). Closes docs/lens-specs/pharmacy-capability-map.md
// checklist item #10, "AI-powered adherence prediction (Medisafe's 2025
// feature)" — previously GENUINELY MISSING. Built as a transparent
// fixed-weight formula, NOT a trained/learned model (Concord has no
// per-user clinical training corpus, so claiming a real "AI prediction"
// here would be fabrication per CLAUDE.md's honest-by-construction rule).
//
// Formula under test (documented at computeAdherenceRisk in
// server/domains/pharmacy.js, reproduced here so this test proves the
// math rather than pasting output):
//
//   score = round(
//       0.45 * adherenceGap        // 100 - trailing adherence% (adherenceFor), clamped [0,100]
//     + 0.25 * streakComponent     // min(missedOrSkippedStreak, 5) / 5 * 100
//     + 0.20 * supplyComponent     // daysOfSupply<=0 -> 100, else clamp(100 - daysOfSupply/14*100, 0, 100)
//     + 0.10 * refillComponent     // refillsRemaining===0 -> 100, ===1 -> 40, else 0
//   ), clamped to [0, 100]
//
// A medication needs a real dose schedule AND >= 3 real logged doses
// (RISK_MIN_LOGGED_DOSES) before it is scored at all; otherwise the
// macro returns an honest insufficientData:true entry instead of a
// fabricated confident number.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch,
// the same pattern used by tests/pharmacy-lens-macros.test.js. No server
// boot, no network, no LLM, no DB — every input here is real STATE the
// macro itself writes via med-add/schedule-set/dose-log.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPharmacyActions from "../domains/pharmacy.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "pharmacy", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

async function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`pharmacy.${name} not registered`);
  const virtualArtifact = { id: null, domain: "pharmacy", type: "domain_action", data: input, meta: {} };
  return await fn(ctx, virtualArtifact, input);
}

before(() => {
  registerPharmacyActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a", id: "user_a" }, userId: "user_a" };

describe("pharmacy lens — adherence-risk registration", () => {
  it("registers the adherence-risk macro", () => {
    assert.equal(typeof ACTIONS.get("adherence-risk"), "function");
  });
});

describe("pharmacy lens — adherence-risk: high-risk history", () => {
  // Setup: 1x/day schedule, quantity 0 (out of supply -> daysOfSupply=0),
  // 0 refills remaining, and 5 consecutive MISSED doses (>= RISK_MIN_LOGGED_DOSES,
  // streak capped at RISK_STREAK_CAP=5).
  //
  // Hand-derived expected values:
  //   adherenceFor(days=30): scheduled = 1*30 = 30, taken = 0 (all logged "missed") -> pct = 0
  //   adherenceGap = 100 - 0 = 100                      -> contribution 0.45*100 = 45
  //   missedStreak = 5 (all 5 logs are "missed")         -> streakComponent = min(5,5)/5*100 = 100 -> contribution 0.25*100 = 25
  //   daysOfSupply = floor(0/1) = 0 -> supplyComponent = 100 (daysOfSupply<=0 branch) -> contribution 0.20*100 = 20
  //   refillsRemaining = 0 -> refillComponent = 100      -> contribution 0.10*100 = 10
  //   rawScore = 45+25+20+10 = 100 -> score = 100, band = "high"
  it("scores 100/high with adherenceGap, missed-streak, zero-supply, and zero-refill all maxed", async () => {
    const add = await call("med-add", ctxA, { name: "Warfarin", quantity: 0, refillsRemaining: 0 });
    assert.equal(add.ok, true);
    const medId = add.result.medication.id;
    const sched = await call("schedule-set", ctxA, { medId, times: ["08:00"] });
    assert.equal(sched.ok, true);
    for (let i = 0; i < 5; i++) {
      const log = await call("dose-log", ctxA, { medId, status: "missed", scheduledTime: "08:00" });
      assert.equal(log.ok, true);
    }

    const risk = await call("adherence-risk", ctxA, { days: 30 });
    assert.equal(risk.ok, true);
    assert.equal(risk.result.method, "deterministic-heuristic");
    assert.equal(risk.result.insufficientData, false);
    assert.equal(risk.result.overall, 100);
    assert.equal(risk.result.overallBand, "high");

    const row = risk.result.perMed.find((m) => m.medId === medId);
    assert.ok(row, "expected the seeded medication in perMed");
    assert.equal(row.insufficientData, false);
    assert.equal(row.score, 100);
    assert.equal(row.band, "high");

    const byFactor = Object.fromEntries(row.factors.map((f) => [f.factor, f]));
    assert.equal(byFactor.trailing_adherence_pct.value, 0);
    assert.equal(byFactor.trailing_adherence_pct.contribution, 45);
    assert.equal(byFactor.recent_missed_or_skipped_streak.value, 5);
    assert.equal(byFactor.recent_missed_or_skipped_streak.contribution, 25);
    assert.equal(byFactor.days_of_supply.value, 0);
    assert.equal(byFactor.days_of_supply.contribution, 20);
    assert.equal(byFactor.refills_remaining.value, 0);
    assert.equal(byFactor.refills_remaining.contribution, 10);
  });
});

describe("pharmacy lens — adherence-risk: low-risk history", () => {
  // Setup: 1x/day schedule, plenty of supply (quantity 100, so after 7
  // taken decrements -> 93 remaining), 3 refills remaining (>=2 ->
  // refillComponent=0), and 7 consecutive TAKEN doses queried over a
  // 7-day window so adherence reads exactly 100%.
  //
  // Note: adherence-risk clamps its `days` param to a MINIMUM of 7
  // (`Math.max(7, Math.min(180, ...))`, mirroring the same clamp
  // adherence-report uses) — so days=7 is the smallest window that is
  // NOT silently widened, and the exact-match math below assumes it.
  //
  // Hand-derived expected values:
  //   adherenceFor(days=7): scheduled = 1*7 = 7, taken = 7 -> pct = 100
  //   adherenceGap = max(0, min(100, 100-100)) = 0          -> contribution 0.45*0 = 0
  //   missedStreak = 0 (most-recent log is "taken")          -> streakComponent = 0 -> contribution 0.25*0 = 0
  //   daysOfSupply = floor(93/1) = 93 -> supplyComponent = clamp(100 - 93/14*100, 0, 100) = clamp(-564.29,0,100) = 0
  //     -> contribution 0.20*0 = 0
  //   refillsRemaining = 3 -> refillComponent = 0            -> contribution 0.10*0 = 0
  //   rawScore = 0 -> score = 0, band = "low"
  it("scores 0/low with full adherence, no missed streak, ample supply, and refills in hand", async () => {
    const add = await call("med-add", ctxA, { name: "Metformin", quantity: 100, refillsRemaining: 3 });
    assert.equal(add.ok, true);
    const medId = add.result.medication.id;
    const sched = await call("schedule-set", ctxA, { medId, times: ["09:00"] });
    assert.equal(sched.ok, true);
    for (let i = 0; i < 7; i++) {
      const log = await call("dose-log", ctxA, { medId, status: "taken", scheduledTime: "09:00" });
      assert.equal(log.ok, true);
    }
    // quantity decremented by 7 taken doses: 100 -> 93
    const detail = await call("med-detail", ctxA, { id: medId });
    assert.equal(detail.result.medication.quantity, 93);

    const risk = await call("adherence-risk", ctxA, { days: 7 });
    assert.equal(risk.ok, true);
    assert.equal(risk.result.overall, 0);
    assert.equal(risk.result.overallBand, "low");

    const row = risk.result.perMed.find((m) => m.medId === medId);
    assert.ok(row);
    assert.equal(row.score, 0);
    assert.equal(row.band, "low");

    const byFactor = Object.fromEntries(row.factors.map((f) => [f.factor, f]));
    assert.equal(byFactor.trailing_adherence_pct.value, 100);
    assert.equal(byFactor.trailing_adherence_pct.contribution, 0);
    assert.equal(byFactor.recent_missed_or_skipped_streak.value, 0);
    assert.equal(byFactor.recent_missed_or_skipped_streak.contribution, 0);
    assert.equal(byFactor.days_of_supply.value, 93);
    assert.equal(byFactor.days_of_supply.contribution, 0);
    assert.equal(byFactor.refills_remaining.value, 3);
    assert.equal(byFactor.refills_remaining.contribution, 0);
  });
});

describe("pharmacy lens — adherence-risk: honest insufficient-history states (never a fabricated confident score)", () => {
  it("no medications at all -> overall:null, insufficientData:true, empty perMed (not a fake score)", async () => {
    const risk = await call("adherence-risk", ctxA, {});
    assert.equal(risk.ok, true);
    assert.equal(risk.result.overall, null);
    assert.equal(risk.result.overallBand, null);
    assert.equal(risk.result.insufficientData, true);
    assert.match(String(risk.result.reason), /no medications tracked/i);
    assert.deepEqual(risk.result.perMed, []);
  });

  it("medication with no dose schedule -> per-med insufficientData:true with an honest reason", async () => {
    const add = await call("med-add", ctxA, { name: "Lisinopril", quantity: 30 });
    const medId = add.result.medication.id;
    // no schedule-set call at all
    const risk = await call("adherence-risk", ctxA, {});
    assert.equal(risk.ok, true);
    const row = risk.result.perMed.find((m) => m.medId === medId);
    assert.ok(row);
    assert.equal(row.insufficientData, true);
    assert.match(String(row.reason), /no dose schedule/i);
    assert.equal(row.score, undefined, "no fabricated score for an unscheduled medication");
    // no medication had enough data to score -> overall stays null, not a fake average
    assert.equal(risk.result.overall, null);
    assert.equal(risk.result.insufficientData, true);
  });

  it("medication with a schedule but fewer than 3 logged doses -> insufficientData:true, not a confident guess", async () => {
    const add = await call("med-add", ctxA, { name: "Atorvastatin", quantity: 30 });
    const medId = add.result.medication.id;
    await call("schedule-set", ctxA, { medId, times: ["07:00"] });
    // only 2 logged doses -- below RISK_MIN_LOGGED_DOSES (3)
    await call("dose-log", ctxA, { medId, status: "taken", scheduledTime: "07:00" });
    await call("dose-log", ctxA, { medId, status: "taken", scheduledTime: "07:00" });

    const risk = await call("adherence-risk", ctxA, {});
    assert.equal(risk.ok, true);
    const row = risk.result.perMed.find((m) => m.medId === medId);
    assert.ok(row);
    assert.equal(row.insufficientData, true);
    assert.equal(row.loggedDoses, 2);
    assert.match(String(row.reason), /only 2 doses logged/i);
    assert.equal(risk.result.overall, null);
  });

  it("STATE unavailable -> {ok:false}, never throws (degrade-graceful)", async () => {
    globalThis._concordSTATE = undefined;
    let r;
    await assert.doesNotReject(async () => { r = await call("adherence-risk", ctxA, {}); });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /STATE unavailable/i);
  });
});

describe("pharmacy lens — adherence-risk: honesty of labeling", () => {
  it("disclaims a heuristic, never claims to be an AI/ML prediction", async () => {
    await call("med-add", ctxA, { name: "Placebo", quantity: 30 });
    const risk = await call("adherence-risk", ctxA, {});
    assert.equal(risk.ok, true);
    assert.equal(risk.result.method, "deterministic-heuristic");
    assert.match(String(risk.result.disclaimer), /heuristic/i);
    assert.match(String(risk.result.disclaimer), /not an ai/i);
    assert.match(String(risk.result.disclaimer), /not medical advice/i);
    assert.doesNotMatch(String(risk.result.formula), /random/i);
  });
});

describe("pharmacy lens — adherence-risk: determinism", () => {
  it("the same logged history always produces the same score (no Math.random, no clock-dependent drift within a call)", async () => {
    const add = await call("med-add", ctxA, { name: "Amlodipine", quantity: 40, refillsRemaining: 1 });
    const medId = add.result.medication.id;
    await call("schedule-set", ctxA, { medId, times: ["10:00"] });
    await call("dose-log", ctxA, { medId, status: "taken", scheduledTime: "10:00" });
    await call("dose-log", ctxA, { medId, status: "missed", scheduledTime: "10:00" });
    await call("dose-log", ctxA, { medId, status: "skipped", scheduledTime: "10:00" });
    await call("dose-log", ctxA, { medId, status: "taken", scheduledTime: "10:00" });

    const first = await call("adherence-risk", ctxA, { days: 30 });
    const second = await call("adherence-risk", ctxA, { days: 30 });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.deepEqual(first.result, second.result);
  });
});
