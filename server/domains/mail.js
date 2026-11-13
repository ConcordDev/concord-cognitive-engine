// server/domains/mail.js
//
// Macro surface for the async player-to-player mail engine (Phase U1).
//
// The mail lens calls these macros through `/api/lens/run`. There is no
// `/api/mail` REST router. The same handlers are what MCP dispatch and the
// Orchestrated Invariant Engine reach (`content/contracts/overrides/mail.*.json`).
//
// Every macro delegates to the single source of truth in
// `server/lib/player-mail.js`; there is NO duplicated wallet / DTU / COD
// logic here. The single-transaction claim invariant lives in the lib.

import {
  sendMail,
  listInbox,
  listSent,
  getMail,
  readMail,
  claimAttachments,
  deleteSentMail,
  declineMail,
} from "../lib/player-mail.js";
import { registerLensExportProvider } from "../lib/lens-export.js";

function actorId(ctx, input) {
  return input?.userId || ctx?.actor?.userId || ctx?.actor?.id || null;
}

// FIX-mail-002: one autosaved compose draft per user, held in lens
// state (the platform's persisted per-user store). A draft is working
// state, not a mail record — it never touches the wallet, escrow, or
// the player_mail table, and saving an empty draft clears it.
function mailDraftStore() {
  const S = globalThis._concordSTATE || (globalThis._concordSTATE = {});
  if (!S.mailLens) S.mailLens = {};
  if (!(S.mailLens.drafts instanceof Map)) S.mailLens.drafts = new Map();
  return S.mailLens.drafts;
}

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) before any
// wallet escrow / DB write — a fail-OPEN here would mint or strand CC.
// An absent field is fine (the lib uses its default). Returns null when clean,
// or the offending key.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

// S6/F6 — the caller's player-mail records join the shared lens export:
// the ↓.dtu / JSON bundle carries the caller's own sent + received mail
// (export-shaped rows), or the machinery explains. Caller-scoped from
// the export ctx's actor; a caller with no mail exports nothing.
registerLensExportProvider("mail", (ctx) => {
  const db = ctx?.db;
  const userId = ctx?.actor?.userId || ctx?.actor?.id || ctx?.userId || null;
  if (!db || !userId) return [];
  const rows = [];
  for (const m of listSent(db, userId, { limit: 200 })) {
    rows.push({
      id: m.id, type: "player-mail-sent", title: m.subject || "Sent mail",
      createdAt: m.sentAt, updatedAt: m.sentAt, data: { ...m, direction: "sent" },
    });
  }
  for (const m of listInbox(db, userId, { limit: 200 })) {
    rows.push({
      id: m.id, type: "player-mail-received", title: m.subject || "Received mail",
      createdAt: m.sentAt, updatedAt: m.readAt ?? m.sentAt, data: { ...m, direction: "received" },
    });
  }
  return rows;
});

