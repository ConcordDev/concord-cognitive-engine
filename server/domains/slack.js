// server/domains/slack.js
//
// Real Slack connector. Thin macros over the SSRF-guarded connector egress
// (lib/connector-client.js), which reads the user's stored OAuth token
// (connector_id "slack") with Bearer auth. Inbound read (channels, history) +
// outbound write (post). Honest reason codes when no token / not configured —
// never faked data. Mirrors the Gmail/Calendar Track-C pattern.

import { listSlackChannels, readSlackMessages, postSlackMessage } from "../lib/connector-client.js";

// Real gate is token presence (connectorFetch returns no_token without a stored
// grant). This kill-switch lets an operator hard-disable the surface. Default on.
const SLACK_ENABLED = process.env.CONCORD_SLACK_ENABLED !== "0";

export default function registerSlackActions(registerLensAction) {
  const uid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  // Mirror the connector reason into `error` too: the frontend lensRun()
  // normalizer surfaces `error` (not `reason`), so the UI can switch on
  // "no_token" to show the Connect-Slack state.
  const fail = (res, fallback) => {
    const reason = res?.reason || fallback;
    return { ok: false, reason, error: reason, detail: res };
  };
  const guard = (ctx) => {
    if (!SLACK_ENABLED) return { ok: false, reason: "slack_disabled", error: "slack_disabled" };
    const userId = uid(ctx);
    if (!userId || userId === "anon") return { ok: false, reason: "no_user", error: "no_user" };
    if (!ctx?.db) return { ok: false, error: "db unavailable" };
    return null;
  };

  // List channels the token can see. params: { limit?, cursor?, types? }
  registerLensAction("slack", "channels", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    try {
      const res = await listSlackChannels(ctx.db, uid(ctx), { limit: params.limit, cursor: params.cursor, types: params.types });
      if (!res.ok) return fail(res, "channels_failed");
      return { ok: true, result: { channels: res.channels, nextCursor: res.nextCursor } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Read recent messages from a channel. params: { channel, limit?, cursor?, oldest? }
  registerLensAction("slack", "history", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    const channel = params.channel || params.channelId;
    if (!channel) return { ok: false, error: "channel required" };
    try {
      const res = await readSlackMessages(ctx.db, uid(ctx), channel, { limit: params.limit, cursor: params.cursor, oldest: params.oldest });
      if (!res.ok) return fail(res, "history_failed");
      return { ok: true, result: { messages: res.messages, nextCursor: res.nextCursor } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Post a message to a channel. params: { channel, text }
  registerLensAction("slack", "post", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    const channel = params.channel || params.channelId;
    if (!channel) return { ok: false, error: "channel required" };
    if (!params.text) return { ok: false, error: "text required" };
    try {
      const res = await postSlackMessage(ctx.db, uid(ctx), channel, params.text);
      if (!res.ok) return fail(res, "post_failed");
      return { ok: true, result: { posted: true, ts: res.ts, channel: res.channel } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Surfaces the connector-OAuth authorize URL the frontend redirects to.
  // Tokens persist under connector_id "slack". Read channels + history + write.
  registerLensAction("slack", "connect", (_ctx, _a, params = {}) => {
    const scopes = ["channels:read", "channels:history", "chat:write"];
    const qs = new URLSearchParams({ token_key: "slack", scopes: scopes.join(",") });
    if (params.redirect) qs.set("redirect", String(params.redirect));
    return { ok: true, result: { provider: "slack", authorizeUrl: `/api/oauth/slack/authorize?${qs.toString()}`, scopes } };
  });
}
