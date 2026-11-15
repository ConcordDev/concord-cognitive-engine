// GB-1538 schema-adaptive follow-on — the three dtus-shape loci the
// genus census named but did not seat (cross-lens-discovery,
// dtu-lens-routing, mcp-tools) must work on BOTH dtus lineages. The
// migrated shape carries type/data/lens_id; the live dtu-store
// runtime shape carries content/content_type and none of those.
// Before this follow-on: searchDtus returned search_failed on every
// runtime-shape call (type + data + lens_id all absent), the facets
// and trending reads silently emptied, backfillLensIds threw its
// SELECT into an ok:false on every heartbeat, and the MCP dtu tools
// (search/get/list/compress/lensList/lensManifest) all failed with
// "no such column". Each module now resolves its columns from
// PRAGMA and builds its queries from the plan; on the migrated
// shape the behaviour is the historical one.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { searchDtus, getKindFacets, getTrending } from "../lib/cross-lens-discovery.js";
import { backfillLensIds } from "../lib/dtu-lens-routing.js";
import { dtuSearch, dtuGet, dtuList, dtuCompress, lensList, lensManifest } from "../lib/mcp-tools.js";

function migratedDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT, data TEXT, content TEXT, lens_id TEXT, tier TEXT, created_at INTEGER);
           CREATE TABLE royalty_lineage (parent_id TEXT, created_at TEXT);`);
  db.prepare(`INSERT INTO dtus (id, type, title, creator_id, data, content, lens_id, tier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("m1", "essay", "Frost essay", "u1", "a study of frost and ice", "a study of frost and ice", "core", "free", 100);
  db.prepare(`INSERT INTO dtus (id, type, title, creator_id, data, content, lens_id, tier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("m2", "essay", "Secret journal", "u1", JSON.stringify({ scope: "personal", text: "journal" }), "journal", "core", "free", 90);
  return db;
}

function runtimeDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT, title TEXT, content TEXT, content_type TEXT, tier TEXT, created_at INTEGER, embedding TEXT);
           CREATE TABLE royalty_lineage (parent_id TEXT, created_at TEXT);`);
  db.prepare(`INSERT INTO dtus (id, creator_id, title, content, content_type, tier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("r1", "u1", "Frost essay", "a study of frost and ice", "essay", "free", 100);
  db.prepare(`INSERT INTO dtus (id, creator_id, title, content, content_type, tier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("r2", "u1", "Secret journal", JSON.stringify({ scope: "personal", text: "journal" }), "essay", "free", 90);
  return db;
}

describe("cross-lens-discovery on the runtime shape", () => {
  it("searchDtus finds by body text and kind, honouring personal scope", () => {
    const db = runtimeDb();
    const byBody = searchDtus(db, "frost");
    assert.equal(byBody.ok, true);
    assert.deepEqual(byBody.results.map((r) => r.id), ["r1"]);
    assert.equal(byBody.results[0].kind, "essay");
    const byKind = searchDtus(db, "frost", { kind: "essay" });
    assert.equal(byKind.results.length, 1);
    const wrongKind = searchDtus(db, "frost", { kind: "spell_recipe" });
    assert.equal(wrongKind.results.length, 0);
    const anon = searchDtus(db, "journal");
    assert.equal(anon.results.length, 0);
    const owner = searchDtus(db, "journal", { requesterId: "u1" });
    assert.equal(owner.results.length, 1);
  });

  it("getKindFacets counts by content_type", () => {
    const db = runtimeDb();
    const facets = getKindFacets(db, "u1");
    assert.deepEqual(facets, [{ kind: "essay", n: 2 }]);
  });

  it("getTrending ranks with kind read from content_type", () => {
    const db = runtimeDb();
    db.prepare(`INSERT INTO royalty_lineage (parent_id, created_at) VALUES (?, datetime('now'))`).run("r1");
    db.prepare(`INSERT INTO royalty_lineage (parent_id, created_at) VALUES (?, datetime('now'))`).run("r1");
    db.prepare(`INSERT INTO royalty_lineage (parent_id, created_at) VALUES (?, datetime('now'))`).run("r2");
    const t = getTrending(db, { lookbackS: 3600, limit: 10 });
    assert.equal(t[0].id, "r1");
    assert.equal(t[0].kind, "essay");
    assert.equal(t[0].citations, 2);
  });
});

describe("cross-lens-discovery on the migrated shape (unchanged behaviour)", () => {
  it("searchDtus + facets behave as before", () => {
    const db = migratedDb();
    const r = searchDtus(db, "frost");
    assert.equal(r.ok, true);
    assert.deepEqual(r.results.map((x) => x.id), ["m1"]);
    assert.equal(r.results[0].kind, "essay");
    assert.deepEqual(getKindFacets(db, "u1"), [{ kind: "essay", n: 2 }]);
  });
});

describe("dtu-lens-routing backfill", () => {
  it("is an honest no-op on the runtime shape (no lens_id column)", () => {
    const db = runtimeDb();
    const r = backfillLensIds(db);
    assert.equal(r.ok, true);
    assert.equal(r.reason, "no_lens_id_column");
    assert.equal(r.scanned, 0);
    assert.equal(r.stamped, 0);
  });

  it("resolves kind from content_type on a hybrid shape and stamps", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT, title TEXT, content TEXT, content_type TEXT, lens_id TEXT, created_at INTEGER);`);
    db.prepare(`INSERT INTO dtus (id, creator_id, title, content, content_type, lens_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("h1", "u1", "A song", "lyrics", "material", "unknown", 1);
    const r = backfillLensIds(db);
    assert.equal(r.ok, true);
    assert.equal(r.scanned, 1);
    const row = db.prepare(`SELECT lens_id FROM dtus WHERE id = 'h1'`).get();
    assert.notEqual(row.lens_id, "unknown");
  });
});

describe("mcp-tools on the runtime shape", () => {
  it("dtuSearch falls back to LIKE and returns the kind as type", async () => {
    const db = runtimeDb();
    const r = await dtuSearch(db, { query: "frost" });
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].id, "r1");
    assert.equal(r.results[0].type, "essay");
  });

  it("dtuGet returns the row with type from content_type", async () => {
    const db = runtimeDb();
    const r = await dtuGet(db, { id: "r1" });
    assert.equal(r.ok, true);
    assert.equal(r.dtu.type, "essay");
    assert.equal(r.dtu.title, "Frost essay");
  });

  it("dtuList and dtuCompress work", async () => {
    const db = runtimeDb();
    const list = await dtuList(db, {});
    assert.equal(list.ok, true);
    assert.equal(list.results.length, 2);
    assert.equal(list.results[0].type, "essay");
    const comp = await dtuCompress(db, { ids: ["r1"] });
    assert.equal(comp.ok, true);
  });

  it("lensList and lensManifest answer honestly with no lens_id column", async () => {
    const db = runtimeDb();
    const ll = await lensList(db, {});
    assert.equal(ll.ok, true);
    assert.deepEqual(ll.lenses, []);
    const lm = await lensManifest(db, { lens_id: "core" });
    assert.equal(lm.ok, true);
    assert.equal(lm.dtuCount, 0);
    assert.deepEqual(lm.sample, []);
  });
});

describe("mcp-tools on the migrated shape (unchanged behaviour)", () => {
  it("dtuSearch LIKE fallback + dtuList read type as before", async () => {
    const db = migratedDb();
    const r = await dtuSearch(db, { query: "frost" });
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].type, "essay");
    const list = await dtuList(db, {});
    assert.equal(list.results.length, 2);
    const lm = await lensManifest(db, { lens_id: "core" });
    assert.equal(lm.dtuCount, 2);
    assert.equal(lm.sample[0].type, "essay");
  });
});
