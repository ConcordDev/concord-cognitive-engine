// server/domains/gmail.js
//
// Track C — real Gmail connector. Thin macros over the SSRF-guarded connector
// egress (lib/connector-client.js), which reads the user's stored OAuth token
// (connector_id "google_gmail") with auto refresh rotation. Outbound send +
// inbound read/modify (list, get, mark-read, star, archive, trash, labels).
// Honest reason codes when no token / not configured — never faked data.

import {
  writeGmailMessage,
  readGmailMessages,
  readGmailMessage,
  modifyGmailMessage,
  trashGmailMessage,
  listGmailLabels,
} from "../lib/connector-client.js";

// Real gate is token presence (connectorFetch returns no_token/connector_not_configured
// without GOOGLE_CLIENT_ID + a stored grant). This kill-switch lets an operator
// hard-disable the surface regardless. Default on.
const GMAIL_ENABLED = process.env.CONCORD_GMAIL_ENABLED !== "0";

export default function registerGmailActions(registerLensAction) {
  const uid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const guard = (ctx) => {
    if (!GMAIL_ENABLED) return { ok: false, reason: "gmail_disabled" };
    const userId = uid(ctx);
    if (!userId || userId === "anon") return { ok: false, reason: "no_user" };
    if (!ctx?.db) return { ok: false, error: "db unavailable" };
    return null;
  };

  registerLensAction("gmail", "send", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    try {
      const mail = params.mail || params;
      if (!mail.to) return { ok: false, error: "mail.to required" };
      const res = await writeGmailMessage(ctx.db, uid(ctx), mail);
      if (!res.ok) return { ok: false, reason: res.reason || "send_failed", detail: res };
      return { ok: true, result: { sent: true, providerMessageId: res.data?.id || null, threadId: res.data?.threadId || null } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // List inbox messages (hydrated with From/Subject/Date/snippet/labels).
  // params: { q?, labelIds?, maxResults?, pageToken? }
  registerLensAction("gmail", "list", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    try {
      const res = await readGmailMessages(ctx.db, uid(ctx), {
        q: params.q,
        labelIds: params.labelIds ?? (params.label ? [params.label] : ["INBOX"]),
        maxResults: params.maxResults,
        pageToken: params.pageToken,
      });
      if (!res.ok) return { ok: false, reason: res.reason || "list_failed", detail: res };
      return { ok: true, result: { messages: res.messages, nextPageToken: res.nextPageToken, resultSizeEstimate: res.resultSizeEstimate } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Read one message in full (parsed body text/html). params: { messageId }
  registerLensAction("gmail", "get", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    const messageId = params.messageId || params.id;
    if (!messageId) return { ok: false, error: "messageId required" };
    try {
      const res = await readGmailMessage(ctx.db, uid(ctx), messageId, { format: "full" });
      if (!res.ok) return { ok: false, reason: res.reason || "get_failed", detail: res };
      return { ok: true, result: { message: res.message } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Label modify: mark read/unread, star/unstar, archive. params:
  // { messageId, addLabelIds?, removeLabelIds? } OR a semantic { action: 'read'|'unread'|'star'|'unstar'|'archive' }
  registerLensAction("gmail", "modify", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    const messageId = params.messageId || params.id;
    if (!messageId) return { ok: false, error: "messageId required" };
    const SEMANTIC = {
      read: { removeLabelIds: ["UNREAD"] },
      unread: { addLabelIds: ["UNREAD"] },
      star: { addLabelIds: ["STARRED"] },
      unstar: { removeLabelIds: ["STARRED"] },
      archive: { removeLabelIds: ["INBOX"] },
    };
    const mods = params.action ? SEMANTIC[params.action] : { addLabelIds: params.addLabelIds, removeLabelIds: params.removeLabelIds };
    if (!mods) return { ok: false, error: `unknown action: ${params.action}` };
    try {
      const res = await modifyGmailMessage(ctx.db, uid(ctx), messageId, mods);
      if (!res.ok) return { ok: false, reason: res.reason || "modify_failed", detail: res };
      return { ok: true, result: { messageId, labelIds: res.data?.labelIds || [] } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Move a message to Trash. params: { messageId }
  registerLensAction("gmail", "trash", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    const messageId = params.messageId || params.id;
    if (!messageId) return { ok: false, error: "messageId required" };
    try {
      const res = await trashGmailMessage(ctx.db, uid(ctx), messageId);
      if (!res.ok) return { ok: false, reason: res.reason || "trash_failed", detail: res };
      return { ok: true, result: { messageId, trashed: true } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // List the user's Gmail labels (for inbox filter chips).
  registerLensAction("gmail", "labels", async (ctx, _a, _params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    try {
      const res = await listGmailLabels(ctx.db, uid(ctx));
      if (!res.ok) return { ok: false, reason: res.reason || "labels_failed", detail: res };
      return { ok: true, result: { labels: res.labels } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Surfaces the connector-OAuth authorize URL the frontend redirects to. A full
  // client needs read + modify + send, so we request gmail.modify (read+label
  // changes) and gmail.send. Tokens persist under connector_id "google_gmail".
  registerLensAction("gmail", "connect", (_ctx, _a, params = {}) => {
    const scopes = [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ];
    const qs = new URLSearchParams({ token_key: "google_gmail", scopes: scopes.join(" ") });
    if (params.redirect) qs.set("redirect", String(params.redirect));
    return { ok: true, result: { provider: "google", authorizeUrl: `/api/oauth/google/authorize?${qs.toString()}`, scopes } };
  });
}
