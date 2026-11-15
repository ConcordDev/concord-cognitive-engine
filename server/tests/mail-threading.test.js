// FIX-mail-016 — player-mail threading, REAL migrated-DB behavioral test.
//
// A reply now names the mail it answers (parent_id, migration 503) and
// the link is stored on the row, so inboxes can nest replies under the
// original instead of every Re: arriving as a separate, unlinked mail.
//
// Pinned invariants:
//   - send with a valid parentId stores it; list/get/sent carry it back
//   - send without parentId carries null (a thread root)
//   - a parentId that does not exist is refused 'parent_not_found'
//   - a parentId for a mail the sender is NOT a party to is refused the
//     same way — threading cannot be forged into a stranger's conversation
//   - the compose draft round-trips parentId (a restored reply still
//     threads when finally sent)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  sendMail,
  listInbox,
  listSent,
  getMail,
} from "../lib/player-mail.js";
import registerMailMacros from "../domains/mail.js";

function seedUser(db, id, cc = 0) {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at, concordia_credits)
     VALUES (?, ?, ?, 'x', unixepoch(), ?)`,
  ).run(id, `u_${id}`, `${id}@example.test`, cc);
}

function buildRegistry() {
  const MACROS = new Map();
  const register = (d, n, fn) => { if (!MACROS.has(d)) MACROS.set(d, new Map()); MACROS.get(d).set(n, fn); };
  registerMailMacros(register);
  return { run: (name, ctx, input) => MACROS.get("mail").get(name)(ctx, input ?? {}) };
}

describe("player-mail threading (FIX-mail-016, real migrated DB)", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    seedUser(db, "u1", 100);
    seedUser(db, "u2", 100);
    seedUser(db, "u3", 100);
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("a reply stores its parent and every read surface carries the link", () => {
    const orig = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "Gate rota", body: "Who takes Friday?" });
    assert.equal(orig.ok, true);
    assert.equal(getMail(db, orig.id, "u1").parentId, null);

    const reply = sendMail(db, { fromUserId: "u2", toUserId: "u1", subject: "Re: Gate rota", body: "I will.", parentId: orig.id });
    assert.equal(reply.ok, true);
    assert.equal(getMail(db, reply.id, "u1").parentId, orig.id);
    assert.equal(listInbox(db, "u1")[0].parentId, orig.id);
    assert.equal(listSent(db, "u2")[0].parentId, orig.id);
  });

  it("a dangling or forged parent is refused as parent_not_found and writes no row", () => {
    const strangers = sendMail(db, { fromUserId: "u1", toUserId: "u3", subject: "Private", body: "u1 + u3 only" });
    assert.equal(strangers.ok, true);

    const dangling = sendMail(db, { fromUserId: "u2", toUserId: "u1", subject: "Re: ???", parentId: "mail_nope" });
    assert.equal(dangling.ok, false);
    assert.equal(dangling.error, "parent_not_found");

    const forged = sendMail(db, { fromUserId: "u2", toUserId: "u1", subject: "Re: Private", parentId: strangers.id });
    assert.equal(forged.ok, false);
    assert.equal(forged.error, "parent_not_found");

    assert.equal(listInbox(db, "u1").length, 0);
  });

  it("the compose draft round-trips parentId through the mail verbs", async () => {
    const reg = buildRegistry();
    const ctx = { db, actor: { userId: "u2" } };
    const saved = await reg.run("draft-save", ctx, {
      toUserId: "u1", subject: "Re: Gate rota", body: "I will.", parentId: "mail_abc",
    });
    assert.equal(saved.ok, true);
    const got = await reg.run("draft-get", ctx, {});
    assert.equal(got.draft.parentId, "mail_abc");
  });
});
