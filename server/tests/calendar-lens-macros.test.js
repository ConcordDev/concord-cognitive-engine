// Phase-2 behavioral macro tests for server/domains/calendar.js — the
// Google-Calendar / Fantastical-shaped substrate the /lenses/calendar lens
// drives via lensRun('calendar', …).
//
// REGISTRY NOTE (verified 2026-06-27): every calendar macro the lens calls is
// served by LENS_ACTIONS (PATH 3 — `registerLensAction("calendar", action,
// (ctx, artifact, params) => …)` in server/domains/calendar.js, wired through
// domains/index.js → server.js domainModules.forEach). The five INLINE
// server.js blocks (schedule / remind / plan_day / plan_week /
// resolve_conflicts) ALSO use `registerLensAction` (server.js:40252-40291), so
// they are LENS_ACTIONS too — there is NO MACROS-path `register("calendar",…)`
// block. `/api/lens/run` resolves these via LENS_ACTIONS.get(`calendar.${name}`)
// at server.js:39155; `runMacro` does NOT reach LENS_ACTIONS, so the
// macro-assassin (which drives runMacro) never touches these handlers — this
// file is the real behavioral verification.
//
// This file mirrors the LIVE LENS_ACTIONS dispatch: handlers are invoked as
// `handler(ctx, virtualArtifact, input)` — the 3-ARG convention, with
// virtualArtifact.data carrying the action-panel artifact payload and `input`
// as the 3rd `params` argument (server.js:39150 shape).
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed
// values (event CRUD round-trips, scheduleOptimize ordering/blocks/totals,
// conflict + recurrence math, appointment slot generation), per-user
// isolation, validation-rejection, degrade-graceful (STATE unavailable),
// fail-CLOSED poisoned input, and the connector macros' network-free
// validation-rejection paths (NO network call).
//
// Complements (does NOT duplicate) server/tests/calendar-domain-parity.test.js,
// which covers ical-export/parse, timezone-convert, calendars/events CRUD shape,
// availability-find, tasks, nl-parse-event, dashboard, sharing, reminders,
// status events, conferences, and invites. The gaps closed here are: the four
// action-panel verbs (detectConflicts/findAvailability/expandRecurring/
// scheduleOptimize), the connector macros, isolation across the core
// event/calendar maps, poisoned-input fail-closed, and degrade-graceful.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerCalendarActions from "../domains/calendar.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "calendar", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the live LENS_ACTIONS dispatch: handler(ctx, virtualArtifact, input).
// `artifactData` populates virtualArtifact.data (the action-panel payload the
// page passes as the artifact's data — e.g. detectConflicts reads
// artifact.data.events). `input` is the 3rd params argument lensRun passes.
function call(name, ctx, input = {}, artifactData = null) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`calendar.${name} not registered`);
  const virtualArtifact = {
    id: null,
    domain: "calendar",
    type: "domain_action",
    data: artifactData != null ? artifactData : (input || {}),
    meta: {},
  };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerCalendarActions(registerLensAction); });
