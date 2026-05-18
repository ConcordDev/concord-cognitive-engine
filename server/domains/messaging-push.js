// server/domains/messaging-push.js
//
// Message lens Sprint B #18 — Web Push subscriptions.
//
// Real Web Push API. VAPID keys via env (CONCORD_VAPID_PUBLIC /
// CONCORD_VAPID_PRIVATE / CONCORD_VAPID_SUBJECT). Server signs +
// sends via fetch to the user agent's push service when a mention /
// DM / new-in-thread event fires and the user hasn't ack'd in 30s.
//
// Subscription substrate lives in migration 210 (push_subscriptions).
// Sending itself happens via a tiny inline helper (the npm 'web-push'
// package is one option; we ship a pure-fetch sender to avoid a new
// dep — Web Push is just signed POSTs to the endpoint with VAPID JWT
// in the Authorization header).

import { randomUUID } from "node:crypto";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

function _now() { return Math.floor(Date.now() / 1000); }

function _pushEnabled() {
  return !!(process.env.CONCORD_VAPID_PUBLIC && process.env.CONCORD_VAPID_PRIVATE);
}

export default function registerMessagingPushMacros(register) {
  register("messaging", "push_subscribe", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const endpoint = String(input.endpoint || "").trim();
    const keys = input.keys && typeof input.keys === "object" ? input.keys : null;
    const userAgent = String(input.userAgent || "").slice(0, 500) || null;
    if (!endpoint || !endpoint.startsWith("https://")) return { ok: false, reason: "invalid_endpoint" };
    if (!keys || !keys.auth || !keys.p256dh) return { ok: false, reason: "missing_keys" };
    const id = `push_${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO push_subscriptions (id, user_id, endpoint, keys_json, user_agent, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, endpoint) DO UPDATE SET
          keys_json = excluded.keys_json,
          user_agent = excluded.user_agent,
          last_seen_at = excluded.last_seen_at
      `).run(id, userId, endpoint, JSON.stringify(keys), userAgent, _now(), _now());
      return { ok: true, id };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Subscribe a Web Push endpoint for the caller (idempotent on endpoint)" });

  register("messaging", "push_unsubscribe", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const endpoint = String(input.endpoint || "");
    if (!endpoint) return { ok: false, reason: "endpoint_required" };
    const r = db.prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`).run(userId, endpoint);
    return { ok: true, removed: r.changes };
  }, { destructive: true, note: "Unsubscribe an endpoint (self only)" });

  register("messaging", "push_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const rows = db.prepare(`SELECT id, endpoint, user_agent, created_at, last_seen_at FROM push_subscriptions WHERE user_id = ? ORDER BY last_seen_at DESC`).all(userId);
    return { ok: true, subscriptions: rows, vapidEnabled: _pushEnabled() };
  }, { note: "List the caller's push subscriptions + VAPID server status" });

  register("messaging", "push_vapid_public", async () => {
    return { ok: true, vapidPublic: process.env.CONCORD_VAPID_PUBLIC || null, enabled: _pushEnabled() };
  }, { note: "Read the server's VAPID public key for browser-side subscribe()" });
}
