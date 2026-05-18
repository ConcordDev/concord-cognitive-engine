// server/tests/calendar-moats.test.js
//
// Tier-2 contract tests for Sprint C: calendar-bound agents, event
// mint, cross-lens cite, booking links, project-bridge surfaces.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCalendarMacros from "../domains/calendar.js";
import registerCalendarAiMacros from "../domains/calendar-ai.js";
import registerCalendarMoatsMacros from "../domains/calendar-moats.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["217_calendar", "218_calendar_ai", "219_calendar_moats"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  // Minimal dtus table for mint paths
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT, creator_id TEXT,
      meta_json TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  registerCalendarMacros(register);
  registerCalendarAiMacros(register);
  registerCalendarMoatsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId, llm = null) { return { db, actor: { userId }, llm }; }

describe("calendar-moats: agents", () => {
  it("agent_create requires name + systemPrompt", async () => {
    const r = await MACROS.get("agent_create")(ctx("u_a"), { name: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "name_and_systemPrompt_required");
  });

  it("agent_create + list + delete round-trip", async () => {
    const c = await MACROS.get("agent_create")(ctx("u_a2"), { name: "Scheduler", systemPrompt: "You schedule meetings." });
    assert.equal(c.ok, true);
    const list = await MACROS.get("agent_list")(ctx("u_a2"));
    assert.ok(list.agents.find((a) => a.id === c.id));
    const d = await MACROS.get("agent_delete")(ctx("u_a2"), { id: c.id });
    assert.equal(d.ok, true);
  });

  it("agent_run injects event context per read_events capability", async () => {
    const c = await MACROS.get("agent_create")(ctx("u_aR"), { name: "Reader", systemPrompt: "Read events.", capabilities: ["read_events"] });
    let captured = "";
    const llm = { chat: async (req) => { captured = req.messages[0].content; return { content: "ok" }; } };
    await MACROS.get("agent_run")({ db, actor: { userId: "u_aR" }, llm }, { id: c.id, message: "summary" });
    assert.ok(captured.includes("Upcoming events"));
  });

  it("agent_publish mints agent_spec DTU + idempotent", async () => {
    const c = await MACROS.get("agent_create")(ctx("u_pub"), { name: "Pub", systemPrompt: "x" });
    const p = await MACROS.get("agent_publish")(ctx("u_pub"), { id: c.id });
    assert.equal(p.ok, true);
    assert.ok(p.dtuId.startsWith("agent_spec:"));
    const p2 = await MACROS.get("agent_publish")(ctx("u_pub"), { id: c.id });
    assert.equal(p2.alreadyPublished, true);
  });
});

describe("calendar-moats: event mint + cite", () => {
  let cal, evt;
  before(async () => {
    cal = await MACROS.get("calendar_create")(ctx("u_mint"), { name: "Mint cal" });
    evt = await MACROS.get("event_create")(ctx("u_mint"), {
      calendarId: cal.id, title: "Meeting", startAt: 1_900_000_000, endAt: 1_900_003_600,
    });
  });

  it("event_mint creates event_spec DTU + records mint", async () => {
    const r = await MACROS.get("event_mint")(ctx("u_mint"), { eventId: evt.id, royaltyRate: 0.15 });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId.startsWith("event_spec:"));
    assert.equal(r.royaltyRate, 0.15);
  });

  it("event_mint clamps royalty rate to 30% + is idempotent", async () => {
    const cal2 = await MACROS.get("calendar_create")(ctx("u_clamp"), { name: "C" });
    const e2 = await MACROS.get("event_create")(ctx("u_clamp"), { calendarId: cal2.id, title: "E", startAt: 1_900_000_000, endAt: 1_900_003_600 });
    const a = await MACROS.get("event_mint")(ctx("u_clamp"), { eventId: e2.id, royaltyRate: 0.99 });
    assert.equal(a.royaltyRate, 0.30);
    const b = await MACROS.get("event_mint")(ctx("u_clamp"), { eventId: e2.id });
    assert.equal(b.alreadyMinted, true);
    assert.equal(b.dtuId, a.dtuId);
  });

  it("event_cite_dtu requires mint first + degrades when engine absent", async () => {
    const cal3 = await MACROS.get("calendar_create")(ctx("u_cite"), { name: "C" });
    const e3 = await MACROS.get("event_create")(ctx("u_cite"), { calendarId: cal3.id, title: "E", startAt: 1, endAt: 2 });
    const unminted = await MACROS.get("event_cite_dtu")(ctx("u_cite"), { eventId: e3.id, dtuId: "dtu:fake" });
    assert.equal(unminted.ok, false);
    assert.equal(unminted.reason, "event_not_minted_yet");
    await MACROS.get("event_mint")(ctx("u_cite"), { eventId: e3.id });
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES (?, 'doc', 'P', 'u_other', '{}')`).run("dtu:p1");
    const r = await MACROS.get("event_cite_dtu")(ctx("u_cite"), { eventId: e3.id, dtuId: "dtu:p1" });
    assert.equal(r.ok, true);
    assert.ok(r.childDtuId);
  });
});

describe("calendar-moats: booking links (Calendly parity)", () => {
  let calId;
  before(async () => { calId = (await MACROS.get("calendar_create")(ctx("u_book"), { name: "Booking cal" })).id; });

  it("booking_link_create + list + get-by-slug", async () => {
    const c = await MACROS.get("booking_link_create")(ctx("u_book"), {
      title: "30-min intro", durationMinutes: 30, targetCalendarId: calId,
    });
    assert.equal(c.ok, true);
    assert.ok(c.slug);
    const list = await MACROS.get("booking_link_list")(ctx("u_book"));
    assert.ok(list.links.find((l) => l.id === c.id));
    const get = await MACROS.get("booking_link_get")(ctx(), { slug: c.slug });
    assert.equal(get.ok, true);
    assert.equal(get.link.duration_minutes, 30);
  });

  it("booking_link_slots returns available slots respecting working hours", async () => {
    const c = await MACROS.get("booking_link_create")(ctx("u_slots"), {
      title: "Slots", durationMinutes: 30,
      targetCalendarId: (await MACROS.get("calendar_create")(ctx("u_slots"), { name: "S" })).id,
      windowDaysAhead: 7, includeWeekends: true,
    });
    const r = await MACROS.get("booking_link_slots")(ctx(), { slug: c.slug });
    assert.equal(r.ok, true);
    assert.ok(r.slots.length > 0);
    assert.ok(r.slots.every((s) => s.endAt - s.startAt === 30 * 60));
  });

  it("booking_link_book creates an event + records the booking", async () => {
    const c = await MACROS.get("booking_link_create")(ctx("u_b"), {
      title: "Book me", durationMinutes: 30,
      targetCalendarId: (await MACROS.get("calendar_create")(ctx("u_b"), { name: "B" })).id,
      includeWeekends: true,
    });
    const slots = await MACROS.get("booking_link_slots")(ctx(), { slug: c.slug });
    assert.ok(slots.slots.length > 0);
    const slot = slots.slots[0];
    const r = await MACROS.get("booking_link_book")(ctx(), {
      slug: c.slug, startAt: slot.startAt,
      guestName: "Alice", guestEmail: "alice@external.com",
    });
    assert.equal(r.ok, true);
    assert.ok(r.bookingId);
    assert.ok(r.eventId);
    // Second booking on the same slot should fail
    const conflict = await MACROS.get("booking_link_book")(ctx(), {
      slug: c.slug, startAt: slot.startAt, guestEmail: "bob@external.com",
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.reason, "slot_taken");
  });

  it("booking_link_get returns not_found for unknown slug", async () => {
    const r = await MACROS.get("booking_link_get")(ctx(), { slug: "does-not-exist" });
    assert.equal(r.ok, false);
  });
});

describe("calendar-moats: project bridge", () => {
  it("bridge_tasks returns empty when tasks table is absent", async () => {
    // Tasks table doesn't exist in this test DB
    const r = await MACROS.get("bridge_tasks")(ctx("u_br"));
    assert.equal(r.ok, true);
    assert.deepEqual(r.events, []);
  });

  it("bridge_sprints handles missing sprint schema gracefully", async () => {
    const r = await MACROS.get("bridge_sprints")(ctx("u_br"));
    assert.equal(r.ok, true);
    assert.deepEqual(r.events, []);
  });

  it("bridge_world_events handles missing world_events schema gracefully", async () => {
    const r = await MACROS.get("bridge_world_events")(ctx("u_br"));
    assert.equal(r.ok, true);
    assert.deepEqual(r.events, []);
  });

  it("bridge_tasks surfaces real task rows when tasks table exists", async () => {
    // Create a minimal tasks table for this test
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, task_key TEXT, title TEXT, priority TEXT,
        due_at INTEGER, project_id TEXT, assignee_id TEXT, deleted_at INTEGER
      )
    `);
    const dueAt = Math.floor(Date.now() / 1000) + 86400;
    db.prepare(`INSERT INTO tasks (id, task_key, title, priority, due_at, project_id, assignee_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("task:b1", "BR-1", "Real task", "urgent", dueAt, "proj:1", "u_brT");
    const r = await MACROS.get("bridge_tasks")(ctx("u_brT"));
    assert.equal(r.ok, true);
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].kind, "task_due");
    assert.equal(r.events[0].color, "#ef4444"); // urgent → red
  });
});
