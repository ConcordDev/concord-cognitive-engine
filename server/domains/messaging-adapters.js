// server/domains/messaging-adapters.js
//
// Sprint C #25 — wires the six dark adapters in lib/messaging/adapters/
// into a unified macro surface. Each adapter already exports:
//   platform, isConfigured(), verifyIncoming(req), parseIncoming(body),
//   sendMessage(channel, text)
// (telegram + a couple others also export registerWebhook /
// sendTyping / sendInteractionResponse — surfaced when present.)
//
// Per-adapter env-gating: CONCORD_<ADAPTER>_ENABLED=true. The activation
// is the operator's call; the wiring lands either way so the UI can
// surface adapter status accurately.

import * as slack from "../lib/messaging/adapters/slack.js";
import * as discord from "../lib/messaging/adapters/discord.js";
import * as telegram from "../lib/messaging/adapters/telegram.js";
import * as signal from "../lib/messaging/adapters/signal.js";
import * as imessage from "../lib/messaging/adapters/imessage.js";
import * as whatsapp from "../lib/messaging/adapters/whatsapp.js";

const ADAPTERS = { slack, discord, telegram, signal, imessage, whatsapp };

function _envEnabled(platform) {
  const key = `CONCORD_${platform.toUpperCase()}_ENABLED`;
  const v = process.env[key];
  return v === "true" || v === "1";
}

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

export default function registerMessagingAdaptersMacros(register) {
  register("messaging", "adapter_list", async () => {
    const list = Object.entries(ADAPTERS).map(([platform, mod]) => ({
      platform,
      env_enabled: _envEnabled(platform),
      configured: typeof mod.isConfigured === "function" ? !!mod.isConfigured() : false,
      capabilities: {
        send: typeof mod.sendMessage === "function",
        receive: typeof mod.parseIncoming === "function",
        verify: typeof mod.verifyIncoming === "function",
        webhook: typeof mod.registerWebhook === "function",
        typing: typeof mod.sendTyping === "function",
        interaction: typeof mod.sendInteractionResponse === "function",
      },
    }));
    return { ok: true, adapters: list };
  }, { note: "List all 6 messaging adapters with env-gate + configured + capability flags" });

  register("messaging", "adapter_status", async (_ctx, input = {}) => {
    const platform = String(input.platform || "");
    const mod = ADAPTERS[platform];
    if (!mod) return { ok: false, reason: "unknown_platform" };
    return {
      ok: true, platform,
      env_enabled: _envEnabled(platform),
      configured: typeof mod.isConfigured === "function" ? !!mod.isConfigured() : false,
    };
  }, { note: "Adapter status check (env_enabled vs configured)" });

  register("messaging", "adapter_send", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const platform = String(input.platform || "");
    const channel = String(input.channel || input.recipient || "");
    const text = String(input.text || input.body || "");
    if (!platform || !channel || !text) return { ok: false, reason: "platform_channel_text_required" };
    const mod = ADAPTERS[platform];
    if (!mod) return { ok: false, reason: "unknown_platform" };
    if (!_envEnabled(platform)) return { ok: false, reason: "adapter_disabled", hint: `Set CONCORD_${platform.toUpperCase()}_ENABLED=true` };
    if (typeof mod.isConfigured === "function" && !mod.isConfigured()) {
      return { ok: false, reason: "adapter_not_configured", hint: `Set the platform's required env vars (token / credentials)` };
    }
    if (typeof mod.sendMessage !== "function") return { ok: false, reason: "send_not_supported" };
    try {
      const r = await mod.sendMessage(channel, text);
      return { ok: true, platform, channel, result: r };
    } catch (err) {
      return { ok: false, reason: "send_failed", error: err?.message };
    }
  }, { destructive: true, note: "Send a message via an external adapter (Slack / Discord / Telegram / Signal / iMessage / WhatsApp). Env-gated + configured-gated." });

  register("messaging", "adapter_inbound", async (ctx, input = {}) => {
    // Called by the webhook route handlers (or polling adapters) to
    // ingest external messages into concord. Creates a kind='external'
    // conversation if one doesn't exist for the (platform, channel)
    // pair, then posts the incoming body as a real concord message.
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const platform = String(input.platform || "");
    const externalChannelId = String(input.channelId || input.channel || "");
    const externalAuthor = String(input.author || "external_user");
    const body = String(input.body || "");
    if (!platform || !externalChannelId || !body) return { ok: false, reason: "platform_channel_body_required" };
    const mod = ADAPTERS[platform];
    if (!mod) return { ok: false, reason: "unknown_platform" };
    // Map external channel to a concord conversation (deterministic id)
    const convId = `external:${platform}:${externalChannelId}`;
    try {
      db.prepare(`
        INSERT INTO conversations (id, kind, title, owner_id, external_source, meta_json, created_at, updated_at)
        VALUES (?, 'external', ?, ?, ?, ?, unixepoch(), unixepoch())
        ON CONFLICT(id) DO UPDATE SET updated_at = unixepoch()
      `).run(convId, `${platform}#${externalChannelId}`.slice(0, 200), "external", platform, JSON.stringify({ platform, externalChannelId }));
      // Post the incoming body as a real message — authored by the
      // external user (we don't have a concord user_id for them, so
      // we use `external:<platform>:<author>` as a synthetic id).
      const { randomUUID } = await import("node:crypto");
      const msgId = `msg_${randomUUID()}`;
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT INTO messages (id, conversation_id, author_id, body, body_kind, mentions_json, server_ts, created_at)
        VALUES (?, ?, ?, ?, 'text', '[]', ?, ?)
      `).run(msgId, convId, `external:${platform}:${externalAuthor}`, body.slice(0, 4000), now, now);
      try {
        globalThis._concordREALTIME?.io?.to(`conversation:${convId}`).emit("msg:new", {
          conversationId: convId, message: { id: msgId, author_id: `external:${platform}:${externalAuthor}`, body, server_ts: now },
        });
      } catch { /* best effort */ }
      return { ok: true, conversationId: convId, messageId: msgId };
    } catch (err) {
      return { ok: false, reason: "ingest_failed", error: err?.message };
    }
  }, { destructive: true, note: "Ingest an external message into a kind='external' concord conversation (used by webhook handlers / polling)" });
}
