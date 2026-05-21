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

// ─── Backlog: photo/media attachments per entry ─────────────────────────
describe("daily.entry media attachments", () => {
  it("entry-create stores media items and entry-update replaces them", () => {
    const e = call("entry-create", ctxA, {
      body: "trip photos",
      media: [{ kind: "image", url: "data:image/png;base64,AAAA", caption: "beach" }],
    });
    assert.equal(e.ok, true);
    assert.equal(e.result.entry.media.length, 1);
    assert.equal(e.result.entry.media[0].kind, "image");
    const u = call("entry-update", ctxA, {
      id: e.result.entry.id,
      media: [
        { kind: "image", url: "data:image/png;base64,BBBB", caption: "" },
        { kind: "link", url: "https://example.com", caption: "ref" },
      ],
    });
    assert.equal(u.result.entry.media.length, 2);
    assert.equal(u.result.entry.media[1].kind, "link");
  });
  it("entry-create drops media without a url", () => {
    const e = call("entry-create", ctxA, { body: "x", media: [{ kind: "image", caption: "no url" }] });
    assert.equal(e.result.entry.media.length, 0);
  });
});

// ─── Backlog: calendar / heatmap view ───────────────────────────────────
describe("daily.entry-heatmap", () => {
  it("builds a day-keyed grid with coverage and longest streak", () => {
    const md = today.slice(0, 8);
    call("entry-create", ctxA, { body: "d1", date: `${md}01` });
    const r = call("entry-heatmap", ctxA, { days: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.days, 60);
    assert.equal(r.result.cells.length, 60);
    assert.ok(r.result.coverage >= 0 && r.result.coverage <= 100);
  });
  it("clamps the window into the 7..366 range", () => {
    const r = call("entry-heatmap", ctxA, { days: 9999 });
    assert.ok(r.result.days <= 366);
  });
});

// ─── Backlog: habit builder + scheduled check-ins ───────────────────────
describe("daily.habit builder", () => {
  it("habit-create persists cadence + reminder and lists it", () => {
    const h = call("habit-create", ctxA, { name: "Walk", frequency: "weekdays", reminderTime: "08:30", cue: "after coffee" });
    assert.equal(h.ok, true);
    assert.equal(h.result.habit.frequency, "weekdays");
    assert.equal(h.result.habit.reminderTime, "08:30");
    const list = call("habit-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.habits[0].cue, "after coffee");
  });
  it("rejects a nameless habit", () => {
    assert.equal(call("habit-create", ctxA, { name: "" }).ok, false);
  });
  it("habit-checkin toggles today and bumps the streak", () => {
    const h = call("habit-create", ctxA, { name: "Read", frequency: "daily" }).result.habit;
    const on = call("habit-checkin", ctxA, { habitId: h.id });
    assert.equal(on.result.done, true);
    assert.equal(call("habit-list", ctxA, {}).result.habits[0].doneToday, true);
    const off = call("habit-checkin", ctxA, { habitId: h.id });
    assert.equal(off.result.done, false);
  });
  it("habit-update edits and habit-delete removes the habit + check-ins", () => {
    const h = call("habit-create", ctxA, { name: "Meditate" }).result.habit;
    call("habit-checkin", ctxA, { habitId: h.id });
    call("habit-update", ctxA, { id: h.id, name: "Meditate 10m", targetPerWeek: 5 });
    assert.equal(call("habit-list", ctxA, {}).result.habits[0].name, "Meditate 10m");
    call("habit-delete", ctxA, { id: h.id });
    assert.equal(call("habit-list", ctxA, {}).result.count, 0);
  });
});

// ─── Backlog: entry templates ───────────────────────────────────────────
describe("daily.templates-list", () => {
  it("returns the gratitude / reflection / goals templates", () => {
    const r = call("templates-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 3);
    const ids = r.result.templates.map((t) => t.id);
    assert.ok(ids.includes("gratitude") && ids.includes("reflection") && ids.includes("goals"));
  });
  it("a template-tagged entry records its template id", () => {
    const e = call("entry-create", ctxA, { body: "grateful", template: "gratitude" });
    assert.equal(e.result.entry.template, "gratitude");
  });
});

// ─── Backlog: tags + tag-based filtering ────────────────────────────────
describe("daily.tags-list", () => {
  it("aggregates tag counts across entries", () => {
    call("entry-create", ctxA, { body: "a", tags: ["work", "focus"] });
    call("entry-create", ctxA, { body: "b", tags: ["work"] });
    const r = call("tags-list", ctxA, {});
    assert.equal(r.ok, true);
    const work = r.result.tags.find((t) => t.tag === "work");
    assert.equal(work.count, 2);
    assert.equal(r.result.totalTagged, 2);
  });
});

// ─── Backlog: encrypted / private journal lock ──────────────────────────
describe("daily.journal lock", () => {
  it("lock-set then lock-verify gates with a passcode", () => {
    assert.equal(call("lock-status", ctxA, {}).result.locked, false);
    const set = call("lock-set", ctxA, { passcode: "1234", hint: "pin" });
    assert.equal(set.ok, true);
    assert.equal(call("lock-status", ctxA, {}).result.locked, true);
    assert.equal(call("lock-verify", ctxA, { passcode: "1234" }).result.unlocked, true);
    assert.equal(call("lock-verify", ctxA, { passcode: "0000" }).result.unlocked, false);
  });
  it("rejects a short passcode and requires current code to change", () => {
    assert.equal(call("lock-set", ctxA, { passcode: "12" }).ok, false);
    call("lock-set", ctxA, { passcode: "1234" });
    assert.equal(call("lock-set", ctxA, { passcode: "5678", currentPasscode: "wrong" }).ok, false);
    assert.equal(call("lock-set", ctxA, { passcode: "5678", currentPasscode: "1234" }).ok, true);
  });
  it("lock-remove clears the passcode", () => {
    call("lock-set", ctxA, { passcode: "abcd" });
    assert.equal(call("lock-remove", ctxA, { passcode: "wrong" }).ok, false);
    assert.equal(call("lock-remove", ctxA, { passcode: "abcd" }).ok, true);
    assert.equal(call("lock-status", ctxA, {}).result.locked, false);
  });
});

// ─── Backlog: export journal to Markdown archive ────────────────────────
describe("daily.export-archive", () => {
  it("produces a Markdown archive of the user's entries", () => {
    call("entry-create", ctxA, { body: "exported day", mood: 4, tags: ["export"], date: today });
    const r = call("export-archive", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "markdown");
    assert.equal(r.result.entryCount, 1);
    assert.ok(r.result.markdown.includes("# Journal Archive"));
    assert.ok(r.result.markdown.includes("exported day"));
    assert.ok(r.result.bytes > 0);
  });
  it("filters the archive by tag", () => {
    call("entry-create", ctxA, { body: "tagged", tags: ["keep"] });
    call("entry-create", ctxA, { body: "untagged", tags: [] });
    const r = call("export-archive", ctxA, { tag: "keep" });
    assert.equal(r.result.entryCount, 1);
  });
});
