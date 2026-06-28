// Behavioral macro tests for server/domains/mentorship.js — the four pure-compute
// analytics calculators the /lenses/mentorship surface drives:
//   matchScore · progressTrack · feedbackSummary · developmentPlan
//
// COMPLEMENT to mentorship-domain-parity.test.js (which pins the directory /
// matching / scheduling / goals / reviews / program / messaging STATE-backed
// surface). This file is the COMPONENT-EXACT-SHAPE Phase-2 gate for the two
// frontend surfaces that reach these calculators:
//
//   A. MentorshipActionPanel (callMacro → /api/lens/run): the user pastes the
//      EXPLICIT object shape. The dispatch peels the redundant
//      { artifact:{ data } } wrapper, so the handler sees artifact.data === that
//      object. We drive each calculator with the EXACT input the component
//      sends and assert the EXACT fields it renders from r.result, with real
//      computed values — not shape-only "ok:true".
//
//   B. The inline page panel (useRunArtifact → /api/lens/:domain/:id/run): runs
//      against a STORED relation artifact whose data shape is
//      { mentorName, menteeName, skills[], goals:string[], sessionsCompleted,
//        rating, ... }. Before this gate the calculators only read the explicit
//      shape, so the inline cards rendered a DEAD "undefined ↔ undefined · 0%"
//      result. We pin that the relation aliases now produce real values.
//
// MONEY/CORRECTNESS SCRUTINY: these are pure calculators (no wallet, no minting),
// so the risk is fail-OPEN non-finite output. parseFloat("Infinity") yields
// Infinity and Number("1e999") yields Infinity, so a naive `parseFloat(x) || 1`
// would let a poisoned duration/rating flow into a computed total (totalHours,
// avgRating) and emit Infinity/NaN. The domain was hardened with finNum
// (collapse non-finite → finite default). The poisoned-numeric block below pins
// that every computed total stays FINITE (fail-CLOSED).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMentorshipActions from "../domains/mentorship.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "mentorship", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the LIVE 3-arg dispatch: handler(ctx, virtualArtifact, input) with
// virtualArtifact.data === input (the dispatch sets virtualArtifact.data to the
// peeled body.input). A regression that confuses the param positions, or that
// reads from the wrong wrapper layer, surfaces here.
function call(name, input = {}, ctx = ctxA) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`mentorship.${name} not registered`);
  const virtualArtifact = { id: null, domain: "mentorship", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerMentorshipActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

const CALCULATORS = ["matchScore", "progressTrack", "feedbackSummary", "developmentPlan"];

describe("mentorship — registration (every calculator the lens reaches)", () => {
  it("registers every pure-compute macro the lens calls", () => {
    for (const m of CALCULATORS) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing mentorship.${m}`);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// A. MentorshipActionPanel — EXACT explicit-shape input → EXACT rendered output
// ──────────────────────────────────────────────────────────────────────────

describe("mentorship.matchScore — component exact shape + real value", () => {
  it("scores the EXACT { mentor, mentee } object the panel pastes and renders every field", () => {
    // Input is exactly what actMatch sends: callMacro('matchScore', { artifact:{ data: parsed } })
    // → after dispatch peel → artifact.data === parsed.
    const r = call("matchScore", {
      mentor: { name: "Ada", skills: ["react", "node"], availability: "weekly", experience: true },
      mentee: { name: "Eve", goals: ["learn react"], preferredSchedule: "weekly" },
    });
    assert.equal(r.ok, true);
    // EXACT fields the panel renders from r.result:
    // matchResult.matchScore / .compatibility / .mentor / .mentee / .skillOverlap
    assert.equal(r.result.mentor, "Ada");
    assert.equal(r.result.mentee, "Eve");
    // skillOverlap: "react" matches goal "learn react" → 1; "node" → 0.
    assert.equal(r.result.skillOverlap, 1);
    // score = round(min(1/3,1)*50 + 1*30 + 20) = round(66.67) = 67.
    assert.equal(r.result.matchScore, 67);
    assert.equal(r.result.compatibility, "good");
  });

  it("grades excellent at full overlap + availability + experience", () => {
    const r = call("matchScore", {
      mentor: { name: "M", skills: ["react", "node", "ts"], availability: "weekly", experience: true },
      mentee: { name: "E", goals: ["react", "node", "ts"], preferredSchedule: "weekly" },
    });
    assert.equal(r.result.skillOverlap, 3);
    // round(1*50 + 1*30 + 20) = 100
    assert.equal(r.result.matchScore, 100);
    assert.equal(r.result.compatibility, "excellent");
  });

  it("grades fair with no overlap + mismatched availability + no experience", () => {
    const r = call("matchScore", {
      mentor: { name: "M", skills: ["go"], availability: "monthly", experience: false },
      mentee: { name: "E", goals: ["design"], preferredSchedule: "weekly" },
    });
    // round(0 + 0.5*30 + 0) = 15
    assert.equal(r.result.matchScore, 15);
    assert.equal(r.result.compatibility, "fair");
  });
});

describe("mentorship.progressTrack — component exact shape + real value", () => {
  it("rolls up the EXACT { goals, sessions } shape and renders completionRate + momentum", () => {
    const r = call("progressTrack", {
      goals: [{ completed: true }, { status: "done" }, {}],
      sessions: [{ duration: 1 }, { duration: 2 }],
    });
    assert.equal(r.ok, true);
    // EXACT fields rendered: completionRate, momentum, completed, totalGoals,
    // sessionsCompleted, totalHours
    assert.equal(r.result.totalGoals, 3);
    assert.equal(r.result.completed, 2);
    assert.equal(r.result.inProgress, 1);
    assert.equal(r.result.completionRate, 67); // round(2/3*100)
    assert.equal(r.result.sessionsCompleted, 2);
    assert.equal(r.result.totalHours, 3); // 1 + 2
    assert.equal(r.result.momentum, "building"); // 2 sessions
  });

  it("reports strong momentum at >= 4 sessions", () => {
    const r = call("progressTrack", {
      goals: [{ completed: true }],
      sessions: [{ duration: 1 }, { duration: 1 }, { duration: 1 }, { duration: 1 }],
    });
    assert.equal(r.result.completionRate, 100);
    assert.equal(r.result.sessionsCompleted, 4);
    assert.equal(r.result.momentum, "strong");
  });
});

describe("mentorship.feedbackSummary — component exact shape + real value", () => {
  it("averages the EXACT feedback:[{rating,tags}] shape and renders themes", () => {
    const r = call("feedbackSummary", {
      feedback: [
        { rating: 5, tags: ["helpful", "clear"] },
        { rating: 4, tags: ["helpful"] },
      ],
    });
    assert.equal(r.ok, true);
    // EXACT fields rendered: avgRating, satisfaction, sessions, topThemes[{theme,count}]
    assert.equal(r.result.sessions, 2);
    assert.equal(r.result.avgRating, 4.5);
    assert.equal(r.result.satisfaction, "high");
    assert.equal(r.result.topThemes[0].theme, "helpful");
    assert.equal(r.result.topThemes[0].count, 2);
  });

  it("returns the honest empty-cue message when no feedback is given", () => {
    const r = call("feedbackSummary", { feedback: [] });
    assert.equal(r.ok, true);
    // The panel guards on fbResult.avgRating != null; the message branch is the
    // honest empty cue (NOT a fabricated rating).
    assert.equal(typeof r.result.message, "string");
    assert.equal(r.result.avgRating, undefined);
  });

  it("flags needs-attention satisfaction for low ratings", () => {
    const r = call("feedbackSummary", { feedback: [{ rating: 2 }, { rating: 1 }] });
    assert.equal(r.result.avgRating, 1.5);
    assert.equal(r.result.satisfaction, "needs-attention");
  });
});

describe("mentorship.developmentPlan — component exact shape + real value", () => {
  it("builds the EXACT { currentSkills, targetRole, skillGaps } the panel sends", () => {
    // actPlan splits the csv inputs into arrays before calling.
    const r = call("developmentPlan", {
      currentSkills: ["js", "ts"],
      targetRole: "Staff Engineer",
      skillGaps: ["distributed systems", "leadership"],
    });
    assert.equal(r.ok, true);
    // EXACT fields rendered: timelineWeeks, targetRole, gaps[], milestones[{phase,weeks,focus}], currentSkillCount
    assert.equal(r.result.currentSkillCount, 2);
    assert.equal(r.result.targetRole, "Staff Engineer");
    assert.deepEqual(r.result.gaps, ["distributed systems", "leadership"]);
    assert.equal(r.result.timelineWeeks, 26);
    assert.equal(r.result.milestones.length, 4);
    assert.equal(r.result.milestones[0].phase, "Foundation");
    assert.equal(r.result.milestones[3].phase, "Mastery");
    // every milestone carries the EXACT { phase, weeks, focus } the panel maps.
    for (const m of r.result.milestones) {
      assert.equal(typeof m.phase, "string");
      assert.equal(typeof m.weeks, "string");
      assert.equal(typeof m.focus, "string");
    }
  });

  it("falls back to guidance placeholders when gaps + role are absent", () => {
    const r = call("developmentPlan", {});
    assert.equal(r.result.targetRole, "next level");
    assert.equal(r.result.gaps.length, 1);
    assert.match(r.result.gaps[0], /Identify specific skill gaps/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// B. Inline page panel — STORED RELATION shape must produce REAL values
//    (regression guard against the dead "undefined ↔ undefined · 0%" card)
// ──────────────────────────────────────────────────────────────────────────

describe("mentorship — inline page panel relation-shape alignment", () => {
  // The stored relation data shape (page.tsx MentorshipData / handleCreate).
  const RELATION = {
    mentorName: "Ada", menteeName: "Eve", topic: "Rust",
    status: "active", goals: ["ship a crate", "learn async"],
    meetingFrequency: "weekly", sessionsCompleted: 3, notes: "", skills: ["rust", "systems"], rating: 4,
  };

  it("matchScore reads mentorName/menteeName/skills/goals aliases (not undefined ↔ undefined)", () => {
    const r = call("matchScore", RELATION);
    assert.equal(r.ok, true);
    assert.equal(r.result.mentor, "Ada");   // was undefined before alignment
    assert.equal(r.result.mentee, "Eve");   // was undefined before alignment
    assert.ok(Number.isFinite(r.result.matchScore));
    // sessionsCompleted>0 → experience true → score includes the +20 bump.
    assert.ok(r.result.matchScore >= 20);
  });

  it("progressTrack derives sessionsCompleted + totalHours from the relation count", () => {
    const r = call("progressTrack", RELATION);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalGoals, 2);          // relation goals:string[]
    assert.equal(r.result.completed, 0);           // strings carry no completed flag
    assert.equal(r.result.sessionsCompleted, 3);   // from sessionsCompleted count
    assert.equal(r.result.totalHours, 3);          // 1h/session fallback
    assert.equal(r.result.momentum, "building");
  });

  it("developmentPlan reads relation skills[] as currentSkills", () => {
    const r = call("developmentPlan", RELATION);
    assert.equal(r.ok, true);
    assert.equal(r.result.currentSkillCount, 2);   // relation skills[]
    assert.equal(r.result.timelineWeeks, 26);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Validation-rejection, degrade-graceful, and fail-CLOSED poisoned numerics
// ──────────────────────────────────────────────────────────────────────────

describe("mentorship — degrade-graceful on missing / malformed input", () => {
  it("matchScore degrades to a fair 0-overlap score on empty input (no throw)", () => {
    const r = call("matchScore", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.skillOverlap, 0);
    // empty → availMatch 0.5 (both undefined are NOT equal because availability is null) → 15
    assert.equal(r.result.matchScore, 15);
    assert.equal(r.result.compatibility, "fair");
  });

  it("matchScore tolerates non-array skills/goals (coerce to [])", () => {
    const r = call("matchScore", { mentor: { skills: "nope" }, mentee: { goals: 42 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.skillOverlap, 0);
    assert.ok(Number.isFinite(r.result.matchScore));
  });

  it("progressTrack tolerates non-array goals/sessions", () => {
    const r = call("progressTrack", { goals: "nope", sessions: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalGoals, 0);
    assert.equal(r.result.completionRate, 0);
    assert.ok(Number.isFinite(r.result.totalHours));
  });

  it("feedbackSummary returns the message cue (not a crash) for non-array feedback", () => {
    const r = call("feedbackSummary", { feedback: "nope" });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });

  it("developmentPlan tolerates non-array skills + non-string role", () => {
    const r = call("developmentPlan", { currentSkills: "nope", targetRole: 42, skillGaps: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.result.currentSkillCount, 0);
    assert.equal(r.result.targetRole, "42");
    assert.equal(r.result.timelineWeeks, 26);
  });
});

describe("mentorship — fail-CLOSED poisoned numerics stay FINITE", () => {
  it("progressTrack.totalHours stays finite when durations are poisoned", () => {
    const r = call("progressTrack", {
      goals: [{ completed: true }],
      sessions: [{ duration: "Infinity" }, { duration: "1e999" }, { duration: "NaN" }],
    });
    assert.equal(r.ok, true);
    assert.equal(Number.isFinite(r.result.totalHours), true, "totalHours must be finite");
    // each poisoned duration collapses to the 1h default → 3 sessions → 3h.
    assert.equal(r.result.totalHours, 3);
    assert.equal(r.result.sessionsCompleted, 3);
  });

  it("progressTrack.sessionsCompleted stays finite when the relation count is poisoned", () => {
    const r = call("progressTrack", { sessionsCompleted: "Infinity" });
    assert.equal(r.ok, true);
    assert.equal(Number.isFinite(r.result.sessionsCompleted), true);
    assert.equal(r.result.sessionsCompleted, 0);
    assert.equal(Number.isFinite(r.result.totalHours), true);
  });

  it("feedbackSummary.avgRating stays finite + bounded when ratings are poisoned", () => {
    const r = call("feedbackSummary", {
      feedback: [{ rating: "Infinity" }, { rating: "1e999" }, { rating: "NaN" }],
    });
    assert.equal(r.ok, true);
    assert.equal(Number.isFinite(r.result.avgRating), true, "avgRating must be finite");
    // each poisoned rating collapses to the 3 default → avg 3.
    assert.equal(r.result.avgRating, 3);
    assert.ok(r.result.avgRating >= 0 && r.result.avgRating <= 5);
  });

  it("matchScore stays finite + bounded 0..100 on poisoned skill/goal payloads", () => {
    const r = call("matchScore", {
      mentor: { skills: "Infinity", experience: "1e999" },
      mentee: { goals: "NaN" },
    });
    assert.equal(r.ok, true);
    assert.equal(Number.isFinite(r.result.matchScore), true);
    assert.ok(r.result.matchScore >= 0 && r.result.matchScore <= 100);
  });
});
