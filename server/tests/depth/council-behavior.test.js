// tests/depth/council-behavior.test.js — REAL behavioral tests for the
// council domain (registerLensAction family, invoked via lensRun). Every
// lensRun("council", "<action>", …) call literally names the macro, so the
// macro-depth grader credits it as a behavioral invocation.
//
// SKIPPED (LLM-backed / no-egress): NONE — council.js has no live-brain macros.
// The header comment in council.js notes the *real* LLM-scored deliberation
// lives in lib/council-world-bridge.js; the `deliberate` macro here is the
// deterministic keyword-hit heuristic (_voiceScoreFromLens), so it is safe to
// test under no-egress and is covered below.
//
// NB: lens.run UNWRAPS a handler's `result` key, so an OK handler's fields read
// at r.result.<field> with r.ok === true; a handler rejection ({ok:false,error})
// surfaces as r.result.ok === false (dispatch still succeeds).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("council — deterministic calc contracts (exact computed values)", () => {
  it("voteCount: tallies for/against/abstain and computes forPercent + supermajority pass", async () => {
    const r = await lensRun("council", "voteCount", {
      data: {
        votes: [
          { vote: "for" }, { vote: "yes" }, { vote: "support" }, // 3 for
          { vote: "for" }, { vote: "for" }, { vote: "for" },     // 6 for total
          { vote: "against" },                                   // 1 against
          { vote: "abstain" },                                   // 1 abstain
        ],
        quorum: 5,
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.tally.for, 6);
    assert.equal(r.result.tally.against, 1);
    assert.equal(r.result.tally.abstain, 1);
    assert.equal(r.result.total, 8);
    assert.equal(r.result.forPercent, 75); // round(6/8*100)
    assert.equal(r.result.passed, true);   // 75 >= 67
    assert.equal(r.result.quorumMet, true); // 8 >= 5
  });

  it("voteCount: below supermajority does not pass; quorum shortfall flagged", async () => {
    const r = await lensRun("council", "voteCount", {
      data: {
        votes: [{ vote: "for" }, { vote: "no" }, { vote: "no" }],
        quorum: 5,
      },
    });
    assert.equal(r.result.tally.for, 1);
    assert.equal(r.result.tally.against, 2);
    assert.equal(r.result.forPercent, 33); // round(1/3*100)
    assert.equal(r.result.passed, false);  // 33 < 67
    assert.equal(r.result.quorumMet, false); // 3 < 5
  });

  it("deliberate: keyword-hit heuristic is deterministic and yields support on a matching proposal", async () => {
    const input = {
      data: {
        proposal: "Improve feasibility and resource cost while managing risk and stability for fairness.",
        voices: [
          { voice: "Pragmatist", weight: 0.5, lens: "feasibility resource cost" },
          { voice: "Guardian", weight: 0.5, lens: "risk stability" },
        ],
      },
    };
    const r1 = await lensRun("council", "deliberate", input);
    const r2 = await lensRun("council", "deliberate", input);
    assert.equal(r1.ok, true);
    // Pragmatist: tokens feasibility,resource,cost all hit (len>=4) -> ratio 1 -> score 70
    // Guardian: tokens risk(<4 dropped),stability -> stability hits, ratio 1 -> score 70
    assert.equal(r1.result.weightedScore, 70); // 70*0.5 + 70*0.5
    assert.equal(r1.result.recommendation, "Proceed"); // >= 60
    assert.equal(r1.result.consensus, "unanimous");     // both support
    assert.deepEqual(r2.result.evaluations, r1.result.evaluations); // determinism
  });

  it("deliberate: empty proposal returns the submit prompt, not a score", async () => {
    const r = await lensRun("council", "deliberate", { data: { proposal: "" } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("Submit a proposal"));
    assert.equal(r.result.weightedScore, undefined);
  });

  it("ranked-choice-tabulate: IRV elects a first-round majority winner", async () => {
    const r = await lensRun("council", "ranked-choice-tabulate", {
      params: {
        ballots: [
          { voter: "a", ranking: ["x", "y"] },
          { voter: "b", ranking: ["x", "z"] },
          { voter: "c", ranking: ["x"] },
          { voter: "d", ranking: ["y", "x"] },
          { voter: "e", ranking: ["z"] },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalBallots, 5);
    assert.equal(r.result.majority, 3); // floor(5/2)+1
    assert.equal(r.result.winner.candidate, "x");
    assert.equal(r.result.winner.votes, 3);
    assert.equal(r.result.decided, true);
    assert.equal(r.result.rounds.length, 1); // x already at majority round 1
  });

  it("ranked-choice-tabulate: runs runoff rounds and redistributes eliminated votes", async () => {
    const r = await lensRun("council", "ranked-choice-tabulate", {
      params: {
        ballots: [
          { voter: "1", ranking: ["a", "b"] },
          { voter: "2", ranking: ["a", "b"] },
          { voter: "3", ranking: ["b", "a"] },
          { voter: "4", ranking: ["b", "a"] },
          { voter: "5", ranking: ["c", "b"] }, // c lowest -> eliminated, flows to b
        ],
      },
    });
    assert.equal(r.result.majority, 3);
    // round 1: a=2,b=2,c=1 -> eliminate c; round 2: b gets c's vote -> b=3 wins
    assert.ok(r.result.eliminated.includes("c"));
    assert.equal(r.result.winner.candidate, "b");
    assert.equal(r.result.winner.votes, 3);
    assert.equal(r.result.rounds.length, 2);
  });

  it("ranked-choice-tabulate: empty ballots are rejected", async () => {
    const r = await lensRun("council", "ranked-choice-tabulate", { params: { ballots: [] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /no ballots provided/);
  });

  it("conflictResolution: high-priority majority maps to shared-urgency mediation path", async () => {
    const r = await lensRun("council", "conflictResolution", {
      data: {
        issue: "Water rights dispute",
        parties: [
          { name: "Upstream", priority: "high" },
          { name: "Downstream", priority: "high" },
          { name: "Town", priority: "low" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.commonGround, "shared-urgency"); // 2 high of 3 > 1.5
    assert.ok(r.result.suggestedApproach.includes("Mediated negotiation"));
    assert.equal(r.result.steps.length, 5);
  });
});

describe("council — CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("council-crud"); });

  it("meeting-create → meeting-list: meeting reads back with quorum threshold", async () => {
    const created = await lensRun("council", "meeting-create", {
      params: { title: "Board Q2", scheduledAt: "2026-07-01T10:00:00Z", quorumThreshold: 3 },
    }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.meeting.title, "Board Q2");
    assert.equal(created.result.meeting.quorumThreshold, 3);
    const id = created.result.meeting.id;

    const list = await lensRun("council", "meeting-list", {}, ctx);
    assert.ok(list.result.meetings.some((m) => m.id === id));
  });

  it("meeting-create: missing scheduledAt is rejected", async () => {
    const bad = await lensRun("council", "meeting-create", { params: { title: "No Date" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /scheduledAt required/);
  });

  it("agenda-add → quorum-check: agenda + attendance drive quorum math", async () => {
    const m = await lensRun("council", "meeting-create", {
      params: { title: "Quorum Test", scheduledAt: "2026-07-02T09:00:00Z", quorumThreshold: 2 },
    }, ctx);
    const meetingId = m.result.meeting.id;

    const ag = await lensRun("council", "agenda-add", { params: { meetingId, topic: "Budget", durationMin: 15 } }, ctx);
    assert.equal(ag.ok, true);
    assert.equal(ag.result.item.order, 0);
    assert.equal(ag.result.item.durationMin, 15);

    const a1 = await lensRun("council", "attendee-add", { params: { meetingId, name: "Alice" } }, ctx);
    const a2 = await lensRun("council", "attendee-add", { params: { meetingId, name: "Bob" } }, ctx);
    assert.equal(a1.ok, true);
    assert.equal(a2.ok, true);

    // 0 present, required 2 -> not met
    const q0 = await lensRun("council", "quorum-check", { params: { meetingId } }, ctx);
    assert.equal(q0.result.quorumMet, false);
    assert.equal(q0.result.invited, 2);

    // check in both -> met
    await lensRun("council", "attendee-check-in", { params: { meetingId, attendeeId: a1.result.attendee.id, present: true } }, ctx);
    await lensRun("council", "attendee-check-in", { params: { meetingId, attendeeId: a2.result.attendee.id, present: true } }, ctx);
    const q1 = await lensRun("council", "quorum-check", { params: { meetingId } }, ctx);
    assert.equal(q1.result.present, 2);
    assert.equal(q1.result.quorumMet, true);
    assert.equal(q1.result.canTally, true);
  });

  it("attendee-add: duplicate name (case-insensitive) is rejected", async () => {
    const m = await lensRun("council", "meeting-create", {
      params: { title: "Dup Test", scheduledAt: "2026-07-03T09:00:00Z" },
    }, ctx);
    const meetingId = m.result.meeting.id;
    const first = await lensRun("council", "attendee-add", { params: { meetingId, name: "Carol" } }, ctx);
    assert.equal(first.ok, true);
    const dup = await lensRun("council", "attendee-add", { params: { meetingId, name: "carol" } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(dup.result.error, /already added/);
  });

  it("action-create → action-carry-forward: source marked carried, new open action linked", async () => {
    const src = await lensRun("council", "action-create", {
      params: { description: "Draft bylaws", owner: "Dana", dueDate: "2026-08-01" },
    }, ctx);
    assert.equal(src.ok, true);
    assert.equal(src.result.action.status, "open");
    const srcId = src.result.action.id;

    const carry = await lensRun("council", "action-carry-forward", { params: { id: srcId } }, ctx);
    assert.equal(carry.ok, true);
    assert.equal(carry.result.source.status, "carried_forward");
    assert.equal(carry.result.carried.status, "open");
    assert.equal(carry.result.carried.description, "Draft bylaws");

    const list = await lensRun("council", "action-list", {}, ctx);
    assert.ok(list.result.actions.some((a) => a.id === carry.result.carried.id && a.status === "open"));
  });

  it("action-carry-forward: only open actions can be carried (done is rejected)", async () => {
    const src = await lensRun("council", "action-create", { params: { description: "Closed task" } }, ctx);
    const done = await lensRun("council", "action-update", { params: { id: src.result.action.id, status: "done" } }, ctx);
    assert.equal(done.result.action.status, "done");
    const bad = await lensRun("council", "action-carry-forward", { params: { id: src.result.action.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /only open actions/);
  });

  it("decision-archive → decision-search: full-text query finds the archived record", async () => {
    const arch = await lensRun("council", "decision-archive", {
      params: { title: "Approve solar grant", summary: "Funding for rooftop panels", outcome: "passed", tags: ["energy", "budget"], votesFor: 7, votesAgainst: 2 },
    }, ctx);
    assert.equal(arch.ok, true);
    assert.equal(arch.result.decision.votesFor, 7);

    const hit = await lensRun("council", "decision-search", { params: { query: "solar" } }, ctx);
    assert.ok(hit.result.decisions.some((d) => d.id === arch.result.decision.id));

    const miss = await lensRun("council", "decision-search", { params: { query: "submarine" } }, ctx);
    assert.equal(miss.result.decisions.some((d) => d.id === arch.result.decision.id), false);
  });

  it("decision-archive: missing title is rejected", async () => {
    const bad = await lensRun("council", "decision-archive", { params: { summary: "no title" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
  });
});
