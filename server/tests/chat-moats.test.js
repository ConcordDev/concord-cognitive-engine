// server/tests/chat-moats.test.js
//
// Tier-2 contract tests for Sprint C: session mint + cross-lens cite,
// persona marketplace publish + install, 5-brain council mode,
// public links, conversation export.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerChatExtrasMacros from "../domains/chat-extras.js";
import registerChatMoatsMacros from "../domains/chat-moats.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["223_chat_extras", "224_chat_ai_surface", "225_chat_moats"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  // Minimal stand-ins for chat_sessions / chat_messages / dtus
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY, user_id TEXT, title TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT, creator_id TEXT,
      meta_json TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  registerChatExtrasMacros(register);
  registerChatMoatsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

function makeSession(userId, id = `sess_${Math.random().toString(36).slice(2)}`) {
  db.prepare(`INSERT INTO chat_sessions (id, user_id, title) VALUES (?, ?, ?)`).run(id, userId, `Test ${id}`);
  return id;
}

// ─── Session mint + cite ────────────────────────────────────────

describe("session_mint + cite cascade", () => {
  it("session_mint creates chat_session DTU + idempotent + royalty clamped", async () => {
    const sid = makeSession("u_sm1");
    const r1 = await MACROS.get("session_mint")(ctx("u_sm1"), { sessionId: sid, royaltyRate: 0.99 });
    assert.equal(r1.ok, true);
    assert.equal(r1.royaltyRate, 0.30);
    assert.ok(r1.dtuId.startsWith("chat_session:"));
    const r2 = await MACROS.get("session_mint")(ctx("u_sm1"), { sessionId: sid });
    assert.equal(r2.alreadyMinted, true);
    assert.equal(r2.dtuId, r1.dtuId);
  });

  it("session_mint refuses cross-user", async () => {
    const sid = makeSession("u_owner");
    const r = await MACROS.get("session_mint")(ctx("u_thief"), { sessionId: sid });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });

  it("session_mint_status returns minted=false when not minted", async () => {
    const sid = makeSession("u_ns");
    const r = await MACROS.get("session_mint_status")(ctx("u_ns"), { sessionId: sid });
    assert.equal(r.minted, false);
  });

  it("session_cite_dtu requires mint first + degrades when engine absent", async () => {
    const sid = makeSession("u_cite");
    const unminted = await MACROS.get("session_cite_dtu")(ctx("u_cite"), { sessionId: sid, dtuId: "dtu:fake" });
    assert.equal(unminted.ok, false); assert.equal(unminted.reason, "session_not_minted_yet");
    await MACROS.get("session_mint")(ctx("u_cite"), { sessionId: sid });
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES (?, 'doc', 'P', 'u_other', '{}')`).run("dtu:p_cite");
    const r = await MACROS.get("session_cite_dtu")(ctx("u_cite"), { sessionId: sid, dtuId: "dtu:p_cite" });
    assert.equal(r.ok, true);
    assert.ok(r.childDtuId);
  });
});

// ─── Persona marketplace ────────────────────────────────────────

describe("persona_publish + persona_install", () => {
  it("persona_publish mints agent_spec DTU + flips visibility to public", async () => {
    const c = await MACROS.get("persona_create")(ctx("u_pp"), { name: "Pub", systemPrompt: "x" });
    const p = await MACROS.get("persona_publish")(ctx("u_pp"), { id: c.id });
    assert.equal(p.ok, true);
    assert.ok(p.dtuId.startsWith("agent_spec:"));
    const get = await MACROS.get("persona_get")(ctx("u_pp"), { id: c.id });
    assert.equal(get.persona.visibility, "public");
  });

  it("persona_install creates my own copy + bumps install_count", async () => {
    // First, owner publishes
    const c = await MACROS.get("persona_create")(ctx("u_author"), { name: "Sharable", systemPrompt: "be sharable", visibility: "private" });
    await MACROS.get("persona_publish")(ctx("u_author"), { id: c.id });
    // Now another user installs
    const i = await MACROS.get("persona_install")(ctx("u_installer"), { personaId: c.id });
    assert.equal(i.ok, true);
    assert.notEqual(i.newPersonaId, c.id);
    const mine = await MACROS.get("persona_list")(ctx("u_installer"));
    assert.ok(mine.personas.find((p) => p.id === i.newPersonaId));
  });

  it("persona_install rejects unpublished personas", async () => {
    const c = await MACROS.get("persona_create")(ctx("u_priv"), { name: "Private", systemPrompt: "x", visibility: "private" });
    const r = await MACROS.get("persona_install")(ctx("u_install_priv"), { personaId: c.id });
    assert.equal(r.ok, false); assert.equal(r.reason, "not_published");
  });
});

// ─── 5-brain council ────────────────────────────────────────────

describe("council mode", () => {
  it("council_start + record_response + synthesize lifecycle", async () => {
    const r = await MACROS.get("council_start")(ctx("u_council"), { question: "Should we ship?", brains: ["conscious", "subconscious"] });
    assert.equal(r.ok, true);
    await MACROS.get("council_record_response")(ctx("u_council"), { id: r.id, brainSlot: "conscious", response: "Yes — ready" });
    const after1 = await MACROS.get("council_get")(ctx("u_council"), { id: r.id });
    assert.equal(after1.run.status, "collecting");
    assert.equal(after1.run.responses.conscious.response, "Yes — ready");
    await MACROS.get("council_record_response")(ctx("u_council"), { id: r.id, brainSlot: "subconscious", response: "Yes — but watch X" });
    const after2 = await MACROS.get("council_get")(ctx("u_council"), { id: r.id });
    assert.equal(after2.run.status, "synthesizing");
    await MACROS.get("council_synthesize")(ctx("u_council"), { id: r.id, synthesis: "Ship with caveat on X" });
    const final = await MACROS.get("council_get")(ctx("u_council"), { id: r.id });
    assert.equal(final.run.status, "complete");
    assert.equal(final.run.synthesis, "Ship with caveat on X");
  });

  it("council_get forbidden cross-user", async () => {
    const r = await MACROS.get("council_start")(ctx("u_owner_cc"), { question: "?" });
    const g = await MACROS.get("council_get")(ctx("u_thief"), { id: r.id });
    assert.equal(g.ok, false); assert.equal(g.reason, "forbidden");
  });

  it("council_start defaults to 3 brains", async () => {
    const r = await MACROS.get("council_start")(ctx("u_def"), { question: "default test" });
    assert.equal(r.brains.length, 3);
  });
});

// ─── Public links ───────────────────────────────────────────────

describe("public links", () => {
  it("public_link_create + get + revoke round-trip", async () => {
    const sid = makeSession("u_pl");
    db.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', 'hi'), (?, 'assistant', 'hi back')`).run(sid, sid);
    const c = await MACROS.get("public_link_create")(ctx("u_pl"), { sessionId: sid });
    assert.equal(c.ok, true);
    const g = await MACROS.get("public_link_get")({ db }, { slug: c.slug });
    assert.equal(g.ok, true);
    assert.equal(g.link.messages.length, 2);
    // Re-fetch should bump access_count
    await MACROS.get("public_link_get")({ db }, { slug: c.slug });
    const list = await MACROS.get("public_link_list")(ctx("u_pl"));
    const link = list.links.find((l) => l.id === c.slug);
    assert.ok(link.access_count >= 2);
    await MACROS.get("public_link_revoke")(ctx("u_pl"), { slug: c.slug });
    const after = await MACROS.get("public_link_get")({ db }, { slug: c.slug });
    assert.equal(after.ok, false); assert.equal(after.reason, "not_found");
  });

  it("public_link_get respects expires_at", async () => {
    const sid = makeSession("u_exp");
    const c = await MACROS.get("public_link_create")(ctx("u_exp"), { sessionId: sid, expiresInHours: 1 });
    // Force-expire
    db.prepare(`UPDATE chat_public_links SET expires_at = unixepoch() - 60 WHERE id = ?`).run(c.slug);
    const g = await MACROS.get("public_link_get")({ db }, { slug: c.slug });
    assert.equal(g.reason, "expired");
  });
});

// ─── Session export ─────────────────────────────────────────────

describe("session_export", () => {
  it("md format produces a markdown document with messages", async () => {
    const sid = makeSession("u_exp_md");
    db.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', 'hi'), (?, 'assistant', 'response')`).run(sid, sid);
    const r = await MACROS.get("session_export")(ctx("u_exp_md"), { sessionId: sid, format: "md" });
    assert.equal(r.format, "md");
    assert.ok(r.data.includes("**user:** hi"));
    assert.ok(r.data.includes("**assistant:** response"));
    assert.ok(r.filename.endsWith(".md"));
  });

  it("json format includes session + messages", async () => {
    const sid = makeSession("u_exp_json");
    db.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', 'a')`).run(sid);
    const r = await MACROS.get("session_export")(ctx("u_exp_json"), { sessionId: sid, format: "json" });
    assert.equal(r.format, "json");
    assert.ok(r.data.session.id === sid);
    assert.equal(r.data.messages.length, 1);
  });

  it("forbidden cross-user", async () => {
    const sid = makeSession("u_ex_own");
    const r = await MACROS.get("session_export")(ctx("u_ex_thief"), { sessionId: sid });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });
});
