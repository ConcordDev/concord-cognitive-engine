// server/tests/social-moats.test.js
//
// Tier-2 contract tests for Sprint C: mint posts + custom feed
// algorithms, cross-lens cite cascade, federation outbox processor
// state machine, refusal-field integration.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerSocialMacros from "../domains/social.js";
import registerSocialAiMacros from "../domains/social-ai.js";
import registerSocialMoatsMacros from "../domains/social-moats.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["226_social_durable", "227_social_ai", "228_social_moats"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  // Minimal stand-ins for dtus + federation_outbox
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT, creator_id TEXT,
      meta_json TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS federation_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_json TEXT, target_inbox TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  registerSocialMacros(register);
  registerSocialAiMacros(register);
  registerSocialMoatsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── Mint post ──────────────────────────────────────────────────

describe("post_mint", () => {
  it("creates social_post DTU + idempotent + royalty clamped to 30%", async () => {
    const p = await MACROS.get("post_create")(ctx("u_mint"), { content: "mintable post" });
    const r1 = await MACROS.get("post_mint")(ctx("u_mint"), { postId: p.id, royaltyRate: 0.99 });
    assert.equal(r1.ok, true);
    assert.ok(r1.dtuId.startsWith("social_post:"));
    assert.equal(r1.royaltyRate, 0.30);
    const r2 = await MACROS.get("post_mint")(ctx("u_mint"), { postId: p.id });
    assert.equal(r2.alreadyMinted, true);
    assert.equal(r2.dtuId, r1.dtuId);
  });

  it("refuses to mint a private post", async () => {
    const p = await MACROS.get("post_create")(ctx("u_priv"), { content: "private", visibility: "private" });
    const r = await MACROS.get("post_mint")(ctx("u_priv"), { postId: p.id });
    assert.equal(r.ok, false); assert.equal(r.reason, "cannot_mint_private_post");
  });

  it("refuses cross-user mint", async () => {
    const p = await MACROS.get("post_create")(ctx("u_owner_mint"), { content: "mine" });
    const r = await MACROS.get("post_mint")(ctx("u_thief_mint"), { postId: p.id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("post_mint_status returns minted=false when not minted", async () => {
    const p = await MACROS.get("post_create")(ctx("u_unmint"), { content: "fresh" });
    const r = await MACROS.get("post_mint_status")(ctx("u_unmint"), { postId: p.id });
    assert.equal(r.minted, false);
  });

  it("post_cite_dtu requires mint + degrades when engine absent", async () => {
    const p = await MACROS.get("post_create")(ctx("u_cite_post"), { content: "cite test" });
    const unminted = await MACROS.get("post_cite_dtu")(ctx("u_cite_post"), { postId: p.id, dtuId: "dtu:any" });
    assert.equal(unminted.reason, "post_not_minted_yet");
    await MACROS.get("post_mint")(ctx("u_cite_post"), { postId: p.id });
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES (?, 'doc', 'Parent', 'u_other', '{}')`).run("dtu:cite_target");
    const r = await MACROS.get("post_cite_dtu")(ctx("u_cite_post"), { postId: p.id, dtuId: "dtu:cite_target" });
    assert.equal(r.ok, true);
    assert.ok(r.childDtuId);
  });
});

// ─── Mint algorithm ─────────────────────────────────────────────

describe("algo_publish + algo_install", () => {
  it("publishes algo as agent_spec DTU + flips visibility to public", async () => {
    const c = await MACROS.get("algo_create")(ctx("u_apub"), {
      name: "My anti-rage", weights: { rage_bait: -5, calm: 3 },
    });
    const p = await MACROS.get("algo_publish")(ctx("u_apub"), { algoId: c.id });
    assert.equal(p.ok, true);
    assert.ok(p.dtuId.startsWith("agent_spec:"));
    const row = db.prepare(`SELECT visibility, dtu_id FROM social_feed_algos WHERE id = ?`).get(c.id);
    assert.equal(row.visibility, "public");
    assert.equal(row.dtu_id, p.dtuId);
  });

  it("publish is idempotent", async () => {
    const c = await MACROS.get("algo_create")(ctx("u_apub2"), { name: "Idempotent" });
    const p1 = await MACROS.get("algo_publish")(ctx("u_apub2"), { algoId: c.id });
    const p2 = await MACROS.get("algo_publish")(ctx("u_apub2"), { algoId: c.id });
    assert.equal(p2.alreadyPublished, true);
    assert.equal(p2.dtuId, p1.dtuId);
  });

  it("refuses to publish seeded algos", async () => {
    // Make sure seeded algos exist
    await MACROS.get("algo_list")(ctx("u_seed_pub"));
    const r = await MACROS.get("algo_publish")(ctx("u_seed_pub"), { algoId: "algo:seed:inverse_x" });
    assert.equal(r.ok, false);
    assert.ok(["forbidden", "cannot_publish_seeded_algo"].includes(r.reason));
  });

  it("install creates my own copy + bumps install_count on source mint", async () => {
    const c = await MACROS.get("algo_create")(ctx("u_author_alg"), { name: "Shareable algo" });
    await MACROS.get("algo_publish")(ctx("u_author_alg"), { algoId: c.id });
    const i = await MACROS.get("algo_install")(ctx("u_installer_alg"), { algoId: c.id });
    assert.equal(i.ok, true);
    assert.notEqual(i.newAlgoId, c.id);
    // The fork (newAlgoId) gets me as a subscriber
    const subs = db.prepare(`SELECT COUNT(*) AS n FROM social_feed_algo_subscribers WHERE algo_id = ?`).get(i.newAlgoId);
    assert.equal(subs.n, 1);
    // The source's mint row records the install
    const mintRow = db.prepare(`SELECT install_count FROM social_algo_mints WHERE algo_id = ?`).get(c.id);
    assert.equal(mintRow.install_count, 1);
  });

  it("install rejects unpublished algos", async () => {
    const c = await MACROS.get("algo_create")(ctx("u_alg_priv"), { name: "Private", visibility: "private" });
    const r = await MACROS.get("algo_install")(ctx("u_alg_thief"), { algoId: c.id });
    assert.equal(r.ok, false); assert.equal(r.reason, "not_published");
  });
});

// ─── Federation processor ──────────────────────────────────────

describe("federation outbox processor", () => {
  it("outbox_status returns counts when tables exist", async () => {
    db.prepare(`INSERT INTO federation_outbox (activity_json, target_inbox) VALUES (?, ?)`).run('{"x":1}', "https://peer/inbox");
    db.prepare(`INSERT INTO federation_outbox (activity_json, target_inbox) VALUES (?, ?)`).run('{"y":2}', "https://peer/inbox");
    const r = await MACROS.get("federation_outbox_status")(ctx("u_fos"));
    assert.equal(r.ok, true);
    assert.ok(typeof r.pending === "number");
  });

  it("outbox_process seeds new entries to pending + advances to sent", async () => {
    db.prepare(`INSERT INTO federation_outbox (activity_json, target_inbox) VALUES (?, ?)`).run('{"a":1}', "https://peer/inbox");
    db.prepare(`INSERT INTO federation_outbox (activity_json, target_inbox) VALUES (?, ?)`).run('{"b":2}', "https://peer/inbox");
    const r = await MACROS.get("federation_outbox_process")(ctx("u_proc"));
    assert.equal(r.ok, true);
    assert.ok(r.processed >= 2);
    // Re-check status — should now show sent
    const status = await MACROS.get("federation_outbox_status")(ctx("u_proc"));
    assert.ok(status.sent >= 2);
  });

  it("processor is idempotent — re-running doesn't re-process sent rows", async () => {
    const r1 = await MACROS.get("federation_outbox_process")(ctx("u_idem"));
    const r2 = await MACROS.get("federation_outbox_process")(ctx("u_idem"));
    // Second call should process 0 new rows (everything already sent)
    assert.equal(r2.processed, 0);
  });
});

// ─── Refusal-Field integration ─────────────────────────────────

describe("post_check_refusal", () => {
  it("degrades gracefully when refusal engine absent", async () => {
    const p = await MACROS.get("post_create")(ctx("u_ref"), { content: "test content" });
    const r = await MACROS.get("post_check_refusal")(ctx("u_ref"), { postId: p.id });
    assert.equal(r.ok, true);
    // engine may or may not be present in the test environment
    assert.ok(typeof r.anyRefused === "boolean");
  });

  it("returns not_found for missing post", async () => {
    const r = await MACROS.get("post_check_refusal")(ctx("u_ref2"), { postId: "post:fake" });
    assert.equal(r.ok, false); assert.equal(r.reason, "not_found");
  });
});
