// server/emergent/announcement-broadcaster.js
//
// Phase BB3 — operator announcements broadcast heartbeat.
//
// Frequency 60 (~15 min). Pulls any announcement rows that haven't
// been broadcast yet (`last_broadcast_at IS NULL`), marks them
// broadcast inside dequeueBroadcastBatch, and emits a
// `concord:announcement` socket event so all connected clients can
// surface the banner.
//
// Scope global — one announcement is for the whole player base, not
// per world. Kill-switch CONCORD_ANNOUNCEMENTS_ENABLED=0.

import logger from "../logger.js";
import { dequeueBroadcastBatch, sweepExpiredAnnouncements } from "../lib/announcements.js";

export function runAnnouncementBroadcaster({ db, io } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (process.env.CONCORD_ANNOUNCEMENTS_ENABLED === "0") {
    return { ok: true, skipped: "disabled_by_env" };
  }

  try {
    sweepExpiredAnnouncements(db);
    const batch = dequeueBroadcastBatch(db, 20);
    for (const ann of batch) {
      try {
        io?.emit?.("concord:announcement", {
          id: ann.id, kind: ann.kind, title: ann.title,
          body_md: ann.body_md, published_at: ann.published_at,
        });
      } catch (err) {
        logger.debug?.("announcement-broadcaster", "emit_failed", { error: err?.message });
      }
    }
    if (batch.length > 0) {
      logger.info?.("announcement-broadcaster", "tick", { broadcast: batch.length });
    }
    return { ok: true, broadcast: batch.length };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}
