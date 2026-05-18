// server/domains/calendar-ai.js
//
// Calendar lens Sprint B — AI surface. 8 marquee features mirroring
// 2026 rivals: Motion auto-schedule, natural-language event entry,
// meeting prep, Sunsama daily ritual, meeting notes, voice-to-event,
// Aki-style chat assistant, semantic search.

import { randomUUID } from "node:crypto";
import {
  withTimeout, stripFences, extractJsonObject, extractJsonArray,
  recordAiRun, deterministicParseEvent,
} from "../lib/calendar/ai-helpers.js";
import {
  createEvent, listEventsInRange, expandEvent, ensureDefaultCalendar, getCalendar, getEvent,
} from "../lib/calendar/persistence.js";
import { findAvailability, dayBounds, freenessScore } from "../lib/calendar/scheduling.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

export default function registerCalendarAiMacros(register) {

  // ─── 1. Motion-style auto-schedule ──────────────────────────────
  // Takes pending tasks (from Tasks lens) + their durations + due
  // dates, fits them into available calendar slots respecting buffer
  // minutes + working hours + focus blocks. Heaviest macro.
  register("calendar", "ai_auto_schedule", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const tasks = Array.isArray(input.tasks) ? input.tasks : [];
    if (tasks.length === 0) return { ok: false, reason: "no_tasks" };
    const calendarId = input.calendarId || ensureDefaultCalendar(db, userId)?.id;
    if (!calendarId) return { ok: false, reason: "no_calendar" };
    const cal = getCalendar(db, calendarId);
    if (cal.owner_id !== userId) return { ok: false, reason: "forbidden" };

    const settings = db.prepare(`SELECT * FROM calendar_auto_schedule_settings WHERE user_id = ?`).get(userId) || {
      work_start_hour: 9, work_end_hour: 17, buffer_minutes: 15, include_weekends: 0, max_meetings_per_day: 6,
    };
    const horizonDays = Math.min(Number(input.horizonDays) || 14, 60);
    const minutesPerPoint = Number(input.minutesPerPoint) || 30;
    const startTs = _now();
    const endTs = startTs + horizonDays * 86400;

    // Pull existing events in the window
    const existing = listEventsInRange(db, { ownerId: userId, calendarIds: [calendarId], windowStartTs: startTs, windowEndTs: endTs });
    const expanded = [];
    for (const e of existing) {
      if (e.rrule) expanded.push(...expandEvent(db, e, { windowStartTs: startTs, windowEndTs: endTs }).map((x) => ({ startAt: x.start_at, endAt: x.end_at })));
      else expanded.push({ startAt: e.start_at, endAt: e.end_at });
    }

    // Also treat focus blocks as busy
    const focusBlocks = db.prepare(`SELECT * FROM calendar_focus_blocks WHERE owner_id = ? AND enabled = 1`).all(userId);

    // Sort tasks by deadline asc, then priority desc
    const PRI_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };
    const sorted = [...tasks].sort((a, b) => {
      const ad = a.dueAt || a.due_at || (startTs + 30 * 86400);
      const bd = b.dueAt || b.due_at || (startTs + 30 * 86400);
      if (ad !== bd) return ad - bd;
      return (PRI_WEIGHT[b.priority] || 0) - (PRI_WEIGHT[a.priority] || 0);
    });

    const placed = [];
    const skipped = [];
    const busyWindows = [...expanded];

    for (const task of sorted) {
      const durMinutes = task.estimate
        ? (task.estimateUnit === "hours" ? task.estimate * 60 : task.estimate * minutesPerPoint)
        : 60;
      const slotSeconds = Math.max(15 * 60, durMinutes * 60);
      const deadline = task.dueAt || task.due_at || endTs;

      let placedAt = null;
      // Walk days from today until deadline
      for (let dayOffset = 0; dayOffset <= horizonDays && placedAt == null; dayOffset++) {
        const d = new Date((startTs + dayOffset * 86400) * 1000);
        const dow = d.getUTCDay();
        if (!settings.include_weekends && (dow === 0 || dow === 6)) continue;
        const dateStr = d.toISOString().slice(0, 10);
        const bounds = dayBounds(dateStr, settings.work_start_hour, settings.work_end_hour);
        if (!bounds || bounds.dayEndTs > deadline) {
          if (bounds && bounds.dayStartTs > deadline) continue;
        }
        // Add focus blocks for this dow into busyWindows for the day
        const dayBusy = busyWindows.filter((b) => b.startAt < bounds.dayEndTs && b.endAt > bounds.dayStartTs).map((b) => ({ ...b }));
        for (const fb of focusBlocks) {
          if (fb.day_of_week !== null && fb.day_of_week !== dow) continue;
          dayBusy.push({
            startAt: bounds.dayStartTs - bounds.dayStartTs % 86400 + fb.start_minute * 60,
            endAt: bounds.dayStartTs - bounds.dayStartTs % 86400 + fb.end_minute * 60,
          });
        }
        const avail = findAvailability(dayBusy, { dayStartTs: bounds.dayStartTs, dayEndTs: bounds.dayEndTs, slotMinutes: durMinutes });
        for (const slot of avail.slots) {
          if (slot.minutes * 60 < slotSeconds) continue;
          const proposedStart = slot.startAt + (settings.buffer_minutes || 0) * 60;
          const proposedEnd = proposedStart + slotSeconds;
          if (proposedEnd > bounds.dayEndTs) continue;
          if (proposedEnd > deadline) continue;
          placedAt = { startAt: proposedStart, endAt: proposedEnd };
          busyWindows.push(placedAt);
          break;
        }
      }
      if (placedAt) placed.push({ task: { id: task.id, title: task.title }, ...placedAt });
      else skipped.push({ task: { id: task.id, title: task.title }, reason: "no_slot_before_deadline" });
    }

    // Optionally create events for placed tasks
    const created = [];
    if (input.commit) {
      for (const p of placed) {
        const r = createEvent(db, {
          calendarId, organizerId: userId,
          title: p.task.title || "Scheduled task",
          startAt: p.startAt, endAt: p.endAt,
          metaJson: JSON.stringify({ auto_scheduled: true, source_task_id: p.task.id }),
        });
        if (r.ok) created.push({ id: r.id, taskId: p.task.id });
      }
    }
    recordAiRun(db, { userId, kind: "auto_schedule", outputText: JSON.stringify({ placed, skipped, created }), source: "deterministic" });
    return { ok: true, placed, skipped, created, committed: !!input.commit, source: "deterministic" };
  }, { destructive: true, note: "Motion-style auto-schedule of tasks into free calendar slots (set commit=true to create events)" });

  // ─── 2. Natural-language event entry ────────────────────────────
  register("calendar", "ai_parse_event", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const text = String(input.text || "").trim();
    if (!text) return { ok: false, reason: "text_required" };
    const llm = ctx?.llm;
    const t0 = Date.now();

    if (!llm?.chat) {
      const parsed = deterministicParseEvent(text);
      recordAiRun(db, { userId, kind: "parse_event", inputText: text, outputText: JSON.stringify(parsed), source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: !!parsed, event: parsed, source: "fallback" };
    }

    const sys = `You parse a natural-language event description into JSON: { title, startAt (unix seconds), endAt (unix seconds), location (or null), allDay (bool), attendeeNames (array of strings). Output ONLY JSON. If no time given, default to next 09:00 for 1 hour. Now is ${new Date().toISOString()}.`;
    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: text }],
        temperature: 0.2, maxTokens: 400, slot: "utility",
      }), 8000);
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const parsed = extractJsonObject(raw);
      if (!parsed?.title || !parsed?.startAt) {
        const fb = deterministicParseEvent(text);
        return { ok: !!fb, event: fb, source: "fallback", reason: "parse_failed", raw: raw.slice(0, 200) };
      }
      recordAiRun(db, { userId, kind: "parse_event", inputText: text, outputText: JSON.stringify(parsed), source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, event: parsed, source: "llm" };
    } catch (e) {
      const fb = deterministicParseEvent(text);
      return { ok: !!fb, event: fb, source: "fallback", error: e?.message };
    }
  }, { requiresLLM: false, note: "Parse 'lunch with Sarah Tuesday 1pm' into an event object (deterministic fallback)" });

  // ─── 3. Meeting prep ────────────────────────────────────────────
  register("calendar", "ai_meeting_prep", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const eventId = String(input.eventId || "");
    const evt = getEvent(db, eventId);
    if (!evt) return { ok: false, reason: "not_found" };
    const cal = getCalendar(db, evt.calendar_id);
    if (cal.owner_id !== userId) return { ok: false, reason: "forbidden" };

    // Pull cross-app links + attendees
    const links = db.prepare(`SELECT * FROM calendar_links WHERE event_id = ?`).all(evt.id);
    const attendees = db.prepare(`SELECT * FROM calendar_attendees WHERE event_id = ?`).all(evt.id);

    const llm = ctx?.llm;
    const t0 = Date.now();
    if (!llm?.chat) {
      const fb = `Meeting: ${evt.title}\n\nAttendees: ${attendees.map((a) => a.name || a.user_id || a.email).join(", ") || "—"}\n${links.length ? `Linked: ${links.map((l) => l.target_label || l.target_id).join(", ")}` : ""}`;
      recordAiRun(db, { eventId: evt.id, userId, kind: "meeting_prep", outputText: fb, source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, briefing: fb, source: "fallback" };
    }

    const sys = `You produce a one-paragraph meeting briefing (under 100 words). Format: who's attending, what's on the agenda (inferred from event + linked items), and one suggested opening question.`;
    const userMsg = `Event: ${evt.title}\nWhen: ${new Date(evt.start_at * 1000).toLocaleString()}\nDescription: ${String(evt.description_html || "").replace(/<[^>]+>/g, " ").slice(0, 1500)}\nAttendees: ${attendees.map((a) => a.name || a.user_id || a.email).join(", ")}\nLinked: ${links.map((l) => `${l.target_kind}:${l.target_label || l.target_id}`).join("; ")}`;
    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.5, maxTokens: 300, slot: "utility",
      }), 8000);
      const briefing = stripFences(String(r?.text || r?.content || r?.message?.content || "").trim());
      recordAiRun(db, { eventId: evt.id, userId, kind: "meeting_prep", outputText: briefing, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, briefing, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { note: "Generate a one-paragraph meeting briefing from the event + linked docs + attendees" });

  // ─── 4. Sunsama-style daily ritual ──────────────────────────────
  register("calendar", "ai_daily_ritual", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const date = String(input.date || new Date().toISOString().slice(0, 10));
    const bounds = dayBounds(date, 0, 24);
    if (!bounds) return { ok: false, reason: "invalid_date" };

    // Pull the day's events + open tasks (best-effort cross-lens read)
    const dayEvents = listEventsInRange(db, { ownerId: userId, windowStartTs: bounds.dayStartTs, windowEndTs: bounds.dayEndTs });
    let openTasks = [];
    try {
      openTasks = db.prepare(`
        SELECT id, task_key, title, priority, estimate, due_at FROM tasks
        WHERE assignee_id = ? AND deleted_at IS NULL
          AND status_id NOT IN ('st:done','st:cancelled')
        ORDER BY due_at IS NULL, due_at, priority LIMIT 20
      `).all(userId);
    } catch { /* tasks schema may be absent in test DB */ }

    let beats = [];
    try {
      beats = db.prepare(`
        SELECT id, subject_id, subject_kind, suggestion FROM player_beats
        WHERE user_id = ? AND status = 'open' LIMIT 5
      `).all(userId);
    } catch { /* personal beats may be absent */ }

    const llm = ctx?.llm;
    const t0 = Date.now();
    if (!llm?.chat) {
      const lines = [
        `Day plan — ${date}`,
        ``,
        `Today's events (${dayEvents.length}):`,
        ...dayEvents.slice(0, 5).map((e) => `- ${new Date(e.start_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ${e.title}`),
        ``,
        `Open tasks (${openTasks.length}):`,
        ...openTasks.slice(0, 5).map((t) => `- ${t.task_key} ${t.title}${t.due_at ? ` (due ${new Date(t.due_at * 1000).toLocaleDateString()})` : ""}`),
        ``,
        ...(beats.length ? [`Personal beats:`, ...beats.slice(0, 3).map((b) => `- ${b.suggestion}`)] : []),
      ].join("\n");
      recordAiRun(db, { userId, kind: "daily_ritual", outputText: lines, source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, plan: lines, dayEvents, openTasks, beats, source: "fallback" };
    }

    const sys = `You write a 2-3 sentence guided daily plan in the Sunsama style. Pull in: scheduled events, top 3 open tasks (by deadline + priority), and 1 personal beat. End with one focused suggestion for what to tackle first. Under 80 words.`;
    const userMsg = `Date: ${date}\nEvents: ${dayEvents.map((e) => `[${new Date(e.start_at * 1000).toLocaleTimeString()}] ${e.title}`).join("; ")}\nTasks: ${openTasks.map((t) => `${t.task_key} ${t.title}`).join("; ")}\nBeats: ${beats.map((b) => b.suggestion).join("; ")}`;
    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.4, maxTokens: 300, slot: "utility",
      }));
      const plan = stripFences(String(r?.text || r?.content || r?.message?.content || "").trim());
      recordAiRun(db, { userId, kind: "daily_ritual", outputText: plan, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, plan, dayEvents, openTasks, beats, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { note: "Sunsama-style daily planning ritual (events + tasks + Personal Beats integration)" });

  // ─── 5. Post-meeting notes ──────────────────────────────────────
  register("calendar", "ai_meeting_notes", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const eventId = String(input.eventId || "");
    const transcript = String(input.transcript || "").trim();
    if (!eventId || !transcript) return { ok: false, reason: "eventId_and_transcript_required" };
    const evt = getEvent(db, eventId);
    if (!evt) return { ok: false, reason: "not_found" };
    const cal = getCalendar(db, evt.calendar_id);
    if (cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const llm = ctx?.llm;
    const t0 = Date.now();
    if (!llm?.chat) {
      const fb = `# ${evt.title}\n\n${transcript.slice(0, 2000)}\n\n(Notes saved verbatim — LLM brain offline for summarization.)`;
      recordAiRun(db, { eventId: evt.id, userId, kind: "meeting_notes", inputText: transcript, outputText: fb, source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, notes: fb, source: "fallback" };
    }
    const sys = `You summarize a meeting transcript into: 1) one-paragraph summary, 2) "Decisions" bullet list, 3) "Action items" bullet list with owner (if mentioned). Output as markdown.`;
    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: transcript }],
        temperature: 0.3, maxTokens: 1000, slot: "subconscious",
      }));
      const notes = stripFences(String(r?.text || r?.content || r?.message?.content || "").trim());
      recordAiRun(db, { eventId: evt.id, userId, kind: "meeting_notes", inputText: transcript, outputText: notes, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, notes, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { note: "Post-meeting transcript → markdown summary with decisions + action items" });

  // ─── 6. Voice → event (uses ai_parse_event under the hood) ──────
  register("calendar", "ai_voice_event", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const transcript = String(input.transcript || "").trim();
    if (!transcript) return { ok: false, reason: "transcript_required" };
    const llm = ctx?.llm;
    // Parse with LLM if available, deterministic fallback otherwise
    let event;
    if (llm?.chat) {
      try {
        const sys = `Parse a voice transcript into a calendar event JSON: { title, startAt (unix sec), endAt (unix sec), location, allDay (bool) }. Today is ${new Date().toISOString().slice(0, 10)}. Output ONLY JSON.`;
        const r = await withTimeout(llm.chat({
          messages: [{ role: "system", content: sys }, { role: "user", content: transcript }],
          temperature: 0.2, maxTokens: 300, slot: "utility",
        }), 6000);
        event = extractJsonObject(String(r?.text || r?.content || r?.message?.content || ""));
      } catch { /* fall through */ }
    }
    if (!event?.title || !event?.startAt) {
      event = deterministicParseEvent(transcript);
    }
    if (!event) return { ok: false, reason: "parse_failed" };

    const created = input.autoCreate !== false ? (() => {
      const calId = input.calendarId || ensureDefaultCalendar(db, userId)?.id;
      if (!calId) return null;
      const r = createEvent(db, {
        calendarId: calId, organizerId: userId,
        title: event.title, startAt: event.startAt, endAt: event.endAt || event.startAt + 3600,
        location: event.location || null, allDay: !!event.allDay,
      });
      return r.ok ? { id: r.id } : null;
    })() : null;

    recordAiRun(db, { eventId: created?.id, userId, kind: "voice", inputText: transcript, outputText: JSON.stringify(event), source: llm?.chat ? "llm" : "fallback" });
    return { ok: true, event, created, source: llm?.chat ? "llm" : "fallback" };
  }, { destructive: true, note: "Voice transcript → calendar event (Todoist-Ramble parity for calendar)" });

  // ─── 7. Aki-style chat assistant ────────────────────────────────
  register("calendar", "ai_chat", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const message = String(input.message || "").trim();
    if (!message) return { ok: false, reason: "message_required" };
    const llm = ctx?.llm;
    const t0 = Date.now();
    // Load context: upcoming events + open reminders
    const windowEnd = _now() + 14 * 86400;
    const upcoming = listEventsInRange(db, { ownerId: userId, windowStartTs: _now(), windowEndTs: windowEnd, limit: 50 });
    if (!llm?.chat) {
      const fb = `(Calendar brain offline.) You have ${upcoming.length} events in the next 14 days. Next: ${upcoming[0]?.title || 'none'} at ${upcoming[0] ? new Date(upcoming[0].start_at * 1000).toLocaleString() : '—'}.`;
      recordAiRun(db, { userId, kind: "chat", prompt: message, outputText: fb, source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, reply: fb, source: "fallback" };
    }
    const sys = `You are the user's calendar assistant. Be brief (under 60 words). When asked about their schedule, refer to the upcoming events provided. When asked to schedule something, suggest a time but don't actually create the event (tell them which macro to call).`;
    const userMsg = `Upcoming events (next 14d):\n${upcoming.slice(0, 12).map((e) => `[${new Date(e.start_at * 1000).toLocaleString()}] ${e.title}`).join("\n")}\n\nUser: ${message}`;
    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.6, maxTokens: 300, slot: "utility",
      }));
      const reply = stripFences(String(r?.text || r?.content || r?.message?.content || "").trim());
      recordAiRun(db, { userId, kind: "chat", prompt: message, outputText: reply, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, reply, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { note: "Aki-style executive-assistant chat with upcoming-events context" });

  // ─── 8. Semantic search across events ───────────────────────────
  register("calendar", "semantic_search", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const query = String(input.query || "").trim();
    if (query.length < 2) return { ok: true, results: [] };
    const STOP = new Set(["the","a","an","is","are","of","in","on","to","for","with","by","and","or","but","at","that","this","it","be"]);
    const tokens = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
    const bigrams = (a) => { const o = []; for (let i = 0; i < a.length - 1; i++) o.push(`${a[i]} ${a[i+1]}`); return o; };
    const qTok = tokens(query);
    const qBg = bigrams(qTok);
    const myCals = db.prepare(`SELECT id FROM calendars WHERE owner_id = ?`).all(userId).map((r) => r.id);
    if (myCals.length === 0) return { ok: true, results: [] };
    const placeholders = myCals.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT id, calendar_id, title, description_html, location, start_at, end_at
      FROM calendar_events WHERE calendar_id IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY ABS(start_at - ?) ASC LIMIT 1000
    `).all(...myCals, _now());
    const scored = [];
    for (const r of rows) {
      const text = `${r.title} ${String(r.description_html || "").replace(/<[^>]+>/g, " ")} ${r.location || ""}`;
      const dTok = tokens(text);
      const dBg = bigrams(dTok);
      let score = 0;
      for (const t of qTok) if (dTok.includes(t)) score += 1;
      for (const b of qBg) if (dBg.includes(b)) score += 4;
      if (score > 0) scored.push({ id: r.id, title: r.title, start_at: r.start_at, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return { ok: true, results: scored.slice(0, Math.min(Number(input.limit) || 25, 100)) };
  }, { note: "Semantic search across my events (bigram scoring)" });

  // ─── Focus blocks CRUD + settings ────────────────────────────────

  register("calendar", "focus_block_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = `focus:${randomUUID()}`;
    db.prepare(`
      INSERT INTO calendar_focus_blocks (id, owner_id, title, day_of_week, start_minute, end_minute, kind, color, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, unixepoch(), unixepoch())
    `).run(id, userId,
      String(input.title || "Focus block").slice(0, 120),
      input.dayOfWeek != null ? Number(input.dayOfWeek) : null,
      Number(input.startMinute) || 540,
      Number(input.endMinute) || 660,
      ["focus","dnd","habit","lunch","exercise","sleep"].includes(input.kind) ? input.kind : "focus",
      input.color || "#8b5cf6");
    return { ok: true, id };
  }, { destructive: true, note: "Create a recurring focus block (Reclaim parity)" });

  register("calendar", "focus_block_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, blocks: db.prepare(`SELECT * FROM calendar_focus_blocks WHERE owner_id = ? ORDER BY day_of_week, start_minute`).all(userId) };
  }, { note: "List my focus blocks" });

  register("calendar", "focus_block_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = db.prepare(`DELETE FROM calendar_focus_blocks WHERE id = ? AND owner_id = ?`).run(String(input.id), userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Delete a focus block" });

  register("calendar", "settings_get", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const row = db.prepare(`SELECT * FROM calendar_auto_schedule_settings WHERE user_id = ?`).get(userId);
    return { ok: true, settings: row || {
      user_id: userId, work_start_hour: 9, work_end_hour: 17,
      buffer_minutes: 15, min_focus_minutes: 30, include_weekends: 0,
      max_meetings_per_day: 6, auto_decline_outside_hours: 0,
    } };
  }, { note: "Get my auto-schedule preferences" });

  register("calendar", "settings_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    db.prepare(`
      INSERT INTO calendar_auto_schedule_settings
        (user_id, work_start_hour, work_end_hour, buffer_minutes, min_focus_minutes,
         include_weekends, max_meetings_per_day, auto_decline_outside_hours, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(user_id) DO UPDATE SET
        work_start_hour = excluded.work_start_hour,
        work_end_hour = excluded.work_end_hour,
        buffer_minutes = excluded.buffer_minutes,
        min_focus_minutes = excluded.min_focus_minutes,
        include_weekends = excluded.include_weekends,
        max_meetings_per_day = excluded.max_meetings_per_day,
        auto_decline_outside_hours = excluded.auto_decline_outside_hours,
        updated_at = excluded.updated_at
    `).run(userId,
      Number(input.workStartHour ?? 9), Number(input.workEndHour ?? 17),
      Number(input.bufferMinutes ?? 15), Number(input.minFocusMinutes ?? 30),
      input.includeWeekends ? 1 : 0,
      Number(input.maxMeetingsPerDay ?? 6),
      input.autoDeclineOutsideHours ? 1 : 0);
    return { ok: true };
  }, { destructive: true, note: "Update auto-schedule preferences" });

  register("calendar", "ai_runs_recent", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, runs: db.prepare(`SELECT * FROM calendar_ai_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, Math.min(Number(input.limit) || 50, 200)) };
  }, { note: "Recent AI runs (provenance trail)" });
}
