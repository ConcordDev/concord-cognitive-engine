// Council write authz: council records are shared for reading, but only the
// author (or an admin) may change a meeting, its agenda/attendees/packet, an
// action item, or a proposal. Repros from the 2026-10-17 sweep (IF-1 council).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCouncilActions from "../domains/council.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) { ACTIONS.set(name, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`council.${name} not registered`);
  return fn(ctx, { id: null, domain: "council", type: "domain_action", data: input, meta: {} }, input);
}
before(() => { registerCouncilActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const A = { actor: { userId: "user_a" }, userId: "user_a" };
const B = { actor: { userId: "user_b" }, userId: "user_b" };
const ADMIN = { actor: { userId: "root", role: "admin" }, userId: "root" };
const ANON = {};

function seed() {
  const m = call("meeting-create", A, { title: "Budget", scheduledAt: "2026-11-01T10:00" }).result.meeting;
  const item = call("agenda-add", A, { meetingId: m.id, topic: "Roads" }).result.item;
  const att = call("attendee-add", A, { meetingId: m.id, name: "Ann" }).result.attendee;
  const doc = call("packet-add", A, { meetingId: m.id, name: "Doc" }).result.document;
  const act = call("action-create", A, { description: "Follow up", meetingId: m.id }).result.action;
  return { m, item, att, doc, act };
}

describe("council write authz", () => {
  it("B cannot modify A's meeting or its children; state unchanged", () => {
    const { m, item, att, doc } = seed();
    const snap = JSON.stringify(call("meeting-list", A).result);
    const attempts = [
      ["meeting-update", { id: m.id, title: "Hijacked" }],
      ["agenda-add", { meetingId: m.id, topic: "Evil" }],
      ["agenda-update", { meetingId: m.id, itemId: item.id, topic: "Evil" }],
      ["agenda-remove", { meetingId: m.id, itemId: item.id }],
      ["agenda-reorder", { meetingId: m.id, order: [item.id] }],
      ["attendee-add", { meetingId: m.id, name: "Mallory" }],
      ["attendee-check-in", { meetingId: m.id, attendeeId: att.id, present: true }],
      ["attendee-remove", { meetingId: m.id, attendeeId: att.id }],
      ["packet-add", { meetingId: m.id, name: "Evil" }],
      ["packet-remove", { meetingId: m.id, documentId: doc.id }],
    ];
    for (const [name, input] of attempts) {
      const r = call(name, B, input);
      assert.equal(r.ok, false, name);
      assert.equal(r.error, "forbidden", name);
      const r2 = call(name, ANON, input);
      assert.equal(r2.ok, false, `${name} anon`);
    }
    assert.equal(JSON.stringify(call("meeting-list", A).result), snap);
  });

  it("B cannot update or carry forward A's action, nor attach an action to A's meeting", () => {
    const { m, act } = seed();
    assert.equal(call("action-update", B, { id: act.id, status: "done" }).error, "forbidden");
    assert.equal(call("action-carry-forward", B, { id: act.id }).error, "forbidden");
    assert.equal(call("action-create", B, { description: "x", meetingId: m.id }).error, "forbidden");
    assert.equal(call("action-create", B, { description: "x", meetingId: "nope" }).error, "meeting not found");
    const acts = call("action-list", A).result.actions;
    assert.equal(acts.length, 1);
    assert.equal(acts[0].status, "open");
  });

  it("B cannot edit A's proposal", () => {
    const p = call("proposal-create", A, { title: "Parks", description: "More parks" });
    assert.equal(p.ok, true, JSON.stringify(p));
    const id = p.result.proposal.id;
    const r = call("proposal-update", B, { id, title: "Hijacked", status: "passed" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "forbidden");
    const after = call("proposal-list", A).result.proposals.find((x) => x.id === id);
    assert.equal(after.title, "Parks");
  });

  it("the author and an admin can still modify; B can still read and RSVP", () => {
    const { m, item, att, act } = seed();
    assert.equal(call("meeting-update", A, { id: m.id, title: "Budget v2" }).ok, true);
    assert.equal(call("agenda-update", A, { meetingId: m.id, itemId: item.id, notes: "ok" }).ok, true);
    assert.equal(call("action-update", A, { id: act.id, status: "done" }).ok, true);
    assert.equal(call("meeting-update", ADMIN, { id: m.id, location: "Hall" }).ok, true);
    assert.equal(call("meeting-list", B).result.total, 1);
    assert.equal(call("attendee-rsvp", B, { meetingId: m.id, attendeeId: att.id, rsvp: "yes" }).ok, true);
  });
});
