// Tier-2 contract tests for council lens 2026 feature-parity macros:
// meeting scheduling, agenda builder, attendance/RSVP, quorum enforcement,
// document packet, ranked-choice tabulation, action-item tracking,
// decision archive + search. Parity targets: Loomio + Convene.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCouncilActions from "../domains/council.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`council.${name}`);
  if (!fn) throw new Error(`council.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerCouncilActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function makeMeeting(ctx = ctxA, over = {}) {
  return call("meeting-create", ctx, {
    title: "Q2 Board Session",
    scheduledAt: "2026-06-01T15:00:00.000Z",
    location: "Council Hall",
    quorumThreshold: 3,
    ...over,
  });
}

describe("council — meeting scheduling", () => {
  it("creates a meeting and lists it", () => {
    const r = makeMeeting();
    assert.equal(r.ok, true);
    assert.equal(r.result.meeting.status, "scheduled");
    assert.equal(r.result.meeting.quorumThreshold, 3);
    const list = call("meeting-list", ctxA);
    assert.equal(list.result.total, 1);
  });

  it("rejects a meeting without a title or scheduledAt", () => {
    assert.equal(call("meeting-create", ctxA, { scheduledAt: "2026-06-01" }).ok, false);
    assert.equal(call("meeting-create", ctxA, { title: "X" }).ok, false);
  });

  it("shared board — user B sees user A's meeting", () => {
    const created = makeMeeting(ctxA);
    const list = call("meeting-list", ctxB);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.meetings[0].id, created.result.meeting.id);
    assert.equal(list.result.meetings[0].authorId, "user_a");
  });

  it("updates and deletes a meeting", () => {
    const m = makeMeeting().result.meeting;
    const u = call("meeting-update", ctxA, { id: m.id, status: "concluded", title: "Renamed" });
    assert.equal(u.result.meeting.status, "concluded");
    assert.equal(u.result.meeting.title, "Renamed");
    assert.equal(call("meeting-delete", ctxA, { id: m.id }).ok, true);
    assert.equal(call("meeting-list", ctxA).result.total, 0);
  });
});

describe("council — agenda builder", () => {
  it("adds, updates, removes and reorders timed agenda items", () => {
    const m = makeMeeting().result.meeting;
    const a1 = call("agenda-add", ctxA, { meetingId: m.id, topic: "Budget review", durationMin: 20 });
    assert.equal(a1.ok, true);
    assert.equal(a1.result.item.durationMin, 20);
    const a2 = call("agenda-add", ctxA, { meetingId: m.id, topic: "New hires", durationMin: 15 });
    assert.equal(a2.result.meeting.agenda.length, 2);
    const upd = call("agenda-update", ctxA, {
      meetingId: m.id, itemId: a1.result.item.id, status: "discussed",
    });
    assert.equal(upd.result.item.status, "discussed");
    const reordered = call("agenda-reorder", ctxA, {
      meetingId: m.id, order: [a2.result.item.id, a1.result.item.id],
    });
    assert.equal(reordered.result.meeting.agenda[0].id, a2.result.item.id);
    const rem = call("agenda-remove", ctxA, { meetingId: m.id, itemId: a1.result.item.id });
    assert.equal(rem.result.meeting.agenda.length, 1);
    assert.equal(rem.result.meeting.agenda[0].order, 0);
  });

  it("rejects an agenda item without a topic", () => {
    const m = makeMeeting().result.meeting;
    assert.equal(call("agenda-add", ctxA, { meetingId: m.id }).ok, false);
  });
});

describe("council — attendance + RSVP", () => {
  it("adds attendees, records RSVP and check-in", () => {
    const m = makeMeeting().result.meeting;
    const at = call("attendee-add", ctxA, { meetingId: m.id, name: "Dana", role: "chair" });
    assert.equal(at.ok, true);
    assert.equal(at.result.attendee.rsvp, "no_response");
    const rsvp = call("attendee-rsvp", ctxA, {
      meetingId: m.id, attendeeId: at.result.attendee.id, rsvp: "yes",
    });
    assert.equal(rsvp.result.attendee.rsvp, "yes");
    const ci = call("attendee-check-in", ctxA, {
      meetingId: m.id, attendeeId: at.result.attendee.id, present: true,
    });
    assert.equal(ci.result.attendee.present, true);
  });

  it("rejects duplicate attendees and invalid RSVP", () => {
    const m = makeMeeting().result.meeting;
    call("attendee-add", ctxA, { meetingId: m.id, name: "Dana" });
    assert.equal(call("attendee-add", ctxA, { meetingId: m.id, name: "dana" }).ok, false);
    const at2 = call("attendee-add", ctxA, { meetingId: m.id, name: "Lee" });
    assert.equal(call("attendee-rsvp", ctxA, {
      meetingId: m.id, attendeeId: at2.result.attendee.id, rsvp: "bogus",
    }).ok, false);
  });

  it("removes an attendee", () => {
    const m = makeMeeting().result.meeting;
    const at = call("attendee-add", ctxA, { meetingId: m.id, name: "Temp" });
    const r = call("attendee-remove", ctxA, { meetingId: m.id, attendeeId: at.result.attendee.id });
    assert.equal(r.result.meeting.attendees.length, 0);
  });
});

describe("council — quorum enforcement", () => {
  it("blocks tally when present attendees are below threshold", () => {
    const m = makeMeeting(ctxA, { quorumThreshold: 3 }).result.meeting;
    const a = call("attendee-add", ctxA, { meetingId: m.id, name: "One" }).result.attendee;
    const b = call("attendee-add", ctxA, { meetingId: m.id, name: "Two" }).result.attendee;
    call("attendee-add", ctxA, { meetingId: m.id, name: "Three" });
    call("attendee-check-in", ctxA, { meetingId: m.id, attendeeId: a.id, present: true });
    call("attendee-check-in", ctxA, { meetingId: m.id, attendeeId: b.id, present: true });
    const q1 = call("quorum-check", ctxA, { meetingId: m.id });
    assert.equal(q1.result.present, 2);
    assert.equal(q1.result.quorumMet, false);
    assert.equal(q1.result.canTally, false);
  });

  it("permits tally once threshold is met", () => {
    const m = makeMeeting(ctxA, { quorumThreshold: 2 }).result.meeting;
    const a = call("attendee-add", ctxA, { meetingId: m.id, name: "One" }).result.attendee;
    const b = call("attendee-add", ctxA, { meetingId: m.id, name: "Two" }).result.attendee;
    call("attendee-check-in", ctxA, { meetingId: m.id, attendeeId: a.id, present: true });
    call("attendee-check-in", ctxA, { meetingId: m.id, attendeeId: b.id, present: true });
    const q = call("quorum-check", ctxA, { meetingId: m.id });
    assert.equal(q.result.quorumMet, true);
    assert.equal(q.result.canTally, true);
  });

  it("never reports quorum met when the threshold is 0, even if attendees exist", () => {
    const m = makeMeeting(ctxA, { quorumThreshold: 0 }).result.meeting;
    const a = call("attendee-add", ctxA, { meetingId: m.id, name: "One" }).result.attendee;
    const absent = call("quorum-check", ctxA, { meetingId: m.id });
    assert.equal(absent.result.present, 0);
    assert.equal(absent.result.invited, 1);
    assert.equal(absent.result.quorumMet, false);
    call("attendee-check-in", ctxA, { meetingId: m.id, attendeeId: a.id, present: true });
    const present = call("quorum-check", ctxB, { meetingId: m.id });
    assert.equal(present.result.present, 1);
    assert.equal(present.result.quorumMet, false);
    assert.equal(present.result.canTally, false);
  });
});

describe("council — document packet", () => {
  it("bundles and removes attachments per meeting", () => {
    const m = makeMeeting().result.meeting;
    const d = call("packet-add", ctxA, {
      meetingId: m.id, name: "FY26 Budget.pdf", url: "https://example.com/b.pdf", kind: "report",
    });
    assert.equal(d.ok, true);
    assert.equal(d.result.meeting.packet.length, 1);
    assert.equal(d.result.document.kind, "report");
    const rm = call("packet-remove", ctxA, { meetingId: m.id, documentId: d.result.document.id });
    assert.equal(rm.result.meeting.packet.length, 0);
  });

  it("rejects a document without a name", () => {
    const m = makeMeeting().result.meeting;
    assert.equal(call("packet-add", ctxA, { meetingId: m.id }).ok, false);
  });
});

describe("council — action-item tracking", () => {
  it("creates, lists and updates action items", () => {
    const c = call("action-create", ctxA, {
      description: "Draft policy revision", owner: "Lee", dueDate: "2026-07-01",
    });
    assert.equal(c.ok, true);
    const list = call("action-list", ctxA);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.open, 1);
    const u = call("action-update", ctxA, { id: c.result.action.id, status: "done" });
    assert.equal(u.result.action.status, "done");
    assert.equal(call("action-list", ctxA, { status: "open" }).result.total, 0);
  });

  it("flags overdue open actions", () => {
    call("action-create", ctxA, { description: "Late task", dueDate: "2020-01-01" });
    const list = call("action-list", ctxA);
    assert.equal(list.result.overdue, 1);
  });

  it("carries an open action forward into a new meeting", () => {
    const m = makeMeeting().result.meeting;
    const a = call("action-create", ctxA, {
      description: "Follow up on vendor contract", owner: "Dana",
    }).result.action;
    const cf = call("action-carry-forward", ctxA, { id: a.id, targetMeetingId: m.id });
    assert.equal(cf.ok, true);
    assert.equal(cf.result.source.status, "carried_forward");
    assert.equal(cf.result.carried.status, "open");
    assert.equal(cf.result.carried.meetingId, m.id);
    // a second carry-forward of the already-carried source is rejected
    assert.equal(call("action-carry-forward", ctxA, { id: a.id }).ok, false);
  });

  it("shared board — user B sees user A's action item", () => {
    const created = call("action-create", ctxA, { description: "Shared task" });
    const list = call("action-list", ctxB);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.actions[0].id, created.result.action.id);
    assert.equal(list.result.actions[0].authorId, "user_a");
  });

  it("deletes an action item", () => {
    const a = call("action-create", ctxA, { description: "Temp" }).result.action;
    assert.equal(call("action-delete", ctxA, { id: a.id }).ok, true);
    assert.equal(call("action-list", ctxA).result.total, 0);
  });
});

describe("council — ranked-choice tabulation (IRV)", () => {
  it("declares a first-round majority winner", () => {
    const r = call("ranked-choice-tabulate", ctxA, {
      ballots: [
        { voter: "v1", ranking: ["A", "B"] },
        { voter: "v2", ranking: ["A", "C"] },
        { voter: "v3", ranking: ["B", "A"] },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.winner.candidate, "A");
    assert.equal(r.result.decided, true);
    assert.equal(r.result.rounds.length, 1);
  });

  it("runs instant-runoff rounds when no first-round majority", () => {
    const r = call("ranked-choice-tabulate", ctxA, {
      ballots: [
        { voter: "v1", ranking: ["A", "C"] },
        { voter: "v2", ranking: ["A", "C"] },
        { voter: "v3", ranking: ["B", "C"] },
        { voter: "v4", ranking: ["B", "C"] },
        { voter: "v5", ranking: ["C", "A"] },
      ],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.rounds.length >= 2);
    assert.ok(r.result.eliminated.length >= 1);
    assert.equal(r.result.winner.votes >= r.result.majority, true);
  });

  it("rejects an empty ballot set", () => {
    assert.equal(call("ranked-choice-tabulate", ctxA, { ballots: [] }).ok, false);
  });
});

describe("council — decision archive + search", () => {
  it("archives a decision and finds it by full-text query", () => {
    const a = call("decision-archive", ctxA, {
      title: "Adopt remote-work policy",
      summary: "Council approved hybrid schedule for all staff",
      outcome: "passed",
      tags: ["hr", "policy"],
      votesFor: 7, votesAgainst: 2,
    });
    assert.equal(a.ok, true);
    const hit = call("decision-search", ctxA, { query: "hybrid" });
    assert.equal(hit.result.total, 1);
    const byTag = call("decision-search", ctxA, { query: "hr" });
    assert.equal(byTag.result.total, 1);
    const miss = call("decision-search", ctxA, { query: "nonexistent" });
    assert.equal(miss.result.total, 0);
  });

  it("filters archived decisions by outcome", () => {
    call("decision-archive", ctxA, { title: "Passed motion", outcome: "passed" });
    call("decision-archive", ctxA, { title: "Rejected motion", outcome: "rejected" });
    assert.equal(call("decision-search", ctxA, { outcome: "rejected" }).result.total, 1);
    assert.equal(call("decision-search", ctxA, { outcome: "all" }).result.total, 2);
  });

  it("shared board — user B sees user A's decision", () => {
    const created = call("decision-archive", ctxA, { title: "Shared resolution" });
    const list = call("decision-search", ctxB);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.decisions[0].id, created.result.decision.id);
    assert.equal(list.result.decisions[0].authorId, "user_a");
  });

  it("deletes an archived decision", () => {
    const d = call("decision-archive", ctxA, { title: "Temp resolution" }).result.decision;
    assert.equal(call("decision-delete", ctxA, { id: d.id }).ok, true);
    assert.equal(call("decision-search", ctxA).result.total, 0);
  });
});

describe("council — shared proposals, votes, quorum, audit", () => {
  it("A proposes, B sees and votes, quorum updates, audit shows A's name", () => {
    const created = call("proposal-create", ctxA, {
      title: "Adopt the shared charter",
      description: "One council, real members.",
      authorName: "Ada",
    });
    assert.equal(created.ok, true);
    const id = created.result.proposal.id;
    assert.equal(created.result.proposal.authorId, "user_a");
    assert.equal(created.result.proposal.authorName, "Ada");
    assert.equal(created.result.proposal.votesCast, 0);
    assert.equal(created.result.proposal.eligible, 1);
    assert.equal(created.result.proposal.quorumRequired, 1);
    assert.equal(created.result.proposal.quorumMet, false);

    const seen = call("proposal-list", ctxB);
    assert.equal(seen.result.total, 1);
    assert.equal(seen.result.proposals[0].id, id);
    assert.equal(seen.result.proposals[0].authorId, "user_a");

    const early = call("proposal-vote", ctxB, { id, choice: "support", authorName: "Bea" });
    assert.equal(early.ok, false);
    assert.equal(early.error, "not eligible");

    const joined = call("member-join", ctxB, { authorName: "Bea" });
    assert.equal(joined.ok, true);
    assert.equal(joined.result.total, 2);

    const afterJoin = call("proposal-list", ctxB).result.proposals[0];
    assert.equal(afterJoin.eligible, 2);
    assert.equal(afterJoin.quorumRequired, 2);
    assert.equal(afterJoin.votesCast, 0);
    assert.equal(afterJoin.quorumMet, false);

    const voted = call("proposal-vote", ctxB, { id, choice: "support", authorName: "Bea" });
    assert.equal(voted.ok, true);
    assert.equal(voted.result.quorum.votesCast, 1);
    assert.equal(voted.result.quorum.eligible, 2);
    assert.equal(voted.result.quorum.quorumMet, false);
    assert.equal(voted.result.quorum.tally.for, 1);

    const again = call("proposal-vote", ctxB, { id, choice: "oppose", authorName: "Bea" });
    assert.equal(again.ok, true);
    assert.equal(again.result.quorum.votesCast, 1);
    assert.equal(again.result.quorum.tally.for, 0);
    assert.equal(again.result.quorum.tally.against, 1);
    assert.equal(Object.keys(again.result.proposal.votes).length, 1);

    const ada = call("proposal-vote", ctxA, { id, choice: "support", authorName: "Ada" });
    assert.equal(ada.ok, true);
    assert.equal(ada.result.quorum.votesCast, 2);
    assert.equal(ada.result.quorum.required, 2);
    assert.equal(ada.result.quorum.quorumMet, true);
    assert.equal(ada.result.quorum.tally.for, 1);
    assert.equal(ada.result.quorum.tally.against, 1);

    const audit = call("audit-list", ctxB);
    const actors = audit.result.entries.map((e) => e.actor);
    assert.ok(actors.includes("Ada"));
    assert.equal(actors.includes("Council Chair"), false);
    const createdEntry = audit.result.entries.find((e) => e.action === "Created proposal");
    assert.equal(createdEntry.actor, "Ada");
    assert.equal(createdEntry.target, id);

    assert.equal(call("proposal-delete", ctxB, { id }).ok, false);
    assert.equal(call("proposal-delete", ctxA, { id }).ok, true);
    assert.equal(call("proposal-list", ctxB).result.total, 0);
  });

  it("rejects the Council Chair label and records the account instead", () => {
    const created = call("proposal-create", {
      actor: { userId: "user_a", displayName: "Council Chair" },
      userId: "user_a",
    }, { title: "No ceremonial actor", authorName: "Council Chair" });
    assert.equal(created.ok, true);
    assert.equal(created.result.proposal.authorName, "user_a");
    const audit = call("audit-list", ctxA);
    assert.equal(audit.result.entries[0].actor, "user_a");
    assert.equal(audit.result.entries.some((e) => e.actor === "Council Chair"), false);
  });

  it("folds a legacy per-user meeting into the shared board without deleting the source", () => {
    const legacy = [{
      id: "mtg_legacy",
      title: "Old board",
      scheduledAt: "2026-01-01T00:00:00.000Z",
      agenda: [],
      attendees: [],
      packet: [],
    }];
    globalThis._concordSTATE.councilLens = {
      meetings: new Map([["user_a", legacy]]),
      actions: new Map(),
      decisions: new Map(),
    };
    const first = call("meeting-list", ctxB);
    assert.equal(first.result.total, 1);
    assert.equal(first.result.meetings[0].id, "mtg_legacy");
    assert.equal(first.result.meetings[0].authorId, "user_a");
    assert.equal(legacy.length, 1);
    const second = call("meeting-list", ctxA);
    assert.equal(second.result.total, 1);
    assert.equal(call("meeting-delete", ctxA, { id: "mtg_legacy" }).ok, true);
    assert.equal(call("meeting-list", ctxB).result.total, 0);
    assert.equal(legacy.length, 1);
    assert.equal(call("meeting-list", ctxA).result.total, 0);
  });
});

describe("council — STATE unavailable path", () => {
  it("returns error shape when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("meeting-list", ctxA);
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
