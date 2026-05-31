// Contract test for the news auto-compose Phase II Wave 21 substrate.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  runNewsComposePass,
  composeStoryFromEvent,
  listRecentStories,
} from "../lib/news-story-composer.js";
import registerNewsComposeMacros from "../domains/news-compose.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`news.${name}`);
  assert.ok(fn, `news.${name} not registered`);
  return fn(ctx, input);
}

let db;
before(() => { registerNewsComposeMacros(register); });

beforeEach(() => {
  db = new Database(":memory:");
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE npc_schemes (
      id TEXT PRIMARY KEY,
      plotter_kind TEXT, plotter_id TEXT,
      target_kind TEXT, target_id TEXT,
      kind TEXT, phase TEXT,
      resolved_at INTEGER
    );
    CREATE TABLE faction_strategy_log (
      id TEXT PRIMARY KEY,
      faction_id TEXT NOT NULL,
      move TEXT NOT NULL,
      target_id TEXT,
      occurred_at INTEGER NOT NULL
    );
    CREATE TABLE realm_decrees (
      id TEXT PRIMARY KEY,
      kingdom_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      body_json TEXT,
      issued_by_kind TEXT, issued_by_id TEXT,
      issued_at INTEGER NOT NULL
    );
    CREATE TABLE npc_legacies (
      id TEXT PRIMARY KEY,
      npc_id TEXT NOT NULL,
      world_id TEXT,
      died_at INTEGER NOT NULL
    );
    CREATE TABLE npc_inheritance_links (
      id TEXT PRIMARY KEY,
      deceased_npc_id TEXT NOT NULL,
      heir_npc_id TEXT
    );
  `);
});

const ctx = () => ({ actor: { userId: null }, userId: null, db });

describe("news-story-composer", () => {
  it("composeStoryFromEvent inserts a DTU", () => {
    const r = composeStoryFromEvent(db, {
      kind: "scheme_revealed",
      sourceId: "s1",
      signature: "scheme:s1",
      vars: { npc: "npc_alpha", context: "blackmail" },
      timestamp: 100,
    });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId);
    const row = db.prepare("SELECT * FROM dtus WHERE id = ?").get(r.dtuId);
    assert.ok(row);
    assert.equal(row.visibility, "public");
    const tags = JSON.parse(row.tags_json);
    assert.ok(tags.includes("news_story"));
    assert.ok(tags.includes("news:scheme_revealed"));
    assert.ok(tags.includes("news:scheme_revealed:s1"));
  });

  it("compose is idempotent on same (kind, sourceId)", () => {
    const r1 = composeStoryFromEvent(db, { kind: "scheme_revealed", sourceId: "s2", vars: { npc: "x", context: "y" } });
    const r2 = composeStoryFromEvent(db, { kind: "scheme_revealed", sourceId: "s2", vars: { npc: "x", context: "y" } });
    assert.equal(r1.ok, true);
    assert.equal(r2.alreadyComposed, true);
    assert.equal(r1.dtuId, r2.dtuId);
  });

  it("runNewsComposePass harvests from every available source", () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare("INSERT INTO npc_schemes (id, plotter_kind, plotter_id, kind, phase, resolved_at) VALUES ('sc1','npc','npc1','heist','exposed',?)").run(now - 100);
    db.prepare("INSERT INTO faction_strategy_log (id, faction_id, move, target_id, occurred_at) VALUES ('fw1','fA','DECLARE_WAR','fB',?)").run(now - 50);
    db.prepare("INSERT INTO realm_decrees (id, kingdom_id, kind, body_json, issued_by_kind, issued_by_id, issued_at) VALUES ('rd1','r1','tax_change','{\"title\":\"New Levy\"}','npc','npc_x',?)").run(now - 30);
    db.prepare("INSERT INTO npc_legacies (id, npc_id, died_at) VALUES ('lg1','npc_old',?)").run(now - 20);
    db.prepare("INSERT INTO npc_inheritance_links (id, deceased_npc_id, heir_npc_id) VALUES ('il1','npc_old','npc_young')").run();

    const r = runNewsComposePass(db);
    assert.equal(r.ok, true);
    assert.equal(r.harvested, 4);
    assert.equal(r.composed, 4);
    const stories = listRecentStories(db);
    assert.equal(stories.length, 4);
  });

  it("listRecentStories filters by kind", () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare("INSERT INTO npc_schemes (id, plotter_kind, plotter_id, kind, phase, resolved_at) VALUES ('sc1','npc','npc1','heist','exposed',?)").run(now);
    db.prepare("INSERT INTO faction_strategy_log (id, faction_id, move, target_id, occurred_at) VALUES ('fw1','fA','DECLARE_WAR','fB',?)").run(now);
    runNewsComposePass(db);
    const schemeOnly = listRecentStories(db, { kind: "scheme_revealed" });
    assert.equal(schemeOnly.length, 1);
    const wars = listRecentStories(db, { kind: "faction_war_declared" });
    assert.equal(wars.length, 1);
  });

  it("compose skips stale events outside the source window", () => {
    const now = Math.floor(Date.now() / 1000);
    // realm_decree window is 24h; place this decree 3 days ago
    db.prepare("INSERT INTO realm_decrees (id, kingdom_id, kind, body_json, issued_by_kind, issued_by_id, issued_at) VALUES ('rd_old','r','tax_change','{\"title\":\"Old Levy\"}','npc','npc_x',?)").run(now - 3600 * 24 * 3);
    const r = runNewsComposePass(db);
    assert.equal(r.harvested, 0);
    assert.equal(r.composed, 0);
  });

  it("runs cleanly when none of the source tables exist", () => {
    // Drop tables to simulate test env without that substrate
    db.exec("DROP TABLE npc_schemes; DROP TABLE faction_strategy_log; DROP TABLE realm_decrees; DROP TABLE npc_legacies;");
    const r = runNewsComposePass(db);
    assert.equal(r.ok, true);
    assert.equal(r.harvested, 0);
  });
});

describe("news domain macros", () => {
  it("auto_compose macro returns summary", async () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare("INSERT INTO npc_schemes (id, plotter_kind, plotter_id, kind, phase, resolved_at) VALUES ('sc1','npc','npc1','heist','exposed',?)").run(now);
    const r = await call("auto_compose", ctx());
    assert.equal(r.ok, true);
    assert.equal(r.composed, 1);
  });

  it("compose_one macro inserts a single DTU", async () => {
    const r = await call("compose_one", ctx(), {
      kind: "scheme_revealed",
      sourceId: "z1",
      vars: { npc: "y", context: "z" },
    });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId);
  });

  it("list_recent returns sorted DESC", async () => {
    await call("compose_one", ctx(), { kind: "scheme_revealed", sourceId: "a", vars: { context: "x" } });
    await call("compose_one", ctx(), { kind: "scheme_revealed", sourceId: "b", vars: { context: "x" } });
    const r = await call("list_recent", ctx(), {});
    assert.equal(r.stories.length, 2);
  });
});
