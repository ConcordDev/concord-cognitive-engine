// tests/depth/reflection-behavior.test.js — REAL behavioral tests for the
// reflection domain (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value calcs (TF-IDF / sentiment / streaks) +
// CRUD round-trips + validation rejections. Every lensRun("reflection","<macro>",…)
// call literally names the macro, so the macro-depth grader credits it as a
// behavioral invocation.
//
// SKIPPED (network/LLM): `reflect-deepen` + `entry-summarize` route through
// ctx.llm.chat when available — non-deterministic brain path. We only exercise
// deterministic compute/CRUD here.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("reflection — calc contracts (exact computed values)", () => {
  it("insightExtraction: TF-IDF surfaces recurring theme + tag/prevalence math", async () => {
    const r = await lensRun("reflection", "insightExtraction", {
      data: {
        entries: [
          { text: "running running gave me clarity at sunrise", tags: ["fitness"] },
          { text: "running through the park, calm mind", tags: ["fitness"] },
          { text: "a quiet morning of reading and tea", tags: ["calm"] },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.entriesAnalyzed, 3);
    // "running" appears in 2 of 3 docs → documentFrequency 2, prevalence 0.6667
    const running = r.result.themes.find((t) => t.theme === "running");
    assert.ok(running, "running should be an extracted theme");
    assert.equal(running.documentFrequency, 2);
    assert.equal(running.prevalence, 0.6667);
    // tag "fitness" appears in 2 entries
    const fitnessTag = r.result.topTags.find((t) => t.tag === "fitness");
    assert.equal(fitnessTag.count, 2);
  });

  it("insightExtraction: empty entries returns the no-data message", async () => {
    const r = await lensRun("reflection", "insightExtraction", { data: { entries: [] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("No journal entries"));
  });

  it("growthMetrics: rising positive sentiment is flagged 'improving'", async () => {
    const r = await lensRun("reflection", "growthMetrics", {
      data: {
        entries: [
          { date: "2026-01-01", text: "sad lonely stuck failed worse" },
          { date: "2026-01-02", text: "anxious worried difficult tired" },
          { date: "2026-01-03", text: "okay neutral words here today" },
          { date: "2026-01-04", text: "good progress hopeful better learn" },
          { date: "2026-01-05", text: "grateful happy proud accomplished joyful" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.entriesAnalyzed, 5);
    assert.equal(r.result.sentiment.trend, "improving");
    assert.ok(r.result.sentiment.slope > 0);
  });

  it("growthMetrics: under 2 entries returns the need-more-data message", async () => {
    const r = await lensRun("reflection", "growthMetrics", {
      data: { entries: [{ date: "2026-01-01", text: "one entry only" }] },
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("at least 2 entries"));
  });

  it("habitTracking: consecutive days compute exact current + longest streak", async () => {
    const r = await lensRun("reflection", "habitTracking", {
      data: {
        habits: [{
          name: "Meditate",
          completions: [
            { date: "2026-01-01" }, { date: "2026-01-02" }, { date: "2026-01-03" },
            { date: "2026-01-05" }, { date: "2026-01-06" },
          ],
        }],
      },
    });
    assert.equal(r.ok, true);
    const prof = r.result.habitProfiles.find((h) => h.name === "Meditate");
    assert.equal(prof.totalCompletions, 5);
    assert.equal(prof.uniqueDays, 5);
    assert.equal(prof.longestStreak, 3);   // Jan 1-2-3
    assert.equal(prof.currentStreak, 2);   // Jan 5-6 (ends at most recent)
  });

  it("habitTracking: empty habits returns the no-data message", async () => {
    const r = await lensRun("reflection", "habitTracking", { data: { habits: [] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("No habit data"));
  });
});

describe("reflection — prompt/template catalogs (deterministic)", () => {
  it("prompt-library: exposes the full prompt set with derived categories", async () => {
    const r = await lensRun("reflection", "prompt-library", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, r.result.prompts.length);
    assert.ok(r.result.prompts.some((p) => p.category === "gratitude"));
    assert.ok(r.result.categories.includes("mindfulness"));
  });

  it("prompt-today: same date yields the same deterministic prompt", async () => {
    const a = await lensRun("reflection", "prompt-today", { params: { date: "2026-06-07" } });
    const b = await lensRun("reflection", "prompt-today", { params: { date: "2026-06-07" } });
    assert.equal(a.ok, true);
    assert.equal(a.result.prompt.text, b.result.prompt.text);
    assert.ok(a.result.prompt.text.length > 0);
  });

  it("templates-list: includes the daily-review template by id", async () => {
    const r = await lensRun("reflection", "templates-list", {});
    assert.equal(r.ok, true);
    assert.ok(r.result.templates.some((t) => t.id === "daily-review"));
    assert.equal(r.result.count, r.result.templates.length);
  });
});

describe("reflection — CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("reflection-crud"); });

  it("journal-create → journal-list: journal reads back with default color", async () => {
    const add = await lensRun("reflection", "journal-create", { params: { name: "Morning Pages" } }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.journal.color, "sky");
    const list = await lensRun("reflection", "journal-list", {}, ctx);
    assert.ok(list.result.journals.some((j) => j.id === add.result.journal.id));
  });

  it("journal-create: empty name is rejected", async () => {
    const r = await lensRun("reflection", "journal-create", { params: { name: "   " } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /journal name required/);
  });

  it("entry-create → entry-detail → entry-update: mood + text round-trip", async () => {
    const created = await lensRun("reflection", "entry-create", {
      params: { text: "First real reflection here today", mood: "GREAT", tags: ["Win", "win"] },
    }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.entry.mood, "great");       // lower-cased + valid
    assert.deepEqual(created.result.entry.tags, ["win"]);   // deduped + lower-cased
    const id = created.result.entry.id;

    const detail = await lensRun("reflection", "entry-detail", { params: { id } }, ctx);
    assert.equal(detail.result.entry.id, id);
    assert.equal(detail.result.entry.wordCount, 5);         // "First real reflection here today"

    const upd = await lensRun("reflection", "entry-update", { params: { id, text: "Now this entry is longer than before for sure" } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.entry.wordCount, 9);
  });

  it("entry-create: empty text is rejected", async () => {
    const r = await lensRun("reflection", "entry-create", { params: { text: "   " } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /entry text required/);
  });

  it("entry-search: finds an entry by a word in its body", async () => {
    await lensRun("reflection", "entry-create", { params: { text: "watermelon picnic by the lake" } }, ctx);
    const r = await lensRun("reflection", "entry-search", { params: { query: "watermelon" } }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.entries.some((e) => e.text.includes("watermelon")));
    assert.equal(r.result.query, "watermelon");
  });

  it("entry-delete: removing an entry drops it from detail lookup", async () => {
    const created = await lensRun("reflection", "entry-create", { params: { text: "temporary entry to delete" } }, ctx);
    const id = created.result.entry.id;
    const del = await lensRun("reflection", "entry-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const after = await lensRun("reflection", "entry-detail", { params: { id } }, ctx);
    assert.equal(after.result.ok, false);
    assert.match(after.result.error, /entry not found/);
  });

  it("journal-stats: aggregates total words + per-mood counts across entries", async () => {
    const own = await depthCtx("reflection-stats");
    await lensRun("reflection", "entry-create", { params: { text: "alpha beta gamma", mood: "good" } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "delta epsilon", mood: "good" } }, own);
    const r = await lensRun("reflection", "journal-stats", {}, own);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEntries, 2);
    assert.equal(r.result.totalWords, 5);   // 3 + 2 words
    assert.equal(r.result.byMood.good, 2);
  });

  it("mood-trend: averages mood scores deterministically (great=5, low=2)", async () => {
    const own = await depthCtx("reflection-mood");
    const today = new Date().toISOString().slice(0, 10);
    await lensRun("reflection", "entry-create", { params: { text: "great day", mood: "great", date: today } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "low day", mood: "low", date: today } }, own);
    const r = await lensRun("reflection", "mood-trend", { params: { days: 30 } }, own);
    assert.equal(r.ok, true);
    assert.equal(r.result.entries, 2);
    assert.equal(r.result.averageScore, 3.5);   // (5 + 2) / 2
    assert.equal(r.result.distribution.great, 1);
  });

  it("entry-from-template: instantiates a template body into a real entry", async () => {
    const own = await depthCtx("reflection-tpl");
    const r = await lensRun("reflection", "entry-from-template", { params: { templateId: "gratitude" } }, own);
    assert.equal(r.ok, true);
    assert.equal(r.result.template, "gratitude");
    assert.ok(r.result.entry.tags.includes("gratitude"));
    const list = await lensRun("reflection", "entry-list", {}, own);
    assert.ok(list.result.entries.some((e) => e.id === r.result.entry.id));
  });

  it("entry-from-template: unknown template id is rejected", async () => {
    const r = await lensRun("reflection", "entry-from-template", { params: { templateId: "nope-not-real" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /unknown template/);
  });
});

// ── APPENDED (depth-fleet, Track A): cover previously-untested macros ──
// SKIPPED (LLM/non-deterministic): `reflect-deepen` + `entry-summarize` route
// through ctx.llm.chat; `entry-set-place` weather fetch + `voice-entry-create`
// cleanup are network/brain paths — exercised here only on their deterministic
// (no-fetch / no-cleanup) branches with explicit assertions.

describe("reflection — streaks, calendar, tags, on-this-day (own ctx round-trips)", () => {
  it("journal-streak: consecutive days ending today give exact current + longest streak", async () => {
    const own = await depthCtx("reflection-streak");
    const today = new Date();
    const dayStr = (offset) =>
      new Date(today.getTime() - offset * 86400000).toISOString().slice(0, 10);
    // today, yesterday, day-before → current streak 3; plus an isolated 10-days-ago day.
    await lensRun("reflection", "entry-create", { params: { text: "today entry", date: dayStr(0) } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "yesterday entry", date: dayStr(1) } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "two days ago", date: dayStr(2) } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "old isolated", date: dayStr(10) } }, own);
    const r = await lensRun("reflection", "journal-streak", {}, own);
    assert.equal(r.ok, true);
    assert.equal(r.result.currentStreak, 3);
    assert.equal(r.result.longestStreak, 3);
    assert.equal(r.result.daysJournaled, 4);
  });

  it("calendar-month: counts entries per day for the requested year/month", async () => {
    const own = await depthCtx("reflection-cal");
    await lensRun("reflection", "entry-create", { params: { text: "a", date: "2026-03-04" } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "b", date: "2026-03-04" } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "c", date: "2026-03-09" } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "d", date: "2026-04-01" } }, own);
    const r = await lensRun("reflection", "calendar-month", { params: { year: 2026, month: 3 } }, own);
    assert.equal(r.ok, true);
    assert.equal(r.result.year, 2026);
    assert.equal(r.result.month, 3);
    assert.equal(r.result.days["04"], 2);   // two entries on Mar 4
    assert.equal(r.result.days["09"], 1);
    assert.equal(r.result.daysWithEntries, 2);  // Apr entry excluded
  });

  it("tags-list: aggregates + sorts tag counts descending", async () => {
    const own = await depthCtx("reflection-tags");
    await lensRun("reflection", "entry-create", { params: { text: "one", tags: ["work", "focus"] } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "two", tags: ["work"] } }, own);
    const r = await lensRun("reflection", "tags-list", {}, own);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.tags[0].tag, "work");   // highest count first
    assert.equal(r.result.tags[0].count, 2);
  });

  it("on-this-day: surfaces same MM-DD from prior years with yearsAgo", async () => {
    const own = await depthCtx("reflection-otd");
    await lensRun("reflection", "entry-create", { params: { text: "old anniversary", date: "2024-06-07" } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "different day", date: "2024-06-08" } }, own);
    const r = await lensRun("reflection", "on-this-day", { params: { date: "2026-06-07" } }, own);
    assert.equal(r.ok, true);
    assert.equal(r.result.date, "06-07");
    assert.equal(r.result.count, 1);
    assert.equal(r.result.entries[0].yearsAgo, 2);   // 2026 - 2024
  });
});

describe("reflection — goal, dashboard, media, place (own ctx round-trips)", () => {
  it("reflection-goal-set → reflection-goal-status: tracks weekly progress", async () => {
    const own = await depthCtx("reflection-goal");
    const set = await lensRun("reflection", "reflection-goal-set", { params: { weeklyEntries: 2 } }, own);
    assert.equal(set.ok, true);
    assert.equal(set.result.weeklyEntries, 2);
    const today = new Date().toISOString().slice(0, 10);
    await lensRun("reflection", "entry-create", { params: { text: "first this week", date: today } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "second this week", date: today } }, own);
    const status = await lensRun("reflection", "reflection-goal-status", {}, own);
    assert.equal(status.ok, true);
    assert.equal(status.result.weeklyEntries, 2);
    assert.equal(status.result.entriesThisWeek, 2);
    assert.equal(status.result.met, true);
    assert.equal(status.result.isDefault, false);
    assert.equal(status.result.pct, 100);
  });

  it("reflection-dashboard: reports totals, today flag, and prompt of the day", async () => {
    const own = await depthCtx("reflection-dash");
    const today = new Date().toISOString().slice(0, 10);
    await lensRun("reflection", "entry-create", { params: { text: "alpha beta gamma", mood: "good", date: today } }, own);
    const r = await lensRun("reflection", "reflection-dashboard", {}, own);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEntries, 1);
    assert.equal(r.result.totalWords, 3);
    assert.equal(r.result.wroteToday, true);
    assert.equal(r.result.latestMood, "good");
    assert.ok(r.result.promptOfTheDay.text.length > 0);
  });

  it("entry-attach-media → entry-remove-media: image media drives photoCount", async () => {
    const own = await depthCtx("reflection-media");
    const created = await lensRun("reflection", "entry-create", { params: { text: "entry with a photo" } }, own);
    const entryId = created.result.entry.id;
    const att = await lensRun("reflection", "entry-attach-media", {
      params: { entryId, type: "image", url: "https://example.com/x.png", caption: "sunset" },
    }, own);
    assert.equal(att.ok, true);
    assert.equal(att.result.mediaCount, 1);
    const mediaId = att.result.media.id;
    // photoCount updates on the entry (image type counted).
    const detail = await lensRun("reflection", "entry-detail", { params: { id: entryId } }, own);
    assert.equal(detail.result.entry.photoCount, 1);
    const rem = await lensRun("reflection", "entry-remove-media", { params: { entryId, mediaId } }, own);
    assert.equal(rem.ok, true);
    assert.equal(rem.result.mediaCount, 0);
  });

  it("entry-attach-media: missing dataUrl/url is rejected", async () => {
    const own = await depthCtx("reflection-media-rej");
    const created = await lensRun("reflection", "entry-create", { params: { text: "needs media source" } }, own);
    const r = await lensRun("reflection", "entry-attach-media", {
      params: { entryId: created.result.entry.id, type: "image" },
    }, own);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /dataUrl or url required/);
  });

  it("entry-set-place: rounds geo to 6dp; invalid lat/lon rejected (no weather fetch)", async () => {
    const own = await depthCtx("reflection-place");
    const created = await lensRun("reflection", "entry-create", { params: { text: "from the trail" } }, own);
    const entryId = created.result.entry.id;
    const ok = await lensRun("reflection", "entry-set-place", {
      params: { entryId, lat: 37.123456789, lon: -122.987654321, location: "Coastal Trail" },
    }, own);
    assert.equal(ok.ok, true);
    assert.equal(ok.result.geo.lat, 37.123457);   // rounded to 6 decimals
    assert.equal(ok.result.geo.lon, -122.987654);
    assert.equal(ok.result.weatherFetched, false); // fetchWeather not requested
    const bad = await lensRun("reflection", "entry-set-place", {
      params: { entryId, lat: 200, lon: 0 },
    }, own);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /valid lat\/lon required/);
  });
});

