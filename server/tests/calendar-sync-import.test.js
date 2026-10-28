// Sync & import honesty (S14 / F14):
// - accounts-connect validates the feed (fetch + VCALENDAR parse check)
//   BEFORE an account exists — a bogus URL can never become a
//   "connected" account again.
// - ical-import is the commit step behind ical-parse's preview: it
//   creates the parsed events on the default calendar, dedupes by the
//   source UID so re-importing the same file does not double it, and
//   reports what it did (imported / skipped / recurring-noted).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = async (n, p) => map.get(n)(ctx, { data: p }, p);

const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:feed-1@x",
  "SUMMARY:Feed One",
  "DTSTART:20261028T140000Z",
  "DTEND:20261028T150000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:feed-2@x",
  "SUMMARY:Feed Two",
  "DTSTART:20261029T140000Z",
  "DTEND:20261029T150000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const realFetch = globalThis.fetch;
function stubFetch(impl) { globalThis.fetch = impl; }

beforeEach(() => { globalThis._concordSTATE = {}; });
afterEach(() => { globalThis.fetch = realFetch; });

describe("accounts-connect validates before it connects", () => {
  it("a 404 feed creates NO account", async () => {
    stubFetch(async () => ({ ok: false, status: 404, text: async () => "nope" }));
    const r = await call("accounts-connect", { label: "Bad", icsUrl: "https://example.invalid/calendar.ics" });
    assert.equal(r.ok, false);
    assert.match(r.error, /404/);
    assert.equal((await call("accounts-list", {})).result.accounts.length, 0);
  });

  it("an unreachable feed creates NO account", async () => {
    stubFetch(async () => { throw new Error("fetch failed"); });
    const r = await call("accounts-connect", { label: "Bad", icsUrl: "https://example.invalid/calendar.ics" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
    assert.equal((await call("accounts-list", {})).result.accounts.length, 0);
  });

  it("a non-iCalendar response creates NO account", async () => {
    stubFetch(async () => ({ ok: true, status: 200, text: async () => "<html>hello</html>" }));
    const r = await call("accounts-connect", { label: "Bad", icsUrl: "https://example.com/calendar.ics" });
    assert.equal(r.ok, false);
    assert.equal((await call("accounts-list", {})).result.accounts.length, 0);
  });

  it("a real feed connects and reports its event count", async () => {
    stubFetch(async () => ({ ok: true, status: 200, text: async () => FEED }));
    const r = await call("accounts-connect", { label: "Work", icsUrl: "https://example.com/cal.ics" });
    assert.equal(r.ok, true);
    assert.equal(r.result.validatedEventCount, 2);
    assert.equal((await call("accounts-list", {})).result.accounts.length, 1);
  });
});

describe("ical-import commits the preview", () => {
  it("creates the parsed events and dedupes re-imports by UID", async () => {
    const first = await call("ical-import", { ics: FEED });
    assert.equal(first.ok, true);
    assert.equal(first.result.imported, 2);
    const listed = await call("events-list", { rangeStart: "2026-10-01", rangeEnd: "2026-11-30" });
    assert.deepEqual(listed.result.events.map((e) => e.title).sort(), ["Feed One", "Feed Two"]);

    const second = await call("ical-import", { ics: FEED });
    assert.equal(second.result.imported, 0);
    assert.equal(second.result.skipped, 2);
  });

  it("rejects non-iCalendar input and skips undated events", async () => {
    assert.equal((await call("ical-import", { ics: "hello" })).ok, false);
    const mixed = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:ok@x", "SUMMARY:Dated",
      "DTSTART:20261028T140000Z", "END:VEVENT",
      "BEGIN:VEVENT", "UID:bad@x", "SUMMARY:Undated", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const r = await call("ical-import", { ics: mixed });
    assert.equal(r.result.imported, 1);
    assert.equal(r.result.skipped, 1);
  });
});
