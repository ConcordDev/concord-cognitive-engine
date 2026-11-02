// Collaborators + invites (S6 / F6): attendees must round-trip through
// create AND update (applyEventEdits used to ignore them, so any edit
// silently froze the original list), and the invite macros must track
// RSVP state against the same event.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);

const RANGE = { rangeStart: "2027-01-01", rangeEnd: "2027-01-10" };
let eventId;

beforeEach(() => {
  globalThis._concordSTATE = {};
  const c = call("events-create", {
    title: "Design sync", start: "2027-01-04T10:00:00.000Z", end: "2027-01-04T11:00:00.000Z",
    attendees: ["@alice", "bob@example.com"],
  });
  assert.equal(c.ok, true);
  eventId = c.result.event.id;
});

const listed = () => call("events-list", RANGE).result.events.find((e) => e.id === eventId);

describe("attendees round-trip", () => {
  it("create persists collaborators and events-list returns them", () => {
    assert.deepEqual(listed().attendees, ["@alice", "bob@example.com"]);
  });

  it("update REPLACES the collaborator list (the F6 break)", () => {
    const u = call("events-update", { id: eventId, attendees: ["@carol"] });
    assert.equal(u.ok, true);
    assert.deepEqual(listed().attendees, ["@carol"]);
  });

  it("an update that does not mention attendees preserves them", () => {
    call("events-update", { id: eventId, title: "Design sync v2" });
    assert.deepEqual(listed().attendees, ["@alice", "bob@example.com"]);
  });

  it("an explicit empty list clears collaborators", () => {
    call("events-update", { id: eventId, attendees: [] });
    assert.deepEqual(listed().attendees, []);
  });

  it("blank entries are dropped and duplicates removed on update", () => {
    call("events-update", { id: eventId, attendees: [" @dana ", "", "@dana"] });
    assert.deepEqual(listed().attendees, ["@dana"]);
  });
});

describe("invites", () => {
  it("send creates pending invites, dedupes, and mirrors guests onto attendees", () => {
    const r = call("invites-send", { eventId, guests: ["@erin", "bob@example.com"] });
    assert.equal(r.ok, true);
    // Dedupe is against the invite list (empty here), not the attendee list.
    assert.equal(r.result.sent, 2);
    const again = call("invites-send", { eventId, guests: ["@erin"] });
    assert.equal(again.result.sent, 0, "re-sending to the same guest dedupes");
    const list = call("invites-list", { eventId });
    assert.equal(list.result.rsvpCounts.pending, list.result.count);
    assert.ok(listed().attendees.includes("@erin"), "guest mirrored onto the event for ICS export");
  });

  it("rsvp by token records the response; revoke removes the invite", () => {
    const r = call("invites-send", { eventId, guests: ["@frank"] });
    const inv = r.result.invites[0];
    const resp = call("invite-rsvp", { token: inv.token, rsvp: "accepted" });
    assert.equal(resp.ok, true);
    assert.equal(resp.result.invite.rsvp, "accepted");
    assert.ok(resp.result.invite.respondedAt);
    assert.equal(call("invite-rsvp", { token: inv.token, rsvp: "maybe" }).ok, false);
    assert.equal(call("invite-revoke", { id: inv.id }).ok, true);
    assert.equal(call("invites-list", { eventId }).result.count, 0);
  });

  it("invites-send requires a real event and at least one guest", () => {
    assert.equal(call("invites-send", { eventId: "evt_nope", guests: ["@x"] }).ok, false);
    assert.equal(call("invites-send", { eventId, guests: [] }).ok, false);
  });
});