// Hermetic: a fresh in-memory STATE per test so per-user maps never bleed
// across cases. No boot, no DB, no network, no LLM.
beforeEach(() => { globalThis._concordSTATE = {}; });
afterEach(() => { delete globalThis._concordSTATE; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// ─────────────────────────────────────────────────────────────────────────────
describe("calendar — registration (every lens-driven macro present)", () => {
  it("registers every macro the page + components call via lensRun", () => {
    // Exact set grepped from app/lenses/calendar/page.tsx + components/calendar/
    for (const m of [
      // action-panel verbs (useRunArtifact → POST /api/lens/run … action)
      "detectConflicts", "findAvailability", "expandRecurring", "scheduleOptimize",
      // AppointmentSchedules.tsx
      "appointment-schedule-list", "appointment-slots", "appointment-bookings",
      "appointment-schedule-create", "appointment-schedule-delete",
      "appointment-book", "appointment-cancel-booking",
      // CalendarParityHub.tsx
      "accounts-connect", "accounts-disconnect", "calendar-share", "calendar-unshare",
      "reminders-acknowledge", "status-event-create", "conference-generate",
      "conference-clear", "invites-send", "invite-rsvp", "invite-revoke",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing calendar.${m}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Action-panel verb: detectConflicts (artifact.data.events) — NOT in parity
// test's coverage of the overlap-minute math edge cases.
describe("calendar.detectConflicts — overlap math + guards", () => {
  it("computes exact overlap minutes for two overlapping events", () => {
    const events = [
      { title: "A", start: "2026-06-01T10:00:00Z", end: "2026-06-01T11:00:00Z" },
      { title: "B", start: "2026-06-01T10:30:00Z", end: "2026-06-01T12:00:00Z" },
    ];
    const r = call("detectConflicts", ctxA, {}, { events });
    assert.equal(r.ok, true);
    assert.equal(r.result.conflictCount, 1);
    assert.equal(r.result.conflictFree, false);
    // overlap = min(11:00,12:00) − B.start(10:30) = 30 minutes
    assert.equal(r.result.conflicts[0].overlapMinutes, 30);
    assert.equal(r.result.totalEvents, 2);
  });

  it("touching boundaries (end == start) do NOT count as a conflict", () => {
    const events = [
      { title: "A", start: "2026-06-01T10:00:00Z", end: "2026-06-01T11:00:00Z" },
      { title: "B", start: "2026-06-01T11:00:00Z", end: "2026-06-01T12:00:00Z" },
    ];
    const r = call("detectConflicts", ctxA, {}, { events });
    assert.equal(r.ok, true);
    assert.equal(r.result.conflictCount, 0);
    assert.equal(r.result.conflictFree, true);
  });

  it("needs ≥2 events — returns a guidance message for 0/1", () => {
    const r0 = call("detectConflicts", ctxA, {}, { events: [] });
    assert.equal(r0.ok, true);
    assert.match(r0.result.message, /at least 2 events/i);
    const r1 = call("detectConflicts", ctxA, {}, { events: [{ title: "lonely", start: "2026-06-01T10:00:00Z" }] });
    assert.match(r1.result.message, /at least 2 events/i);
  });

  it("defaults a missing end to start+1h before testing overlap", () => {
    // A has no end → treated as 10:00–11:00; B starts 10:30 → overlap 30m.
    const events = [
      { title: "A", start: "2026-06-01T10:00:00Z" },
      { title: "B", start: "2026-06-01T10:30:00Z", end: "2026-06-01T10:45:00Z" },
    ];
    const r = call("detectConflicts", ctxA, {}, { events });
    assert.equal(r.result.conflictCount, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Action-panel verb: findAvailability (artifact.data) — NOT in parity test
// (which exercises the STATE-backed `availability-find`, a different macro).
describe("calendar.findAvailability — free-slot gaps in a work window", () => {
  it("finds the morning + afternoon gaps around a midday meeting", () => {
    const data = {
      date: "2026-06-01",
      workStartHour: 9,
      workEndHour: 17,
      slotMinutes: 30,
      events: [
        { start: "2026-06-01T12:00:00", end: "2026-06-01T13:00:00" },
      ],
    };
    const r = call("findAvailability", ctxA, {}, data);
    assert.equal(r.ok, true);
    assert.equal(r.result.eventsToday, 1);
    // gap1: 09:00–12:00 (180m), gap2: 13:00–17:00 (240m) → 420m total free
    assert.equal(r.result.availableSlots.length, 2);
    assert.equal(r.result.totalFreeMinutes, 420);
    assert.equal(r.result.availableSlots[0].minutes, 180);
    assert.equal(r.result.availableSlots[1].minutes, 240);
  });

  it("a fully-free workday is one big slot", () => {
    const r = call("findAvailability", ctxA, {}, { date: "2026-06-02", workStartHour: 9, workEndHour: 17, events: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.availableSlots.length, 1);
    assert.equal(r.result.totalFreeMinutes, 480);
  });

  it("a gap narrower than slotMinutes is not offered", () => {
    // Two meetings 20 minutes apart with a 30-minute minimum slot → no inner gap.
    const data = {
      date: "2026-06-03", workStartHour: 9, workEndHour: 11, slotMinutes: 30,
      events: [
        { start: "2026-06-03T09:00:00", end: "2026-06-03T09:40:00" },
        { start: "2026-06-03T10:00:00", end: "2026-06-03T11:00:00" },
      ],
    };
    const r = call("findAvailability", ctxA, {}, data);
    // The 09:40–10:00 (20m) gap is dropped; no trailing gap (last event ends at workEnd).
    assert.equal(r.result.availableSlots.length, 0);
    assert.equal(r.result.totalFreeMinutes, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Action-panel verb: expandRecurring (artifact.data) — NOT in parity test.
describe("calendar.expandRecurring — recurrence occurrence math", () => {
  it("weekly expands to N dated occurrences spaced 7 days apart", () => {
    const data = { name: "Standup", recurrence: "weekly", startDate: "2026-06-01", count: 4 };
    const r = call("expandRecurring", ctxA, {}, data);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalOccurrences, 4);
    assert.equal(r.result.occurrences.length, 4);
    assert.equal(r.result.occurrences[0].date, "2026-06-01");
    assert.equal(r.result.occurrences[1].date, "2026-06-08");
    assert.equal(r.result.occurrences[3].date, "2026-06-22");
    assert.equal(r.result.spanDays, 21); // (4-1) * 7
  });

  it("daily uses a 1-day interval; monthly uses 30 days", () => {
    const daily = call("expandRecurring", ctxA, {}, { recurrence: "daily", startDate: "2026-06-01", count: 3 });
    assert.equal(daily.result.occurrences[2].date, "2026-06-03");
    assert.equal(daily.result.spanDays, 2);
    const monthly = call("expandRecurring", ctxA, {}, { recurrence: "monthly", startDate: "2026-06-01", count: 2 });
    assert.equal(monthly.result.spanDays, 30);
  });

  it("FAIL-CLOSED: an absurd count is clamped to the 52 safety cap", () => {
    const r = call("expandRecurring", ctxA, {}, { recurrence: "daily", startDate: "2026-06-01", count: 1e9 });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalOccurrences, 52);
    assert.equal(r.result.occurrences.length, 52);
  });

  it("an unknown frequency falls back to the 7-day weekly interval", () => {
    const r = call("expandRecurring", ctxA, {}, { recurrence: "fortnightly-ish", startDate: "2026-06-01", count: 2 });
    assert.equal(r.result.occurrences[1].date, "2026-06-08");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Action-panel verb: scheduleOptimize — the macro CLAUDE.md flags as a
// known-FIXED source bug. Verify it STAYS correct.
describe("calendar.scheduleOptimize — priority sort + energy blocks (known-fixed)", () => {
  it("orders tasks by priority critical>high>medium>low", () => {
    const tasks = [
      { name: "low-task", priority: "low", duration: 30 },
      { name: "crit-task", priority: "critical", duration: 60 },
      { name: "med-task", priority: "medium", duration: 45 },
      { name: "high-task", priority: "high", duration: 90 },
    ];
    const r = call("scheduleOptimize", ctxA, {}, { tasks });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.optimizedOrder, ["crit-task", "high-task", "med-task", "low-task"]);
  });

  it("routes high-energy AND critical tasks to the morning block", () => {
    const tasks = [
      { name: "deep-focus", priority: "high", energy: "high", duration: 120 },
      { name: "urgent-fix", priority: "critical", energy: "medium", duration: 60 },
      { name: "email", priority: "low", energy: "low", duration: 30 },
    ];
    const r = call("scheduleOptimize", ctxA, {}, { tasks });
    // morning = energy high OR priority critical
    assert.deepEqual(r.result.morningBlock.sort(), ["deep-focus", "urgent-fix"].sort());
    assert.deepEqual(r.result.afternoonBlock, ["email"]);
  });

  it("computes the exact total + fitsInWorkday flag (≤480m)", () => {
    const tasks = [
      { name: "a", priority: "high", duration: 240 },
      { name: "b", priority: "medium", duration: 200 },
    ];
    const fits = call("scheduleOptimize", ctxA, {}, { tasks });
    assert.equal(fits.result.totalMinutes, 440);
    assert.equal(fits.result.totalHours, 7.3);
    assert.equal(fits.result.fitsInWorkday, true);

    const over = call("scheduleOptimize", ctxA, {}, {
      tasks: [{ name: "x", priority: "high", duration: 300 }, { name: "y", priority: "medium", duration: 300 }],
    });
    assert.equal(over.result.totalMinutes, 600);
    assert.equal(over.result.fitsInWorkday, false);
  });

  it("a malformed duration defaults to 30 minutes (never NaN)", () => {
    const r = call("scheduleOptimize", ctxA, {}, { tasks: [{ name: "junk", priority: "medium", duration: "not-a-number" }] });
    assert.equal(r.result.totalMinutes, 30);
    assert.ok(Number.isFinite(r.result.totalHours));
  });

  it("an unknown priority sorts as medium (does not throw / NaN-rank)", () => {
    const r = call("scheduleOptimize", ctxA, {}, {
      tasks: [
        { name: "weird", priority: "ultra-mega", duration: 30 },
        { name: "crit", priority: "critical", duration: 30 },
        { name: "low", priority: "low", duration: 30 },
      ],
    });
    // critical(0) < weird(unknown→2) < low(3)
    assert.deepEqual(r.result.optimizedOrder, ["crit", "weird", "low"]);
  });

  it("no tasks → guidance message, not a crash", () => {
    const r = call("scheduleOptimize", ctxA, {}, { tasks: [] });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /add tasks/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-user isolation across the CORE event/calendar maps (parity test only
// pins isolation for invites). These are STATE-backed via aidCal(ctx).
describe("calendar — per-user isolation (events + appointments)", () => {
  it("user A's events are invisible to user B", () => {
    const a = call("events-create", ctxA, { title: "A-private", start: "2026-06-01T09:00:00Z", end: "2026-06-01T10:00:00Z" });
    assert.equal(a.ok, true);
    const range = { rangeStart: "2026-05-30T00:00:00Z", rangeEnd: "2026-06-05T00:00:00Z" };
    const listA = call("events-list", ctxA, range);
    const listB = call("events-list", ctxB, range);
    assert.equal(listA.result.events.some(e => e.title === "A-private"), true);
    assert.equal(listB.result.events.some(e => e.title === "A-private"), false);
  });

  it("user A cannot delete user B's event by id", () => {
    const b = call("events-create", ctxB, { title: "B-only", start: "2026-06-01T09:00:00Z", end: "2026-06-01T10:00:00Z" });
    const del = call("events-delete", ctxA, { id: b.result.event.id });
    assert.equal(del.ok, false);
    assert.equal(del.error, "event not found");
    // Still present for B.
    const stillThere = call("events-list", ctxB, { rangeStart: "2026-05-30T00:00:00Z", rangeEnd: "2026-06-05T00:00:00Z" });
    assert.equal(stillThere.result.events.some(e => e.title === "B-only"), true);
  });

  it("appointment schedules are scoped per-user", () => {
    const a = call("appointment-schedule-create", ctxA, { title: "A office hours" });
    assert.equal(a.ok, true);
    const listA = call("appointment-schedule-list", ctxA);
    const listB = call("appointment-schedule-list", ctxB);
    assert.equal(listA.result.count, 1);
    assert.equal(listB.result.count, 0);
    // B cannot delete A's schedule.
    const del = call("appointment-schedule-delete", ctxB, { id: a.result.schedule.id });
    assert.equal(del.ok, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Appointment booking: double-book prevention + cancel round-trip (the booking
// engine the AppointmentSchedules component drives).
describe("calendar — appointment booking round-trip", () => {
  it("books a slot, blocks the same slot, then cancels it", () => {
    const sched = call("appointment-schedule-create", ctxA, { title: "Intro calls", durationMin: 30, startHour: 9, endHour: 11, weekdays: [1, 2, 3, 4, 5] });
    const id = sched.result.schedule.id;
    const slot = "2026-06-01T09:00:00"; // 2026-06-01 is a Monday (weekday 1)
    const b1 = call("appointment-book", ctxA, { scheduleId: id, slotStart: slot, bookerName: "Dana" });
    assert.equal(b1.ok, true);
    assert.equal(b1.result.booking.bookerName, "Dana");
    // Double-book blocked.
    const b2 = call("appointment-book", ctxA, { scheduleId: id, slotStart: slot, bookerName: "Eve" });
    assert.equal(b2.ok, false);
    assert.equal(b2.error, "slot already booked");
    // Cancel restores availability.
    const cancel = call("appointment-cancel-booking", ctxA, { scheduleId: id, bookingId: b1.result.booking.id });
    assert.equal(cancel.ok, true);
    const b3 = call("appointment-book", ctxA, { scheduleId: id, slotStart: slot, bookerName: "Eve" });
    assert.equal(b3.ok, true);
  });

  it("rejects a malformed slotStart and a missing bookerName", () => {
    const sched = call("appointment-schedule-create", ctxA, { title: "S" });
    const id = sched.result.schedule.id;
    assert.equal(call("appointment-book", ctxA, { scheduleId: id, slotStart: "garbage", bookerName: "X" }).ok, false);
    assert.equal(call("appointment-book", ctxA, { scheduleId: id, slotStart: "2026-06-01T09:00:00", bookerName: "  " }).ok, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connector macros — validation + REJECTION only, with NO network call. Every
// assertion below exercises a branch that returns BEFORE the connector client's
// connectorFetch is ever reached.
describe("calendar — connector macros: network-free validation-rejection", () => {
  it("accounts-connect-google returns the OAuth authorize URL (deterministic, no network)", () => {
    const r = call("accounts-connect-google", ctxA, { redirect: "/lenses/calendar" });
    assert.equal(r.ok, true);
    assert.match(r.result.authorizeUrl, /^\/api\/oauth\/google\/authorize\?/);
    assert.match(r.result.authorizeUrl, /token_key=google_calendar/);
    assert.deepEqual(r.result.scopes, ["https://www.googleapis.com/auth/calendar.events"]);
  });

  it("accounts-push-event rejects an unknown account before any push", async () => {
    const r = await call("accounts-push-event", { ...ctxA, db: {} }, { accountId: "ghost", event: { title: "x" } });
    assert.equal(r.ok, false);
    assert.equal(r.error, "account not found");
  });

  it("accounts-push-event refuses to push on a pull-only account (no network)", async () => {
    const acct = call("accounts-connect", ctxA, { label: "ReadOnly", icsUrl: "https://example.com/feed.ics", direction: "pull" });
    const r = await call("accounts-push-event", { ...ctxA, db: {} }, { accountId: acct.result.account.id, event: { title: "x" } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "direction_pull_no_push");
    assert.equal(r.direction, "pull");
  });

  it("accounts-push-event rejects a non-google provider before any connector call", async () => {
    const acct = call("accounts-connect", ctxA, { label: "Outlook", icsUrl: "https://example.com/o.ics", provider: "outlook", direction: "two-way" });
    const r = await call("accounts-push-event", { ...ctxA, db: {} }, { accountId: acct.result.account.id, event: { title: "x" } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "push_unsupported_provider");
    assert.equal(r.provider, "outlook");
  });

  it("accounts-push-event rejects a google push with no event title before any network call", async () => {
    const acct = call("accounts-connect", ctxA, { label: "GCal", icsUrl: "https://example.com/g.ics", provider: "google", direction: "two-way" });
    const r = await call("accounts-push-event", { ...ctxA, db: {} }, { accountId: acct.result.account.id, event: {} });
    assert.equal(r.ok, false);
    assert.equal(r.error, "event.title required");
  });

  it("accounts-pull-events rejects anon + missing db before any network call", async () => {
    const anon = await call("accounts-pull-events", { actor: { userId: "anon" }, userId: "anon", db: {} }, {});
    assert.equal(anon.ok, false);
    assert.equal(anon.reason || anon.error, "no_user");
    const noDb = await call("accounts-pull-events", { actor: { userId: "user_a" }, userId: "user_a" }, {});
    assert.equal(noDb.ok, false);
    assert.equal(noDb.error, "db unavailable");
  });

  it("accounts-pull-events rejects a non-google account before any connector call", async () => {
    const acct = call("accounts-connect", ctxA, { label: "Apple", icsUrl: "https://example.com/a.ics", provider: "apple" });
    const r = await call("accounts-pull-events", { ...ctxA, db: {} }, { accountId: acct.result.account.id });
    assert.equal(r.ok, false);
    assert.equal(r.reason || r.error, "pull_unsupported_provider");
  });

  it("accounts-connect itself rejects a non-https icsUrl (SSRF-shaped guard)", () => {
    const bad = call("accounts-connect", ctxA, { label: "x", icsUrl: "file:///etc/passwd" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /icsUrl/);
    const noLabel = call("accounts-connect", ctxA, { label: "", icsUrl: "https://ok.com/f.ics" });
    assert.equal(noLabel.ok, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// conference-generate — deterministic, keyless room URL (no external API).
describe("calendar.conference-generate — keyless room URL", () => {
  it("produces a joinable jitsi URL and can attach it to a real event", () => {
    const ev = call("events-create", ctxA, { title: "Sync", start: "2026-06-01T09:00:00Z", end: "2026-06-01T10:00:00Z" });
    const r = call("conference-generate", ctxA, { eventId: ev.result.event.id, provider: "jitsi" });
    assert.equal(r.ok, true);
    assert.match(r.result.url, /^https:\/\/meet\.jit\.si\/concord-/);
    assert.equal(r.result.attachedToEvent, true);
    // conference-clear removes it.
    const cleared = call("conference-clear", ctxA, { eventId: ev.result.event.id });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.result.event.conferenceLink, "");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FAIL-CLOSED poisoned input — the validators must never persist garbage / NaN.
describe("calendar — fail-CLOSED on poisoned input", () => {
  it("events-create rejects an unparseable start date (no row persisted)", () => {
    const r = call("events-create", ctxA, { title: "Poison", start: "not-a-date" });
    assert.equal(r.ok, false);
    assert.match(r.error, /start/);
    const list = call("events-list", ctxA, { rangeStart: "2000-01-01T00:00:00Z", rangeEnd: "2100-01-01T00:00:00Z" });
    assert.equal(list.result.events.some(e => e.title === "Poison"), false);
  });

  it("events-create rejects an empty title", () => {
    assert.equal(call("events-create", ctxA, { title: "   ", start: "2026-06-01T09:00:00Z" }).ok, false);
  });

  it("status-event-create rejects an unknown kind and an unparseable start", () => {
    assert.equal(call("status-event-create", ctxA, { kind: "lunch", start: "2026-06-01T09:00:00Z" }).ok, false);
    assert.equal(call("status-event-create", ctxA, { kind: "focus-time", start: "garbage" }).ok, false);
  });

  it("invite-rsvp rejects an unknown rsvp value", () => {
    const ev = call("events-create", ctxA, { title: "Party", start: "2026-06-01T09:00:00Z" });
    const inv = call("invites-send", ctxA, { eventId: ev.result.event.id, guests: ["dana@x.com"] });
    const tok = inv.result.invites[0].token;
    const bad = call("invite-rsvp", ctxA, { token: tok, rsvp: "maybe-ish" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /accepted/);
    // A valid value still works.
    const ok = call("invite-rsvp", ctxA, { token: tok, rsvp: "accepted" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.invite.rsvp, "accepted");
  });

  it("appointment-schedule-create clamps an absurd duration into [5,480]", () => {
    const huge = call("appointment-schedule-create", ctxA, { title: "huge", durationMin: 1e9 });
    assert.equal(huge.result.schedule.durationMin, 480);
    const tiny = call("appointment-schedule-create", ctxA, { title: "tiny", durationMin: -50 });
    assert.equal(tiny.result.schedule.durationMin, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// degrade-graceful — STATE-backed macros must return a clean error, not throw,
// when the world STATE is unavailable (e.g. very early boot).
describe("calendar — degrade-graceful when STATE is unavailable", () => {
  it("STATE-backed macros return ok:false 'STATE unavailable' (never throw)", () => {
    delete globalThis._concordSTATE;
    for (const m of ["calendars-list", "events-list", "appointment-schedule-list", "accounts-list", "conference-generate"]) {
      const r = call(m, ctxA, {});
      assert.equal(r.ok, false, `${m} should degrade gracefully`);
      assert.equal(r.error, "STATE unavailable", `${m} wrong error`);
    }
  });

  it("pure-compute action-panel verbs still work with no STATE (no STATE dependency)", () => {
    delete globalThis._concordSTATE;
    const r = call("detectConflicts", ctxA, {}, {
      events: [
        { title: "A", start: "2026-06-01T10:00:00Z", end: "2026-06-01T11:00:00Z" },
        { title: "B", start: "2026-06-01T10:30:00Z", end: "2026-06-01T11:30:00Z" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.conflictCount, 1);
  });
});
