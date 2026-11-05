// Behaviour tests for the mental-health lens build slices S-MH-1 + S-MH-3.
//
// S-MH-3: the dashboard "Day streak" counts days with ANY tracked
// activity (check-in, sleep log, gratitude entry, breathing, practice
// session) — R3's pass showed a mood check-in + journal + sleep log on
// one day left the streak at 0 because only practice-session days
// counted. And mood-insights no longer calls a trend "stable" on one
// to three check-ins: under four entries it reports not-enough-data.
//
// S-MH-1: wellness-score-tracked computes the Analysis score from the
// member's own tracked store on a disclosed basis — no tracked data
// means no score; social interactions are never invented (absent =>
// the three tracked pillars, renormalized, basis "tracked"; supplied
// => the exact four-pillar wellnessScore formula, basis
// "tracked+social").
//
// Harness mirrors server/tests/mental-health-lens-macros.test.js:
// handlers are invoked as handler(ctx, virtualArtifact, input).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMentalhealthActions from "../domains/mentalhealth.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "mental-health", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`mental-health.${name} not registered`);
  const virtualArtifact = { id: null, domain: "mental-health", type: "domain_action", data: input, meta: {} };
  return fn(ctx, virtualArtifact, input);
}

before(() => { registerMentalhealthActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const today = () => new Date().toISOString().slice(0, 10);
const dayOffset = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

describe("mental-health build — S-MH-3 streak semantics", () => {
  it("a mood check-in + sleep log + gratitude entry today make the streak 1 with no practice session", () => {
    call("mood-log", ctxA, { mood: 3, date: today() });
    call("sleep-log", ctxA, { hoursSlept: 7.5, quality: 3, date: today() });
    call("gratitude-add", ctxA, { entries: ["a quiet morning"] });
    const dash = call("wellness-dashboard", ctxA, {}).result;
    assert.equal(dash.streak, 1);
    assert.equal(dash.sessionsThisWeek, 0);
  });

  it("activity yesterday + today makes the streak 2 across activity kinds", () => {
    call("mood-log", ctxA, { mood: 4, date: dayOffset(1) });
    call("sleep-log", ctxA, { hoursSlept: 7, quality: 3, date: today() });
    const dash = call("wellness-dashboard", ctxA, {}).result;
    assert.equal(dash.streak, 2);
  });

  it("a gap day breaks the streak even with older activity", () => {
    call("mood-log", ctxA, { mood: 4, date: dayOffset(2) });
    const dash = call("wellness-dashboard", ctxA, {}).result;
    assert.equal(dash.streak, 0);
  });
});

describe("mental-health build — S-MH-3 mood trend honesty", () => {
  it("one check-in reports not-enough-data, not stable", () => {
    call("mood-log", ctxA, { mood: 3, date: today() });
    const ins = call("mood-insights", ctxA, {}).result;
    assert.equal(ins.entries, 1);
    assert.equal(ins.trend, "not-enough-data");
  });

  it("three check-ins still report not-enough-data", () => {
    for (const [i, m] of [2, 3, 4].entries()) call("mood-log", ctxA, { mood: m, date: dayOffset(2 - i) });
    assert.equal(call("mood-insights", ctxA, {}).result.trend, "not-enough-data");
  });

  it("four check-ins compute a real trend", () => {
    for (const [i, m] of [2, 2, 5, 5].entries()) call("mood-log", ctxA, { mood: m, date: dayOffset(3 - i) });
    assert.equal(call("mood-insights", ctxA, {}).result.trend, "improving");
  });
});

describe("mental-health build — S-MH-1 wellness-score-tracked", () => {
  it("no tracked data => no score (zero-input form preserved)", () => {
    const r = call("wellness-score-tracked", ctxA, {}).result;
    assert.equal(r.wellnessScore, null);
    assert.equal(r.basis, "no-tracked-data");
  });

  it("score derives from the member's own sleep + mood + practice, basis disclosed", () => {
    call("sleep-log", ctxA, { hoursSlept: 7.5, quality: 3, date: today() });
    call("mood-log", ctxA, { mood: 3, date: today() }); // 3/5 -> 6/10
    call("session-log", ctxA, { type: "meditation", durationMin: 70 }); // 10 min/day over the week
    const r = call("wellness-score-tracked", ctxA, {}).result;
    assert.equal(r.basis, "tracked");
    assert.equal(r.tracked.sleepHours, 7.5);
    assert.equal(r.tracked.moodScore, 6);
    assert.equal(r.tracked.exerciseMinutes, 10);
    // pillars: sleep 7.5/8*25 = 23.4375, mood 6/10*25 = 15, activity 10/30*25 = 8.333
    // tracked basis: (46.77 / 75) * 100 = 62.36 -> 62
    assert.equal(r.wellnessScore, 62);
    assert.match(r.breakdown.sleep, /7\.5h/);
    assert.match(r.breakdown.social, /not tracked/);
  });

  it("supplied social interactions switch to the exact four-pillar formula", () => {
    call("sleep-log", ctxA, { hoursSlept: 7.5, quality: 3, date: today() });
    call("mood-log", ctxA, { mood: 3, date: today() });
    call("session-log", ctxA, { type: "meditation", durationMin: 70 });
    const r = call("wellness-score-tracked", ctxA, { socialInteractions: 3 }).result;
    assert.equal(r.basis, "tracked+social");
    // 23.4375 + 15 + 8.333 + 25 = 71.77 -> 72
    assert.equal(r.wellnessScore, 72);
    // and it equals the artifact wellnessScore on the same inputs
    const manual = call("wellnessScore", ctxA, {
      sleepHours: 7.5, exerciseMinutes: 10, socialInteractions: 3, moodScore: 6,
    }).result;
    assert.equal(r.wellnessScore, manual.wellnessScore);
  });

  it("the pass's fixture case: logged 7.5h sleep and 3/5 mood move the score off the manual defaults", () => {
    call("sleep-log", ctxA, { hoursSlept: 7.5, quality: 3, date: today() });
    call("mood-log", ctxA, { mood: 3, date: today() });
    const r = call("wellness-score-tracked", ctxA, {}).result;
    // the manual calculator at factory defaults returned 34 from boxes
    // reading sleep 7 / mood 5; the tracked score must reflect 7.5 / 3.
    assert.equal(r.tracked.sleepHours, 7.5);
    assert.equal(r.tracked.moodScore, 6);
    assert.ok(r.wellnessScore !== 34 || r.tracked.sleepHours !== 7);
  });

  it("per-user isolation: another user's data does not leak into the score", () => {
    call("sleep-log", ctxA, { hoursSlept: 8, quality: 5, date: today() });
    const other = call("wellness-score-tracked", { actor: { userId: "user_b" } }, {}).result;
    assert.equal(other.wellnessScore, null);
  });
});
