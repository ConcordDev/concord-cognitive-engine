// Behavioral macro tests for server/domains/foundry.js — the Foundry
// no-code world-builder substrate (lens #125).
//
// LIGHTWEIGHT + HERMETIC by design: NO server.js boot, NO engine /
// ghost-fleet / oracle-brain / content-seeder, NO network, NO LLM. We
// create a better-sqlite3 :memory: DB, run ONLY the foundry migrations
// (191, 192) plus the `worlds` table the publish/preview macros INSERT
// into, then drive the registered macro handlers DIRECTLY the way
// runMacro would — a (ctx, input) call — against the REAL DB + the REAL
// in-memory globalThis._concordSTATE the builder-extras use.
//
// These are NOT shape-only assertions: every test asserts ACTUAL values
// + multi-step round-trips (create → get/list; blueprint_save →
// blueprint_get; asset_import → asset_list), creator ownership scoping,
// the fail-CLOSED numeric guard (Construction Rule A), and the
// no_db / no_actor gates. Mirrors the saved/careers test pattern.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerFoundryMacros from "../domains/foundry.js";
import { up as up191 } from "../migrations/191_foundry_worlds.js";
import { up as up192 } from "../migrations/192_foundry_phase7.js";

// ── A tiny local register harness (exactly what server.js does) ──────────────
function collectMacros() {
  const map = new Map();
  registerFoundryMacros((domain, name, handler) => {
    assert.equal(domain, "foundry", `unexpected domain registration: ${domain}`);
    map.set(name, handler);
  });
  return map;
}

function freshDb() {
  const db = new Database(":memory:");
  up191(db);
  up192(db);
  // The publish/preview macros compile a worldspec into a real `worlds`
  // row. Create the table with the columns those INSERTs touch (mirrors
  // migration 042_concordia_worlds.js).
  db.exec(`
    CREATE TABLE worlds (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      universe_type      TEXT NOT NULL,
      description        TEXT,
      physics_modulators TEXT DEFAULT '{}',
      rule_modulators    TEXT DEFAULT '{}',
      created_by         TEXT,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      total_visits       INTEGER NOT NULL DEFAULT 0,
      status             TEXT NOT NULL DEFAULT 'active'
    );
  `);
  return db;
}

function ctxFor(db, userId) {
  return { db, actor: userId ? { userId } : undefined };
}

let db, macros;
function call(name, ctx, input = {}) {
  const fn = macros.get(name);
  if (!fn) throw new Error(`foundry.${name} not registered`);
  return fn(ctx, input);
}

beforeEach(() => {
  db = freshDb();
  macros = collectMacros();
  // builder-extras (blueprints/assets/playtests/collab) live in
  // globalThis._concordSTATE — reset so each test is isolated.
  globalThis._concordSTATE = {};
});

const A = "user_a";
const B = "user_b";

describe("foundry — registration", () => {
  it("registers the full builder + worldspec + extras surface", () => {
    for (const m of [
      "systems", "system_schema", "validate_systems",
      "create", "update", "get", "list", "delete", "validate",
      "publish", "unpublish", "preview", "preview_end",
      "templates", "compose_rule",
      "blueprint_kinds", "blueprint_get", "blueprint_save",
      "asset_kinds", "asset_import", "asset_list", "asset_remove",
      "marketplace", "analytics", "track_play",
    ]) {
      assert.equal(typeof macros.get(m), "function", `missing foundry.${m}`);
    }
  });
});

describe("foundry — registry read surface (real catalog, not shape-only)", () => {
  it("systems returns the real composable-system catalog", () => {
    const r = call("systems", ctxFor(db, A), {});
    assert.equal(r.ok, true);
    assert.ok(r.total > 0, "catalog is non-empty");
    assert.equal(r.systems.length, r.total);
    assert.ok(r.systems.some((s) => s.id === "terrain-biomes"), "terrain-biomes present");
    assert.ok(r.categories && typeof r.categories === "object");
  });

  it("system_schema resolves a real system and rejects unknown", () => {
    const ok = call("system_schema", ctxFor(db, A), { id: "terrain-biomes" });
    assert.equal(ok.ok, true);
    assert.equal(ok.id, "terrain-biomes");
    assert.ok(ok.configSchema && typeof ok.configSchema === "object");

    const bad = call("system_schema", ctxFor(db, A), { id: "no_such_system" });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "unknown_system");
  });
});

