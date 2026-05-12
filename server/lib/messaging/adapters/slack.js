// @env-config-ok: intentional external URL references
// server/lib/messaging/adapters/slack.js
// Slack Bot API adapter using Events API + Web API.
// Requires: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET

import crypto from "node:crypto";

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";
const API_BASE = "https://slack.com/api";

export const platform = "slack";

export function isConfigured() {
  return Boolean(BOT_TOKEN);
}

/** Verify Slack request signature (HMAC-SHA256 with timestamp anti-replay) */
export function verifyIncoming(req) {
  if (!SIGNING_SECRET) return true;
  try {
    const timestamp = req.headers?.["x-slack-request-timestamp"] || "";
    const signature = req.headers?.["x-slack-signature"] || "";
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (age > 300) return false; // replay attack window

    const rawBody = typeof req.rawBody === "string" ? req.rawBody : JSON.stringify(req.body);
    const sigBase = `v0:${timestamp}:${rawBody}`;
    const expected = "v0=" + crypto.createHmac("sha256", SIGNING_SECRET).update(sigBase).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Parse Slack Events API payload */
export function parseIncoming(body) {
  try {
    // URL verification challenge
    if (body?.type === "url_verification") {
      return { ok: true, type: "unsupported", text: "", externalId: "", chatId: "", platform, raw: body, _challenge: body.challenge };
    }

    const event = body?.event;
    if (!event || event.type !== "message" || event.bot_id || event.subtype === "bot_message") {
      return { ok: false, type: "unsupported", text: "", externalId: "", chatId: "", platform, raw: body };
    }

    return {
      ok: true,
      type: "text",
      text: event.text || "",
      externalId: event.user || "",
      chatId: event.channel || "",
      platform,
      messageId: event.ts || String(Date.now()),
      raw: body,
    };
  } catch {
    return { ok: false, type: "unsupported", text: "", externalId: "", chatId: "", platform, raw: body };
  }
}

/** Post a message to a Slack channel via chat.postMessage */
export async function sendMessage(channel, text) {
  if (!isConfigured()) return { ok: false, error: "slack_not_configured" };

  try {
    const res = await fetch(`${API_BASE}/chat.postMessage`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: String(text).slice(0, 40000),
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, error: `Slack API ${res.status}: ${err}` };
    }

    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.error || "slack_api_error" };
    return { ok: true, messageId: data.ts };
  } catch (err) {
    return { ok: false, error: err?.message || "slack_send_failed" };
  }
}

/** Send a typing indicator to a Slack channel */
export async function sendTyping(channelId) {
  // Slack does not support per-message typing indicator for bots via the Web API
  // This is a no-op stub for interface compatibility
  return { ok: true };
}
