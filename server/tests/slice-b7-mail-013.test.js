// Slice B7 — FIX-mail-013: recipient-side inbox management against a
// REAL migrated DB (the player-mail-realdb harness shape; needs
// better-sqlite3, so this runs in the desk's batch checks / CI).
//
// Pins: trash is recipient-local and refuses mail whose attachments
// are still in escrow; star/archive drive the list views; mark-unread
// only reverses the read step.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  sendMail,
  listInbox,
  listSent,
  readMail,
  deleteInboxMail,
  setMailStarred,
  setMailArchived,
  unreadMail,
} from "../lib/player-mail.js";

function seedUser(db, id, cc = 0) {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at, concordia_credits)
     VALUES (?, ?, ?, 'x', unixepoch(), ?)`,
  ).run(id, `u_${id}`, `${id}@example.test`, cc);
}

describe("FIX-mail-013 — inbox management (real DB)", () => {
  let db;
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    seedUser(db, "alice", 100);
    seedUser(db, "bob", 0);
  });
  afterEach(() => db?.close());

  it("trash hides the mail for the recipient only; the sender keeps their copy", () => {
    const sent = sendMail(db, { fromUserId: "alice", toUserId: "bob", subject: "plain", body: "hi" });
    assert.equal(sent.ok, true);
    assert.equal(listInbox(db, "bob").length, 1);
    const del = deleteInboxMail(db, sent.id, "bob");
    assert.equal(del.ok, true);
    assert.equal(listInbox(db, "bob").length, 0);
    assert.equal(listSent(db, "alice").length, 1, "the sender's Sent copy is untouched");
    const again = deleteInboxMail(db, sent.id, "bob");
    assert.equal(again.ok, true);
    assert.equal(again.alreadyDeleted, true);
    const notMine = deleteInboxMail(db, sent.id, "alice");
    assert.equal(notMine.ok, false);
    assert.equal(notMine.error, "not_authorized");
  });

  it("trash refuses a mail whose attachments are still in escrow", () => {
    const sent = sendMail(db, { fromUserId: "alice", toUserId: "bob", subject: "gift", body: "", attachmentCc: 10 });
    assert.equal(sent.ok, true);
    const del = deleteInboxMail(db, sent.id, "bob");
    assert.equal(del.ok, false);
    assert.equal(del.error, "has_unclaimed_attachments");
    assert.equal(listInbox(db, "bob").length, 1, "the refused mail stays in the inbox");
  });

  it("star and archive drive the list views; unarchive returns the mail", () => {
    const sent = sendMail(db, { fromUserId: "alice", toUserId: "bob", subject: "file me", body: "" });
    assert.equal(sent.ok, true);
    assert.equal(setMailStarred(db, sent.id, "bob", true).ok, true);
    assert.equal(listInbox(db, "bob", { folder: "starred" }).length, 1);
    assert.equal(listInbox(db, "bob")[0].starredAt != null, true);
    assert.equal(setMailArchived(db, sent.id, "bob", true).ok, true);
    assert.equal(listInbox(db, "bob").length, 0, "archived mail leaves the default inbox");
    assert.equal(listInbox(db, "bob", { folder: "archived" }).length, 1);
    assert.equal(listInbox(db, "bob", { folder: "starred" }).length, 1, "starred view spans archived mail");
    assert.equal(setMailArchived(db, sent.id, "bob", false).ok, true);
    assert.equal(listInbox(db, "bob").length, 1);
  });

  it("mark-unread reverses read and refuses terminal statuses", () => {
    const sent = sendMail(db, { fromUserId: "alice", toUserId: "bob", subject: "read me", body: "" });
    assert.equal(sent.ok, true);
    assert.equal(unreadMail(db, sent.id, "bob").ok, true, "already unread is idempotent");
    assert.equal(readMail(db, sent.id, "bob").ok, true);
    assert.equal(listInbox(db, "bob")[0].status, "read");
    assert.equal(unreadMail(db, sent.id, "bob").ok, true);
    const after = listInbox(db, "bob")[0];
    assert.equal(after.status, "unread");
    assert.equal(after.readAt, null);
  });
});
