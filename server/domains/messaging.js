// server/domains/messaging.js — Phase I5 cross-platform messaging
// binding surface (whatsapp/slack/sms/email). Backed by the
// messaging_adapters table from mig 056.

import crypto from "node:crypto";

export default function registerMessagingMacros(register) {
  register("messaging", "list_bindings", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "missing_inputs" };
    try {
      const rows = db.prepare(`
        SELECT id, user_id, platform, handle, is_default, connected_at
        FROM messaging_adapters WHERE user_id = ?
        ORDER BY is_default DESC, platform
      `).all(userId);
      return { ok: true, bindings: rows };
    } catch {
      return { ok: true, bindings: [], reason: "messaging_adapters_missing" };
    }
  }, { note: "List player's cross-platform messaging bindings." });

  register("messaging", "add_binding", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "missing_inputs" };
    const { platform, handle } = input || {};
    if (!platform || !handle) return { ok: false, reason: "missing_inputs" };
    const id = `msg_${crypto.randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO messaging_adapters (id, user_id, platform, handle, is_default)
        VALUES (?, ?, ?, ?, 0)
      `).run(id, userId, platform, handle);
      return { ok: true, id };
    } catch (err) {
      return { ok: false, reason: "add_failed", error: err?.message };
    }
  }, { note: "Add a binding for a platform." });

  register("messaging", "remove_binding", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "missing_inputs" };
    const { id } = input || {};
    if (!id) return { ok: false, reason: "missing_id" };
    try {
      const r = db.prepare(`DELETE FROM messaging_adapters WHERE id = ? AND user_id = ?`).run(id, userId);
      return { ok: r.changes > 0 };
    } catch (err) {
      return { ok: false, reason: "remove_failed", error: err?.message };
    }
  }, { note: "Remove a binding (owner-only)." });

  register("messaging", "set_default", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "missing_inputs" };
    const { id } = input || {};
    if (!id) return { ok: false, reason: "missing_id" };
    try {
      db.transaction(() => {
        db.prepare(`UPDATE messaging_adapters SET is_default = 0 WHERE user_id = ?`).run(userId);
        db.prepare(`UPDATE messaging_adapters SET is_default = 1 WHERE id = ? AND user_id = ?`).run(id, userId);
      })();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: "set_default_failed", error: err?.message };
    }
  }, { note: "Mark a binding as the user's default." });
}
