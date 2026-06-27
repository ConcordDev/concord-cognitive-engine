// server/domains/announcements.js
//
// Per-lens flawless loop — macro surface for the operator announcements
// lens (`/lenses/announcements`).
//
// The page reads the REST route GET /api/announcements (public) and the
// admin-only POST /api/announcements. These macros expose the SAME engine
// surface through runMacro so the generic lens shell, ⌘K palette, and the
// Orchestrated Invariant Engine (contract: announcements.*) reach them via
// the uniform macro path. All logic delegates to ../lib/announcements.js —
// nothing is duplicated here.
//
// - announcements.list   — public read (mirrors GET /api/announcements).
// - announcements.get    — public read; single announcement by id.
// - announcements.post   — admin-gated publish (mirrors POST /api/announcements).
//   The admin gate is enforced IN-HANDLER off ctx.actor.role so the macro
//   path carries the same authority as the route. Non-admin → admin_only.

import {
  publishAnnouncement,
  listRecentAnnouncements,
  VALID_KINDS,
} from "../lib/announcements.js";

export default function registerAnnouncementMacros(register) {
  /**
   * announcements.list — recent, non-expired operator announcements.
   * input: { kind?, limit? }
   * Public read — same data GET /api/announcements serves.
   */
  register("announcements", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const kind = input.kind && VALID_KINDS.has(input.kind) ? input.kind : undefined;
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    return { ok: true, announcements: listRecentAnnouncements(db, { kind, limit }) };
  }, { note: "recent operator announcements (public read)" });

  /**
   * announcements.get — a single non-expired announcement by id.
   * input: { id }
   * Public read.
   */
  register("announcements", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.id) return { ok: false, reason: "missing_id" };
    // listRecentAnnouncements already applies the expiry filter; find by id
    // off the recent window (cap raised so id lookups don't miss).
    const all = listRecentAnnouncements(db, { limit: 200 });
    const found = all.find((a) => a.id === input.id);
    if (!found) return { ok: false, reason: "unknown_announcement" };
    return { ok: true, announcement: found };
  }, { note: "single operator announcement by id (public read)" });

  /**
   * announcements.post — publish a new announcement. ADMIN ONLY.
   * input: { kind, title, body, expiresAt?, dtuAttachmentId? }
   * Mirrors POST /api/announcements; the admin gate is enforced here off
   * ctx.actor.role so the macro path can't bypass the route's authority.
   */
  register("announcements", "post", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const role = ctx?.actor?.role || "";
    if (role !== "admin") return { ok: false, error: "admin_only" };
    const authorUserId = ctx?.actor?.userId || ctx?.actor?.id || null;
    return publishAnnouncement(db, {
      kind: input.kind,
      title: input.title,
      body: input.body,
      expiresAt: input.expiresAt,
      dtuAttachmentId: input.dtuAttachmentId,
      authorUserId,
    });
  }, { note: "publish an operator announcement (admin only)" });
}
