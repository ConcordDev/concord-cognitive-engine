// server/domains/mail.js
//
// Macro surface for the async player-to-player mail engine (Phase U1).
//
// The `/lenses/mail` page drives the REST routes (`/api/mail/*`) directly,
// but exposing the same engine as `mail.*` macros makes it reachable through
// the generic `/api/lens/run` + MCP dispatch, lets the Orchestrated Invariant
// Engine drive a real contract (`content/contracts/overrides/mail.*.json`),
// and makes the lens manifest's `lens.mail.*` declaration true rather than
// aspirational.
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
} from "../lib/player-mail.js";

function actorId(ctx, input) {
  return input?.userId || ctx?.actor?.userId || ctx?.actor?.id || null;
}

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
    const status = ["unread", "read", "claimed", "expired"].includes(input.status)
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
}
