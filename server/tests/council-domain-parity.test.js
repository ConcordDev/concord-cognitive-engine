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

  it("INVARIANT: meetings are scoped per-user", () => {
    makeMeeting(ctxA);
    assert.equal(call("meeting-list", ctxB).result.total, 0);
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

  it("INVARIANT: action items are scoped per-user", () => {
    call("action-create", ctxA, { description: "A-only task" });
    assert.equal(call("action-list", ctxB).result.total, 0);
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

  it("INVARIANT: decision archive is scoped per-user", () => {
    call("decision-archive", ctxA, { title: "A-only resolution" });
    assert.equal(call("decision-search", ctxB).result.total, 0);
  });

  it("deletes an archived decision", () => {
    const d = call("decision-archive", ctxA, { title: "Temp resolution" }).result.decision;
    assert.equal(call("decision-delete", ctxA, { id: d.id }).ok, true);
    assert.equal(call("decision-search", ctxA).result.total, 0);
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
