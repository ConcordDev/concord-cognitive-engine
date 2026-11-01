// Recurring edit scopes (S10 / F10): this / following / all must each
// change exactly the occurrences they claim to. Two server defects
// pinned here: a "following" split used to DROP a count-bounded
// series' count (turning "10 times" into an infinite series), and
// scoped edits reported nothing about how many occurrences changed.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);

const RANGE = { rangeStart: "2026-10-01", rangeEnd: "2027-03-01" };
let seriesId;
const occurrences = () => call("events-list", RANGE).result.events
  .filter((e) => e.title.startsWith("Weekly"))
  .sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));

beforeEach(() => {
  globalThis._concordSTATE = {};
  const c = call("events-create", {
    title: "Weekly sync", start: "2026-10-05T14:00:00.000Z", end: "2026-10-05T15:00:00.000Z",
    recurrence: { freq: "weekly", interval: 1, count: 10 },
  });
  assert.equal(c.ok, true);
  seriesId = c.result.event.id;
  assert.equal(occurrences().length, 10);
});

describe("events-update scopes", () => {
  it("scope 'this' changes only that occurrence and reports 1", () => {
    const third = occurrences()[2];
    const r = call("events-update", { id: seriesId, scope: "this", occurrenceKey: third.occurrenceStart, title: "Weekly sync — moved" });
    assert.equal(r.ok, true);
    assert.equal(r.result.occurrencesAffected, 1);
    const after = occurrences();
    assert.equal(after.length, 10);
    assert.equal(after[2].title, "Weekly sync — moved");
    assert.equal(after[1].title, "Weekly sync");
    assert.equal(after[3].title, "Weekly sync");
  });

  it("scope 'following' splits the series and PRESERVES the remaining count", () => {
    const fourth = occurrences()[3];
    const r = call("events-update", { id: seriesId, scope: "following", occurrenceKey: fourth.occurrenceStart, title: "Weekly sync v2" });
    assert.equal(r.ok, true);
    assert.equal(r.result.occurrencesAffected, 7);
    const after = call("events-list", RANGE).result.events
      .sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
    assert.equal(after.length, 10, "the split must not change the total occurrence count");
    assert.deepEqual(after.slice(0, 3).map((e) => e.title), ["Weekly sync", "Weekly sync", "Weekly sync"]);
    assert.ok(after.slice(3).every((e) => e.title === "Weekly sync v2"));
  });

  it("scope 'following' still preserves the count when the client re-sends the form rule", () => {
    const fourth = occurrences()[3];
    // The grid sends the whole form recurrence on save; without a count
    // in it, the split's remaining count must survive the rule replace.
    const r = call("events-update", {
      id: seriesId, scope: "following", occurrenceKey: fourth.occurrenceStart,
      title: "Weekly sync v2", recurrence: { freq: "weekly", interval: 1, count: null, until: null },
    });
    assert.equal(r.ok, true);
    const after = call("events-list", RANGE).result.events;
    assert.equal(after.length, 10);
  });

  it("scope 'all' changes every occurrence and reports the series size", () => {
    const r = call("events-update", { id: seriesId, scope: "all", title: "Weekly sync — renamed" });
    assert.equal(r.ok, true);
    assert.equal(r.result.occurrencesAffected, 10);
    assert.ok(occurrences().every((e) => e.title === "Weekly sync — renamed"));
  });

  it("a scoped edit without occurrenceKey is refused, not guessed", () => {
    assert.equal(call("events-update", { id: seriesId, scope: "this", title: "Nope" }).ok, false);
  });
});
