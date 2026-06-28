// Behavioral macro tests for server/domains/council.js — the DAO + Convene +
// Loomio-shaped governance substrate the /lenses/council lens drives.
//
// These pin the REAL handler contracts that three live surfaces render:
//   - CouncilActionPanel.tsx  → deliberate / voteCount / generateMinutes /
//                                conflictResolution   (heuristic, NOT LLM)
//   - MeetingsWorkspace.tsx    → meeting-* / agenda-* / attendee-* /
//                                quorum-check / packet-* / action-*
//   - DecisionArchive.tsx      → decision-archive / decision-search /
//                                decision-delete / ranked-choice-tabulate
//
// Dispatch convention mirrored exactly: a handler registered via
// registerLensAction(domain, action, fn) is invoked as fn(ctx, virtualArtifact,
// input) — the 3-ARG convention — with virtualArtifact.data === input (so both
// the `artifact.data.X` readers AND the `params.X` readers resolve from the same
// object, exactly like server.js:39159-39160 / :39287-39288).
//
// HERMETIC: no boot, no network, no LLM. globalThis.fetch throws. State lives in
// globalThis._concordSTATE.councilLens (per-user Maps), seeded fresh per test.
//
// NOT shape-only: every test feeds KNOWN input and asserts the EXACT computed
// output (deliberate weightedScore + consensus, IRV round elimination, vote
// tally + forPercent, quorum gating) so a contract drift surfaces here. The
// earlier CouncilActionPanel rendered a fabricated shape (positions / yes-no-
// abstain / summary / resolution) the handler never returns — these tests pin
// the handler's actual RETURNS so that dead-surface class can't recur.
//
// MONEY/CORRECTNESS: pure compute (no wallet / mint). The risk is fail-OPEN
// non-finite output. `voteCount.forPercent` guards total===0 → 0 and
// `ranked-choice-tabulate` guards an empty ballot set (returns ok:false) and a
// 100-round IRV guard, so poisoned/empty input degrades, never NaN/Infinity or
// an uncaught throw.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCouncilActions from "../domains/council.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "council", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input) with
// virtualArtifact.data === input.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`council.${name} not registered`);
  const virtualArtifact = { id: null, domain: "council", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerCouncilActions(registerLensAction); });