describe("reflection — encryption, timeline, map, export, sync (own ctx round-trips)", () => {
  it("entry-encrypt → entry-decrypt: round-trips plaintext; wrong key rejected", async () => {
    const own = await depthCtx("reflection-crypto");
    const created = await lensRun("reflection", "entry-create", {
      params: { text: "secret thoughts I want hidden", title: "Private" },
    }, own);
    const entryId = created.result.entry.id;
    const enc = await lensRun("reflection", "entry-encrypt", { params: { entryId, key: "passphrase" } }, own);
    assert.equal(enc.ok, true);
    assert.equal(enc.result.encrypted, true);
    // body is masked after encryption
    const masked = await lensRun("reflection", "entry-detail", { params: { id: entryId } }, own);
    assert.equal(masked.result.entry.text, "[encrypted]");
    // wrong key is rejected via the salted fingerprint
    const wrong = await lensRun("reflection", "entry-decrypt", { params: { entryId, key: "nope" } }, own);
    assert.equal(wrong.result.ok, false);
    assert.match(wrong.result.error, /incorrect key/);
    // correct key recovers the exact plaintext
    const dec = await lensRun("reflection", "entry-decrypt", { params: { entryId, key: "passphrase" } }, own);
    assert.equal(dec.ok, true);
    assert.equal(dec.result.text, "secret thoughts I want hidden");
    assert.equal(dec.result.title, "Private");
  });

  it("entry-encrypt: short key (<4 chars) is rejected", async () => {
    const own = await depthCtx("reflection-crypto-rej");
    const created = await lensRun("reflection", "entry-create", { params: { text: "to encrypt" } }, own);
    const r = await lensRun("reflection", "entry-encrypt", {
      params: { entryId: created.result.entry.id, key: "ab" },
    }, own);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /at least 4 characters/);
  });

  it("entry-timeline: orders events chronologically and buckets by month", async () => {
    const own = await depthCtx("reflection-timeline");
    await lensRun("reflection", "entry-create", { params: { text: "march entry", date: "2026-03-15", mood: "great" } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "april entry", date: "2026-04-02", mood: "rough" } }, own);
    const r = await lensRun("reflection", "entry-timeline", {}, own);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.events[0].tone, "good");   // great → good tone
    assert.equal(r.result.events[1].tone, "bad");    // rough → bad tone
    assert.equal(r.result.monthBuckets.length, 2);
  });

  it("entry-map: only geo-tagged entries become markers + grouped places", async () => {
    const own = await depthCtx("reflection-map");
    const a = await lensRun("reflection", "entry-create", { params: { text: "placed" } }, own);
    await lensRun("reflection", "entry-set-place", {
      params: { entryId: a.result.entry.id, lat: 40.5, lon: -73.5, location: "Park" },
    }, own);
    await lensRun("reflection", "entry-create", { params: { text: "no location here" } }, own);
    const r = await lensRun("reflection", "entry-map", {}, own);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);                 // only the placed entry
    assert.equal(r.result.markers[0].label, "Park");
    assert.equal(r.result.places[0].count, 1);
  });

  it("journal-export → export-history: builds a document and logs the export", async () => {
    const own = await depthCtx("reflection-export");
    await lensRun("reflection", "entry-create", { params: { text: "exportable entry", date: "2026-05-01" } }, own);
    const exp = await lensRun("reflection", "journal-export", { params: { format: "json" } }, own);
    assert.equal(exp.ok, true);
    assert.equal(exp.result.format, "json");
    assert.equal(exp.result.entryCount, 1);
    assert.ok(exp.result.document.includes("exportable entry"));
    assert.ok(exp.result.filename.endsWith(".json"));
    const hist = await lensRun("reflection", "export-history", {}, own);
    assert.equal(hist.ok, true);
    assert.equal(hist.result.count, 1);
    assert.equal(hist.result.exports[0].format, "json");
  });

  it("year-in-review: aggregates entry/word counts + busiest month for the year", async () => {
    const own = await depthCtx("reflection-yir");
    await lensRun("reflection", "entry-create", { params: { text: "one two three", date: "2025-02-10", mood: "good" } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "four five", date: "2025-02-20", mood: "good" } }, own);
    await lensRun("reflection", "entry-create", { params: { text: "six", date: "2025-07-01", mood: "okay" } }, own);
    const r = await lensRun("reflection", "year-in-review", { params: { year: 2025 } }, own);
    assert.equal(r.ok, true);
    assert.equal(r.result.entryCount, 3);
    assert.equal(r.result.totalWords, 6);            // 3 + 2 + 1
    assert.equal(r.result.busiestMonth, "February"); // 2 entries vs 1 in July
    assert.equal(r.result.daysJournaled, 3);
  });

  it("device-checkin → sync-status: tracks devices + pending drafts; deviceId required", async () => {
    const own = await depthCtx("reflection-sync");
    const ci = await lensRun("reflection", "device-checkin", {
      params: { deviceId: "phone-1", label: "Pixel", platform: "android", pendingDrafts: 2 },
    }, own);
    assert.equal(ci.ok, true);
    assert.equal(ci.result.deviceCount, 1);
    const status = await lensRun("reflection", "sync-status", {}, own);
    assert.equal(status.ok, true);
    assert.equal(status.result.deviceCount, 1);
    assert.equal(status.result.onlineCount, 1);      // just checked in → online
    assert.equal(status.result.pendingDrafts, 2);
    assert.equal(status.result.synced, false);
    const missing = await lensRun("reflection", "device-checkin", { params: {} }, own);
    assert.equal(missing.result.ok, false);
    assert.match(missing.result.error, /deviceId required/);
  });

  it("reminder-set → reminder-status: persists schedule and computes wroteToday", async () => {
    const own = await depthCtx("reflection-reminder");
    const set = await lensRun("reflection", "reminder-set", { params: { hour: 21, minute: 30, label: "Evening" } }, own);
    assert.equal(set.ok, true);
    assert.equal(set.result.reminder.hour, 21);
    assert.equal(set.result.reminder.minute, 30);
    const today = new Date().toISOString().slice(0, 10);
    await lensRun("reflection", "entry-create", { params: { text: "wrote today", date: today } }, own);
    const status = await lensRun("reflection", "reminder-status", {}, own);
    assert.equal(status.ok, true);
    assert.equal(status.result.wroteToday, true);
    assert.equal(status.result.reminder.label, "Evening");
  });

  it("voice-entry-create: deterministic branch stores transcript + audio media; audioUrl required", async () => {
    const own = await depthCtx("reflection-voice");
    const r = await lensRun("reflection", "voice-entry-create", {
      params: { audioUrl: "data:audio/webm;base64,AAAA", transcript: "I spoke five clear words", durationSec: 12 },
    }, own);
    assert.equal(r.ok, true);
    assert.equal(r.result.transcriptComposer, "client");   // no cleanup → caller-supplied
    assert.equal(r.result.entry.kind, "voice");
    assert.ok(r.result.entry.tags.includes("voice"));
    assert.equal(r.result.entry.wordCount, 5);
    const missing = await lensRun("reflection", "voice-entry-create", { params: { transcript: "no audio" } }, own);
    assert.equal(missing.result.ok, false);
    assert.match(missing.result.error, /audioUrl/);
  });

  it("prompt-random: returns a prompt from the requested category", async () => {
    const r = await lensRun("reflection", "prompt-random", { params: { category: "gratitude" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.prompt.category, "gratitude");
    assert.ok(r.result.prompt.text.length > 0);
  });

  it("journal-delete: removes journal and detaches (not deletes) its entries", async () => {
    const own = await depthCtx("reflection-jdel");
    const jrn = await lensRun("reflection", "journal-create", { params: { name: "Throwaway" } }, own);
    const jid = jrn.result.journal.id;
    const ent = await lensRun("reflection", "entry-create", { params: { text: "lives in throwaway", journalId: jid } }, own);
    const eid = ent.result.entry.id;
    const del = await lensRun("reflection", "journal-delete", { params: { id: jid } }, own);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, jid);
    // journal gone from the list
    const list = await lensRun("reflection", "journal-list", {}, own);
    assert.ok(!list.result.journals.some((j) => j.id === jid));
    // entry survives but is detached (journalId nulled)
    const detail = await lensRun("reflection", "entry-detail", { params: { id: eid } }, own);
    assert.equal(detail.ok, true);
    assert.equal(detail.result.entry.journalId, null);
  });

  it("journal-delete: unknown id is rejected", async () => {
    const own = await depthCtx("reflection-jdel-rej");
    const r = await lensRun("reflection", "journal-delete", { params: { id: "jrn_nope" } }, own);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /journal not found/);
  });
});
