// Contract tests for the daily lens — Day One-shape journaling
// substrate in server/domains/daily.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDailyActions from "../domains/daily.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`daily.${name}`);
  assert.ok(fn, `daily.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerDailyActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const today = new Date().toISOString().slice(0, 10);

describe("daily.journal", () => {
  it("journal-list auto-seeds a default journal", () => {
    const r = call("journal-list", ctxA, {});
    assert.equal(r.result.count, 1);
    assert.equal(r.result.journals[0].name, "Journal");
  });
  it("journal-create adds a journal scoped per user", () => {
    call("journal-create", ctxA, { name: "Travel" });
    assert.equal(call("journal-list", ctxA, {}).result.count, 2);
    assert.equal(call("journal-list", ctxB, {}).result.count, 1); // just the default
  });
});

describe("daily.entry CRUD", () => {
  it("creates an entry with mood + tags and lists it", () => {
    const e = call("entry-create", ctxA, { body: "A good day at the coast.", mood: 4, tags: ["coast", "calm"] });
    assert.equal(e.ok, true);
    assert.equal(e.result.entry.mood, 4);
    assert.equal(e.result.entry.tags.length, 2);
    assert.equal(call("entry-list", ctxA, {}).result.count, 1);
  });
  it("rejects an empty entry and clamps mood", () => {
    assert.equal(call("entry-create", ctxA, { body: "" }).ok, false);
    const e = call("entry-create", ctxA, { body: "x", mood: 99 });
    assert.equal(e.result.entry.mood, 5);
  });
  it("updates and deletes an entry", () => {
    const e = call("entry-create", ctxA, { body: "draft" }).result.entry;
    call("entry-update", ctxA, { id: e.id, body: "revised", mood: 2 });
    assert.equal(call("entry-detail", ctxA, { id: e.id }).result.entry.body, "revised");
    call("entry-delete", ctxA, { id: e.id });
    assert.equal(call("entry-list", ctxA, {}).result.count, 0);
  });
  it("filters entries by tag", () => {
    call("entry-create", ctxA, { body: "one", tags: ["work"] });
    call("entry-create", ctxA, { body: "two", tags: ["rest"] });
    assert.equal(call("entry-list", ctxA, { tag: "work" }).result.count, 1);
  });
});

describe("daily.on-this-day", () => {
  it("surfaces same month-day entries from prior years", () => {
    const md = today.slice(5);
    call("entry-create", ctxA, { body: "last year", date: `2021-${md}` });
    call("entry-create", ctxA, { body: "today", date: today });
    const r = call("on-this-day", ctxA, {});
    assert.equal(r.result.count, 1);
    assert.equal(r.result.entries[0].body, "last year");
  });
});

describe("daily.search / mood-trend / dashboard", () => {
  it("entry-search matches body, title and tags", () => {
    call("entry-create", ctxA, { body: "hiking in the hills", tags: ["outdoors"] });
    assert.equal(call("entry-search", ctxA, { query: "hiking" }).result.count, 1);
    assert.equal(call("entry-search", ctxA, { query: "outdoors" }).result.count, 1);
  });
  it("mood-trend averages mood per date", () => {
    call("entry-create", ctxA, { body: "a", mood: 4, date: today });
    call("entry-create", ctxA, { body: "b", mood: 2, date: today });
    const r = call("mood-trend", ctxA, {});
    assert.equal(r.result.trend[0].avgMood, 3);
    assert.equal(r.result.averageMood, 3);
  });
  it("daily-dashboard counts entries and streak", () => {
    call("entry-create", ctxA, { body: "today's entry", date: today });
    const d = call("daily-dashboard", ctxA, {});
    assert.equal(d.result.totalEntries, 1);
    assert.equal(d.result.wroteToday, true);
    assert.equal(d.result.currentStreak, 1);
  });
  it("prompt-today returns a journaling prompt", () => {
    const r = call("prompt-today", ctxA, {});
    assert.ok(typeof r.result.prompt === "string" && r.result.prompt.length > 0);
  });
});

describe("daily — pure-compute helpers still intact", () => {
  it("habitStreak handles empty input", () => {
    const r = call("habitStreak", ctxA, {});
    assert.equal(r.ok, true);
  });
});
