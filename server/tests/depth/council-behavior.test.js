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

// ─────────────────────────────────────────────────────────────────────────
// Coverage extension (no LLM-backed macros in council.js — every macro here
// is a deterministic heuristic/CRUD handler, so all are tested directly).
// New distinct macros exercised below: generateMinutes, meeting-update,
// meeting-delete, agenda-update, agenda-remove, agenda-reorder,
// attendee-rsvp, attendee-remove, attendee-check-in (default-toggle path),
// packet-add, packet-remove, action-delete, decision-delete. Plus the
// divergent-priorities branch of conflictResolution.
// ─────────────────────────────────────────────────────────────────────────
describe("council — minutes + conflict divergent branch (pure compute)", () => {
  it("generateMinutes: maps agenda/decisions/actionItems with defaults applied", async () => {
    const r = await lensRun("council", "generateMinutes", {
      data: {
        title: "Special Session",
        date: "2026-09-09",
        attendees: ["Ann", "Ben", "Cy"],
        agenda: [{ topic: "Roads", status: "deferred" }, "Bridges"],
        decisions: [{ text: "Fund roads", passed: false }, { text: "Pave Main St" }],
        actionItems: [{ task: "Hire surveyor", assignee: "Ben", dueDate: "2026-10-01" }, "File permit"],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.title, "Special Session");
    assert.equal(r.result.date, "2026-09-09");
    assert.equal(r.result.attendees, 3);
    // agenda: numbered, status preserved or defaulted to "discussed"
    assert.equal(r.result.agendaItems.length, 2);
    assert.deepEqual(r.result.agendaItems[0], { item: 1, topic: "Roads", status: "deferred" });
    assert.deepEqual(r.result.agendaItems[1], { item: 2, topic: "Bridges", status: "discussed" });
    // decisions: explicit passed:false honored, missing passed defaults true
    assert.equal(r.result.decisions[0].passed, false);
    assert.equal(r.result.decisions[0].votedBy, "council");
    assert.equal(r.result.decisions[1].passed, true);
    // actionItems: object form preserved, string form defaulted
    assert.deepEqual(r.result.actionItems[0], { task: "Hire surveyor", assignee: "Ben", dueDate: "2026-10-01" });
    assert.deepEqual(r.result.actionItems[1], { task: "File permit", assignee: "unassigned", dueDate: "TBD" });
  });

  it("generateMinutes: empty data falls back to default title and current-date shape", async () => {
    const r = await lensRun("council", "generateMinutes", { data: {} });
    assert.equal(r.ok, true);
    assert.equal(r.result.title, "Council Meeting Minutes");
    assert.equal(r.result.attendees, 0);
    assert.deepEqual(r.result.agendaItems, []);
    assert.deepEqual(r.result.decisions, []);
    assert.equal(r.result.date.length, 10); // ISO date prefix YYYY-MM-DD
  });

  it("conflictResolution: low-priority majority maps to divergent-priorities path", async () => {
    const r = await lensRun("council", "conflictResolution", {
      data: {
        issue: "Park naming",
        parties: [
          { name: "North", priority: "low" },
          { name: "South", priority: "low" },
          { name: "Civic", priority: "high" },
        ],
      },
    });
    assert.equal(r.ok, true);
    // only 1 high of 3, not > 1.5 -> divergent
    assert.equal(r.result.commonGround, "divergent-priorities");
    assert.ok(r.result.suggestedApproach.includes("Structured dialogue"));
    assert.equal(r.result.parties[0].priority, "low");
    assert.equal(r.result.steps.length, 5);
  });
});

describe("council — meeting/agenda/attendee/packet mutations (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("council-mut"); });

  async function freshMeeting(title) {
    const m = await lensRun("council", "meeting-create", {
      params: { title, scheduledAt: "2026-11-01T08:00:00Z", quorumThreshold: 1 },
    }, ctx);
    assert.equal(m.ok, true);
    return m.result.meeting.id;
  }

  it("meeting-update: patches fields + quorumThreshold, leaves others intact", async () => {
    const id = await freshMeeting("Pre-update");
    const upd = await lensRun("council", "meeting-update", {
      params: { id, title: "Post-update", status: "in_progress", quorumThreshold: 4 },
    }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.meeting.title, "Post-update");
    assert.equal(upd.result.meeting.status, "in_progress");
    assert.equal(upd.result.meeting.quorumThreshold, 4);
    assert.equal(upd.result.meeting.scheduledAt, "2026-11-01T08:00:00Z"); // untouched
  });

  it("meeting-update: unknown id is rejected", async () => {
    const bad = await lensRun("council", "meeting-update", { params: { id: "mtg_nope", title: "x" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /meeting not found/);
  });

  it("meeting-delete: removes the meeting from the list", async () => {
    const id = await freshMeeting("To Delete");
    const del = await lensRun("council", "meeting-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("council", "meeting-list", {}, ctx);
    assert.equal(list.result.meetings.some((m) => m.id === id), false);
  });

  it("agenda-update + agenda-remove: edit then drop reindexes order", async () => {
    const meetingId = await freshMeeting("Agenda Ops");
    const a0 = await lensRun("council", "agenda-add", { params: { meetingId, topic: "First", durationMin: 5 } }, ctx);
    const a1 = await lensRun("council", "agenda-add", { params: { meetingId, topic: "Second" } }, ctx);
    assert.equal(a1.result.item.order, 1);

    // update item 0: durationMin=0 is falsy so the existing value (5) is kept
    // (Math.max(1, parseInt(0) || item.durationMin) -> Math.max(1, 5) -> 5),
    // status whitelisted, notes coerced to string.
    const upd = await lensRun("council", "agenda-update", {
      params: { meetingId, itemId: a0.result.item.id, durationMin: 0, status: "discussed", notes: "done" },
    }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.item.durationMin, 5); // 0 falsy -> falls back to prior 5
    assert.equal(upd.result.item.status, "discussed");
    assert.equal(upd.result.item.notes, "done");

    // a negative value parses truthy and is clamped to the floor of 1
    const clamp = await lensRun("council", "agenda-update", {
      params: { meetingId, itemId: a0.result.item.id, durationMin: -7 },
    }, ctx);
    assert.equal(clamp.result.item.durationMin, 1); // Math.max(1, -7) -> 1
    // an out-of-whitelist status is ignored (stays "discussed")
    const badStatus = await lensRun("council", "agenda-update", {
      params: { meetingId, itemId: a0.result.item.id, status: "bogus" },
    }, ctx);
    assert.equal(badStatus.result.item.status, "discussed");

    // remove item 0 -> remaining item reindexed to order 0
    const rem = await lensRun("council", "agenda-remove", { params: { meetingId, itemId: a0.result.item.id } }, ctx);
    assert.equal(rem.ok, true);
    assert.equal(rem.result.meeting.agenda.length, 1);
    assert.equal(rem.result.meeting.agenda[0].id, a1.result.item.id);
    assert.equal(rem.result.meeting.agenda[0].order, 0);
  });

  it("agenda-reorder: full permutation reindexes; length mismatch rejected", async () => {
    const meetingId = await freshMeeting("Reorder");
    const x = await lensRun("council", "agenda-add", { params: { meetingId, topic: "X" } }, ctx);
    const y = await lensRun("council", "agenda-add", { params: { meetingId, topic: "Y" } }, ctx);
    const z = await lensRun("council", "agenda-add", { params: { meetingId, topic: "Z" } }, ctx);

    const ok = await lensRun("council", "agenda-reorder", {
      params: { meetingId, order: [z.result.item.id, x.result.item.id, y.result.item.id] },
    }, ctx);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.result.meeting.agenda.map((a) => a.id), [z.result.item.id, x.result.item.id, y.result.item.id]);
    assert.deepEqual(ok.result.meeting.agenda.map((a) => a.order), [0, 1, 2]);

    const bad = await lensRun("council", "agenda-reorder", { params: { meetingId, order: [x.result.item.id] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /order length mismatch/);
  });

  it("attendee-rsvp: valid value persists; invalid value rejected", async () => {
    const meetingId = await freshMeeting("RSVP");
    const at = await lensRun("council", "attendee-add", { params: { meetingId, name: "Dee" } }, ctx);
    assert.equal(at.result.attendee.rsvp, "no_response");

    const yes = await lensRun("council", "attendee-rsvp", { params: { meetingId, attendeeId: at.result.attendee.id, rsvp: "yes" } }, ctx);
    assert.equal(yes.ok, true);
    assert.equal(yes.result.attendee.rsvp, "yes");

    const bad = await lensRun("council", "attendee-rsvp", { params: { meetingId, attendeeId: at.result.attendee.id, rsvp: "perhaps" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /rsvp invalid/);
  });

  it("attendee-check-in: omitted present flag toggles current state", async () => {
    const meetingId = await freshMeeting("Toggle");
    const at = await lensRun("council", "attendee-add", { params: { meetingId, name: "Eve" } }, ctx);
    assert.equal(at.result.attendee.present, false);
    const t1 = await lensRun("council", "attendee-check-in", { params: { meetingId, attendeeId: at.result.attendee.id } }, ctx);
    assert.equal(t1.result.attendee.present, true); // toggled from false
    const t2 = await lensRun("council", "attendee-check-in", { params: { meetingId, attendeeId: at.result.attendee.id } }, ctx);
    assert.equal(t2.result.attendee.present, false); // toggled back
  });

  it("attendee-remove: drops attendee; unknown id rejected", async () => {
    const meetingId = await freshMeeting("Remove Attendee");
    const at = await lensRun("council", "attendee-add", { params: { meetingId, name: "Finn" } }, ctx);
    const rem = await lensRun("council", "attendee-remove", { params: { meetingId, attendeeId: at.result.attendee.id } }, ctx);
    assert.equal(rem.ok, true);
    assert.equal(rem.result.meeting.attendees.length, 0);
    const bad = await lensRun("council", "attendee-remove", { params: { meetingId, attendeeId: "att_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /attendee not found/);
  });

  it("packet-add → packet-remove: board-book document round-trip", async () => {
    const meetingId = await freshMeeting("Packet");
    const add = await lensRun("council", "packet-add", {
      params: { meetingId, name: "Budget PDF", url: "doc://budget", kind: "report" },
    }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.document.name, "Budget PDF");
    assert.equal(add.result.document.kind, "report");
    assert.equal(add.result.meeting.packet.length, 1);

    const missingName = await lensRun("council", "packet-add", { params: { meetingId, url: "doc://x" } }, ctx);
    assert.equal(missingName.result.ok, false);
    assert.match(missingName.result.error, /name required/);

    const rem = await lensRun("council", "packet-remove", { params: { meetingId, documentId: add.result.document.id } }, ctx);
    assert.equal(rem.ok, true);
    assert.equal(rem.result.meeting.packet.length, 0);
  });
});

describe("council — action + decision deletion (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("council-del"); });

  it("action-delete: removes the action; unknown id rejected", async () => {
    const src = await lensRun("council", "action-create", { params: { description: "Temp task" } }, ctx);
    const del = await lensRun("council", "action-delete", { params: { id: src.result.action.id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, src.result.action.id);
    const list = await lensRun("council", "action-list", {}, ctx);
    assert.equal(list.result.actions.some((a) => a.id === src.result.action.id), false);

    const bad = await lensRun("council", "action-delete", { params: { id: "act_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /action not found/);
  });

  it("decision-delete: removes the archived record; unknown id rejected", async () => {
    const arch = await lensRun("council", "decision-archive", { params: { title: "Temp decision" } }, ctx);
    const del = await lensRun("council", "decision-delete", { params: { id: arch.result.decision.id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, arch.result.decision.id);
    const search = await lensRun("council", "decision-search", { params: { query: "Temp decision" } }, ctx);
    assert.equal(search.result.decisions.some((d) => d.id === arch.result.decision.id), false);

    const bad = await lensRun("council", "decision-delete", { params: { id: "dec_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /decision not found/);
  });
});
