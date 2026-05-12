// @env-config-ok: intentional external URL references
// server/lib/messaging/adapters/telegram.js
// Telegram Bot API adapter.
// Requires: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (optional)

import crypto from "node:crypto";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

export const platform = "telegram";

export function isConfigured() {
  return Boolean(BOT_TOKEN);
}

/** Verify X-Telegram-Bot-Api-Secret-Token header */
export function verifyIncoming(req) {
  if (!WEBHOOK_SECRET) return true;
  const token = req.headers?.["x-telegram-bot-api-secret-token"] || "";
  return token === WEBHOOK_SECRET;
}

/** Parse Telegram Update object */
export function parseIncoming(body) {
  try {
    const msg = body?.message || body?.edited_message || body?.channel_post;
    if (!msg) return { ok: false, type: "unsupported", text: "", externalId: "", chatId: "", platform, raw: body };

    const type = msg.text ? "text"
      : msg.photo ? "image"
      : msg.voice || msg.audio ? "voice"
      : msg.sticker ? "sticker"
      : msg.document ? "file"
      : "unsupported";

    return {
      ok: true,
      type,
      text: msg.text || msg.caption || "",
      externalId: String(msg.from?.id || ""),
      chatId: String(msg.chat?.id || ""),
      platform,
      messageId: String(msg.message_id),
      raw: body,
    };
  } catch {
    return { ok: false, type: "unsupported", text: "", externalId: "", chatId: "", platform, raw: body };
  }
}

/** Send a message via Telegram Bot API */
export async function sendMessage(chatId, text) {
  if (!isConfigured()) return { ok: false, error: "telegram_not_configured" };

  try {
    const res = await fetch(`${API_BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text).slice(0, 4096),
        parse_mode: "HTML",
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, error: `Telegram API ${res.status}: ${err}` };
    }

    const data = await res.json();
    return { ok: true, messageId: String(data?.result?.message_id || "") };
  } catch (err) {
    return { ok: false, error: err?.message || "telegram_send_failed" };
  }
}

/** Register this bot's webhook URL with Telegram */
export async function registerWebhook(webhookUrl) {
  if (!isConfigured()) return { ok: false, error: "telegram_not_configured" };

  const body = { url: webhookUrl };
  if (WEBHOOK_SECRET) body.secret_token = WEBHOOK_SECRET;

  const res = await fetch(`${API_BASE}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(err => ({ ok: false, error: err?.message }));

  if (!res?.ok) return { ok: false };
  const data = await res.json().catch(() => null);
  return { ok: data?.ok === true };
}
