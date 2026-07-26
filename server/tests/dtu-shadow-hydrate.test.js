// server/tests/dtu-shadow-hydrate.test.js
//
// Pure unit tests for server/lib/dtu-shadow-hydrate.js — the read-side fix
// for "a DTU minted via a raw `INSERT INTO dtus` is invisible to
// marketplace.list/purchaseWithRoyalties" (those macros only ever read
// STATE.dtus, which only `dtu.create` populates). See
// server/tests/marketplace-sql-shadow-hydration.test.js for the end-to-end
// (booted-server) proof that the two confirmed victims — gamedesign.js's
// building-publish and forge-marketplace.js's mintForgeAppAsDtu — are now
// listable/purchasable. This file pins the pure mapping logic in isolation,
// no server boot required.
//
// Run: node --test server/tests/dtu-shadow-hydrate.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { hydrateDtuRow, readAndHydrateDtu } from "../lib/dtu-shadow-hydrate.js";

describe("hydrateDtuRow — pure row → STATE.dtus shape mapper", () => {
  it("returns null for a falsy or id-less row", () => {
    assert.equal(hydrateDtuRow(null), null);
    assert.equal(hydrateDtuRow(undefined), null);
    assert.equal(hydrateDtuRow({}), null);
    assert.equal(hydrateDtuRow({ title: "no id here" }), null);
  });

  it("body_json shape (gamedesign.js#building-publish): title/meta/human/lineage from the JSON blob, tags from tags_json", () => {
    const body = {
      title: "Riverside Watchtower",
      meta: { type: "blueprint", kind: "building", archetype: "tower" },
      human: { summary: "Riverside Watchtower — an authored tower building." },
      lineage: { parents: ["concept-art-1"], conceptArtDtuId: "concept-art-1" },
    };
    const row = {
      id: "dtu_bp_1",
      owner_user_id: "user-1",
      title: "Riverside Watchtower",
      body_json: JSON.stringify(body),
      tags_json: JSON.stringify(["building", "blueprint", "tower"]),
      visibility: "public",
      tier: "regular",
      created_at: "2026-01-02 03:04:05",
      updated_at: "2026-01-02 03:04:05",
    };
    const dtu = hydrateDtuRow(row);
    assert.equal(dtu.id, "dtu_bp_1");
    assert.equal(dtu.ownerId, "user-1");
    assert.equal(dtu.title, "Riverside Watchtower");
    assert.deepEqual(dtu.tags, ["building", "blueprint", "tower"]);
    assert.equal(dtu.visibility, "public");
    assert.equal(dtu.tier, "regular");
    assert.equal(dtu.human.summary, body.human.summary);
    assert.deepEqual(dtu.lineage, body.lineage);
    assert.equal(dtu.meta.kind, "building");
    assert.equal(dtu.meta.archetype, "tower");
    assert.equal(dtu.sqlShadow, true);
    assert.equal(dtu.source, "sql_shadow");
    // no `scope` column exists on `dtus` — never invented
    assert.equal(dtu.scope, undefined);
    // ISO timestamps, not the raw SQLite "datetime('now')" string
    assert.match(dtu.createdAt, /^2026-01-02T03:04:05/);
  });

  it("data shape (forge-marketplace.js#mintForgeAppAsDtu): creator_id as owner, unixepoch created_at, meta from `data`, human.summary falls back to meta.summary", () => {
    const meta = {
      author_kind: "player",
      skill_kind: "forge_app",
      forge_template_id: null,
      summary: "A single-file todo tracker.",
      source_size: 42,
    };
    const nowSec = Math.floor(Date.parse("2026-02-03T04:05:06Z") / 1000);
    const row = {
      id: "forge:user-2:abcd1234",
      type: "forge_app",
      title: "Todo Tracker",
      creator_id: "user-2",
      data: JSON.stringify(meta),
      skill_level: 1,
      total_experience: 0,
      created_at: nowSec, // unixepoch() integer, not a string
    };
    const dtu = hydrateDtuRow(row);
    assert.equal(dtu.ownerId, "user-2");
    assert.equal(dtu.title, "Todo Tracker");
    assert.equal(dtu.human.summary, "A single-file todo tracker.");
    assert.equal(dtu.meta.skill_kind, "forge_app");
    assert.equal(dtu.meta.source_size, 42);
    // no body_json on this shape → empty lineage, never fabricated
    assert.deepEqual(dtu.lineage, {});
    assert.equal(dtu.createdAt, "2026-02-03T04:05:06.000Z");
  });

  it("content shape (server/economy/dtu-pipeline.js#createDTU): human.summary falls back to a content slice when there's no title/summary", () => {
    const row = {
      id: "dtu_content_1",
      creator_id: "user-3",
      content: "Long-form article body text that should become the fallback summary.",
      content_type: "text",
      metadata_json: JSON.stringify({ citationMode: "open" }),
      status: "published",
      title: null,
      created_at: "2026-03-04 05:06:07",
    };
    const dtu = hydrateDtuRow(row);
    assert.equal(dtu.title, "Untitled DTU"); // no title, no body_json.title
    assert.equal(dtu.human.summary, row.content.slice(0, 320));
    assert.equal(dtu.meta.citationMode, "open");
  });

  it("owner resolution prefers owner_user_id over creator_id when both are present", () => {
    const dtu = hydrateDtuRow({ id: "x", owner_user_id: "owner-a", creator_id: "owner-b" });
    assert.equal(dtu.ownerId, "owner-a");
  });

  it("malformed JSON blobs degrade to safe defaults instead of throwing", () => {
    const dtu = hydrateDtuRow({
      id: "dtu_bad_json",
      owner_user_id: "user-4",
      title: "Still Fine",
      body_json: "{not valid json",
      tags_json: "also not json",
      data: "{broken",
      metadata_json: "[1,2,",
    });
    assert.equal(dtu.title, "Still Fine");
    assert.deepEqual(dtu.tags, []);
    assert.deepEqual(dtu.meta, {});
    assert.deepEqual(dtu.lineage, {});
  });

  it("a system-authored row (no owner) is marked creatorType 'system'", () => {
    const dtu = hydrateDtuRow({ id: "dtu_system_1", title: "Seed content" });
    assert.equal(dtu.ownerId, null);
    assert.equal(dtu.creatorType, "system");
  });
});

