// Delete with a way back (S12 / F12): deleting an event used to be one
// silent, permanent click. Now a delete is a soft delete — the event
// leaves every surface (grid, conflicts, availability, dashboard,
// reminders) but sits in a trash it can be restored from, and only an
// explicit permanent delete destroys it.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);

const RANGE = { rangeStart: "2026-10-26", rangeEnd: "2026-10-30" };
let eventId;

beforeEach(() => {
  globalThis._concordSTATE = {};
  const c = call("events-create", { title: "Doomed", start: "2026-10-28T14:00:00.000Z", end: "2026-10-28T15:00:00.000Z" });
  eventId = c.result.event.id;
});

describe("soft delete + trash", () => {
  it("a deleted event vanishes from list/conflicts/dashboard but is in the trash", () => {
    const d = call("events-delete", { id: eventId });
    assert.equal(d.ok, true);
    assert.equal(d.result.soft, true);
    assert.equal(call("events-list", RANGE).result.count, 0);
    const conf = call("conflicts-check", { start: "2026-10-28T13:00:00.000Z", end: "2026-10-28T16:00:00.000Z" });
    assert.equal(conf.result.hasConflict, false);
    const trash = call("events-trash-list", {});
    assert.equal(trash.result.count, 1);
    assert.equal(trash.result.events[0].title, "Doomed");
    assert.ok(trash.result.events[0].deletedAt);
  });

  it("restore brings it back everywhere; a second delete + permanent delete ends it", () => {
    call("events-delete", { id: eventId });
    const r = call("events-restore", { id: eventId });
    assert.equal(r.ok, true);
    assert.equal(call("events-list", RANGE).result.count, 1);
    assert.equal(call("events-trash-list", {}).result.count, 0);

    call("events-delete", { id: eventId });
    assert.equal(call("events-delete", { id: eventId }).ok, false, "already-trashed reads as not found");
    const p = call("events-delete-permanent", { id: eventId });
    assert.equal(p.ok, true);
    assert.equal(call("events-trash-list", {}).result.count, 0);
    assert.equal(call("events-restore", { id: eventId }).ok, false);
  });

  it("a trashed event cannot be edited or invited to", () => {
    call("events-delete", { id: eventId });
    assert.equal(call("events-update", { id: eventId, title: "Zombie" }).ok, false);
    assert.equal(call("invites-send", { eventId, guests: ["@x"] }).ok, false);
  });

  it("scoped deletes still sculpt the series instead of trashing it", () => {
    const s = call("events-create", {
      title: "Weekly", start: "2026-10-05T14:00:00.000Z", end: "2026-10-05T15:00:00.000Z",
      recurrence: { freq: "weekly", interval: 1, count: 4 },
    });
    const occ = call("events-list", { rangeStart: "2026-10-01", rangeEnd: "2026-11-30" }).result.events
      .find((e) => e.id === s.result.event.id);
    const d = call("events-delete", { id: s.result.event.id, scope: "this", occurrenceKey: occ.occurrenceStart });
    assert.equal(d.ok, true);
    assert.equal(call("events-trash-list", {}).result.count, 0, "an occurrence delete is not a trash delete");
    const remaining = call("events-list", { rangeStart: "2026-10-01", rangeEnd: "2026-11-30" }).result.events
      .filter((e) => e.id === s.result.event.id);
    assert.equal(remaining.length, 3);
  });
});


describe("status events and the trash", () => {
  it("a deleted status block leaves status-events-list", () => {
    const c = call("status-event-create", {
      kind: "out-of-office", detail: "Trip",
      start: "2026-11-02T00:00:00.000Z", end: "2026-11-03T00:00:00.000Z", allDay: true,
    });
    assert.equal(c.ok, true);
    const listed = () => call("status-events-list", { includeAll: true }).result.statusEvents;
    assert.equal(listed().some((e) => e.id === c.result.event.id), true);
    call("events-delete", { id: c.result.event.id });
    assert.equal(listed().some((e) => e.id === c.result.event.id), false);
  });
});
