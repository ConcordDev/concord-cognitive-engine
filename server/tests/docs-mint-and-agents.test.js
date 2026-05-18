// server/tests/docs-mint-and-agents.test.js
//
// Tier-2 contract tests for the Sprint C concord-native moats:
// mint-as-DTU, cross-lens cite cascade, DTU pack export, page-bound
// agents + publish-as-agent_spec-DTU. The royalty cascade engine is
// stubbed in tests that don't run the full economy schema; the cite
// macro is designed to degrade gracefully when the engine is missing.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerDocsMacros from "../domains/docs.js";
import registerDocsMintMacros from "../domains/docs-mint.js";
import registerDocsAgentsMacros from "../domains/docs-agents.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const n of ["211_documents", "212_doc_ai", "213_doc_extensions"]) {
    const m = await import(`../migrations/${n}.js`);
    m.up(db);
  }
  // dtus table — minimal shape sufficient for the mint + agent paths.
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      title       TEXT,
      creator_id  TEXT,
      meta_json   TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  registerDocsMacros(register);
  registerDocsMintMacros(register);
  registerDocsAgentsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId = "u_mint", llm = null) { return { db, actor: { userId }, llm }; }

async function makeDoc(userId, title = "Doc") {
  const r = await MACROS.get("create")(ctx(userId), { title, contentHtml: "<h1>Body</h1>" });
  return r.id;
}

describe("docs-mint: mint_as_dtu", () => {
  it("mints a doc into a 'document' DTU + records doc_mints", async () => {
    const docId = await makeDoc("u_owner");
    const r = await MACROS.get("mint_as_dtu")(ctx("u_owner"), { documentId: docId, royaltyRate: 0.15 });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId.startsWith("document:"));
    assert.equal(r.royaltyRate, 0.15);
    const dtu = db.prepare(`SELECT kind, creator_id FROM dtus WHERE id = ?`).get(r.dtuId);
    assert.equal(dtu.kind, "document");
    assert.equal(dtu.creator_id, "u_owner");
  });

  it("mint is idempotent — second mint returns the existing dtu_id", async () => {
    const docId = await makeDoc("u_owner2");
    const a = await MACROS.get("mint_as_dtu")(ctx("u_owner2"), { documentId: docId });
    const b = await MACROS.get("mint_as_dtu")(ctx("u_owner2"), { documentId: docId });
    assert.equal(b.dtuId, a.dtuId);
    assert.equal(b.alreadyMinted, true);
  });

  it("royaltyRate clamped to constitutional 30% cap", async () => {
    const docId = await makeDoc("u_cap");
    const r = await MACROS.get("mint_as_dtu")(ctx("u_cap"), { documentId: docId, royaltyRate: 0.99 });
    assert.equal(r.royaltyRate, 0.30);
  });

  it("non-admin forbidden", async () => {
    const docId = await makeDoc("u_admin");
    const r = await MACROS.get("mint_as_dtu")(ctx("u_outsider"), { documentId: docId });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });

  it("mint_status returns minted=false for unminted, minted=true with row otherwise", async () => {
    const docId = await makeDoc("u_status");
    const a = await MACROS.get("mint_status")(ctx("u_status"), { documentId: docId });
    assert.equal(a.minted, false);
    await MACROS.get("mint_as_dtu")(ctx("u_status"), { documentId: docId });
    const b = await MACROS.get("mint_status")(ctx("u_status"), { documentId: docId });
    assert.equal(b.minted, true);
    assert.ok(b.mint?.dtu_id);
  });
});