describe("foundry — create → get → list → update → delete round-trip (real DB)", () => {
  it("persists a draft and round-trips it through get/list", () => {
    const created = call("create", ctxFor(db, A), { name: "My First World", description: "a test" });
    assert.equal(created.ok, true);
    const id = created.world.id;
    assert.ok(id.startsWith("fw_"));
    assert.equal(created.world.name, "My First World");
    assert.equal(created.world.status, "draft");

    // the row really exists in the DB
    const dbRow = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
    assert.ok(dbRow, "row persisted");
    assert.equal(dbRow.creator_id, A);

    // get returns it for the owner
    const got = call("get", ctxFor(db, A), { id });
    assert.equal(got.ok, true);
    assert.equal(got.world.id, id);

    // list shows it
    const listed = call("list", ctxFor(db, A), {});
    assert.equal(listed.ok, true);
    assert.equal(listed.count, 1);
    assert.equal(listed.worlds[0].id, id);

    // update the name → reflected on re-get
    const upd = call("update", ctxFor(db, A), { id, name: "Renamed World" });
    assert.equal(upd.ok, true);
    assert.equal(upd.world.name, "Renamed World");
    assert.equal(call("get", ctxFor(db, A), { id }).world.name, "Renamed World");

    // delete → gone
    const del = call("delete", ctxFor(db, A), { id });
    assert.equal(del.ok, true);
    assert.equal(del.deleted, id);
    assert.equal(call("get", ctxFor(db, A), { id }).reason, "not_found");
    assert.equal(call("list", ctxFor(db, A), {}).count, 0);
  });

  it("scopes by creator — a draft never leaks to another user", () => {
    const created = call("create", ctxFor(db, A), { name: "Private World" });
    const id = created.world.id;
    assert.equal(call("get", ctxFor(db, B), { id }).reason, "not_owner");
    assert.equal(call("delete", ctxFor(db, B), { id }).reason, "not_owner");
    assert.equal(call("list", ctxFor(db, B), {}).count, 0);
  });

  it("rejects a nameless draft and over-long name", () => {
    assert.equal(call("create", ctxFor(db, A), {}).reason, "missing_name");
    assert.equal(call("create", ctxFor(db, A), { name: "x".repeat(201) }).reason, "name_too_long");
  });
});

describe("foundry — blueprint_save → blueprint_get round-trip", () => {
  it("saves a visual-script graph for a world and reads it back", () => {
    const id = call("create", ctxFor(db, A), { name: "BP World" }).world.id;

    // an empty graph is rejected
    const empty = call("blueprint_save", ctxFor(db, A), { id, nodes: [], edges: [] });
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, "empty_blueprint");

    // a real graph saves
    const saved = call("blueprint_save", ctxFor(db, A), {
      id,
      nodes: [{ id: "n1", kind: "event", type: "on_enter" }, { id: "n2", kind: "action", type: "spawn" }],
      edges: [{ from: "n1", to: "n2" }],
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.blueprint.nodes.length, 2);

    // and reads back identically
    const got = call("blueprint_get", ctxFor(db, A), { id });
    assert.equal(got.ok, true);
    assert.equal(got.blueprint.nodes.length, 2);
    assert.equal(got.blueprint.edges.length, 1);
  });
});

