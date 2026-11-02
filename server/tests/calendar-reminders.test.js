// Reminders that actually remind (S8 / F8): a reminder materializes at
// its NOMINAL time — the old code fired anything inside a 60-minute
// look-ahead immediately (~29 min early in the review) and never
// surfaced reminders whose event had already started. Missed reminders
// are admitted as missed; dismiss and snooze are different verbs.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const MIN = 60_000;

beforeEach(() => { globalThis._concordSTATE = {}; });

describe("reminders-due", () => {
  it("does NOT fire early: a reminder 30 minutes from its nominal time stays upcoming", () => {
    // Event in 90 min, 60-min reminder → nominal fire time is +30 min.
    call("events-create", { title: "Later", start: iso(90 * MIN), end: iso(120 * MIN), reminders: [60] });
    const r = call("reminders-due", { lookAheadMin: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.firedNow, 0);
    assert.equal(r.result.pending.length, 0);
    assert.equal(r.result.upcoming.length, 1);
    assert.equal(r.result.upcoming[0].eventTitle, "Later");
    const fireInMin = Math.round((new Date(r.result.upcoming[0].fireAt).getTime() - Date.now()) / MIN);
    assert.ok(fireInMin >= 29 && fireInMin <= 31, `fireAt ~30 min out, got ${fireInMin}`);
  });

  it("fires at the nominal time and reports the receipt (fireAt, offset)", () => {
    // Event in 30 min, 60-min reminder → nominal fire time was 30 min ago.
    const start = iso(30 * MIN);
    call("events-create", { title: "Soon", start, end: iso(60 * MIN), reminders: [60] });
    const r = call("reminders-due", {});
    assert.equal(r.result.firedNow, 1);
    assert.equal(r.result.pending.length, 1);
    const note = r.result.pending[0];
    assert.equal(note.eventTitle, "Soon");
    assert.equal(note.missed, false);
    assert.equal(new Date(note.fireAt).getTime(), new Date(start).getTime() - 60 * MIN);
    // And it does not fire twice.
    assert.equal(call("reminders-due", {}).result.firedNow, 0);
  });

  it("a reminder whose event already started surfaces as missed, not vanished", () => {
    call("events-create", { title: "Main", start: iso(-30 * MIN), end: iso(30 * MIN), reminders: [60] });
    const r = call("reminders-due", {});
    assert.equal(r.result.pending.length, 1);
    assert.equal(r.result.pending[0].missed, true);
  });

  it("ancient history (3 days past) is not resurrected", () => {
    call("events-create", { title: "Old", start: iso(-3 * 24 * 60 * MIN), end: iso(-3 * 24 * 60 * MIN + 30 * MIN), reminders: [60] });
    const r = call("reminders-due", {});
    assert.equal(r.result.pending.length, 0);
    assert.equal(r.result.firedNow, 0);
  });
});

describe("reminders-acknowledge", () => {
  it("snooze hides the reminder without consuming it; dismiss consumes it", () => {
    call("events-create", { title: "Soon", start: iso(30 * MIN), end: iso(60 * MIN), reminders: [60] });
    const note = call("reminders-due", {}).result.pending[0];
    const snoozed = call("reminders-acknowledge", { id: note.id, snoozeMin: 10 });
    assert.equal(snoozed.ok, true);
    assert.ok(snoozed.result.notification.snoozedUntil);
    assert.equal(snoozed.result.notification.acknowledged, false);
    assert.equal(call("reminders-due", {}).result.pending.length, 0, "snoozed reminder is hidden");
    const acked = call("reminders-acknowledge", { id: note.id });
    assert.equal(acked.result.notification.acknowledged, true);
    assert.equal(call("reminders-due", {}).result.pending.length, 0);
  });

  it("acknowledging an unknown id errors honestly", () => {
    assert.equal(call("reminders-acknowledge", { id: "ntf_nope" }).ok, false);
  });

  it("a fired reminder also lands in the global bell store — exactly once (S8 completion)", () => {
    call("events-create", { title: "Soon", start: iso(30 * MIN), end: iso(60 * MIN), reminders: [60] });
    call("reminders-due", {});
    const bell = () => globalThis._concordSTATE._social?.notifications?.get("cal-u1") || [];
    assert.equal(bell().length, 1);
    assert.equal(bell()[0].type, "reminder");
    assert.match(bell()[0].content, /Soon/);
    assert.equal(bell()[0].read, false);
    // Re-polling never duplicates the bell entry.
    call("reminders-due", {});
    call("reminders-due", {});
    assert.equal(bell().length, 1);
  });

  it("upcoming (not yet due) reminders do NOT touch the bell", () => {
    call("events-create", { title: "Later", start: iso(90 * MIN), end: iso(120 * MIN), reminders: [60] });
    call("reminders-due", { lookAheadMin: 60 });
    const bell = globalThis._concordSTATE._social?.notifications?.get("cal-u1") || [];
    assert.equal(bell.length, 0);
  });
});