export default function registerMailMacros(register) {
  /**
   * mail.list — the caller's inbox (newest first).
   * input: { userId?, status?, limit? }
   */
  register("mail", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const userId = actorId(ctx, input);
    if (!userId) return { ok: false, error: "no_user" };
    const status = ["unread", "read", "claimed", "expired", "declined"].includes(input.status)
      ? input.status : undefined;
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    return { ok: true, mail: listInbox(db, userId, { status, limit }) };
  }, { note: "list the caller's inbox" });

  /**
   * mail.sent — the caller's outbox (newest first).
   * input: { userId?, limit? }
   */
  register("mail", "sent", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const userId = actorId(ctx, input);
    if (!userId) return { ok: false, error: "no_user" };
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    return { ok: true, mail: listSent(db, userId, { limit }) };
  }, { note: "list the caller's sent mail" });

  /**
   * mail.get — a single piece of mail. Participant-only (sender or recipient).
   * input: { id, userId? }
   */
  register("mail", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const userId = actorId(ctx, input);
    if (!input.id) return { ok: false, error: "missing_id" };
    const mail = getMail(db, String(input.id), userId);
    if (!mail) return { ok: false, error: "not_found" };
    return { ok: true, mail };
  }, { note: "read one piece of mail (participant-only)" });

  /**
   * mail.send — compose mail with optional CC / DTU attachments + COD.
   * Sender's attachment CC is escrowed immediately.
   * input: { toUserId, subject, body?, attachmentDtuIds?, attachmentCc?, codCc?, worldId? }
   */
  register("mail", "send", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const fromUserId = actorId(ctx, input);
    if (!fromUserId) return { ok: false, error: "no_user" };
    const badNum = badNumericField(input, ["attachmentCc", "codCc"]);
    if (badNum) return { ok: false, error: `invalid_${badNum}` };
    return sendMail(db, { ...input, fromUserId });
  }, { note: "send async mail (escrows attachment CC)" });

  /**
   * mail.read — flip an unread piece to read. Idempotent. Recipient-only.
   * input: { id, userId? }
   */
  register("mail", "read", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const userId = actorId(ctx, input);
    if (!userId) return { ok: false, error: "no_user" };
    if (!input.id) return { ok: false, error: "missing_id" };
    return readMail(db, String(input.id), userId);
  }, { note: "mark mail read (idempotent)" });

  /**
   * mail.claim — claim attachments. Single transaction: COD recipient→sender,
   * escrowed attachment CC sender→recipient, DTU ownership transfer. Idempotent.
   * input: { id, userId? }
   */
  register("mail", "claim", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const userId = actorId(ctx, input);
    if (!userId) return { ok: false, error: "no_user" };
    if (!input.id) return { ok: false, error: "missing_id" };
    return claimAttachments(db, String(input.id), userId);
  }, { note: "claim mail attachments (single-tx CC/COD/DTU transfer)" });

  /**
   * mail.delete — remove the caller's own SENT copy from their outbox.
   * Sender-only; the recipient's copy is untouched. A claimed copy is
   * refused (it carries the claim record).
   * input: { id, userId? }
   */
  register("mail", "delete", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const userId = actorId(ctx, input);
    if (!userId) return { ok: false, error: "no_user" };
    if (!input.id) return { ok: false, error: "missing_id" };
    return deleteSentMail(db, String(input.id), userId);
  }, { note: "remove the caller's own sent copy (recipient's copy untouched)" });

  /**
   * mail.decline — decline a piece of mail instead of claiming it
   * (FIX-mail-014). Recipient-only: the escrowed gift CC and the DTU
   * escrow stamps return to the sender in one transaction and the COD
   * charge is never collected. Idempotent.
   * input: { id, userId? }
   */
  register("mail", "decline", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const userId = actorId(ctx, input);
    if (!userId) return { ok: false, error: "no_user" };
    if (!input.id) return { ok: false, error: "missing_id" };
    return declineMail(db, String(input.id), userId);
  }, { note: "decline mail (escrow returns to sender; no COD charged)" });

  /**
   * mail.draft-get — the caller's autosaved compose draft, if any.
   * input: { userId? }
   */
  register("mail", "draft-get", async (ctx, input = {}) => {
    const userId = actorId(ctx, input);
    if (!userId) return { ok: false, error: "no_user" };
    return { ok: true, draft: mailDraftStore().get(userId) || null };
  }, { note: "read the caller's autosaved compose draft" });

  /**
   * mail.draft-save — autosave the compose draft. An all-blank draft
   * clears the saved one (the post-send state). Lengths are clamped to
   * the send limits so a restored draft is always sendable as-is.
   * input: { toUserId?, subject?, body?, attachmentCc?, codCc?, attachmentDtuIds?, attachmentTitles? }
   */
  register("mail", "draft-save", async (ctx, input = {}) => {
    const userId = actorId(ctx, input);
    if (!userId) return { ok: false, error: "no_user" };
    const badNum = badNumericField(input, ["attachmentCc", "codCc"]);
    if (badNum) return { ok: false, error: `invalid_${badNum}` };
    const draft = {
      toUserId: String(input.toUserId || "").slice(0, 128),
      subject: String(input.subject || "").slice(0, 120),
      body: String(input.body || "").slice(0, 4000),
      attachmentCc: Math.max(0, Number(input.attachmentCc) || 0),
      codCc: Math.max(0, Number(input.codCc) || 0),
      attachmentDtuIds: Array.isArray(input.attachmentDtuIds)
        ? input.attachmentDtuIds.map((d) => String(d || "")).filter(Boolean).slice(0, 12)
        : [],
      attachmentTitles: (input.attachmentTitles && typeof input.attachmentTitles === "object")
        ? Object.fromEntries(Object.entries(input.attachmentTitles).slice(0, 12).map(([k, v]) => [String(k), String(v).slice(0, 120)]))
        : {},
      // FIX-mail-016: a reply draft keeps its thread link, so a restored
      // reply still threads under the original when it is finally sent.
      parentId: String(input.parentId || "").slice(0, 128),
      updatedAt: Date.now(),
    };
    const blank = !draft.toUserId && !draft.subject && !draft.body && draft.attachmentDtuIds.length === 0;
    if (blank) {
      mailDraftStore().delete(userId);
      return { ok: true, draft: null };
    }
    mailDraftStore().set(userId, draft);
    return { ok: true, draft };
  }, { note: "autosave the caller's compose draft (blank clears it)" });
}