describe("foundry — asset_import → asset_list → asset_remove round-trip", () => {
  it("imports an asset, lists it, then removes it", () => {
    const id = call("create", ctxFor(db, A), { name: "Asset World" }).world.id;

    const imported = call("asset_import", ctxFor(db, A), {
      id, kind: "model", name: "Tree", url: "https://cdn.example/tree.glb", tags: ["nature"],
    });
    assert.equal(imported.ok, true);
    const assetId = imported.asset.id;
    assert.equal(imported.asset.name, "Tree");

    const listed = call("asset_list", ctxFor(db, A), { id });
    assert.equal(listed.ok, true);
    assert.equal(listed.count, 1);
    assert.equal(listed.assets[0].id, assetId);

    const removed = call("asset_remove", ctxFor(db, A), { id, assetId });
    assert.equal(removed.ok, true);
    assert.equal(call("asset_list", ctxFor(db, A), { id }).count, 0);
  });

  it("rejects an invalid asset (missing url)", () => {
    const id = call("create", ctxFor(db, A), { name: "Bad Asset World" }).world.id;
    const r = call("asset_import", ctxFor(db, A), { id, kind: "model", name: "NoUrl" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_asset");
  });
});

describe("foundry — publish compiles a draft into a real worlds row", () => {
  it("publishes a valid worldspec and writes a live worlds row", () => {
    const created = call("create", ctxFor(db, A), {
      name: "Publishable",
      worldspec: {
        version: 1,
        theme: { universeType: "fantasy", displayName: "Publishable" },
        systems: [{ id: "terrain-biomes", config: {} }],
        rules: [],
      },
    });
    const id = created.world.id;

    const pub = call("publish", ctxFor(db, A), { id });
    assert.equal(pub.ok, true, JSON.stringify(pub));
    assert.ok(pub.publishedWorldId, "got a live world id");

    // the live worlds row really exists
    const w = db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(pub.publishedWorldId);
    assert.ok(w, "live worlds row persisted");
    assert.equal(w.created_by, A);
    assert.equal(w.status, "active");

    // the foundry row flipped to published
    assert.equal(call("get", ctxFor(db, A), { id }).world.status, "published");

    // re-publish is rejected
    assert.equal(call("publish", ctxFor(db, A), { id }).reason, "already_published");
  });

  it("refuses to publish an empty system selection", () => {
    const id = call("create", ctxFor(db, A), { name: "Empty" }).world.id;
    const r = call("publish", ctxFor(db, A), { id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_systems");
  });
});

describe("foundry — fail-CLOSED numeric guard (Construction Rule A / assassin V2)", () => {
  it("list rejects poisoned limit instead of clamping to ok:true", () => {
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      const r = call("list", ctxFor(db, A), { limit: bad });
      assert.equal(r.ok, false, `limit=${bad} should fail-closed`);
      assert.equal(r.reason, "invalid_limit");
    }
    // a valid limit still works
    assert.equal(call("list", ctxFor(db, A), { limit: 10 }).ok, true);
  });

  it("marketplace rejects poisoned limit", () => {
    for (const bad of [NaN, Infinity, -5, 1e308]) {
      const r = call("marketplace", ctxFor(db, A), { limit: bad });
      assert.equal(r.ok, false, `limit=${bad} should fail-closed`);
      assert.equal(r.reason, "invalid_limit");
    }
  });

  it("multiplayer_set rejects poisoned player counts before any DB write", () => {
    const id = call("create", ctxFor(db, A), { name: "MP World" }).world.id;
    for (const bad of [
      { minPlayers: NaN },
      { maxPlayers: Infinity },
      { lobbyCountdownSec: -1 },
      { teamCount: 1e308 },
    ]) {
      const r = call("multiplayer_set", ctxFor(db, A), { id, ...bad });
      assert.equal(r.ok, false, `should reject ${JSON.stringify(bad)}`);
      assert.match(r.reason, /^invalid_/, `reason should be invalid_*, got ${r.reason}`);
    }
  });

  it("track_play rejects a poisoned durationSec", () => {
    const id = call("create", ctxFor(db, A), { name: "Tracked" }).world.id;
    const r = call("track_play", ctxFor(db, A), { id, event: "session", durationSec: Infinity });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_durationSec");
  });
});

describe("foundry — no_db / no_actor gates", () => {
  it("DB-backed write macros return no_db without a db and no_actor without an actor", () => {
    assert.equal(call("create", { actor: { userId: A } }, { name: "x" }).reason, "no_db");
    assert.equal(call("list", { actor: { userId: A } }, {}).reason, "no_db");
    assert.equal(call("create", ctxFor(db), { name: "x" }).reason, "no_actor");
    assert.equal(call("list", ctxFor(db), {}).reason, "no_actor");
  });
});
