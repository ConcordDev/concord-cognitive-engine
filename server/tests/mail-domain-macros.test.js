// Mail domain macros — behavioral test against a real migrated DB.
//
// Proves `server/domains/mail.js` registers the `mail.*` macros and that they
// uphold the contract overrides in content/contracts/overrides/mail.*.json:
//   - mail.send escrows attachment CC, rejects self / empty / unaffordable
//   - mail.claim returns the { ok, claimed, payout, attachments } shape the
//     override invariants assert, conserves currency, transfers DTU ownership
//   - actor resolution falls back to ctx.actor.userId
//
// The handlers delegate to lib/player-mail.js (single source of truth); this
// test pins the macro envelope the /api/lens/run + MCP dispatch surface returns.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerMailMacros from "../domains/mail.js";

function buildRegistry() {
  const MACROS = new Map();
  const register = (d, n, fn, spec) => {
    if (!MACROS.has(d)) MACROS.set(d, new Map());
    MACROS.get(d).set(n, { fn, spec });
  };
  registerMailMacros(register);
  return {
    run: (name, ctx, input) => MACROS.get("mail").get(name).fn(ctx, input ?? {}),
    names: [...MACROS.get("mail").keys()],
  };
}

function seedUser(db, id, cc = 0) {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at, concordia_credits)
     VALUES (?, ?, ?, 'x', unixepoch(), ?)`,
  ).run(id, `u_${id}`, `${id}@example.test`, cc);
}

describe("mail.* domain macros (real migrated DB)", () => {
  let db, reg;
  const u1 = { db: null, actor: { userId: "u1" } };
  const u2 = { db: null, actor: { userId: "u2" } };

  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    seedUser(db, "u1", 500);
    seedUser(db, "u2", 200);
    reg = buildRegistry();
    u1.db = db; u2.db = db;
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("registers the full mail macro surface", () => {
    assert.deepEqual(reg.names.sort(), ["claim", "get", "list", "read", "send", "sent"]);
  });

  it("send → list → claim full envelope upholds the contract invariants", async () => {
    db.prepare(`INSERT INTO dtus (id, creator_id, data) VALUES ('dtu_x','u1',json('{}'))`).run();
    const send = await reg.run("send", u1, { toUserId: "u2", subject: "Hi", body: "b", attachmentDtuIds: ["dtu_x"], attachmentCc: 100, codCc: 50 });
    assert.equal(send.ok, true);
    assert.ok(send.id.startsWith("mail_"));

    const inbox = await reg.run("list", u2, {});
    assert.equal(inbox.ok, true);
    assert.equal(inbox.mail.length, 1);

    const claim = await reg.run("claim", u2, { id: send.id });
    // mail.claim.json invariants:
    assert.equal(claim.ok, true);
    assert.equal(claim.claimed, true);
    assert.ok(claim.payout && typeof claim.payout === "object");
    assert.ok(claim.payout.attachmentCc >= 0);
    assert.ok(claim.payout.codCcPaid >= 0);
    assert.ok(Array.isArray(claim.attachments.dtuIds));
    // currency conserved across full lifecycle (start total 700)
    const total = db.prepare(`SELECT COALESCE(SUM(concordia_credits),0) t FROM users`).get().t;
    assert.equal(total, 700);
    // DTU transferred
    assert.equal(db.prepare(`SELECT creator_id c FROM dtus WHERE id='dtu_x'`).get().c, "u2");
  });

  it("send rejects self / empty subject / unaffordable escrow (mail.send.json seeds)", async () => {
    assert.equal((await reg.run("send", u1, { toUserId: "u1", subject: "x" })).error, "cannot_mail_self");
    assert.equal((await reg.run("send", u1, { toUserId: "u2", subject: "" })).error, "subject_required");
    assert.equal((await reg.run("send", u1, { toUserId: "u2", subject: "Gift", attachmentCc: 99999 })).error, "insufficient_funds");
  });

  it("claim of a non-existent id is a clean { ok:false, error:'not_found' }", async () => {
    const r = await reg.run("claim", u2, { id: "mail_nope" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_found");
  });

  it("macros require an authenticated actor", async () => {
    const r = await reg.run("list", { db }, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_user");
  });

  it("read flips status and is idempotent", async () => {
    const send = await reg.run("send", u1, { toUserId: "u2", subject: "Hi" });
    assert.equal((await reg.run("read", u2, { id: send.id })).ok, true);
    assert.equal((await reg.run("get", u2, { id: send.id })).mail.status, "read");
    assert.equal((await reg.run("read", u2, { id: send.id })).ok, true); // idempotent
  });
});
