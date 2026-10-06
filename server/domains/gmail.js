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
  untrashGmailMessage,
  getGmailProfile,
  readGmailThreads,
  readGmailThread,
  modifyGmailThread,
  trashGmailThread,
  untrashGmailThread,
  getGmailAttachment,
  createGmailLabel,
  listGmailDrafts,
  saveGmailDraft,
  sendGmailDraft,
  deleteGmailDraft,
} from "../lib/connector-client.js";

// Real gate is token presence (connectorFetch returns no_token/connector_not_configured
// without GOOGLE_CLIENT_ID + a stored grant). This kill-switch lets an operator
// hard-disable the surface regardless. Default on.
const GMAIL_ENABLED = process.env.CONCORD_GMAIL_ENABLED !== "0";

export default function registerGmailActions(registerLensAction) {
  const uid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  // Mirror the connector reason into `error` too: the frontend lensRun()
  // normalizer surfaces `error` (not `reason`), so the inbox UI can switch on
  // "no_token"/"connector_not_configured" to show the Connect-Gmail state.
  const fail = (res, fallback) => {
    const reason = res?.reason || fallback;
    return { ok: false, reason, error: reason, detail: res };
  };
  const guard = (ctx) => {
    if (!GMAIL_ENABLED) return { ok: false, reason: "gmail_disabled", error: "gmail_disabled" };
    const userId = uid(ctx);
    if (!userId || userId === "anon") return { ok: false, reason: "no_user", error: "no_user" };
    if (!ctx?.db) return { ok: false, error: "db unavailable" };
    return null;
  };

  registerLensAction("gmail", "send", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    try {
      const mail = params.mail || params;
      if (!mail.to) return { ok: false, error: "mail.to required" };
      const res = await writeGmailMessage(ctx.db, uid(ctx), mail);
      if (!res.ok) return fail(res, "send_failed");
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
      if (!res.ok) return fail(res, "list_failed");
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
      if (!res.ok) return fail(res, "get_failed");
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
      if (!res.ok) return fail(res, "modify_failed");
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
      if (!res.ok) return fail(res, "trash_failed");
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
      if (!res.ok) return fail(res, "labels_failed");
      return { ok: true, result: { labels: res.labels } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // A thin wrapper: guard, run, map an honest connector failure, shape result.
  const run = (name, fn, shape) => registerLensAction("gmail", name, async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    try {
      const pre = fn.validate ? fn.validate(params) : null;
      if (pre) return { ok: false, error: pre };
      const res = await fn(ctx.db, uid(ctx), params);
      if (!res.ok) return fail(res, `${name}_failed`);
      return { ok: true, result: shape(res, params) };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });
  const need = (key) => (p) => (p[key] ? null : `${key} required`);
  const THREAD_SEMANTIC = {
    read: { removeLabelIds: ["UNREAD"] },
    unread: { addLabelIds: ["UNREAD"] },
    star: { addLabelIds: ["STARRED"] },
    unstar: { removeLabelIds: ["STARRED"] },
    archive: { removeLabelIds: ["INBOX"] },
    inbox: { addLabelIds: ["INBOX"] },
    spam: { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
    "not-spam": { removeLabelIds: ["SPAM"], addLabelIds: ["INBOX"] },
    important: { addLabelIds: ["IMPORTANT"] },
    "not-important": { removeLabelIds: ["IMPORTANT"] },
  };

  // Conversations (Gmail's default view). params: { q?, label?|labelIds?, maxResults?, pageToken? }
  const threadsFn = (db, u, p) => readGmailThreads(db, u, {
    q: p.q, maxResults: p.maxResults, pageToken: p.pageToken,
    labelIds: p.labelIds ?? (p.label === "ALL" ? [] : p.label ? [p.label] : ["INBOX"]),
    includeSpamTrash: p.label === "SPAM" || p.label === "TRASH",
  });
  run("threads", threadsFn, (r) => ({ threads: r.threads, nextPageToken: r.nextPageToken, resultSizeEstimate: r.resultSizeEstimate }));

  const threadFn = (db, u, p) => readGmailThread(db, u, p.threadId || p.id);
  threadFn.validate = (p) => (p.threadId || p.id ? null : "threadId required");
  run("thread", threadFn, (r) => ({ thread: r.thread }));

  // params: { threadId, action } (semantic) or { threadId, addLabelIds?, removeLabelIds? }
  const threadModifyFn = (db, u, p) => modifyGmailThread(db, u, p.threadId, p.action ? THREAD_SEMANTIC[p.action] : { addLabelIds: p.addLabelIds, removeLabelIds: p.removeLabelIds });
  threadModifyFn.validate = (p) => (!p.threadId ? "threadId required" : p.action && !THREAD_SEMANTIC[p.action] ? `unknown action: ${p.action}` : null);
  run("thread-modify", threadModifyFn, (r, p) => ({ threadId: p.threadId, action: p.action || null }));

  const threadTrashFn = (db, u, p) => trashGmailThread(db, u, p.threadId);
  threadTrashFn.validate = need("threadId");
  run("thread-trash", threadTrashFn, (r, p) => ({ threadId: p.threadId, trashed: true }));

  const threadUntrashFn = (db, u, p) => untrashGmailThread(db, u, p.threadId);
  threadUntrashFn.validate = need("threadId");
  run("thread-untrash", threadUntrashFn, (r, p) => ({ threadId: p.threadId, trashed: false }));

  const untrashFn = (db, u, p) => untrashGmailMessage(db, u, p.messageId || p.id);
  untrashFn.validate = (p) => (p.messageId || p.id ? null : "messageId required");
  run("untrash", untrashFn, (r, p) => ({ messageId: p.messageId || p.id, trashed: false }));

  run("profile", (db, u) => getGmailProfile(db, u), (r) => ({ profile: r.profile }));

  // Attachment bytes (base64). params: { messageId, attachmentId }
  const attachmentFn = (db, u, p) => getGmailAttachment(db, u, p.messageId, p.attachmentId);
  attachmentFn.validate = (p) => (!p.messageId || !p.attachmentId ? "messageId and attachmentId required" : null);
  run("attachment", attachmentFn, (r) => ({ data: r.attachment.data, size: r.attachment.size }));

  const labelCreateFn = (db, u, p) => createGmailLabel(db, u, p.name);
  labelCreateFn.validate = (p) => (String(p.name || "").trim() ? null : "name required");
  run("label-create", labelCreateFn, (r) => ({ label: r.label }));

  run("drafts", (db, u, p) => listGmailDrafts(db, u, { maxResults: p.maxResults }), (r) => ({ drafts: r.drafts }));

  // Create (no draftId) or replace (draftId) a draft. params: { draftId?, to, cc?, bcc?, subject?, body?, threadId?, inReplyTo?, references? }
  run("draft-save", (db, u, p) => saveGmailDraft(db, u, p.mail || p), (r) => ({ draft: r.draft }));

  const draftSendFn = (db, u, p) => sendGmailDraft(db, u, p.draftId);
  draftSendFn.validate = need("draftId");
  run("draft-send", draftSendFn, (r) => ({ sent: true, providerMessageId: r.data?.id || null, threadId: r.data?.threadId || null }));

  const draftDeleteFn = (db, u, p) => deleteGmailDraft(db, u, p.draftId);
  draftDeleteFn.validate = need("draftId");
  run("draft-delete", draftDeleteFn, (r, p) => ({ deleted: p.draftId }));

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
