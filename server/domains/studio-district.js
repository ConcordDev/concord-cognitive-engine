// server/domains/studio-district.js
//
// Studio Sprint C Item #13 — cross-lens audio-to-world hooks.
//
// Composers list their tracks as district soundscapes. When a world
// event in that district fires endEvent, the soundscape composer
// earns a per-attendee CC micro-credit (the per-attendee math lives
// in lib/world-events.js#endEvent, gated on
// event.meta.soundscape_track_dtu_id).

import crypto from "node:crypto";

const MIN_CC_PER_ATTENDEE = 0.001;
const MAX_CC_PER_ATTENDEE = 1.0;

function clampPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 0.01;
  return Math.min(MAX_CC_PER_ATTENDEE, Math.max(MIN_CC_PER_ATTENDEE, n));
}

export default function registerStudioDistrictMacros(register) {
  // List a track DTU as a district soundscape — sets per-attendee
  // pricing + tags the track so event-host UIs can find it.
  register("studio", "list_for_district", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };

    const trackDtuId = String(input.track_dtuId || "").trim();
    if (!trackDtuId) return { ok: false, reason: "track_dtuId_required" };
    const districtId = String(input.district_id || "concordia-hub").trim();
    const ccPerAttendee = clampPrice(input.cc_per_attendee);

    // Check ownership.
    let track;
    try {
      track = db.prepare("SELECT id, creator_id, meta_json FROM dtus WHERE id = ?").get(trackDtuId);
    } catch { /* dtus optional */ }
    if (!track) return { ok: false, reason: "track_not_found" };
    if (track.creator_id !== userId) return { ok: false, reason: "not_track_owner" };

    let meta = {};
    try { meta = JSON.parse(track.meta_json || "{}"); } catch { /* meta optional */ }
    const listings = Array.isArray(meta.district_listings) ? meta.district_listings : [];
    const existingIdx = listings.findIndex(l => l.district_id === districtId);
    const listing = {
      district_id: districtId,
      cc_per_attendee: ccPerAttendee,
      listed_by: userId,
      listed_at: Math.floor(Date.now() / 1000),
    };
    if (existingIdx >= 0) listings[existingIdx] = listing;
    else listings.push(listing);
    meta.district_listings = listings;
    try {
      db.prepare("UPDATE dtus SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), trackDtuId);
    } catch (err) {
      return { ok: false, reason: "update_failed", error: err?.message };
    }
    return { ok: true, listing };
  }, { note: "list a track as a district soundscape with per-attendee pricing" });

  // Read path — find soundscape candidates available for a district.
  register("studio", "list_district_soundscapes", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const districtId = String(input.district_id || "concordia-hub").trim();
    const limit = Math.max(1, Math.min(100, parseInt(input.limit) || 50));
    try {
      const like = `%"district_id":"${districtId}"%`;
      const rows = db.prepare(`
        SELECT id, title, creator_id, meta_json, created_at FROM dtus
          WHERE kind IN ('audio', 'audio_capture', 'session')
            AND meta_json LIKE ?
          ORDER BY created_at DESC LIMIT ?
      `).all(like, limit);
      const tracks = [];
      for (const r of rows) {
        let meta = {};
        try { meta = JSON.parse(r.meta_json || "{}"); } catch { /* meta optional */ }
        const match = (meta.district_listings || []).find(l => l.district_id === districtId);
        if (match) {
          tracks.push({
            id: r.id, title: r.title, creator_id: r.creator_id,
            cc_per_attendee: match.cc_per_attendee, listed_at: match.listed_at,
          });
        }
      }
      return { ok: true, tracks };
    } catch (err) {
      return { ok: false, reason: "query_failed", error: err?.message };
    }
  }, { note: "list soundscape tracks available for a district" });

  // Attach a soundscape to an event. Idempotent: re-attaching updates
  // the meta inline. The event-host UI calls this; the actual payout
  // fires when endEvent runs.
  register("studio", "attach_soundscape", async (ctx, input = {}) => {
    const eventId = String(input.event_id || "").trim();
    const trackDtuId = String(input.track_dtuId || "").trim();
    if (!eventId || !trackDtuId) return { ok: false, reason: "missing_ids" };
    const ccPerAttendee = clampPrice(input.cc_per_attendee);
    try {
      const { getEvent } = await import("../lib/world-events.js");
      const event = getEvent?.(eventId);
      if (!event) return { ok: false, reason: "event_not_found" };
      // Authority: event host or admin.
      const userId = ctx?.actor?.userId;
      if (event.hostId && event.hostId !== userId) return { ok: false, reason: "not_event_host" };
      event.meta = event.meta || {};
      event.meta.soundscape_track_dtu_id = trackDtuId;
      event.meta.soundscape_cc_per_attendee = ccPerAttendee;
      event.updatedAt = new Date().toISOString();
      return { ok: true, eventId, soundscape_track_dtu_id: trackDtuId, cc_per_attendee: ccPerAttendee };
    } catch (err) {
      return { ok: false, reason: "attach_failed", error: err?.message };
    }
  }, { note: "attach a track DTU as a district event's soundscape (host-only)" });
}

// Internal — used by tests via direct import.
export const _internal = { clampPrice, MIN_CC_PER_ATTENDEE, MAX_CC_PER_ATTENDEE };
