// Contract tests for the reflection Day One 2026-parity journaling
// macros (journals, entries, On This Day, streaks, prompts, templates,
// tags, calendar, mood trend, reflection AI, goals, dashboard).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerReflectionActions from "../domains/reflection.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`reflection.${name}`);
  assert.ok(fn, `reflection.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerReflectionActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const today = () => new Date().toISOString().slice(0, 10);
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe("reflection.journal-*", () => {
  it("creates, lists with entry counts, deletes detaching entries", () => {
    const j = call("journal-create", ctxA, { name: "Morning pages", color: "amber" });
    assert.ok(j.result.journal.id);
    call("entry-create", ctxA, { journalId: j.result.journal.id, text: "first" });
    let list = call("journal-list", ctxA, {});
    assert.equal(list.result.journals.length, 1);
    assert.equal(list.result.journals[0].entryCount, 1);

    const del = call("journal-delete", ctxA, { id: j.result.journal.id });
    assert.equal(del.result.deleted, j.result.journal.id);
    list = call("journal-list", ctxA, {});
    assert.equal(list.result.journals.length, 0);
    // entry survives, journalId detached
    const entries = call("entry-list", ctxA, {});
    assert.equal(entries.result.entries.length, 1);
    assert.equal(entries.result.entries[0].journalId, null);
  });

  it("rejects an empty journal name", () => {
    const r = call("journal-create", ctxA, { name: "   " });
    assert.equal(r.ok, false);
  });
});

describe("reflection.entry-*", () => {
  it("creates an entry with mood/tags/weather and computes word count", () => {
    const r = call("entry-create", ctxA, {
      text: "Today was a calm and steady day", mood: "good",
      tags: ["Calm", "calm", "work"], weather: "sunny", photoCount: 2,
    });
    assert.equal(r.result.entry.mood, "good");
    assert.deepEqual(r.result.entry.tags, ["calm", "work"]);
    assert.equal(r.result.entry.weather, "sunny");
    assert.equal(r.result.entry.wordCount, 7);
  });

  it("rejects an empty entry", () => {
    assert.equal(call("entry-create", ctxA, { text: "" }).ok, false);
  });

  it("updates and deletes an entry", () => {
    const c = call("entry-create", ctxA, { text: "draft", mood: "low" });
    const id = c.result.entry.id;
    const u = call("entry-update", ctxA, { id, text: "revised text here", mood: "great" });
    assert.equal(u.result.entry.mood, "great");
    assert.equal(u.result.entry.wordCount, 3);
    assert.equal(call("entry-delete", ctxA, { id }).result.deleted, id);
    assert.equal(call("entry-detail", ctxA, { id }).ok, false);
  });

  it("searches entry text, title and tags", () => {
    call("entry-create", ctxA, { text: "a quiet walk by the river", tags: ["nature"] });
    call("entry-create", ctxA, { text: "busy day at the office" });
    assert.equal(call("entry-search", ctxA, { query: "river" }).result.count, 1);
    assert.equal(call("entry-search", ctxA, { query: "nature" }).result.count, 1);
    assert.equal(call("entry-search", ctxA, { query: "zzz" }).result.count, 0);
  });

  it("isolates entries per user", () => {
    call("entry-create", ctxA, { text: "mine" });
    assert.equal(call("entry-list", ctxB, {}).result.count, 0);
  });
});

describe("reflection.on-this-day", () => {
  it("returns same-month-day entries from prior years with yearsAgo", () => {
    const t = today();
    call("entry-create", ctxA, { text: "this year", date: t });
    call("entry-create", ctxA, { text: "two years ago", date: `${Number(t.slice(0, 4)) - 2}${t.slice(4)}` });
    const r = call("on-this-day", ctxA, { date: t });
    assert.equal(r.result.count, 1);
    assert.equal(r.result.entries[0].yearsAgo, 2);
  });
});

describe("reflection.journal-streak / stats", () => {
  it("counts consecutive-day streaks and longest run", () => {
    call("entry-create", ctxA, { text: "d0", date: today() });
    call("entry-create", ctxA, { text: "d1", date: dayOffset(-1) });
    call("entry-create", ctxA, { text: "d2", date: dayOffset(-2) });
    call("entry-create", ctxA, { text: "gap", date: dayOffset(-5) });
    const r = call("journal-streak", ctxA, {});
    assert.equal(r.result.currentStreak, 3);
    assert.equal(r.result.longestStreak, 3);
  });

  it("aggregates words, photos and mood distribution", () => {
    call("entry-create", ctxA, { text: "one two three", mood: "good", photoCount: 1 });
    call("entry-create", ctxA, { text: "four five", mood: "good" });
    const r = call("journal-stats", ctxA, {});
    assert.equal(r.result.totalEntries, 2);
    assert.equal(r.result.totalWords, 5);
    assert.equal(r.result.totalPhotos, 1);
    assert.equal(r.result.byMood.good, 2);
  });
});

describe("reflection.prompt-*", () => {
  it("prompt-today is deterministic for a given date", () => {
    const a = call("prompt-today", ctxA, { date: "2026-05-20" });
    const b = call("prompt-today", ctxA, { date: "2026-05-20" });
    assert.equal(a.result.prompt.text, b.result.prompt.text);
  });

  it("prompt-library lists categories and prompts", () => {
    const r = call("prompt-library", ctxA, {});
    assert.ok(r.result.count > 10);
    assert.ok(r.result.categories.includes("gratitude"));
  });

  it("prompt-random honours a category filter", () => {
    const r = call("prompt-random", ctxA, { category: "gratitude" });
    assert.equal(r.result.prompt.category, "gratitude");
  });
});

describe("reflection.templates", () => {
  it("lists templates and seeds an entry from one", () => {
    const list = call("templates-list", ctxA, {});
    assert.ok(list.result.count >= 5);
    const r = call("entry-from-template", ctxA, { templateId: "gratitude" });
    assert.equal(r.result.template, "gratitude");
    assert.ok(r.result.entry.text.length > 0);
    assert.equal(call("entry-list", ctxA, {}).result.count, 1);
  });

  it("rejects an unknown template", () => {
    assert.equal(call("entry-from-template", ctxA, { templateId: "nope" }).ok, false);
  });
});

describe("reflection.tags-list / calendar-month / mood-trend", () => {
  it("counts tags across entries", () => {
    call("entry-create", ctxA, { text: "a", tags: ["work", "calm"] });
    call("entry-create", ctxA, { text: "b", tags: ["work"] });
    const r = call("tags-list", ctxA, {});
    assert.equal(r.result.tags[0].tag, "work");
    assert.equal(r.result.tags[0].count, 2);
  });

  it("calendar-month buckets entry counts by day", () => {
    call("entry-create", ctxA, { text: "x", date: "2026-03-04" });
    call("entry-create", ctxA, { text: "y", date: "2026-03-04" });
    call("entry-create", ctxA, { text: "z", date: "2026-03-11" });
    const r = call("calendar-month", ctxA, { year: 2026, month: 3 });
    assert.equal(r.result.days["04"], 2);
    assert.equal(r.result.daysWithEntries, 2);
  });

  it("mood-trend averages a numeric mood score", () => {
    call("entry-create", ctxA, { text: "a", mood: "great" });
    call("entry-create", ctxA, { text: "b", mood: "okay" });
    const r = call("mood-trend", ctxA, { days: 30 });
    assert.equal(r.result.entries, 2);
    assert.equal(r.result.averageScore, 4);
  });
});

describe("reflection AI helpers", () => {
  it("reflect-deepen falls back to deterministic questions", async () => {
    const c = call("entry-create", ctxA, { text: "I felt overwhelmed at work today." });
    const r = await call("reflect-deepen", ctxA, { id: c.result.entry.id });
    assert.equal(r.result.composer, "deterministic");
    assert.equal(r.result.questions.length, 3);
  });

  it("entry-summarize falls back to deterministic summary", async () => {
    const c = call("entry-create", ctxA, { text: "First sentence here. Second sentence too. Third one." });
    const r = await call("entry-summarize", ctxA, { id: c.result.entry.id });
    assert.equal(r.result.composer, "deterministic");
    assert.ok(r.result.summary.length > 0);
  });
});

describe("reflection.goal & dashboard", () => {
  it("sets a weekly goal and reports progress", () => {
    call("reflection-goal-set", ctxA, { weeklyEntries: 3 });
    call("entry-create", ctxA, { text: "a" });
    call("entry-create", ctxA, { text: "b" });
    const r = call("reflection-goal-status", ctxA, {});
    assert.equal(r.result.weeklyEntries, 3);
    assert.equal(r.result.entriesThisWeek, 2);
    assert.equal(r.result.met, false);
  });

  it("dashboard reports streak, totals and wroteToday", () => {
    call("entry-create", ctxA, { text: "hello world today", mood: "good", date: today() });
    const r = call("reflection-dashboard", ctxA, {});
    assert.equal(r.result.totalEntries, 1);
    assert.equal(r.result.currentStreak, 1);
    assert.equal(r.result.wroteToday, true);
    assert.equal(r.result.latestMood, "good");
    assert.ok(r.result.promptOfTheDay.text);
  });
});

// ─── Day One parity backlog ───────────────────────────────────────────

describe("reflection.entry media", () => {
  it("attaches and removes rich media on an entry", () => {
    const c = call("entry-create", ctxA, { text: "a day at the beach" });
    const id = c.result.entry.id;
    const m = call("entry-attach-media", ctxA, {
      entryId: id, type: "image", dataUrl: "data:image/png;base64,AAAA", caption: "sunset", bytes: 4,
    });
    assert.ok(m.result.media.id);
    assert.equal(m.result.mediaCount, 1);
    assert.equal(call("entry-detail", ctxA, { id }).result.entry.photoCount, 1);
    const rm = call("entry-remove-media", ctxA, { entryId: id, mediaId: m.result.media.id });
    assert.equal(rm.result.mediaCount, 0);
  });

  it("rejects media with no payload and bad type", () => {
    const c = call("entry-create", ctxA, { text: "x" });
    assert.equal(call("entry-attach-media", ctxA, { entryId: c.result.entry.id, type: "image" }).ok, false);
    assert.equal(call("entry-attach-media", ctxA, { entryId: c.result.entry.id, type: "nope", url: "u" }).ok, false);
  });

  it("sets geo place on an entry", async () => {
    const c = call("entry-create", ctxA, { text: "trip" });
    const r = await call("entry-set-place", ctxA, { entryId: c.result.entry.id, lat: 40.7, lon: -74.0, location: "NYC" });
    assert.equal(r.result.geo.lat, 40.7);
    assert.equal(r.result.geo.lon, -74);
  });

  it("rejects invalid coordinates", async () => {
    const c = call("entry-create", ctxA, { text: "trip" });
    const r = await call("entry-set-place", ctxA, { entryId: c.result.entry.id, lat: 999, lon: 0 });
    assert.equal(r.ok, false);
  });
});

describe("reflection.reminder-*", () => {
  it("sets a reminder and reports next due time", () => {
    const set = call("reminder-set", ctxA, { hour: 20, minute: 30 });
    assert.equal(set.result.reminder.hour, 20);
    const st = call("reminder-status", ctxA, {});
    assert.equal(st.result.reminder.minute, 30);
    assert.equal(typeof st.result.wroteToday, "boolean");
  });

  it("defaults to all seven days when none given", () => {
    const set = call("reminder-set", ctxA, {});
    assert.equal(set.result.reminder.days.length, 7);
  });
});

describe("reflection encryption", () => {
  it("encrypts and decrypts an entry round-trip", () => {
    const c = call("entry-create", ctxA, { text: "a private secret", title: "hidden" });
    const id = c.result.entry.id;
    const enc = call("entry-encrypt", ctxA, { entryId: id, key: "passphrase" });
    assert.equal(enc.result.encrypted, true);
    assert.equal(call("entry-detail", ctxA, { id }).result.entry.text, "[encrypted]");
    const dec = call("entry-decrypt", ctxA, { entryId: id, key: "passphrase" });
    assert.equal(dec.result.text, "a private secret");
    assert.equal(dec.result.title, "hidden");
  });

  it("rejects a wrong decryption key", () => {
    const c = call("entry-create", ctxA, { text: "secret data here" });
    call("entry-encrypt", ctxA, { entryId: c.result.entry.id, key: "rightkey" });
    assert.equal(call("entry-decrypt", ctxA, { entryId: c.result.entry.id, key: "wrongkey" }).ok, false);
  });

  it("rejects a too-short key", () => {
    const c = call("entry-create", ctxA, { text: "x y z" });
    assert.equal(call("entry-encrypt", ctxA, { entryId: c.result.entry.id, key: "ab" }).ok, false);
  });
});

describe("reflection.entry-timeline / entry-map", () => {
  it("builds a chronological timeline with mood tone", () => {
    call("entry-create", ctxA, { text: "good day", mood: "great", date: dayOffset(-1) });
    call("entry-create", ctxA, { text: "hard day", mood: "rough", date: today() });
    const r = call("entry-timeline", ctxA, {});
    assert.equal(r.result.count, 2);
    assert.equal(r.result.events[0].tone, "good");
    assert.equal(r.result.events[1].tone, "bad");
  });

  it("returns only geotagged entries on the map", async () => {
    const c1 = call("entry-create", ctxA, { text: "placed" });
    await call("entry-set-place", ctxA, { entryId: c1.result.entry.id, lat: 51.5, lon: -0.12, location: "London" });
    call("entry-create", ctxA, { text: "no place" });
    const r = call("entry-map", ctxA, {});
    assert.equal(r.result.count, 1);
    assert.equal(r.result.markers[0].label, "London");
    assert.equal(r.result.places[0].count, 1);
  });
});

describe("reflection.voice-entry-create", () => {
  it("creates a voice entry with a transcript", async () => {
    const r = await call("voice-entry-create", ctxA, {
      audioUrl: "data:audio/webm;base64,AAAA", transcript: "I spoke this aloud", durationSec: 42,
    });
    assert.equal(r.result.entry.kind, "voice");
    assert.equal(r.result.entry.media.length, 1);
    assert.equal(r.result.entry.media[0].type, "audio");
    assert.ok(r.result.entry.tags.includes("voice"));
  });

  it("rejects a voice entry with no recording", async () => {
    assert.equal((await call("voice-entry-create", ctxA, { transcript: "no audio" })).ok, false);
  });
});

describe("reflection.year-in-review / export", () => {
  it("aggregates a year of entries", () => {
    const y = new Date().getUTCFullYear();
    call("entry-create", ctxA, { text: "one two three four", mood: "good", date: `${y}-01-05` });
    call("entry-create", ctxA, { text: "five six", mood: "great", date: `${y}-02-08` });
    const r = call("year-in-review", ctxA, { year: y });
    assert.equal(r.result.entryCount, 2);
    assert.equal(r.result.totalWords, 6);
    assert.ok(r.result.moodAverage > 0);
  });

  it("exports entries as a markdown document", () => {
    call("entry-create", ctxA, { text: "exported content", title: "Day", date: today() });
    const r = call("journal-export", ctxA, { format: "markdown" });
    assert.equal(r.result.format, "markdown");
    assert.ok(r.result.document.includes("exported content"));
    assert.ok(r.result.filename.endsWith(".md"));
    const hist = call("export-history", ctxA, {});
    assert.equal(hist.result.count, 1);
  });

  it("exports as JSON", () => {
    call("entry-create", ctxA, { text: "json me", date: today() });
    const r = call("journal-export", ctxA, { format: "json" });
    const parsed = JSON.parse(r.result.document);
    assert.equal(parsed.entryCount, 1);
  });
});

describe("reflection.sync-status", () => {
  it("tracks device check-ins and pending drafts", () => {
    call("device-checkin", ctxA, { deviceId: "phone-1", label: "iPhone", pendingDrafts: 2 });
    call("device-checkin", ctxA, { deviceId: "laptop-1", label: "MacBook", pendingDrafts: 0 });
    const r = call("sync-status", ctxA, {});
    assert.equal(r.result.deviceCount, 2);
    assert.equal(r.result.pendingDrafts, 2);
    assert.equal(r.result.synced, false);
    assert.equal(r.result.onlineCount, 2);
  });

  it("rejects a check-in with no deviceId", () => {
    assert.equal(call("device-checkin", ctxA, {}).ok, false);
  });
});
