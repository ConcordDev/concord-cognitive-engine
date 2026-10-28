// Booking pages end to end (S5 / F5): slots respect the owner's real
// events, booking creates a real calendar event and blocks the slot,
// cancelling restores both, and deleting a schedule takes its booking
// events with it.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);

// Monday 2027-01-04, schedule 9:00–12:00, 60-min slots (server-local frame).
const DAY = "2027-01-04";
let scheduleId;

beforeEach(() => {
  globalThis._concordSTATE = {};
  const r = call("appointment-schedule-create", {
    title: "Office hours", durationMin: 60, startHour: 9, endHour: 12, weekdays: [1],
  });
  assert.equal(r.ok, true);
  scheduleId = r.result.schedule.id;
});

const slots = () => call("appointment-slots", { scheduleId, date: DAY }).result.slots;
const slotAt = (label) => slots().find((s) => s.label === label);

describe("appointment booking (F5)", () => {
  it("slots are blocked by the owner's real events, not just other bookings", () => {
    call("events-create", { title: "Dentist", start: `${DAY}T10:00:00`, end: `${DAY}T11:00:00` });
    // Seeded with the same naive local frame the slots use, so the overlap holds in any server time zone.
    const ten = slotAt("10:00");
    assert.equal(ten.available, false);
    assert.equal(ten.conflictTitle, "Dentist");
    assert.equal(slotAt("09:00").available, true);
  });

  it("booking a slot that collides with a real event is refused", () => {
    call("events-create", { title: "Dentist", start: `${DAY}T10:00:00`, end: `${DAY}T11:00:00` });
    const r = call("appointment-book", { scheduleId, slotStart: `${DAY}T10:00:00`, bookerName: "Sam" });
    assert.equal(r.ok, false);
    assert.match(r.error, /Dentist/);
  });

  it("booking creates a real calendar event and blocks the slot; cancel restores both", () => {
    const r = call("appointment-book", { scheduleId, slotStart: `${DAY}T09:00:00`, bookerName: "Sam", note: "Thesis chat" });
    assert.equal(r.ok, true);
    const booking = r.result.booking;
    assert.ok(booking.eventId, "booking carries its calendar event id");

    const evs = call("events-list", { rangeStart: DAY, rangeEnd: "2027-01-05" }).result.events;
    const mirror = evs.find((e) => e.id === booking.eventId);
    assert.ok(mirror, "booking appears on the real calendar");
    assert.equal(mirror.title, "Office hours — Sam");
    assert.equal(mirror.appointmentScheduleId, scheduleId);

    assert.equal(slotAt("09:00").available, false, "booked slot is blocked");
    const again = call("appointment-book", { scheduleId, slotStart: `${DAY}T09:00:00`, bookerName: "Jo" });
    assert.equal(again.ok, false);
    assert.match(again.error, /already booked/);

    const c = call("appointment-cancel-booking", { scheduleId, bookingId: booking.id });
    assert.equal(c.ok, true);
    const evs2 = call("events-list", { rangeStart: DAY, rangeEnd: "2027-01-05" }).result.events;
    assert.equal(evs2.some((e) => e.id === booking.eventId), false, "mirror event removed on cancel");
    assert.equal(slotAt("09:00").available, true, "slot freed on cancel");
  });

  it("past slots cannot be booked", () => {
    const old = call("appointment-schedule-create", { title: "Retro", durationMin: 60, startHour: 9, endHour: 12, weekdays: [1] });
    const r = call("appointment-book", { scheduleId: old.result.schedule.id, slotStart: "2020-01-06T09:00:00", bookerName: "Sam" });
    assert.equal(r.ok, false);
    assert.match(r.error, /past/);
  });

  it("deleting a schedule removes its bookings' calendar events", () => {
    const r = call("appointment-book", { scheduleId, slotStart: `${DAY}T11:00:00`, bookerName: "Sam" });
    assert.equal(r.ok, true);
    const d = call("appointment-schedule-delete", { id: scheduleId });
    assert.equal(d.ok, true);
    const evs = call("events-list", { rangeStart: DAY, rangeEnd: "2027-01-05" }).result.events;
    assert.equal(evs.some((e) => e.id === r.result.booking.eventId), false);
    assert.equal(call("appointment-schedule-list", {}).result.count, 0);
  });

  it("deleting an unknown schedule errors instead of silently passing", () => {
    assert.equal(call("appointment-schedule-delete", { id: "appt_nope" }).ok, false);
  });
});