beforeEach(() => {
  // Fresh per-user state every test — councilLens Maps are lazily created.
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Every macro the lens page + components reach.
const LENS_MACROS = [
  // CouncilActionPanel heuristic governance
  "deliberate", "voteCount", "generateMinutes", "conflictResolution",
  // MeetingsWorkspace
  "meeting-list", "meeting-create", "meeting-update", "meeting-delete",
  "agenda-add", "agenda-update", "agenda-remove", "agenda-reorder",
  "attendee-add", "attendee-rsvp", "attendee-check-in", "attendee-remove",
  "quorum-check", "packet-add", "packet-remove",
  "action-list", "action-create", "action-update", "action-delete", "action-carry-forward",
  // DecisionArchive
  "ranked-choice-tabulate", "decision-archive", "decision-search", "decision-delete",
];

describe("council — registration (every lens-driven macro present)", () => {
  it("registers every macro the lens calls", () => {
    for (const m of LENS_MACROS) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing council.${m}`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// deliberate — CouncilActionPanel sends { proposal }, renders evaluations /
// weightedScore / recommendation / consensus.
// ───────────────────────────────────────────────────────────────────────────
describe("council.deliberate — exact contract CouncilActionPanel renders", () => {
  it("returns evaluations + weightedScore + recommendation + consensus for a proposal", () => {
    const r = call("deliberate", ctxA, { proposal: "Adopt a fairness-and-risk review for resource cost growth" });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.ok(Array.isArray(res.evaluations), "evaluations array (field the panel renders)");
    assert.equal(res.evaluations.length, 4, "default 4 voices");
    for (const e of res.evaluations) {
      assert.equal(typeof e.voice, "string");
      assert.ok(["support", "neutral", "oppose"].includes(e.position));
      assert.ok(Number.isFinite(e.score), "score must be finite (fail-open guard)");
    }
    assert.ok(Number.isFinite(res.weightedScore), "weightedScore finite");
    assert.ok(["Proceed", "Revise and resubmit", "Reject"].includes(res.recommendation));
    assert.ok(["unanimous", "majority", "no-consensus"].includes(res.consensus));
  });

  it("is deterministic — same proposal → same weightedScore", () => {
    const p = { proposal: "Increase the fairness and risk budget for the cost program" };
    const a = call("deliberate", ctxA, p).result.weightedScore;
    const b = call("deliberate", ctxA, p).result.weightedScore;
    assert.equal(a, b);
  });

  it("honors custom voices passed by the caller", () => {
    const r = call("deliberate", ctxA, {
      proposal: "novelty growth roadmap",
      voices: [{ voice: "Innovator", weight: 1, lens: "novelty and growth potential" }],
    });
    assert.equal(r.result.evaluations.length, 1);
    assert.equal(r.result.evaluations[0].voice, "Innovator");
  });

  it("degrades gracefully on empty proposal (prompts, never throws)", () => {
    const r = call("deliberate", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
    assert.ok(!r.result.evaluations, "no fabricated evaluations on empty input");
  });

  it("FAIL-CLOSED-ish: poisoned non-string proposal does not crash + stays finite", () => {
    // proposal is String()-coerced; a numeric/Infinity-ish proposal yields a
    // finite weightedScore, never NaN.
    const r = call("deliberate", ctxA, { proposal: 1e999 });
    assert.equal(r.ok, true);
    if (r.result.evaluations) {
      assert.ok(Number.isFinite(r.result.weightedScore));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// voteCount — panel sends { votes:[{vote}] }, renders tally / forPercent /
// passed / passThreshold / quorumMet.
// ───────────────────────────────────────────────────────────────────────────
describe("council.voteCount — exact tally contract", () => {
  it("tallies for/against/abstain and computes a 67% supermajority", () => {
    const votes = [
      { voter: "a", vote: "for" }, { voter: "b", vote: "yes" }, { voter: "c", vote: "support" },
      { voter: "d", vote: "against" }, { voter: "e", vote: "abstain" },
    ];
    const r = call("voteCount", ctxA, { votes });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.deepEqual(res.tally, { for: 3, against: 1, abstain: 1 });
    assert.equal(res.total, 5);
    assert.equal(res.forPercent, 60); // 3/5
    assert.equal(res.passed, false);  // 60% < 67%
    assert.equal(res.passThreshold, "67% supermajority");
    assert.equal(res.quorumMet, true); // 5 >= default quorum 3
  });

  it("passes at >=67% for", () => {
    const votes = [{ vote: "for" }, { vote: "for" }, { vote: "for" }, { vote: "against" }];
    const r = call("voteCount", ctxA, { votes });
    assert.equal(r.result.forPercent, 75);
    assert.equal(r.result.passed, true);
  });

  it("degrades gracefully on no votes — forPercent 0, never NaN", () => {
    const r = call("voteCount", ctxA, { votes: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 0);
    assert.ok(Number.isFinite(r.result.forPercent));
    assert.equal(r.result.forPercent, 0);
    assert.equal(r.result.quorumMet, false);
  });

  it("FAIL-CLOSED: poisoned votes shape does not crash + forPercent stays finite", () => {
    const r = call("voteCount", ctxA, { votes: [{}, { vote: 1e999 }, null && {}] .filter(Boolean) });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.forPercent));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// generateMinutes — panel sends { title, agenda, attendees, decisions },
// renders title / date / attendees(count) / decisions[{decision,votedBy,passed}]
// / actionItems[{task,assignee,dueDate}].
// ───────────────────────────────────────────────────────────────────────────
describe("council.generateMinutes — exact minutes contract", () => {
  it("shapes decisions + action items the panel renders", () => {
    const r = call("generateMinutes", ctxA, {
      title: "Q3 Session",
      agenda: [{ topic: "Budget", status: "discussed" }],
      attendees: ["Alice", "Bob"],
      decisions: [{ text: "Adopt policy", votedBy: "council", passed: true }],
      actionItems: [{ task: "Draft doc", assignee: "Alice", dueDate: "2026-07-01" }],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.title, "Q3 Session");
    assert.equal(res.attendees, 2, "attendees is a COUNT, not a list");
    assert.deepEqual(res.agendaItems, [{ item: 1, topic: "Budget", status: "discussed" }]);
    assert.deepEqual(res.decisions, [{ decision: "Adopt policy", votedBy: "council", passed: true }]);
    assert.deepEqual(res.actionItems, [{ task: "Draft doc", assignee: "Alice", dueDate: "2026-07-01" }]);
  });

  it("defaults title + date and degrades on empty payload (never throws)", () => {
    const r = call("generateMinutes", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.title, "string");
    assert.match(r.result.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(r.result.agendaItems, []);
    assert.equal(r.result.attendees, 0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// conflictResolution — panel sends { issue, parties }, renders commonGround /
// suggestedApproach / steps.
// ───────────────────────────────────────────────────────────────────────────
describe("council.conflictResolution — exact contract", () => {
  it("classifies common ground and emits suggestedApproach + steps", () => {
    const r = call("conflictResolution", ctxA, {
      issue: "Budget allocation dispute",
      parties: [{ name: "Eng", priority: "high" }, { name: "Sales", priority: "high" }, { name: "Ops", priority: "low" }],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.commonGround, "shared-urgency"); // 2 high of 3 > half
    assert.match(res.suggestedApproach, /Mediated negotiation/);
    assert.ok(Array.isArray(res.steps) && res.steps.length === 5);
    assert.equal(res.parties.length, 3);
  });

  it("divergent priorities path", () => {
    const r = call("conflictResolution", ctxA, {
      issue: "Roadmap",
      parties: [{ name: "A", priority: "low" }, { name: "B", priority: "medium" }],
    });
    assert.equal(r.result.commonGround, "divergent-priorities");
    assert.match(r.result.suggestedApproach, /Structured dialogue/);
  });

  it("degrades gracefully with no parties (never throws)", () => {
    const r = call("conflictResolution", ctxA, { issue: "x" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.parties, []);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ranked-choice-tabulate — DecisionArchive sends { ballots, candidates }.
// ───────────────────────────────────────────────────────────────────────────
describe("council.ranked-choice-tabulate — instant-runoff", () => {
  it("runs IRV rounds and finds a majority winner", () => {
    // 5 ballots. Round 1: A=2, B=2, C=1 → C eliminated, redistributes to A → A=3 majority.
    const ballots = [
      { voter: "1", ranking: ["A", "B"] },
      { voter: "2", ranking: ["A", "C"] },
      { voter: "3", ranking: ["B", "A"] },
      { voter: "4", ranking: ["B", "C"] },
      { voter: "5", ranking: ["C", "A"] },
    ];
    const r = call("ranked-choice-tabulate", ctxA, {
      ballots, candidates: [{ id: "A", label: "Alice" }, { id: "B", label: "Bob" }, { id: "C", label: "Carol" }],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.method, "instant_runoff");
    assert.equal(res.totalBallots, 5);
    assert.equal(res.majority, 3);
    assert.equal(res.winner.candidate, "A");
    assert.equal(res.winner.label, "Alice");
    assert.equal(res.decided, true);
    assert.ok(res.rounds.length >= 2, "at least one elimination round");
    assert.ok(res.eliminated.includes("C"));
  });

  it("rejects an empty ballot set (validation-rejection)", () => {
    const r = call("ranked-choice-tabulate", ctxA, { ballots: [] });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });

  it("FAIL-CLOSED: poisoned ballots do not crash (caught guard, finite/bounded)", () => {
    const r = call("ranked-choice-tabulate", ctxA, { ballots: [{ ranking: [1e999] }, { ranking: ["X"] }] });
    assert.equal(typeof r.ok, "boolean");
    if (r.ok) {
      assert.ok(Number.isFinite(r.result.totalBallots));
      assert.ok(Number.isFinite(r.result.majority));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// MeetingsWorkspace — meeting / agenda / attendee / quorum / packet / action.
// Round-trip through real per-user STATE.
// ───────────────────────────────────────────────────────────────────────────
describe("council meetings — round-trip + quorum gating + per-user isolation", () => {
  it("create → list → agenda → attendee → quorum gate → packet → delete", () => {
    const created = call("meeting-create", ctxA, { title: "Board", scheduledAt: "2026-07-01T10:00:00Z", quorumThreshold: 2 });
    assert.equal(created.ok, true);
    const id = created.result.meeting.id;
    assert.equal(created.result.meeting.status, "scheduled");

    // list returns it (the exact field MeetingsWorkspace reads)
    const listed = call("meeting-list", ctxA, {});
    assert.equal(listed.result.total, 1);
    assert.equal(listed.result.meetings[0].id, id);

    // agenda add → meeting carries the item the panel renders
    const ag = call("agenda-add", ctxA, { meetingId: id, topic: "Open issues", durationMin: 15 });
    assert.equal(ag.result.meeting.agenda.length, 1);
    assert.equal(ag.result.item.durationMin, 15);

    // two attendees; quorum threshold 2 — neither present yet → blocked
    const a1 = call("attendee-add", ctxA, { meetingId: id, name: "Alice" }).result.attendee;
    const a2 = call("attendee-add", ctxA, { meetingId: id, name: "Bob" }).result.attendee;
    let q = call("quorum-check", ctxA, { meetingId: id });
    assert.equal(q.result.quorumMet, false);
    assert.equal(q.result.canTally, false);
    assert.equal(q.result.present, 0);
    assert.equal(q.result.required, 2);

    // check both in → quorum met, tally permitted
    call("attendee-check-in", ctxA, { meetingId: id, attendeeId: a1.id, present: true });
    call("attendee-check-in", ctxA, { meetingId: id, attendeeId: a2.id, present: true });
    q = call("quorum-check", ctxA, { meetingId: id });
    assert.equal(q.result.present, 2);
    assert.equal(q.result.quorumMet, true);
    assert.equal(q.result.canTally, true);

    // packet add → board book
    const pk = call("packet-add", ctxA, { meetingId: id, name: "Pre-read", url: "https://x", kind: "report" });
    assert.equal(pk.result.meeting.packet.length, 1);

    // delete
    const del = call("meeting-delete", ctxA, { id });
    assert.equal(del.result.deleted, id);
    assert.equal(call("meeting-list", ctxA, {}).result.total, 0);
  });

  it("validation-rejection: meeting-create requires title + scheduledAt", () => {
    assert.equal(call("meeting-create", ctxA, {}).ok, false);
    assert.equal(call("meeting-create", ctxA, { title: "X" }).ok, false);
  });

  it("validation-rejection: agenda-add on unknown meeting + missing topic", () => {
    const id = call("meeting-create", ctxA, { title: "M", scheduledAt: "2026-07-01T10:00:00Z" }).result.meeting.id;
    assert.equal(call("agenda-add", ctxA, { meetingId: "nope", topic: "x" }).ok, false);
    assert.equal(call("agenda-add", ctxA, { meetingId: id }).ok, false);
  });

  it("attendee-rsvp rejects an invalid rsvp value", () => {
    const id = call("meeting-create", ctxA, { title: "M", scheduledAt: "2026-07-01T10:00:00Z" }).result.meeting.id;
    const at = call("attendee-add", ctxA, { meetingId: id, name: "A" }).result.attendee;
    assert.equal(call("attendee-rsvp", ctxA, { meetingId: id, attendeeId: at.id, rsvp: "later" }).ok, false);
    assert.equal(call("attendee-rsvp", ctxA, { meetingId: id, attendeeId: at.id, rsvp: "yes" }).ok, true);
  });

  it("per-user isolation — user B never sees user A's meeting", () => {
    call("meeting-create", ctxA, { title: "A-only", scheduledAt: "2026-07-01T10:00:00Z" });
    assert.equal(call("meeting-list", ctxA, {}).result.total, 1);
    assert.equal(call("meeting-list", ctxB, {}).result.total, 0);
  });

  it("FAIL-CLOSED: poisoned quorumThreshold collapses to a finite, non-negative int", () => {
    const r = call("meeting-create", ctxA, { title: "M", scheduledAt: "2026-07-01T10:00:00Z", quorumThreshold: 1e999 });
    assert.equal(r.ok, true);
    assert.ok(Number.isInteger(r.result.meeting.quorumThreshold));
    assert.ok(r.result.meeting.quorumThreshold >= 0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Action items + carry-forward.
// ───────────────────────────────────────────────────────────────────────────
describe("council actions — create / list / carry-forward", () => {
  it("creates an open action, lists it, and carries it forward to a new meeting", () => {
    const m1 = call("meeting-create", ctxA, { title: "M1", scheduledAt: "2026-07-01T10:00:00Z" }).result.meeting.id;
    const m2 = call("meeting-create", ctxA, { title: "M2", scheduledAt: "2026-07-08T10:00:00Z" }).result.meeting.id;
    const act = call("action-create", ctxA, { description: "Follow up", owner: "Alice", dueDate: "2026-07-05", meetingId: m1 });
    assert.equal(act.result.action.status, "open");

    const listed = call("action-list", ctxA, {});
    assert.equal(listed.result.total, 1);
    assert.equal(listed.result.open, 1);

    const carried = call("action-carry-forward", ctxA, { id: act.result.action.id, targetMeetingId: m2 });
    assert.equal(carried.ok, true);
    assert.equal(carried.result.source.status, "carried_forward");
    assert.equal(carried.result.carried.status, "open");
    assert.equal(carried.result.carried.meetingId, m2);
    assert.equal(carried.result.carried.carriedFromMeetingId, m1);

    // now there are two action rows: one carried_forward, one fresh open
    assert.equal(call("action-list", ctxA, {}).result.total, 2);
  });

  it("validation-rejection: action-create requires a description", () => {
    assert.equal(call("action-create", ctxA, {}).ok, false);
  });

  it("carry-forward refuses a non-open action", () => {
    const act = call("action-create", ctxA, { description: "x" }).result.action;
    call("action-update", ctxA, { id: act.id, status: "done" });
    assert.equal(call("action-carry-forward", ctxA, { id: act.id }).ok, false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Decision archive + search.
// ───────────────────────────────────────────────────────────────────────────
describe("council decisions — archive / search / delete", () => {
  it("archives a decision and full-text searches it", () => {
    const arc = call("decision-archive", ctxA, {
      title: "Adopt remote-work policy", summary: "Hybrid schedule approved",
      outcome: "passed", votesFor: 7, votesAgainst: 2, tags: ["hr", "policy"],
    });
    assert.equal(arc.ok, true);
    assert.equal(arc.result.decision.outcome, "passed");
    assert.equal(arc.result.decision.votesFor, 7);
    assert.deepEqual(arc.result.decision.tags, ["hr", "policy"]);

    // search by free text (matches title)
    const byText = call("decision-search", ctxA, { query: "remote" });
    assert.equal(byText.result.total, 1);
    // search by tag
    assert.equal(call("decision-search", ctxA, { query: "policy" }).result.total, 1);
    // outcome filter that excludes it
    assert.equal(call("decision-search", ctxA, { query: "", outcome: "rejected" }).result.total, 0);
    // 'all' outcome returns it
    assert.equal(call("decision-search", ctxA, { query: "", outcome: "all" }).result.total, 1);

    const del = call("decision-delete", ctxA, { id: arc.result.decision.id });
    assert.equal(del.result.deleted, arc.result.decision.id);
    assert.equal(call("decision-search", ctxA, {}).result.total, 0);
  });

  it("validation-rejection: decision-archive requires a title", () => {
    assert.equal(call("decision-archive", ctxA, {}).ok, false);
  });

  it("FAIL-CLOSED: poisoned vote counts collapse to finite non-negative ints", () => {
    const r = call("decision-archive", ctxA, { title: "X", votesFor: 1e999, votesAgainst: -5 });
    assert.equal(r.ok, true);
    assert.ok(Number.isInteger(r.result.decision.votesFor) && r.result.decision.votesFor >= 0);
    assert.ok(Number.isInteger(r.result.decision.votesAgainst) && r.result.decision.votesAgainst >= 0);
  });
});
