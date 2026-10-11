import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCalendarActions from "../domains/calendar.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`calendar.${name}`);
  assert.ok(fn, `calendar.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerCalendarActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "cal_persist_user" }, userId: "cal_persist_user" };

describe("calendar event edit persists", () => {
  it("events-update title is what a later events-list returns", () => {
    const created = call("events-create", ctx, {
      title: "Standup",
      start: "2026-10-12T15:00:00.000Z",
      end: "2026-10-12T15:30:00.000Z",
    });
    assert.equal(created.ok, true);
    const id = created.result.event.id;
    const updated = call("events-update", ctx, { id, title: "Standup moved" });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.event.title, "Standup moved");

    const listed = call("events-list", ctx, {
      rangeStart: "2026-10-01T00:00:00.000Z",
      rangeEnd: "2026-11-01T00:00:00.000Z",
    });
    assert.equal(listed.ok, true);
    const hit = listed.result.events.find((e) => e.id === id);
    assert.ok(hit, "edited event is still on the calendar");
    assert.equal(hit.title, "Standup moved");
  });
});
