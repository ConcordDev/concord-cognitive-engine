// Quick-add parsing (S11 / F11): "…lunch tomorrow at noon" used to
// keep "at noon" in the title and default to 9 AM — the parser knew
// neither "noon" nor bare times, and it worked in the server's frame,
// not the user's. Assertions format the returned instant in the
// caller's zone, which is the only frame that matters.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);
const parse = (text, tz) => call("nl-parse-event", tz ? { text, tz } : { text }).result.parsed;

const TZ = "America/New_York";
const partsIn = (iso, tz) => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  const parts = {};
  for (const p of f.formatToParts(new Date(iso))) parts[p.type] = p.value;
  return parts;
};
const dateKeyIn = (d, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

describe("nl-parse-event", () => {
  it("'Lunch tomorrow at noon' → title Lunch, tomorrow 12:00 in the user's zone", () => {
    const p = parse("Lunch tomorrow at noon", TZ);
    assert.equal(p.title, "Lunch");
    const parts = partsIn(p.start, TZ);
    assert.equal(parts.hour, "12");
    assert.equal(parts.minute, "00");
    const tomorrow = new Date(Date.now() + 86_400_000);
    assert.equal(dateKeyIn(new Date(p.start), TZ), dateKeyIn(tomorrow, TZ));
    assert.equal(p.durationMin, 60);
  });

  it("'Team standup every Monday at 9am for 30 min' → weekly, 30 min, Monday 9:00", () => {
    const p = parse("Team standup every Monday at 9am for 30 min", TZ);
    assert.equal(p.title, "Team standup");
    assert.deepEqual(p.recurrence, { freq: "weekly", interval: 1 });
    assert.equal(p.durationMin, 30);
    const parts = partsIn(p.start, TZ);
    assert.equal(parts.weekday, "Monday");
    assert.equal(parts.hour, "09");
  });

  it("24-hour and bare times parse; the time token leaves the title", () => {
    const a = parse("Dentist at 14:30 today", TZ);
    assert.equal(a.title, "Dentist");
    assert.equal(partsIn(a.start, TZ).hour, "14");
    assert.equal(partsIn(a.start, TZ).minute, "30");
    const b = parse("Call 12:30 tomorrow", TZ);
    assert.equal(b.title, "Call");
    assert.equal(partsIn(b.start, TZ).hour, "12");
    assert.equal(partsIn(b.start, TZ).minute, "30");
  });

  it("'midnight' means 00:00, and the legacy no-zone path still parses noon", () => {
    const p = parse("Midnight snack at midnight", TZ);
    assert.equal(p.title, "Midnight snack");
    assert.equal(partsIn(p.start, TZ).hour, "00");
    const legacy = parse("Lunch tomorrow at noon");
    assert.equal(legacy.title, "Lunch");
    assert.equal(new Date(legacy.start).getHours(), 12);
  });
});
