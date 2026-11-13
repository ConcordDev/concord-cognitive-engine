// Mail full build (F-B row 10) — the legs the premise priced:
//   S1/F1 — the integration registry carries mail at REAL_LIVE with
//     liveFromSubstrate (the manifest + badge legs are pinned FE-side).
//   S2/F3 — list/sent/get payloads resolve the correspondents' display
//     names server-side; a party that does not resolve carries nulls,
//     never the raw account id as a name.
//   S3/F4 — the open path: a sender opening their own sent mail
//     succeeds with NO error surface (the pass's two red "not authorized"
//     notices do not reproduce in current code — the open is list-local
//     and mail.read is recipient-side by design); a recipient open
//     flips unread → read exactly once; a non-participant is refused.
//   S4/F5 — mail.delete removes the SENDER's own sent copy: it leaves
//     the sender's Sent list, persists across a fresh read, and the
//     recipient's inbox copy is untouched. A recipient cannot delete;
//     a claimed copy is refused (it carries the claim record).
//   S6/F6 — the mail export provider is registered and collectLensExport
//     returns exactly the caller's own sent + received player mail.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerMailMacros from "../domains/mail.js";
import { collectLensExport, hasLensExportProvider } from "../lib/lens-export.js";
import { getIntegration, getTier } from "../lib/integration-registry.js";

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

