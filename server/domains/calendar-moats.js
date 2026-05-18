// server/domains/calendar-moats.js
//
// Calendar Sprint C — concord-native moats.
//
//   1. Calendar-bound agents publishable as agent_spec DTUs
//   2. Event mint as event_spec DTU + cross-lens cite cascade
//   3. Booking links (Calendly-style public URLs)
//   4. Project ↔ calendar bridge (task due_at + sprint windows)
//   5. World event overlay (Concordia world_events surface as calendar events)
//   6. iCal subscription URL preparation (the GET feed route is mounted inline in server.js)

import { randomUUID } from "node:crypto";
import {
  getCalendar, ensureDefaultCalendar, getEvent, createEvent,
  listEventsInRange,
} from "../lib/calendar/persistence.js";
import { findAvailability, dayBounds } from "../lib/calendar/scheduling.js";
import { withTimeout, stripFences, recordAiRun } from "../lib/calendar/ai-helpers.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }
function _slugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60); }

const VALID_SLOTS = new Set(["conscious","subconscious","utility","repair","multimodal"]);
const VALID_CAPS = new Set(["read_events","read_attendees","read_focus","write_event","auto_schedule","reminder_compose","triage"]);
const VALID_VIS = new Set(["private","workspace","public","published","global"]);

export default function registerCalendarMoatsMacros(register) {

  // ─── Calendar-bound agents ──────────────────────────────────────

  register("calendar", "agent_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const name = String(input.name || "").trim();
    const systemPrompt = String(input.systemPrompt || "").trim();
    if (!name || !systemPrompt) return { ok: false, reason: "name_and_systemPrompt_required" };
    const slot = VALID_SLOTS.has(input.slot) ? input.slot : "utility";
    const caps = Array.isArray(input.capabilities) ? input.capabilities.filter((c) => VALID_CAPS.has(c)) : ["read_events"];
    let calendarId = input.calendarId || null;
    if (calendarId) {
      const cal = getCalendar(db, calendarId);
      if (!cal || cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    }
    const id = `calagent:${randomUUID()}`;
    db.prepare(`
      INSERT INTO calendar_agents (id, owner_id, calendar_id, name, description, system_prompt, capabilities_json, slot, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, unixepoch(), unixepoch())
    `).run(id, userId, calendarId,
      name.slice(0, 120),
      input.description ? String(input.description).slice(0, 400) : null,
      systemPrompt.slice(0, 4000),
      JSON.stringify(caps), slot);
    return { ok: true, id };
  }, { destructive: true, note: "Create a calendar-bound agent (optionally scoped to one calendar)" });

  register("calendar", "agent_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const rows = db.prepare(`SELECT * FROM calendar_agents WHERE owner_id = ? ORDER BY updated_at DESC`).all(userId);
    return { ok: true, agents: rows.map((r) => ({ ...r, capabilities: _safeJson(r.capabilities_json, []) })) };
  }, { note: "List my calendar agents" });

  register("calendar", "agent_run", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || input.agentId || "");
    const agent = db.prepare(`SELECT * FROM calendar_agents WHERE id = ?`).get(id);
    if (!agent) return { ok: false, reason: "not_found" };
    if (agent.owner_id !== userId) return { ok: false, reason: "forbidden" };
    if (!agent.active) return { ok: false, reason: "inactive" };
    const llm = ctx?.llm;
    const t0 = Date.now();
    const caps = _safeJson(agent.capabilities_json, []);
    const message = String(input.message || "").trim() || "What's on my calendar?";

    const ctxParts = [];
    if (caps.includes("read_events")) {
      const calendarIds = agent.calendar_id ? [agent.calendar_id] : null;
      const events = listEventsInRange(db, { ownerId: userId, calendarIds, windowStartTs: _now(), windowEndTs: _now() + 14 * 86400, limit: 50 });
      ctxParts.push(`# Upcoming events (${events.length})\n${events.slice(0, 20).map((e) => `- [${new Date(e.start_at * 1000).toLocaleString()}] ${e.title}`).join("\n")}`);
    }
    if (caps.includes("read_focus")) {
      const blocks = db.prepare(`SELECT * FROM calendar_focus_blocks WHERE owner_id = ? AND enabled = 1`).all(userId);
      if (blocks.length) ctxParts.push(`# Focus blocks\n${blocks.map((b) => `- ${b.title} (day ${b.day_of_week == null ? 'any' : b.day_of_week}, ${b.start_minute}-${b.end_minute} min)`).join("\n")}`);
    }

    if (!llm?.chat) {
      recordAiRun(db, { userId, kind: "agent_run", prompt: agent.name, outputText: "(brain offline)", source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: false, reason: "llm_unavailable" };
    }
    try {
      const r = await withTimeout(llm.chat({
        messages: [
          { role: "system", content: `${agent.system_prompt}\n\n--- Calendar context ---\n${ctxParts.join("\n\n")}` },
          { role: "user", content: message },
        ],
        temperature: 0.5, maxTokens: 800, slot: agent.slot,
      }));
      const output = stripFences(String(r?.text || r?.content || r?.message?.content || "").trim());
      db.prepare(`UPDATE calendar_agents SET invocation_count = invocation_count + 1, updated_at = ? WHERE id = ?`).run(_now(), agent.id);
      recordAiRun(db, { userId, kind: "agent_run", prompt: agent.name, outputText: output, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, output, agent: { id: agent.id, name: agent.name }, capabilities: caps, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Run a calendar-bound agent" });

  register("calendar", "agent_publish", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const agent = db.prepare(`SELECT * FROM calendar_agents WHERE id = ?`).get(id);
    if (!agent) return { ok: false, reason: "not_found" };
    if (agent.owner_id !== userId) return { ok: false, reason: "forbidden" };
    if (agent.dtu_id) return { ok: true, dtuId: agent.dtu_id, alreadyPublished: true };
    const dtuId = `agent_spec:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
        VALUES (?, 'agent_spec', ?, ?, ?, unixepoch())
      `).run(dtuId, `Calendar agent: ${agent.name}`, userId, JSON.stringify({
        type: "agent_spec", kind: "calendar_bound_agent",
        name: agent.name, description: agent.description,
        system_prompt: agent.system_prompt,
        capabilities: _safeJson(agent.capabilities_json, []),
        slot: agent.slot,
        published_from_calendar: agent.calendar_id,
      }));
      db.prepare(`UPDATE calendar_agents SET dtu_id = ?, updated_at = ? WHERE id = ?`).run(dtuId, _now(), id);
      return { ok: true, dtuId };
    } catch (err) {
      return { ok: false, reason: "publish_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a calendar agent as an agent_spec DTU" });

  register("calendar", "agent_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = db.prepare(`DELETE FROM calendar_agents WHERE id = ? AND owner_id = ?`).run(String(input.id), userId);
    return { ok: r.changes > 0, deleted: r.changes };
  }, { destructive: true, note: "Delete a calendar agent" });

  // ─── Event mint + cross-lens cite ───────────────────────────────

  register("calendar", "event_mint", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const eventId = String(input.eventId || input.id || "");
    const evt = getEvent(db, eventId);
    if (!evt) return { ok: false, reason: "not_found" };
    const cal = getCalendar(db, evt.calendar_id);
    if (cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const existing = db.prepare(`SELECT * FROM calendar_event_mints WHERE event_id = ?`).get(eventId);
    if (existing) return { ok: true, dtuId: existing.dtu_id, alreadyMinted: true };
    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "workspace";
    const royaltyRate = typeof input.royaltyRate === "number" ? Math.max(0, Math.min(0.30, input.royaltyRate)) : 0.21;
    const dtuId = `event_spec:${randomUUID()}`;
    try {
      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
          VALUES (?, 'event_spec', ?, ?, ?, unixepoch())
        `).run(dtuId, evt.title, userId, JSON.stringify({
          type: "event_spec", event_id: eventId, calendar_id: evt.calendar_id,
          start_at: evt.start_at, end_at: evt.end_at, location: evt.location,
          royalty_rate: royaltyRate, visibility,
        }));
        db.prepare(`
          INSERT INTO calendar_event_mints (event_id, dtu_id, creator_id, royalty_rate, visibility, allow_citation, minted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(eventId, dtuId, userId, royaltyRate, visibility, input.allowCitation === false ? 0 : 1, _now());
      });
      tx();
      return { ok: true, dtuId, royaltyRate, visibility };
    } catch (err) {
      return { ok: false, reason: "mint_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint an event as a citable event_spec DTU (owner only)" });

  register("calendar", "event_mint_status", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const m = db.prepare(`SELECT * FROM calendar_event_mints WHERE event_id = ?`).get(String(input.eventId || input.id));
    return { ok: true, minted: !!m, mint: m || null };
  }, { note: "Check whether an event is minted" });

  register("calendar", "event_cite_dtu", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const eventId = String(input.eventId || "");
    const parentDtuId = String(input.dtuId || input.parentDtuId || "");
    if (!eventId || !parentDtuId) return { ok: false, reason: "eventId_and_dtuId_required" };
    const evt = getEvent(db, eventId);
    if (!evt) return { ok: false, reason: "not_found" };
    const cal = getCalendar(db, evt.calendar_id);
    if (cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const mint = db.prepare(`SELECT dtu_id, creator_id FROM calendar_event_mints WHERE event_id = ?`).get(eventId);
    if (!mint) return { ok: false, reason: "event_not_minted_yet" };
    const parentDtu = db.prepare(`SELECT id, creator_id, kind, meta_json FROM dtus WHERE id = ?`).get(parentDtuId);
    if (!parentDtu) return { ok: false, reason: "parent_dtu_not_found" };
    try {
      const { registerCitation } = await import("../economy/royalty-cascade.js");
      const r = registerCitation(db, {
        childId: mint.dtu_id, parentId: parentDtu.id,
        creatorId: mint.creator_id, parentCreatorId: parentDtu.creator_id,
        parentDtu, hasPurchasedLicense: !!input.hasPurchasedLicense, generation: 1,
      });
      if (!r.ok) return r;
      db.prepare(`UPDATE calendar_event_mints SET citation_count = citation_count + 1 WHERE event_id = ?`).run(eventId);
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: r };
    } catch (err) {
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: { ok: false, reason: "engine_unavailable", error: err?.message } };
    }
  }, { destructive: true, note: "Event cites a cross-lens DTU (fires royalty cascade)" });

  // ─── Booking links (Calendly-style) ──────────────────────────────

  register("calendar", "booking_link_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const title = String(input.title || "").trim();
    if (!title) return { ok: false, reason: "title_required" };
    let calendarId = input.targetCalendarId || ensureDefaultCalendar(db, userId)?.id;
    if (!calendarId) return { ok: false, reason: "no_calendar" };
    const cal = getCalendar(db, calendarId);
    if (cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const id = `book:${randomUUID()}`;
    const slug = input.slug ? _slugify(input.slug) : _slugify(title) + "-" + randomUUID().slice(0, 6);
    try {
      db.prepare(`
        INSERT INTO calendar_booking_links
          (id, owner_id, slug, title, description, duration_minutes, buffer_minutes,
           target_calendar_id, check_calendar_ids_json, window_days_ahead,
           work_start_hour, work_end_hour, include_weekends, conferencing_url, max_per_day,
           active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, unixepoch(), unixepoch())
      `).run(id, userId, slug, title.slice(0, 120),
        input.description ? String(input.description).slice(0, 600) : null,
        Math.max(5, Math.min(480, Number(input.durationMinutes) || 30)),
        Math.max(0, Math.min(120, Number(input.bufferMinutes) || 0)),
        calendarId,
        input.checkCalendarIds ? JSON.stringify(input.checkCalendarIds) : null,
        Math.max(1, Math.min(90, Number(input.windowDaysAhead) || 14)),
        Math.max(0, Math.min(23, Number(input.workStartHour) || 9)),
        Math.max(1, Math.min(24, Number(input.workEndHour) || 17)),
        input.includeWeekends ? 1 : 0,
        input.conferencingUrl ? String(input.conferencingUrl).slice(0, 500) : null,
        input.maxPerDay != null ? Number(input.maxPerDay) : null);
      return { ok: true, id, slug };
    } catch (err) {
      if (String(err?.message || "").includes("UNIQUE")) return { ok: false, reason: "slug_taken" };
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Create a Calendly-style booking link (returns slug for /book/:slug URL)" });

  register("calendar", "booking_link_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, links: db.prepare(`SELECT * FROM calendar_booking_links WHERE owner_id = ? ORDER BY active DESC, booking_count DESC`).all(userId) };
  }, { note: "List my booking links" });

  register("calendar", "booking_link_get", async (_ctx, input = {}) => {
    const db = _resolveDb(_ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const slug = String(input.slug || "");
    if (!slug) return { ok: false, reason: "slug_required" };
    const link = db.prepare(`SELECT * FROM calendar_booking_links WHERE slug = ? AND active = 1`).get(slug);
    if (!link) return { ok: false, reason: "not_found" };
    return {
      ok: true,
      link: {
        id: link.id, slug: link.slug, title: link.title, description: link.description,
        duration_minutes: link.duration_minutes, buffer_minutes: link.buffer_minutes,
        window_days_ahead: link.window_days_ahead, work_start_hour: link.work_start_hour,
        work_end_hour: link.work_end_hour, include_weekends: link.include_weekends,
      },
    };
  }, { note: "Get a booking link by slug (public read)" });

  register("calendar", "booking_link_slots", async (_ctx, input = {}) => {
    const db = _resolveDb(_ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const slug = String(input.slug || "");
    const link = db.prepare(`SELECT * FROM calendar_booking_links WHERE slug = ? AND active = 1`).get(slug);
    if (!link) return { ok: false, reason: "not_found" };
    const startTs = _now();
    const endTs = startTs + link.window_days_ahead * 86400;
    const checkIds = link.check_calendar_ids_json ? _safeJson(link.check_calendar_ids_json, []) : [link.target_calendar_id];
    const existing = listEventsInRange(db, { ownerId: link.owner_id, calendarIds: checkIds, windowStartTs: startTs, windowEndTs: endTs });
    const busy = existing.map((e) => ({ startAt: e.start_at, endAt: e.end_at }));
    const slots = [];
    for (let dayOffset = 0; dayOffset < link.window_days_ahead; dayOffset++) {
      const d = new Date((startTs + dayOffset * 86400) * 1000);
      const dow = d.getUTCDay();
      if (!link.include_weekends && (dow === 0 || dow === 6)) continue;
      const dateStr = d.toISOString().slice(0, 10);
      const bounds = dayBounds(dateStr, link.work_start_hour, link.work_end_hour);
      if (!bounds) continue;
      const avail = findAvailability(busy, { dayStartTs: bounds.dayStartTs, dayEndTs: bounds.dayEndTs, slotMinutes: link.duration_minutes });
      for (const slot of avail.slots) {
        let cursor = slot.startAt + (link.buffer_minutes || 0) * 60;
        while (cursor + link.duration_minutes * 60 <= slot.endAt) {
          slots.push({ startAt: cursor, endAt: cursor + link.duration_minutes * 60 });
          cursor += (link.duration_minutes + (link.buffer_minutes || 0)) * 60;
          if (slots.length >= 200) break;
        }
        if (slots.length >= 200) break;
      }
      if (slots.length >= 200) break;
    }
    return { ok: true, slots, durationMinutes: link.duration_minutes };
  }, { note: "Compute available slots for a booking link (public read)" });

  register("calendar", "booking_link_book", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const slug = String(input.slug || "");
    const startAt = Number(input.startAt);
    if (!slug || !startAt) return { ok: false, reason: "slug_and_startAt_required" };
    const link = db.prepare(`SELECT * FROM calendar_booking_links WHERE slug = ? AND active = 1`).get(slug);
    if (!link) return { ok: false, reason: "not_found" };
    const endAt = startAt + link.duration_minutes * 60;
    // Sanity: ensure the slot is still free
    const checkIds = link.check_calendar_ids_json ? _safeJson(link.check_calendar_ids_json, []) : [link.target_calendar_id];
    const conflicts = db.prepare(`
      SELECT id FROM calendar_events
      WHERE calendar_id IN (${checkIds.map(() => "?").join(", ")})
        AND deleted_at IS NULL
        AND start_at < ? AND end_at > ?
      LIMIT 1
    `).get(...checkIds, endAt, startAt);
    if (conflicts) return { ok: false, reason: "slot_taken" };
    const guestName = input.guestName ? String(input.guestName).slice(0, 120) : null;
    const guestEmail = input.guestEmail ? String(input.guestEmail).slice(0, 240) : null;
    const evtR = createEvent(db, {
      calendarId: link.target_calendar_id,
      organizerId: link.owner_id,
      title: `${link.title} — ${guestName || guestEmail || "External booking"}`,
      descriptionHtml: input.message ? `<p>${String(input.message).slice(0, 2000)}</p>` : null,
      startAt, endAt,
      conferencingUrl: link.conferencing_url,
      metaJson: JSON.stringify({ booking_link_id: link.id, guest_email: guestEmail }),
    });
    if (!evtR.ok) return evtR;
    // Attach guest as attendee
    if (guestEmail) {
      db.prepare(`INSERT INTO calendar_attendees (event_id, email, name, role, invited_at) VALUES (?, ?, ?, 'required', ?)`)
        .run(evtR.id, guestEmail, guestName, _now());
    }
    const slotId = `slot:${randomUUID()}`;
    db.prepare(`
      INSERT INTO calendar_booking_slots (id, booking_link_id, event_id, guest_name, guest_email, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(slotId, link.id, evtR.id, guestName, guestEmail, input.message ? String(input.message).slice(0, 2000) : null, _now());
    db.prepare(`UPDATE calendar_booking_links SET booking_count = booking_count + 1 WHERE id = ?`).run(link.id);
    return { ok: true, bookingId: slotId, eventId: evtR.id };
  }, { destructive: true, note: "Confirm a booking via a public booking link (creates event + attendee)" });

  register("calendar", "booking_link_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = db.prepare(`DELETE FROM calendar_booking_links WHERE id = ? AND owner_id = ?`).run(String(input.id), userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Delete a booking link" });

  // Smoking-gun cleanup — calendar_booking_slots was WRITE-ONLY. The
  // booking_confirm macro inserts rows but nothing ever queried them,
  // so the link owner could never see who booked. These two reads
  // close the loop.
  register("calendar", "bookings_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const linkId = String(input.linkId || "");
    if (!linkId) return { ok: false, reason: "linkId_required" };
    const link = db.prepare(`SELECT owner_id FROM calendar_booking_links WHERE id = ?`).get(linkId);
    if (!link) return { ok: false, reason: "not_found" };
    if (link.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 100), 500);
    const rows = db.prepare(`
      SELECT id, booking_link_id, event_id, guest_name, guest_email, message, created_at
      FROM calendar_booking_slots WHERE booking_link_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(linkId, limit);
    return { ok: true, bookings: rows, count: rows.length };
  }, { note: "Bookings against one of MY booking links — closes the write-only gap on calendar_booking_slots" });

  register("calendar", "bookings_mine", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 100), 500);
    const rows = db.prepare(`
      SELECT s.id, s.booking_link_id, s.event_id, s.guest_name, s.guest_email, s.message, s.created_at,
             l.title AS link_title
      FROM calendar_booking_slots s
      INNER JOIN calendar_booking_links l ON l.id = s.booking_link_id
      WHERE l.owner_id = ?
      ORDER BY s.created_at DESC LIMIT ?
    `).all(userId, limit);
    return { ok: true, bookings: rows, count: rows.length };
  }, { note: "All bookings across all of MY booking links" });

  // Smoking-gun cleanup — calendar_links + calendar_subscriptions were
  // READ-ONLY. calendar-ai.js#meeting_prep reads links to enrich the
  // briefing context; iCal feed handler in server.js reads subscription
  // tokens to authenticate. Neither table had a code path that
  // INSERTed rows, so the read code always returned empty. Below are
  // the missing write paths.

  register("calendar", "link_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const eventId = String(input.eventId || "");
    const targetKind = String(input.targetKind || "");
    if (!eventId || !targetKind) return { ok: false, reason: "eventId_and_targetKind_required" };
    const allowed = ["task","doc","dtu","lens","external","project","sprint","world_event","huddle"];
    if (!allowed.includes(targetKind)) return { ok: false, reason: "invalid_target_kind" };
    const evt = db.prepare(`SELECT calendar_id FROM calendar_events WHERE id = ?`).get(eventId);
    if (!evt) return { ok: false, reason: "event_not_found" };
    const cal = db.prepare(`SELECT owner_id FROM calendars WHERE id = ?`).get(evt.calendar_id);
    if (!cal || cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const r = db.prepare(`
      INSERT INTO calendar_links (event_id, target_kind, target_id, target_uri, target_label, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(eventId, targetKind,
      input.targetId ? String(input.targetId).slice(0, 200) : null,
      input.targetUri ? String(input.targetUri).slice(0, 2000) : null,
      input.targetLabel ? String(input.targetLabel).slice(0, 240) : null,
      userId, _now());
    return { ok: true, id: r.lastInsertRowid };
  }, { destructive: true, note: "Link an event to a task/doc/dtu/lens/etc — feeds meeting_prep briefings" });

  register("calendar", "link_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const linkId = Number(input.id);
    if (!linkId) return { ok: false, reason: "id_required" };
    const r = db.prepare(`DELETE FROM calendar_links WHERE id = ? AND created_by = ?`).run(linkId, userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Remove a link from an event" });

  register("calendar", "links_for_event", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const eventId = String(input.eventId || "");
    if (!eventId) return { ok: false, reason: "eventId_required" };
    const links = db.prepare(`SELECT * FROM calendar_links WHERE event_id = ? ORDER BY created_at DESC`).all(eventId);
    return { ok: true, links };
  }, { note: "Links attached to one event" });

  register("calendar", "subscription_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const visibility = ["busy_only","full"].includes(input.visibility) ? input.visibility : "busy_only";
    const calendarIds = Array.isArray(input.calendarIds) ? input.calendarIds.filter((id) => typeof id === "string") : null;
    // Verify caller owns all listed calendars (if specified)
    if (calendarIds && calendarIds.length > 0) {
      const placeholders = calendarIds.map(() => "?").join(", ");
      const mine = db.prepare(`SELECT COUNT(*) AS n FROM calendars WHERE owner_id = ? AND id IN (${placeholders})`).get(userId, ...calendarIds);
      if (mine.n !== calendarIds.length) return { ok: false, reason: "forbidden" };
    }
    const token = `subs:${randomUUID()}`;
    db.prepare(`
      INSERT INTO calendar_subscriptions (id, owner_id, calendar_ids_json, visibility, active, access_count, created_at)
      VALUES (?, ?, ?, ?, 1, 0, ?)
    `).run(token, userId, calendarIds ? JSON.stringify(calendarIds) : null, visibility, _now());
    const feedPath = `/calendars/feed/${token}.ics`;
    return { ok: true, token, feedPath, visibility };
  }, { destructive: true, note: "Create an iCal subscription token (closes the read-only gap on calendar_subscriptions)" });

  register("calendar", "subscription_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const rows = db.prepare(`SELECT id, calendar_ids_json, visibility, active, last_accessed_at, access_count, created_at FROM calendar_subscriptions WHERE owner_id = ? ORDER BY created_at DESC`).all(userId);
    return {
      ok: true,
      subscriptions: rows.map((r) => ({
        token: r.id,
        feedPath: `/calendars/feed/${r.id}.ics`,
        calendarIds: r.calendar_ids_json ? JSON.parse(r.calendar_ids_json) : null,
        visibility: r.visibility,
        active: !!r.active,
        lastAccessedAt: r.last_accessed_at,
        accessCount: r.access_count,
        createdAt: r.created_at,
      })),
    };
  }, { note: "List my iCal subscription tokens" });

  register("calendar", "subscription_revoke", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const token = String(input.token || input.id || "");
    if (!token) return { ok: false, reason: "token_required" };
    const r = db.prepare(`UPDATE calendar_subscriptions SET active = 0 WHERE id = ? AND owner_id = ?`).run(token, userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Disable an iCal subscription token (won't delete history)" });

  // ─── Project ↔ calendar bridge ──────────────────────────────────
  // Surfaces task due dates + sprint windows as virtual calendar
  // events. Non-destructive — these don't insert into calendar_events,
  // just read the tasks tables and project them into the event shape.

  register("calendar", "bridge_tasks", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const windowStartTs = Number(input.windowStartTs) || _now();
    const windowEndTs = Number(input.windowEndTs) || (_now() + 30 * 86400);
    let rows = [];
    try {
      rows = db.prepare(`
        SELECT id, task_key, title, priority, due_at, project_id
        FROM tasks WHERE assignee_id = ? AND due_at IS NOT NULL
          AND deleted_at IS NULL
          AND due_at BETWEEN ? AND ?
        ORDER BY due_at LIMIT 200
      `).all(userId, windowStartTs, windowEndTs);
    } catch { /* tasks schema may be absent */ }
    const virtualEvents = rows.map((t) => ({
      id: `task:${t.id}`,
      kind: "task_due",
      title: `📋 ${t.task_key} ${t.title}`,
      start_at: t.due_at,
      end_at: t.due_at + 1800,
      color: t.priority === "urgent" ? "#ef4444" : t.priority === "high" ? "#f97316" : "#94a3b8",
      project_id: t.project_id,
      task_key: t.task_key,
    }));
    return { ok: true, events: virtualEvents };
  }, { note: "Surface my task due dates as virtual calendar events" });

  register("calendar", "bridge_sprints", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    let rows = [];
    try {
      rows = db.prepare(`
        SELECT s.* FROM task_sprints s
        INNER JOIN project_members pm ON pm.project_id = s.project_id
        WHERE pm.user_id = ? AND s.status IN ('planned','active')
        ORDER BY s.start_at LIMIT 50
      `).all(userId);
    } catch { /* sprints schema may be absent */ }
    const virtualEvents = rows.filter((s) => s.start_at && s.end_at).map((s) => ({
      id: `sprint:${s.id}`,
      kind: "sprint_window",
      title: `🏃 Sprint: ${s.name}`,
      start_at: s.start_at,
      end_at: s.end_at,
      color: s.status === "active" ? "#22c55e" : "#60a5fa",
      project_id: s.project_id,
      all_day: 1,
    }));
    return { ok: true, events: virtualEvents };
  }, { note: "Surface my active/planned sprint windows as virtual calendar events" });

  // ─── World event overlay ────────────────────────────────────────

  register("calendar", "bridge_world_events", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const windowStartTs = Number(input.windowStartTs) || _now();
    const windowEndTs = Number(input.windowEndTs) || (_now() + 14 * 86400);
    let rows = [];
    try {
      rows = db.prepare(`
        SELECT id, kind, world_id, name, description, start_at, end_at, district
        FROM world_events
        WHERE start_at BETWEEN ? AND ?
        ORDER BY start_at LIMIT 200
      `).all(windowStartTs, windowEndTs);
    } catch { /* world_events schema may be absent */ }
    const virtualEvents = rows.map((e) => ({
      id: `world:${e.id}`,
      kind: "world_event",
      title: `🌍 ${e.name || e.kind}`,
      start_at: e.start_at,
      end_at: e.end_at || e.start_at + 3600,
      color: "#a78bfa",
      world_id: e.world_id,
      district: e.district,
    }));
    return { ok: true, events: virtualEvents };
  }, { note: "Surface upcoming Concordia world events in the calendar" });
}
