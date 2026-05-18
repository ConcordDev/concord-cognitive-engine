// server/tests/calendar-ai.test.js
//
// Tier-2 contract tests for the 8 Sprint B AI macros + focus blocks
// + auto-schedule settings. Exercises deterministic fallback paths +
// LLM happy path with a stub brain.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCalendarMacros from "../domains/calendar.js";
import registerCalendarAiMacros from "../domains/calendar-ai.js";
import { deterministicParseEvent } from "../lib/calendar/ai-helpers.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["217_calendar", "218_calendar_ai"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  registerCalendarMacros(register);
  registerCalendarAiMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId = "u_ai", llm = null) { return { db, actor: { userId }, llm }; }

describe("deterministicParseEvent", () => {
  it("extracts time + title from 'lunch with Sarah tomorrow 1pm'", () => {
    const now = new Date(Date.UTC(2026, 5, 1, 12, 0, 0)); // Mon
    const e = deterministicParseEvent("lunch with Sarah tomorrow 1pm", { now });
    assert.ok(e);
    assert.ok(e.title.toLowerCase().includes("lunch"));
    assert.equal(new Date(e.startAt * 1000).getUTCHours(), 13);
    assert.equal(new Date(e.startAt * 1000).getUTCDate(), 2);
  });

  it("recognises 'meeting Tuesday 3pm-4pm' as a 1h block", () => {
    const now = new Date(Date.UTC(2026, 5, 1, 12, 0, 0)); // Mon
    const e = deterministicParseEvent("meeting Tuesday 3pm-4pm", { now });
    assert.equal(new Date(e.startAt * 1000).getUTCDay(), 2);
    assert.equal(new Date(e.startAt * 1000).getUTCHours(), 15);
    assert.equal(e.endAt - e.startAt, 3600);
  });

  it("'for 30 minutes' shortens the duration", () => {
    const now = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
    const e = deterministicParseEvent("review tomorrow 10am for 30 minutes", { now });
    assert.equal(e.endAt - e.startAt, 30 * 60);
  });

  it("returns null for empty input", () => {
    assert.equal(deterministicParseEvent(""), null);
  });
});