function seedUser(db, id, username, cc = 0) {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at, concordia_credits)
     VALUES (?, ?, ?, 'x', unixepoch(), ?)`,
  ).run(id, username, `${id}@example.test`, cc);
}

describe("mail full build (real migrated DB)", () => {
  let db, reg;
  const u1 = { db: null, actor: { userId: "u1" } };
  const u2 = { db: null, actor: { userId: "u2" } };
  const ghost = { db: null, actor: { userId: "ghost" } };

  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    seedUser(db, "u1", "alice", 500);
    seedUser(db, "u2", "bobby", 200);
    reg = buildRegistry();
    u1.db = db; u2.db = db; ghost.db = db;
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("S1: the registry declares mail REAL_LIVE, live from its substrate", () => {
    const entry = getIntegration("mail");
    assert.ok(entry, "mail has an integration-registry entry");
    assert.equal(entry.tier, "REAL_LIVE");
    assert.equal(getTier("mail"), "REAL_LIVE");
    assert.equal(entry.liveFromSubstrate, true);
    assert.match(entry.note, /player mail/i);
    assert.match(entry.note, /Gmail/);
  });

  it("registers the full surface including the delete and decline verbs", () => {
    // \"decline\" joins with FIX-mail-014; \"draft-get\"/\"draft-save\" (FIX-mail-002)
    // were already on the surface — this pin had gone stale against them.
    assert.deepEqual(reg.names.sort(), ["claim", "decline", "delete", "draft-get", "draft-save", "get", "list", "read", "send", "sent"]);
  });

  it("S2: list/sent/get carry resolved names; an unresolved party carries nulls, never its id", async () => {
    const send = await reg.run("send", u1, { toUserId: "u2", subject: "Names ride along", body: "b" });
    assert.equal(send.ok, true);

    const inbox = await reg.run("list", u2, {});
    assert.equal(inbox.mail.length, 1);
    assert.equal(inbox.mail[0].fromName, "alice");
    assert.equal(inbox.mail[0].fromHandle, "alice");
    assert.equal(inbox.mail[0].toName, "bobby");

    const sent = await reg.run("sent", u1, {});
    assert.equal(sent.mail[0].toName, "bobby");
    assert.equal(sent.mail[0].toHandle, "bobby");
    assert.equal(sent.mail[0].fromName, "alice");

    const got = await reg.run("get", u2, { id: send.id });
    assert.equal(got.mail.fromName, "alice");
    assert.equal(got.mail.toName, "bobby");

    // A party with no users row (a since-removed account) resolves to
    // nulls — the raw id is never substituted as the display name.
    db.prepare(`INSERT INTO player_mail (id, from_user_id, to_user_id, subject, body) VALUES ('mail_ghost', 'gone-user', 'u2', 'From a removed account', 'b')`).run();
    const inbox2 = await reg.run("list", u2, {});
    const ghostRow = inbox2.mail.find((m) => m.id === "mail_ghost");
    assert.equal(ghostRow.fromName, null);
    assert.equal(ghostRow.fromHandle, null);
    assert.notEqual(ghostRow.fromName, "gone-user");
  });

  it("S3: the open path — sender opens own sent mail with no error; recipient read flips exactly once; outsider refused", async () => {
    const send = await reg.run("send", u1, { toUserId: "u2", subject: "Open path", body: "b" });
    assert.equal(send.ok, true);

    // The sender opens their own sent copy: the get succeeds and no
    // verb in the open path errors for the mail's own sender (the
    // pass's F4 notices do not reproduce against this path).
    const senderOpen = await reg.run("get", u1, { id: send.id });
    assert.equal(senderOpen.ok, true);
    assert.equal(senderOpen.mail.subject, "Open path");

    // The recipient opens: read flips unread → read…
    const first = await reg.run("read", u2, { id: send.id });
    assert.equal(first.ok, true);
    let row = await reg.run("get", u2, { id: send.id });
    assert.equal(row.mail.status, "read");
    const readAt = row.mail.readAt;
    assert.ok(readAt, "read_at is stamped");

    // …and a second open does not move it again (exactly once).
    const second = await reg.run("read", u2, { id: send.id });
    assert.equal(second.ok, true);
    row = await reg.run("get", u2, { id: send.id });
    assert.equal(row.mail.status, "read");
    assert.equal(row.mail.readAt, readAt);

    // A non-participant gets nothing from the open path at all.
    const outsider = await reg.run("get", ghost, { id: send.id });
    assert.equal(outsider.ok, false);
    const outsiderRead = await reg.run("read", ghost, { id: send.id });
    assert.equal(outsiderRead.ok, false);
  });

  it("S4: delete removes the sender's own sent copy only; the recipient's copy is untouched", async () => {
    const send = await reg.run("send", u1, { toUserId: "u2", subject: "Delete me", body: "b" });
    assert.equal(send.ok, true);

    // The recipient cannot remove the sender's copy.
    const byRecipient = await reg.run("delete", u2, { id: send.id });
    assert.equal(byRecipient.ok, false);
    assert.equal(byRecipient.error, "not_authorized");

    const del = await reg.run("delete", u1, { id: send.id });
    assert.equal(del.ok, true);
    assert.equal(del.deleted, true);

    // Gone from the sender's Sent list, and it stays gone on a fresh read.
    const sent = await reg.run("sent", u1, {});
    assert.equal(sent.mail.length, 0);

    // The recipient's inbox copy is untouched and still opens.
    const inbox = await reg.run("list", u2, {});
    assert.equal(inbox.mail.length, 1);
    assert.equal(inbox.mail[0].subject, "Delete me");

    // Deleting again is an idempotent no-op.
    const again = await reg.run("delete", u1, { id: send.id });
    assert.equal(again.ok, true);
  });

  it("S4: a claimed copy refuses deletion — it carries the claim record", async () => {
    db.prepare(`INSERT INTO dtus (id, creator_id, data) VALUES ('dtu_m', 'u1', json('{}'))`).run();
    const send = await reg.run("send", u1, { toUserId: "u2", subject: "Claim then keep", body: "b", attachmentDtuIds: ["dtu_m"], attachmentCc: 10 });
    assert.equal(send.ok, true);
    const claim = await reg.run("claim", u2, { id: send.id });
    assert.equal(claim.ok, true);
    const del = await reg.run("delete", u1, { id: send.id });
    assert.equal(del.ok, false);
    assert.equal(del.error, "already_claimed");
    const sent = await reg.run("sent", u1, {});
    assert.equal(sent.mail.length, 1);
  });

  it("S6: the export provider returns exactly the caller's own sent + received mail", async () => {
    assert.equal(hasLensExportProvider("mail"), true);
    await reg.run("send", u1, { toUserId: "u2", subject: "Exportable out", body: "b" });
    await reg.run("send", u2, { toUserId: "u1", subject: "Exportable in", body: "b" });

    const runMacro = async (domain, action, input, ctx) => ({ ok: true, artifacts: [] });
    const out = await collectLensExport({ runMacro, domain: "mail", ctx: u1 });
    assert.equal(out.ok, true);
    assert.equal(out.stateBacked, true);
    const titles = out.artifacts.map((a) => a.title).sort();
    assert.deepEqual(titles, ["Exportable in", "Exportable out"]);
    const dirs = Object.fromEntries(out.artifacts.map((a) => [a.title, a.data.direction]));
    assert.equal(dirs["Exportable out"], "sent");
    assert.equal(dirs["Exportable in"], "received");

    // Another caller sees only their own side of the same two mails —
    // the same rows, scoped to them; a third account sees nothing.
    const outGhost = await collectLensExport({ runMacro, domain: "mail", ctx: ghost });
    assert.equal(outGhost.artifacts.length, 0);
  });
});
