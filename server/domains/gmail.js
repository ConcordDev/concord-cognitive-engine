// server/domains/gmail.js
//
// Track C fan-out — outbound Gmail. A thin push macro over the real connector
// egress (lib/connector-client.js#writeGmailMessage), which reads the user's
// stored OAuth token (connector_id "google_gmail", scope gmail.send) with
// refresh rotation. Honest reason codes when no token / not configured — never
// a faked send.

import { writeGmailMessage } from "../lib/connector-client.js";

export default function registerGmailActions(registerLensAction) {
  const uid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";

  registerLensAction("gmail", "send", async (ctx, _a, params = {}) => {
    try {
      const userId = uid(ctx);
      const mail = params.mail || params;
      if (!mail.to) return { ok: false, error: "mail.to required" };
      const res = await writeGmailMessage(ctx.db, userId, mail);
      if (!res.ok) return { ok: false, reason: res.reason || "send_failed", detail: res };
      return { ok: true, result: { sent: true, providerMessageId: res.data?.id || null, threadId: res.data?.threadId || null } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Surfaces the connector-OAuth authorize URL the frontend redirects to so the
  // user grants gmail.send. Tokens persist under connector_id "google_gmail".
  registerLensAction("gmail", "connect", (_ctx, _a, params = {}) => {
    const scope = "https://www.googleapis.com/auth/gmail.send";
    const qs = new URLSearchParams({ token_key: "google_gmail", scopes: scope });
    if (params.redirect) qs.set("redirect", String(params.redirect));
    return { ok: true, result: { provider: "google", authorizeUrl: `/api/oauth/google/authorize?${qs.toString()}`, scopes: [scope] } };
  });
}