describe("calendar-ai: fallback envelope shapes", () => {
  it("ai_parse_event uses deterministic fallback without LLM", async () => {
    const r = await MACROS.get("ai_parse_event")(ctx(), { text: "lunch with Bob Tuesday 1pm" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(r.event.startAt > 0);
  });

  it("ai_parse_event requires text", async () => {
    const r = await MACROS.get("ai_parse_event")(ctx(), {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "text_required");
  });

  it("ai_daily_ritual returns plan string without LLM", async () => {
    const r = await MACROS.get("ai_daily_ritual")(ctx());
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(r.plan.includes("Day plan"));
  });

  it("ai_chat returns canned reply without LLM", async () => {
    const r = await MACROS.get("ai_chat")(ctx(), { message: "what's next?" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(r.reply.toLowerCase().includes("calendar"));
  });

  it("ai_meeting_prep returns fallback briefing when no LLM", async () => {
    // Create a calendar + event first
    const cal = await MACROS.get("calendar_create")(ctx("u_prep"), { name: "Prep" });
    const evt = await MACROS.get("event_create")(ctx("u_prep"), {
      calendarId: cal.id, title: "Sync", startAt: 1_900_000_000, endAt: 1_900_003_600,
    });
    const r = await MACROS.get("ai_meeting_prep")(ctx("u_prep"), { eventId: evt.id });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(r.briefing.includes("Sync"));
  });

  it("ai_meeting_notes saves verbatim when no LLM", async () => {
    const cal = await MACROS.get("calendar_create")(ctx("u_notes"), { name: "Notes" });
    const evt = await MACROS.get("event_create")(ctx("u_notes"), {
      calendarId: cal.id, title: "Standup", startAt: 1_900_000_000, endAt: 1_900_003_600,
    });
    const r = await MACROS.get("ai_meeting_notes")(ctx("u_notes"), { eventId: evt.id, transcript: "We discussed the plan." });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(r.notes.includes("Standup"));
  });

  it("ai_voice_event creates an event from a transcript (deterministic)", async () => {
    await MACROS.get("calendar_create")(ctx("u_v"), { name: "Voice" });
    const r = await MACROS.get("ai_voice_event")(ctx("u_v"), { transcript: "coffee with Alex tomorrow 10am" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(r.event.startAt > 0);
    assert.ok(r.created?.id);
  });
});

describe("calendar-ai: auto_schedule", () => {
  it("fits tasks into free slots before deadline", async () => {
    const cal = await MACROS.get("calendar_create")(ctx("u_auto"), { name: "Auto" });
    const tomorrowTs = Math.floor(Date.now() / 1000) + 2 * 86400;
    const tasks = [
      { id: "t1", title: "Spec doc", estimate: 2, estimateUnit: "hours", dueAt: tomorrowTs + 86400, priority: "high" },
      { id: "t2", title: "Review PR", estimate: 1, estimateUnit: "hours", dueAt: tomorrowTs + 86400, priority: "medium" },
    ];
    const r = await MACROS.get("ai_auto_schedule")(ctx("u_auto"), {
      calendarId: cal.id, tasks, horizonDays: 7, commit: false,
    });
    assert.equal(r.ok, true);
    assert.ok(r.placed.length >= 1);
  });

  it("commits placed tasks as events when commit=true", async () => {
    const cal = await MACROS.get("calendar_create")(ctx("u_commit"), { name: "Commit" });
    // Include weekends so the scheduler doesn't skip days based on test-run date
    await MACROS.get("settings_update")(ctx("u_commit"), { includeWeekends: true });
    const tasks = [{ id: "tx", title: "Auto task", estimate: 1, estimateUnit: "hours", dueAt: Math.floor(Date.now()/1000) + 5*86400, priority: "high" }];
    const r = await MACROS.get("ai_auto_schedule")(ctx("u_commit"), {
      calendarId: cal.id, tasks, commit: true,
    });
    assert.equal(r.committed, true);
    assert.ok(r.placed.length >= 1, `expected at least 1 placed, got placed=${r.placed.length} skipped=${r.skipped.length}`);
    assert.ok(r.created.length >= 1);
  });

  it("returns no_tasks for empty input", async () => {
    const r = await MACROS.get("ai_auto_schedule")(ctx("u_empty"), { tasks: [] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_tasks");
  });
});

describe("calendar-ai: LLM happy path", () => {
  it("ai_parse_event uses LLM JSON output when available", async () => {
    const llm = { chat: async () => ({ content: '{"title":"LLM event","startAt":2000000000,"endAt":2000003600,"allDay":false}' }) };
    const r = await MACROS.get("ai_parse_event")({ db, actor: { userId: "u_llm" }, llm }, { text: "fake input" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "llm");
    assert.equal(r.event.title, "LLM event");
  });

  it("ai_meeting_notes summarizes via LLM when available", async () => {
    const cal = await MACROS.get("calendar_create")(ctx("u_llm_n"), { name: "L" });
    const evt = await MACROS.get("event_create")(ctx("u_llm_n"), {
      calendarId: cal.id, title: "Mtg", startAt: 1_900_000_000, endAt: 1_900_003_600,
    });
    const llm = { chat: async () => ({ content: "# Summary\nDiscussed plan.\n\n## Decisions\n- Ship it.\n\n## Action items\n- Alice owns deploy." }) };
    const r = await MACROS.get("ai_meeting_notes")({ db, actor: { userId: "u_llm_n" }, llm }, {
      eventId: evt.id, transcript: "long transcript here",
    });
    assert.equal(r.source, "llm");
    assert.ok(r.notes.includes("Decisions"));
  });
});

describe("calendar-ai: focus blocks + settings", () => {
  it("focus_block_create + list + delete round-trip", async () => {
    const c = await MACROS.get("focus_block_create")(ctx("u_fb"), {
      title: "Deep work", startMinute: 540, endMinute: 720, dayOfWeek: 1, kind: "focus",
    });
    assert.equal(c.ok, true);
    const list = await MACROS.get("focus_block_list")(ctx("u_fb"));
    assert.ok(list.blocks.find((b) => b.id === c.id));
    const d = await MACROS.get("focus_block_delete")(ctx("u_fb"), { id: c.id });
    assert.equal(d.ok, true);
  });

  it("settings_update + get round-trip", async () => {
    await MACROS.get("settings_update")(ctx("u_s"), {
      workStartHour: 8, workEndHour: 16, bufferMinutes: 10, includeWeekends: true,
    });
    const g = await MACROS.get("settings_get")(ctx("u_s"));
    assert.equal(g.settings.work_start_hour, 8);
    assert.equal(g.settings.include_weekends, 1);
  });
});

describe("calendar-ai: semantic_search", () => {
  it("ranks bigram matches across user's events", async () => {
    const cal = await MACROS.get("calendar_create")(ctx("u_sem"), { name: "Sem" });
    await MACROS.get("event_create")(ctx("u_sem"), { calendarId: cal.id, title: "Sprint review meeting", startAt: 1900000000, endAt: 1900003600 });
    await MACROS.get("event_create")(ctx("u_sem"), { calendarId: cal.id, title: "Cooking night", startAt: 1900100000, endAt: 1900103600 });
    const r = await MACROS.get("semantic_search")(ctx("u_sem"), { query: "sprint review" });
    assert.equal(r.ok, true);
    assert.ok(r.results.length >= 1);
    assert.ok(r.results[0].title.toLowerCase().includes("sprint"));
  });
});

describe("calendar-ai: run ledger", () => {
  it("ai_runs_recent returns rows after invocations", async () => {
    await MACROS.get("ai_parse_event")(ctx("u_led"), { text: "ledger test 1pm" });
    const r = await MACROS.get("ai_runs_recent")(ctx("u_led"));
    assert.ok(r.runs.length >= 1);
    assert.equal(r.runs[0].kind, "parse_event");
  });
});
