// FIX-mail-014 — decline for player mail, REAL migrated-DB behavioral test.
//
// Until this fix the only recipient action on a mail carrying attachments
// or a COD charge was Claim (accept and pay). Decline is the other answer:
// the escrowed gift CC returns to the sender, DTU escrow stamps clear (the
// DTUs never left the sender), the COD charge is never collected, and the
// row lands in the terminal 'declined' status (migration 502 widened the
// status CHECK; runMigrations here proves the widened schema is what the
// engine actually runs against).
//
// Pinned invariants:
//   - decline refunds the escrowed attachment_cc to the SENDER in full
//   - the recipient's balance never moves (no COD is charged on decline)
//   - total CC is conserved across send → decline
//   - claim after decline is refused with 'declined' and moves nothing
//   - decline is idempotent — a second decline refunds nothing twice
//   - only the recipient can decline; a claimed mail cannot be declined

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  sendMail,
  getMail,
  claimAttachments,
  declineMail,
} from "../lib/player-mail.js";

function seedUser(db, id, cc = 0) {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at, concordia_credits)
     VALUES (?, ?, ?, 'x', unixepoch(), ?)`,
  ).run(id, `u_${id}`, `${id}@example.test`, cc);
}

function seedDtu(db, id, ownerId) {
  db.prepare(`INSERT INTO dtus (id, creator_id, data) VALUES (?, ?, json('{}'))`).run(id, ownerId);
}

function ccOf(db, userId) {
  return Number(db.prepare(`SELECT concordia_credits FROM users WHERE id = ?`).get(userId)?.concordia_credits) || 0;
}

function totalCc(db) {
  return Number(db.prepare(`SELECT COALESCE(SUM(concordia_credits),0) AS t FROM users`).get().t) || 0;
}

describe("player-mail decline (FIX-mail-014, real migrated DB)", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    seedUser(db, "u1", 500);
    seedUser(db, "u2", 200);
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("decline returns the escrow to the sender, charges the recipient nothing, DTU stays with the sender", () => {
    seedDtu(db, "dtu_a", "u1");
    const start = totalCc(db);
    const { id } = sendMail(db, {
      fromUserId: "u1", toUserId: "u2", subject: "COD package", body: "pay on claim",
      attachmentDtuIds: ["dtu_a"], attachmentCc: 100, codCc: 50,
    });
    assert.equal(ccOf(db, "u1"), 400); // escrowed at send

    const r = declineMail(db, id, "u2");
    assert.equal(r.ok, true);
    assert.equal(r.declined, true);
    assert.equal(r.refundedCc, 100);

    assert.equal(ccOf(db, "u1"), 500); // escrow fully returned
    assert.equal(ccOf(db, "u2"), 200); // no COD charged, no gift received
    assert.equal(totalCc(db), start); // conserved

    const dtu = db.prepare(`SELECT creator_id, data FROM dtus WHERE id=?`).get("dtu_a");
    assert.equal(dtu.creator_id, "u1"); // never transferred
    assert.equal(JSON.parse(dtu.data).mail_escrow, undefined); // stamp cleared

    const mail = getMail(db, id, "u2");
    assert.equal(mail.status, "declined");
    assert.ok(mail.declinedAt > 0);
  });

  it("claim after decline is refused as 'declined' and moves nothing", () => {
    const { id } = sendMail(db, {
      fromUserId: "u1", toUserId: "u2", subject: "COD", attachmentCc: 10, codCc: 5,
    });
    assert.equal(declineMail(db, id, "u2").ok, true);
    const r = claimAttachments(db, id, "u2");
    assert.equal(r.ok, false);
    assert.equal(r.error, "declined");
    assert.equal(ccOf(db, "u1"), 500);
    assert.equal(ccOf(db, "u2"), 200);
    assert.equal(getMail(db, id, "u2").status, "declined");
  });

  it("decline is idempotent — the second decline refunds nothing twice", () => {
    const { id } = sendMail(db, {
      fromUserId: "u1", toUserId: "u2", subject: "Gift", attachmentCc: 40,
    });
    assert.equal(declineMail(db, id, "u2").ok, true);
    assert.equal(ccOf(db, "u1"), 500);
    const again = declineMail(db, id, "u2");
    assert.equal(again.ok, true);
    assert.equal(again.alreadyDeclined, true);
    assert.equal(ccOf(db, "u1"), 500);
    assert.equal(ccOf(db, "u2"), 200);
  });

  it("only the recipient can decline, and a claimed mail cannot be declined", () => {
    const { id } = sendMail(db, {
      fromUserId: "u1", toUserId: "u2", subject: "Gift", attachmentCc: 10,
    });
    const bySender = declineMail(db, id, "u1");
    assert.equal(bySender.ok, false);
    assert.equal(bySender.error, "not_authorized");

    assert.equal(claimAttachments(db, id, "u2").ok, true);
    const afterClaim = declineMail(db, id, "u2");
    assert.equal(afterClaim.ok, false);
    assert.equal(afterClaim.error, "already_claimed");
  });

  it("a plain mail (no attachments, no COD) can be declined with no wallet movement", () => {
    const { id } = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Just words", body: "hi" });
    const r = declineMail(db, id, "u2");
    assert.equal(r.ok, true);
    assert.equal(r.refundedCc, 0);
    assert.equal(ccOf(db, "u1"), 500);
    assert.equal(ccOf(db, "u2"), 200);
    assert.equal(getMail(db, id, "u2").status, "declined");
  });
});
