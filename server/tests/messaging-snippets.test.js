// server/tests/messaging-snippets.test.js
//
// Sprint B #17 — snippets with royalty cascade on cross-user reuse.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerMessagingSnippetMacros from "../domains/messaging-snippets.js";
import registerMessagingConversationsMacros from "../domains/messaging-conversations.js";

let db; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT,
      creator_id TEXT, meta_json TEXT, skill_level INTEGER DEFAULT 1,
      total_experience INTEGER DEFAULT 0, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS royalty_lineage (
      id TEXT PRIMARY KEY, child_id TEXT NOT NULL, parent_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1, creator_id TEXT,
      parent_creator TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS user_consent (
      user_id TEXT NOT NULL, key TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER, PRIMARY KEY (user_id, key)
    );
  `);
  const mig = await import("../migrations/209_messaging_substrate.js");
  mig.up(db);
  registerMessagingSnippetMacros((_d, n, h) => macros.set(n, h));
  registerMessagingConversationsMacros((_d, n, h) => macros.set(n, h));
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("snippets CRUD", () => {
  let snippetId;
  it("snippet_create requires title + body", async () => {
    const r = await macros.get("snippet_create")({ db, actor: { userId: "u_author" } }, { title: "" });
    assert.equal(r.ok, false);
  });
  it("snippet_create mints a kind='message_snippet' DTU", async () => {
    const r = await macros.get("snippet_create")({ db, actor: { userId: "u_author" } }, {
      title: "sprint kickoff", body: "Hey team, here's the agenda…",
      visibility: "public", license: "CC-BY-SA",
    });
    assert.equal(r.ok, true);
    snippetId = r.snippetDtuId;
    const row = db.prepare(`SELECT kind FROM dtus WHERE id = ?`).get(snippetId);
    assert.equal(row.kind, "message_snippet");
  });
  it("snippet_list scope='mine' returns the caller's snippets", async () => {
    const r = await macros.get("snippet_list")({ db, actor: { userId: "u_author" } }, { scope: "mine" });
    assert.equal(r.ok, true);
    assert.ok(r.snippets.length >= 1);
  });
  it("snippet_list scope='public' returns only public snippets", async () => {
    const priv = await macros.get("snippet_create")({ db, actor: { userId: "u_author" } }, {
      title: "private", body: "secret",
    });
    const r = await macros.get("snippet_list")({ db }, { scope: "public" });
    assert.ok(r.snippets.every((s) => s.visibility === "public"));
    assert.ok(!r.snippets.find((s) => s.id === priv.snippetDtuId));
  });
});

describe("snippet_use + royalty cascade", () => {
  let snippetId; let cid;
  before(async () => {
    const s = await macros.get("snippet_create")({ db, actor: { userId: "u_author" } }, {
      title: "public template", body: "Welcome to the team!", visibility: "public", license: "CC-BY-SA",
    });
    snippetId = s.snippetDtuId;
    const c = await macros.get("convo_create")({ db, actor: { userId: "u_user" } }, { kind: "channel", title: "use-ch" });
    cid = c.id;
  });
  it("snippet_use forbidden for non-participant", async () => {
    const c = await macros.get("convo_create")({ db, actor: { userId: "u_other" } }, { kind: "channel", title: "other" });
    const r = await macros.get("snippet_use")({ db, actor: { userId: "u_user" } }, { snippetDtuId: snippetId, conversationId: c.id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });
  it("snippet_use cross-user public posts the body + fires cascade", async () => {
    const r = await macros.get("snippet_use")({ db, actor: { userId: "u_user" } }, { snippetDtuId: snippetId, conversationId: cid });
    assert.equal(r.ok, true);
    assert.equal(r.cascadeRegistered, true);
    assert.equal(r.sameAuthor, false);
    // royalty_lineage row exists
    const lin = db.prepare(`SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?`).get(r.messageId, snippetId);
    assert.ok(lin);
    // Message has the snippet body
    const msg = db.prepare(`SELECT body FROM messages WHERE id = ?`).get(r.messageId);
    assert.equal(msg.body, "Welcome to the team!");
  });
  it("snippet_use same-author skips cascade", async () => {
    const c = await macros.get("convo_create")({ db, actor: { userId: "u_author" } }, { kind: "channel", title: "self" });
    const r = await macros.get("snippet_use")({ db, actor: { userId: "u_author" } }, { snippetDtuId: snippetId, conversationId: c.id });
    assert.equal(r.ok, true);
    assert.equal(r.cascadeRegistered, false);
    assert.equal(r.sameAuthor, true);
  });
});
