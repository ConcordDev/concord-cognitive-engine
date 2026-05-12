// @env-config-ok: intentional external URL references
// server/lib/messaging/adapters/whatsapp.js
// WhatsApp Cloud API adapter (Meta Graph API v19+).
// Requires: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_WEBHOOK_SECRET

import crypto from "node:crypto";

const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || "";
const API_BASE = "https://graph.facebook.com/v19.0";

export const platform = "whatsapp";

export function isConfigured() {
  return Boolean(PHONE_ID && ACCESS_TOKEN);
}

/** Verify Meta webhook signature (X-Hub-Signature-256 header) */
export function verifyIncoming(req) {
  if (!WEBHOOK_SECRET) return true; // skip verification if secret not set
  const signature = req.headers?.["x-hub-signature-256"] || "";
  if (!signature.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** Parse a WhatsApp Cloud API inbound webhook body */
export function parseIncoming(body) {
  try {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (!msg) return { ok: false, type: "unsupported", text: "", externalId: "", chatId: "", platform, raw: body };

    const type = msg.type === "text" ? "text"
      : msg.type === "image" ? "image"
      : msg.type === "audio" ? "voice"
      : "unsupported";

    return {
      ok: true,
      type,
      text: msg.text?.body || msg.caption || "",
      externalId: msg.from,
      chatId: change?.value?.metadata?.phone_number_id || PHONE_ID,
      platform,
      messageId: msg.id,
      raw: body,
    };
  } catch {
    return { ok: false, type: "unsupported", text: "", externalId: "", chatId: "", platform, raw: body };
  }
}

/** Send a text message via WhatsApp Cloud API */
export async function sendMessage(to, text) {
  if (!isConfigured()) return { ok: false, error: "whatsapp_not_configured" };

  try {
    const res = await fetch(`${API_BASE}/${PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: String(text).slice(0, 4096) },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, error: `WhatsApp API ${res.status}: ${err}` };
    }

    const data = await res.json();
    return { ok: true, messageId: data?.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: err?.message || "whatsapp_send_failed" };
  }
}

/** Handle the Meta webhook verification GET request */
export function handleVerificationChallenge(query) {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && token === WEBHOOK_SECRET) {
    return { ok: true, challenge };
  }
  return { ok: false };
}
