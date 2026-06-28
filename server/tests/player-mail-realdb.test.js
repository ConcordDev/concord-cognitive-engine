// Phase U1 — player mail engine, REAL migrated-DB behavioral test.
//
// The sibling `player-mail.test.js` exercises the engine against a hand-rolled
// in-memory mock whose `UPDATE dtus SET created_by` branch never matched the
// real lib (which writes `creator_id` + a `data` JSON escrow marker) — so the
// DTU-ownership transfer was never actually asserted. This file pins the same
// contract against a fully migrated better-sqlite3 DB so the REAL SQL the
// `/api/mail/*` routes serve is proven end-to-end:
//   send → inbox shows → read → claim (CC + COD + DTU transfer) → expiry sweep.
//
// Pinned invariants (CLAUDE.md "Mail attachments transfer is single-transaction"):
//   - sendMail escrows attachment_cc from the sender up-front
//   - claim moves attachment_cc sender→recipient, COD recipient→sender, and
//     DTU ownership sender→recipient INSIDE ONE TRANSACTION (all-or-nothing)
//   - a failed COD (recipient can't pay) rolls the WHOLE claim back — no CC
//     leaks, DTU stays with sender, escrow marker intact, mail still claimable
//   - total CC is conserved across the whole flow (no minting)
//   - claim is idempotent; expiry refunds escrow to the sender

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  sendMail,
  listInbox,
  listSent,
  getMail,
  readMail,
  claimAttachments,
  sweepExpiredMail,
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