describe("readAndHydrateDtu — SELECT + hydrate against a real SQLite handle", () => {
  function createDb() {
    const db = new Database(":memory:");
    // Minimal real-shaped schema: the migration-001 canonical columns plus
    // the migration-087/295 additive columns the raw-INSERT call sites use.
    db.exec(`
      CREATE TABLE dtus (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT,
        title TEXT NOT NULL DEFAULT 'Untitled',
        body_json TEXT NOT NULL DEFAULT '{}',
        tags_json TEXT NOT NULL DEFAULT '[]',
        visibility TEXT NOT NULL DEFAULT 'private',
        tier TEXT NOT NULL DEFAULT 'regular',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        type TEXT,
        creator_id TEXT,
        data TEXT,
        skill_level REAL,
        total_experience REAL,
        content TEXT,
        content_type TEXT,
        metadata_json TEXT,
        status TEXT,
        lens_id TEXT,
        content_hash TEXT,
        world_id TEXT
      );
    `);
    return db;
  }

  it("returns null when there's no db, no dtuId, or no matching row", () => {
    const db = createDb();
    assert.equal(readAndHydrateDtu(null, "x"), null);
    assert.equal(readAndHydrateDtu(db, null), null);
    assert.equal(readAndHydrateDtu(db, "nonexistent"), null);
    db.close();
  });

  it("hydrates a raw-INSERT row exactly like gamedesign.js#building-publish writes it", () => {
    const db = createDb();
    const body = { title: "Ember Forge", meta: { kind: "building" }, human: { summary: "A working forge." } };
    db.prepare(`
      INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'public', 'regular', datetime('now'), datetime('now'))
    `).run("dtu_ember", "user-9", "Ember Forge", JSON.stringify(body), JSON.stringify(["building"]));

    const dtu = readAndHydrateDtu(db, "dtu_ember");
    assert.ok(dtu);
    assert.equal(dtu.id, "dtu_ember");
    assert.equal(dtu.ownerId, "user-9");
    assert.equal(dtu.human.summary, "A working forge.");
    db.close();
  });

  it("never throws when the query itself fails (e.g. table missing)", () => {
    const db = new Database(":memory:"); // no `dtus` table at all
    assert.equal(readAndHydrateDtu(db, "anything"), null);
    db.close();
  });
});