describe("docs-mint: cite_dtu", () => {
  it("returns doc_not_minted_yet if source doc isn't minted", async () => {
    const docId = await makeDoc("u_cite");
    // parent DTU
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES (?, 'chord_progression', 'parent', 'u_other', '{}')`).run("dtu:parent");
    const r = await MACROS.get("cite_dtu")(ctx("u_cite"), { documentId: docId, dtuId: "dtu:parent" });
    assert.equal(r.ok, false); assert.equal(r.reason, "doc_not_minted_yet");
  });

  it("returns parent_dtu_not_found when DTU doesn't exist", async () => {
    const docId = await makeDoc("u_cite2");
    await MACROS.get("mint_as_dtu")(ctx("u_cite2"), { documentId: docId });
    const r = await MACROS.get("cite_dtu")(ctx("u_cite2"), { documentId: docId, dtuId: "dtu:does-not-exist" });
    assert.equal(r.ok, false); assert.equal(r.reason, "parent_dtu_not_found");
  });

  it("happy path: minted doc cites real DTU, cascade soft-degrades when engine absent", async () => {
    const docId = await makeDoc("u_happy");
    await MACROS.get("mint_as_dtu")(ctx("u_happy"), { documentId: docId });
    db.prepare(`INSERT OR REPLACE INTO dtus (id, kind, title, creator_id, meta_json) VALUES (?, 'whiteboard_board', 'p', 'u_other', '{}')`).run("dtu:wb:1");
    const r = await MACROS.get("cite_dtu")(ctx("u_happy"), { documentId: docId, dtuId: "dtu:wb:1" });
    // Either engine fires successfully or degrades to noted — never throws.
    assert.equal(r.ok, true);
    assert.ok(r.childDtuId);
    assert.equal(r.parentDtuId, "dtu:wb:1");
  });
});

describe("docs-mint: export_dtu_pack", () => {
  it("produces a v1 envelope with doc + null mint when unminted", async () => {
    const docId = await makeDoc("u_export");
    const r = await MACROS.get("export_dtu_pack")(ctx("u_export"), { documentId: docId });
    assert.equal(r.ok, true);
    assert.equal(r.pack.spec, "concord-doc-pack/v1");
    assert.equal(r.pack.document.id, docId);
    assert.equal(r.pack.mint, null);
  });

  it("includes mint metadata when minted", async () => {
    const docId = await makeDoc("u_export2");
    await MACROS.get("mint_as_dtu")(ctx("u_export2"), { documentId: docId, royaltyRate: 0.10 });
    const r = await MACROS.get("export_dtu_pack")(ctx("u_export2"), { documentId: docId });
    assert.equal(r.pack.mint.royalty_rate, 0.10);
    assert.ok(r.pack.mint.dtu_id);
  });
});

describe("docs-agents: CRUD + publish", () => {
  let docId;
  before(async () => { docId = await makeDoc("u_ag"); });

  it("agent_create + list round-trip", async () => {
    const c = await MACROS.get("agent_create")(ctx("u_ag"), {
      documentId: docId, name: "Editor", systemPrompt: "You are this doc's editor.",
      capabilities: ["read_doc", "read_comments"],
    });
    assert.equal(c.ok, true);
    const list = await MACROS.get("agent_list")(ctx("u_ag"), { documentId: docId });
    assert.ok(list.agents.find((a) => a.id === c.id));
    assert.deepEqual(list.agents.find((a) => a.id === c.id).capabilities, ["read_doc", "read_comments"]);
  });

  it("agent_run returns llm_unavailable without LLM in context", async () => {
    const c = await MACROS.get("agent_create")(ctx("u_ag"), {
      documentId: docId, name: "Test", systemPrompt: "x", capabilities: ["read_doc"],
    });
    const r = await MACROS.get("agent_run")(ctx("u_ag"), { id: c.id, message: "hi" });
    assert.equal(r.ok, false); assert.equal(r.reason, "llm_unavailable");
  });

  it("agent_run injects doc context per read_doc capability", async () => {
    const c = await MACROS.get("agent_create")(ctx("u_ag"), {
      documentId: docId, name: "Reader", systemPrompt: "Read doc.", capabilities: ["read_doc"],
    });
    let captured = "";
    const llm = { chat: async (req) => { captured = req.messages[0].content; return { content: "ok" }; } };
    await MACROS.get("agent_run")({ db, actor: { userId: "u_ag" }, llm }, { id: c.id, message: "what is this?" });
    assert.ok(captured.includes("Current document"), `got system prompt: ${captured.slice(0, 200)}`);
  });

  it("agent_publish mints an agent_spec DTU and fills dtu_id", async () => {
    const c = await MACROS.get("agent_create")(ctx("u_ag"), {
      documentId: docId, name: "Publisher", systemPrompt: "p", capabilities: ["read_doc"],
    });
    const p = await MACROS.get("agent_publish")(ctx("u_ag"), { id: c.id });
    assert.equal(p.ok, true);
    assert.ok(p.dtuId.startsWith("agent_spec:"));
    const list = await MACROS.get("agent_list")(ctx("u_ag"), { documentId: docId });
    const row = list.agents.find((a) => a.id === c.id);
    assert.equal(row.dtu_id, p.dtuId);
    const dtu = db.prepare(`SELECT kind FROM dtus WHERE id = ?`).get(p.dtuId);
    assert.equal(dtu.kind, "agent_spec");
  });

  it("agent_publish idempotent — second call returns alreadyPublished", async () => {
    const c = await MACROS.get("agent_create")(ctx("u_ag"), {
      documentId: docId, name: "Idem", systemPrompt: "p",
    });
    await MACROS.get("agent_publish")(ctx("u_ag"), { id: c.id });
    const r2 = await MACROS.get("agent_publish")(ctx("u_ag"), { id: c.id });
    assert.equal(r2.alreadyPublished, true);
  });
});