describe("player-mail (real migrated DB)", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    seedUser(db, "u1", 500);
    seedUser(db, "u2", 200);
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("send → inbox → read round-trips through the real SQL", () => {
    const r = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Hi", body: "Hello there" });
    assert.equal(r.ok, true);
    assert.ok(r.id.startsWith("mail_"));

    const inbox = listInbox(db, "u2");
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].subject, "Hi");
    assert.equal(inbox[0].fromUser, "u1");
    assert.equal(inbox[0].status, "unread");
    // attachment_dtu_ids must hydrate from the JSON column into a real array.
    assert.deepEqual(inbox[0].attachment_dtu_ids, []);

    assert.equal(listSent(db, "u1").length, 1);

    const rd = readMail(db, r.id, "u2");
    assert.equal(rd.ok, true);
    assert.equal(getMail(db, r.id, "u2").status, "read");
  });

  it("sendMail escrows attachment_cc from the sender immediately", () => {
    const r = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Gift", attachmentCc: 100 });
    assert.equal(r.ok, true);
    assert.equal(ccOf(db, "u1"), 400); // 500 - 100 escrowed
    assert.equal(ccOf(db, "u2"), 200); // untouched until claim
  });

  it("sendMail rejects when the sender cannot afford the escrow (no row written)", () => {
    const r = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Gift", attachmentCc: 10_000 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_funds");
    assert.equal(ccOf(db, "u1"), 500); // unchanged
    assert.equal(listInbox(db, "u2").length, 0);
  });

  it("claim moves CC + COD + DTU ownership in ONE transaction (real DB)", () => {
    seedDtu(db, "dtu_a", "u1");
    // Snapshot the whole-system CC BEFORE send. Attachment CC is escrowed out of
    // u1's wallet at send-time and re-enters circulation (to u2) at claim-time,
    // so conservation must be measured across the FULL lifecycle, not just claim.
    const lifecycleStart = totalCc(db);
    const { id } = sendMail(db, {
      fromUserId: "u1", toUserId: "u2", subject: "Care package", body: "enjoy",
      attachmentDtuIds: ["dtu_a"], attachmentCc: 100, codCc: 50,
    });
    // Escrow took 100 from u1; DTU stamped with mail_escrow marker.
    assert.equal(ccOf(db, "u1"), 400);
    assert.equal(JSON.parse(db.prepare(`SELECT data FROM dtus WHERE id=?`).get("dtu_a").data).mail_escrow, 1);

    const r = claimAttachments(db, id, "u2");
    assert.equal(r.ok, true);
    assert.equal(r.claimed, true);
    assert.deepEqual(r.payout, { attachmentCc: 100, codCcPaid: 50 });
    assert.deepEqual(r.attachments.dtuIds, ["dtu_a"]);

    // u2: +100 attachment, -50 COD → 200 + 100 - 50 = 250
    assert.equal(ccOf(db, "u2"), 250);
    // u1: already at 400 (escrow), +50 COD received → 450
    assert.equal(ccOf(db, "u1"), 450);
    // DTU ownership moved to u2; escrow marker removed.
    const dtu = db.prepare(`SELECT creator_id, data FROM dtus WHERE id=?`).get("dtu_a");
    assert.equal(dtu.creator_id, "u2");
    assert.equal(JSON.parse(dtu.data).mail_escrow, undefined);
    // Mail marked claimed; attachments cleared from the row.
    const claimed = getMail(db, id, "u2");
    assert.equal(claimed.status, "claimed");
    assert.deepEqual(claimed.attachment_dtu_ids, []);
    // No CC minted or destroyed across the full send→claim lifecycle: the
    // escrowed attachment CC simply returned to circulation in u2's wallet.
    assert.equal(totalCc(db), lifecycleStart);
  });

  it("a COD the recipient cannot pay rolls the WHOLE claim back (atomic)", () => {
    seedDtu(db, "dtu_b", "u1");
    // u2 starts with 200 but COD is 9999 → cannot pay.
    const { id } = sendMail(db, {
      fromUserId: "u1", toUserId: "u2", subject: "Pricey", body: "pay up",
      attachmentDtuIds: ["dtu_b"], attachmentCc: 100, codCc: 9999,
    });
    const u1Before = ccOf(db, "u1"); // 400 (escrowed)
    const u2Before = ccOf(db, "u2"); // 200
    const total = totalCc(db);

    const r = claimAttachments(db, id, "u2");
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_funds_for_cod");

    // Nothing moved: not the attachment CC, not the DTU, not the COD.
    assert.equal(ccOf(db, "u1"), u1Before);
    assert.equal(ccOf(db, "u2"), u2Before);
    assert.equal(db.prepare(`SELECT creator_id FROM dtus WHERE id=?`).get("dtu_b").creator_id, "u1");
    assert.equal(JSON.parse(db.prepare(`SELECT data FROM dtus WHERE id=?`).get("dtu_b").data).mail_escrow, 1);
    // Mail is still claimable (status unchanged), CC conserved.
    assert.notEqual(getMail(db, id, "u2").status, "claimed");
    assert.equal(totalCc(db), total);
  });

  it("claim is idempotent — second claim is a no-op and does not double-pay", () => {
    const { id } = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Gift", attachmentCc: 100 });
    const first = claimAttachments(db, id, "u2");
    assert.equal(first.ok, true);
    assert.equal(ccOf(db, "u2"), 300);

    const second = claimAttachments(db, id, "u2");
    assert.equal(second.ok, true);
    assert.equal(second.alreadyClaimed, true);
    assert.equal(ccOf(db, "u2"), 300); // not credited twice
  });

  it("claim rejects a user who is not the recipient", () => {
    seedUser(db, "u3", 0);
    const { id } = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Private", attachmentCc: 10 });
    const r = claimAttachments(db, id, "u3");
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_found"); // getMail hides mail not addressed to caller
    // Escrow stays with the intended flow; u2 can still claim.
    assert.equal(claimAttachments(db, id, "u2").ok, true);
  });

  it("expiry sweep refunds escrowed CC to the sender and marks expired", () => {
    const { id } = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Gift", attachmentCc: 100 });
    assert.equal(ccOf(db, "u1"), 400); // escrowed
    // Backdate expiry.
    db.prepare(`UPDATE player_mail SET expires_at = unixepoch() - 1 WHERE id = ?`).run(id);

    const swept = sweepExpiredMail(db);
    assert.equal(swept.swept, 1);
    assert.equal(ccOf(db, "u1"), 500); // refunded
    assert.equal(getMail(db, id, "u1").status, "expired");
    // Expired mail can no longer be claimed.
    assert.equal(claimAttachments(db, id, "u2").error, "expired");
  });

  it("getMail enforces participant-only visibility", () => {
    seedUser(db, "u3", 0);
    const { id } = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Secret" });
    assert.ok(getMail(db, id, "u1")); // sender can read
    assert.ok(getMail(db, id, "u2")); // recipient can read
    assert.equal(getMail(db, id, "u3"), null); // outsider cannot
  });
});
