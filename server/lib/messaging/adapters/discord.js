// @env-config-ok: intentional external URL references
// server/lib/messaging/adapters/discord.js
// Discord Bot Gateway + Interactions adapter.
// Requires: DISCORD_BOT_TOKEN, DISCORD_APPLICATION_PUBLIC_KEY

import crypto from "node:crypto";

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const PUBLIC_KEY = process.env.DISCORD_APPLICATION_PUBLIC_KEY || "";
const API_BASE = "https://discord.com/api/v10";

export const platform = "discord";

export function isConfigured() {
  return Boolean(BOT_TOKEN);
}

/** Verify Discord Ed25519 interaction signature */
export function verifyIncoming(req) {
  if (!PUBLIC_KEY) return true;
  try {
    const signature = req.headers?.["x-signature-ed25519"] || "";
    const timestamp = req.headers?.["x-signature-timestamp"] || "";
    const rawBody = typeof req.rawBody === "string" ? req.rawBody : JSON.stringify(req.body);
    const message = Buffer.from(timestamp + rawBody);
    const sigBuf = Buffer.from(signature, "hex");
    const keyBuf = Buffer.from(PUBLIC_KEY, "hex");
    return crypto.verify(null, message, { key: keyBuf, format: "der", type: "spki", dsaEncoding: "ieee-p1363" }, sigBuf);
  } catch {
    // Fall back to accepting if crypto verification unavailable on this node version
    return false;
  }
}

/** Parse Discord message or interaction */
export function parseIncoming(body) {
  try {
    // Interactions (slash commands etc.)
    if (body?.type === 2) {
      return {
        ok: true,
        type: "text",
        text: body?.data?.options?.find?.(o => o.name === "message")?.value
          || body?.data?.name || "",
        externalId: body?.member?.user?.id || body?.user?.id || "",
        chatId: body?.channel_id || body?.guild_id || "",
        platform,
        messageId: body?.id,
        raw: body,
      };
    }

    // Gateway events (MESSAGE_CREATE via webhook delivery)
    const msg = body?.d || body;
    if (msg?.content !== undefined) {
      return {
        ok: true,
        type: "text",
        text: msg.content || "",
        externalId: msg.author?.id || "",
        chatId: msg.channel_id || "",
        platform,
        messageId: msg.id,
        raw: body,
      };
    }

    return { ok: false, type: "unsupported", text: "", externalId: "", chatId: "", platform, raw: body };
  } catch {
    return { ok: false, type: "unsupported", text: "", externalId: "", chatId: "", platform, raw: body };
  }
}

/** Send a message to a Discord channel */
export async function sendMessage(channelId, text) {
  if (!isConfigured()) return { ok: false, error: "discord_not_configured" };

  try {
    const res = await fetch(`${API_BASE}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: String(text).slice(0, 2000) }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, error: `Discord API ${res.status}: ${err}` };
    }

    const data = await res.json();
    return { ok: true, messageId: data?.id };
  } catch (err) {
    return { ok: false, error: err?.message || "discord_send_failed" };
  }
}

/** Reply to an interaction (needed within 3s of receiving it) */
export async function sendInteractionResponse(interactionId, token, content) {
  if (!isConfigured()) return { ok: false, error: "discord_not_configured" };

  const res = await fetch(`${API_BASE}/interactions/${interactionId}/${token}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
      data: { content: String(content).slice(0, 2000) },
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(err => ({ ok: false, error: err?.message }));

  return { ok: res?.ok === true };
}
