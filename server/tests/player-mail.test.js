// Phase U1 — player mail engine.
//
// In-memory DB stub validates send → inbox shows → read → claim chain
// including COD wallet transfer + idempotency. Real-DB integration is
// covered by the boot smoke once better-sqlite3 is installed.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sendMail, listInbox, listSent, getMail, readMail, claimAttachments, sweepExpiredMail } from "../lib/player-mail.js";

function memDb() {
  const t = {
    mail: new Map(),
    wallets: new Map(),
    dtus: new Map(),
    ledger: [],
  };
  function _trim(s) { return String(s).replace(/\s+/g, " ").trim(); }
  function _run(sql, args) {
    const n = _trim(sql);
    if (n.startsWith("INSERT INTO player_mail")) {
      const [id, from, to, worldId, subject, body, attachIds, attachCc, codCc, ttl] = args;
      t.mail.set(id, {
        id, from_user_id: from, to_user_id: to, world_id: worldId,
        subject, body, status: "unread",
        sent_at: Math.floor(Date.now() / 1000),
        read_at: null, claimed_at: null,
        expires_at: Math.floor(Date.now() / 1000) + ttl * 86400,
        attachment_dtu_ids: attachIds, attachment_cc: attachCc, cod_cc: codCc,
      });
      return { changes: 1 };
    }
    if (n.startsWith("UPDATE player_mail SET status = 'read'")) {
      const [id, userId] = args;
      const m = t.mail.get(id);
      if (m && m.to_user_id === userId && m.status === "unread") {
        m.status = "read"; m.read_at = Math.floor(Date.now() / 1000);
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    if (n.startsWith("UPDATE player_mail SET status = 'claimed'")) {
      const [id] = args;
      const m = t.mail.get(id);
      if (m) {
        m.status = "claimed"; m.claimed_at = Math.floor(Date.now() / 1000);
        m.attachment_dtu_ids = "[]";
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    if (n.startsWith("UPDATE player_mail SET status = 'expired'")) {
      const [id] = args;
      const m = t.mail.get(id);
      if (m) { m.status = "expired"; return { changes: 1 }; }
      return { changes: 0 };
    }
    // Wallet primitives now read users.concordia_credits + log to reward_ledger.
    if (n.startsWith("SELECT concordia_credits AS balance FROM users")) {
      const w = t.wallets.get(args[0]);
      return w !== undefined ? { balance: w } : null;
    }
    if (n.startsWith("UPDATE users SET concordia_credits = concordia_credits - ?")) {
      const [amount, userId] = args;
      const cur = t.wallets.get(userId) || 0;
      t.wallets.set(userId, cur - amount);
      return { changes: 1 };
    }
    if (n.startsWith("UPDATE users SET concordia_credits = concordia_credits + ?")) {
      const [amount, userId] = args;
      t.wallets.set(userId, (t.wallets.get(userId) || 0) + amount);
      return { changes: 1 };
    }
    if (n.startsWith("INSERT INTO reward_ledger")) {
      t.ledger.push({ id: args[0], userId: args[1], amount: args[2], ref: args[3] });
      return { changes: 1 };
    }
    // The real lib stamps an escrow marker into the `data` JSON column at send.
    if (n.startsWith("UPDATE dtus SET data = json_set")) {
      const [dtuId] = args;
      const d = t.dtus.get(dtuId);
      if (d) { d.mail_escrow = 1; return { changes: 1 }; }
      return { changes: 0 };
    }
    // …and transfers ownership via `creator_id` (+ clears the marker) at claim.
    if (n.startsWith("UPDATE dtus SET creator_id")) {
      const [newOwner, dtuId] = args;
      const d = t.dtus.get(dtuId);
      if (d) { d.creator_id = newOwner; delete d.mail_escrow; return { changes: 1 }; }
      return { changes: 0 };
    }
    return { changes: 0 };
  }
  function _all(sql, args) {
    const n = _trim(sql);
    if (n.includes("FROM player_mail") && n.includes("to_user_id = ?")) {
      const userId = args[0];
      const rows = [...t.mail.values()].filter(m => m.to_user_id === userId);
      const statusArg = n.includes("status = ?") ? args[1] : null;
      const filtered = statusArg ? rows.filter(r => r.status === statusArg) : rows;
      return filtered.sort((a, b) => b.sent_at - a.sent_at).map(_renameForInbox);
    }
    if (n.includes("FROM player_mail") && n.includes("from_user_id = ?")) {
      const userId = args[0];
      return [...t.mail.values()].filter(m => m.from_user_id === userId).sort((a, b) => b.sent_at - a.sent_at).map(_renameForSent);
    }
    if (n.startsWith("SELECT id, from_user_id AS fromUser, attachment_dtu_ids") && n.includes("expires_at <= unixepoch()")) {
      return [...t.mail.values()]
        .filter(m => (m.status === "unread" || m.status === "read") && m.expires_at <= Math.floor(Date.now() / 1000))
        .map(m => ({ id: m.id, fromUser: m.from_user_id, attachment_dtu_ids: m.attachment_dtu_ids, attachmentCc: m.attachment_cc }));
    }
    return [];
  }
  function _renameForInbox(m) {
    return { id: m.id, fromUser: m.from_user_id, worldId: m.world_id, subject: m.subject, body: m.body, status: m.status, sentAt: m.sent_at, readAt: m.read_at, claimedAt: m.claimed_at, expiresAt: m.expires_at, attachment_dtu_ids: m.attachment_dtu_ids, attachmentCc: m.attachment_cc, codCc: m.cod_cc };
  }
  function _renameForSent(m) {
    return { id: m.id, toUser: m.to_user_id, worldId: m.world_id, subject: m.subject, body: m.body, status: m.status, sentAt: m.sent_at, readAt: m.read_at, claimedAt: m.claimed_at, expiresAt: m.expires_at, attachment_dtu_ids: m.attachment_dtu_ids, attachmentCc: m.attachment_cc, codCc: m.cod_cc };
  }
  function _get(sql, args) {
    const n = _trim(sql);
    if (n.startsWith("SELECT concordia_credits AS balance FROM users")) {
      const w = t.wallets.get(args[0]);
      return w !== undefined ? { balance: w } : null;
    }
    if (n.startsWith("SELECT id, from_user_id AS fromUser, to_user_id AS toUser")) {
      const m = t.mail.get(args[0]);
      return m ? { id: m.id, fromUser: m.from_user_id, toUser: m.to_user_id, worldId: m.world_id, subject: m.subject, body: m.body, status: m.status, sentAt: m.sent_at, readAt: m.read_at, claimedAt: m.claimed_at, expiresAt: m.expires_at, attachment_dtu_ids: m.attachment_dtu_ids, attachmentCc: m.attachment_cc, codCc: m.cod_cc } : null;
    }
    if (n.startsWith("SELECT to_user_id, status FROM player_mail")) {
      const m = t.mail.get(args[0]);
      return m ? { to_user_id: m.to_user_id, status: m.status } : null;
    }
    return null;
  }
  const db = {
    prepare(sql) {
      return {
        run: (...args) => _run(sql, args),
        all: (...args) => _all(sql, args),
        get: (...args) => _get(sql, args),
      };
    },
    transaction(fn) { return () => fn(); },
    _t: t,
    _seedWallet(userId, balance) { t.wallets.set(userId, balance); },
    _seedDtu(id, ownerId) { t.dtus.set(id, { id, creator_id: ownerId }); },
  };
  return db;
}

describe("Phase U1 — player mail", () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it("sendMail validates non-empty subject and distinct users", () => {
    assert.equal(sendMail(db, { fromUserId: "u1", toUserId: "u1", subject: "x" }).error, "cannot_mail_self");
    assert.equal(sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "" }).error, "subject_required");
  });

  it("sendMail with no attachments succeeds without wallet activity", () => {
    const r = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Hi", body: "Hello" });
    assert.equal(r.ok, true);
    assert.ok(r.id?.startsWith("mail_"));
    assert.equal(db._t.wallets.size, 0);
  });

  it("sendMail with attachmentCc escrows from sender", () => {
    db._seedWallet("u1", 500);
    const r = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Gift", attachmentCc: 100 });
    assert.equal(r.ok, true);
    assert.equal(db._t.wallets.get("u1"), 400);
  });

  it("sendMail with insufficient escrow rejects", () => {
    db._seedWallet("u1", 50);
    const r = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Gift", attachmentCc: 100 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_funds");
  });

  it("inbox + sent listings show the new mail", () => {
    sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Hi" });
    assert.equal(listInbox(db, "u2").length, 1);
    assert.equal(listSent(db, "u1").length, 1);
  });

  it("readMail flips status to read; idempotent on already-read", () => {
    const { id } = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Hi" });
    const r1 = readMail(db, id, "u2");
    assert.equal(r1.ok, true);
    const r2 = readMail(db, id, "u2");
    assert.equal(r2.ok, true);  // idempotent
  });

  it("claim transfers CC from sender escrow to recipient", () => {
    db._seedWallet("u1", 500);
    const { id } = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Gift", attachmentCc: 100 });
    const r = claimAttachments(db, id, "u2");
    assert.equal(r.ok, true);
    assert.equal(db._t.wallets.get("u2"), 100);
    assert.equal(db._t.wallets.get("u1"), 400);  // already debited
  });

  it("COD claim debits recipient and credits sender", () => {
    db._seedWallet("u1", 500);
    db._seedWallet("u2", 200);
    const { id } = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Bill", codCc: 50 });
    const r = claimAttachments(db, id, "u2");
    assert.equal(r.ok, true);
    assert.equal(db._t.wallets.get("u2"), 150);
    assert.equal(db._t.wallets.get("u1"), 550);  // received COD
  });

  it("claim transfers DTU ownership from sender to recipient", () => {
    db._seedDtu("dtu1", "u1");
    const { id } = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Gift", attachmentDtuIds: ["dtu1"] });
    assert.equal(db._t.dtus.get("dtu1").mail_escrow, 1);  // escrowed at send
    const r = claimAttachments(db, id, "u2");
    assert.equal(r.ok, true);
    assert.deepEqual(r.attachments.dtuIds, ["dtu1"]);
    assert.equal(db._t.dtus.get("dtu1").creator_id, "u2");  // ownership moved
    assert.equal(db._t.dtus.get("dtu1").mail_escrow, undefined);  // marker cleared
  });

  it("claim is idempotent — re-claim returns alreadyClaimed", () => {
    db._seedWallet("u1", 100);
    const { id } = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Hi" });
    claimAttachments(db, id, "u2");
    const r2 = claimAttachments(db, id, "u2");
    assert.equal(r2.ok, true);
    assert.equal(r2.alreadyClaimed, true);
  });

  it("claim rejects wrong recipient", () => {
    const { id } = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Hi" });
    const r = claimAttachments(db, id, "u3");
    assert.equal(r.ok, false);
  });

  it("sweepExpiredMail refunds escrow to sender", () => {
    db._seedWallet("u1", 500);
    const { id } = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Gift", attachmentCc: 100 });
    // Force expiry: backdate expires_at.
    db._t.mail.get(id).expires_at = Math.floor(Date.now() / 1000) - 1;
    const r = sweepExpiredMail(db);
    assert.equal(r.swept, 1);
    assert.equal(db._t.wallets.get("u1"), 500);  // refunded
    assert.equal(db._t.mail.get(id).status, "expired");
  });
});
