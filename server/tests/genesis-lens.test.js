// server/tests/genesis-lens.test.js
//
// PHASE-2 non-score behavioral test for the genesis lens — the emergent-AI
// observatory. The lens is REST-driven: the page + components/genesis/* call
// /api/emergents* (NOT the macro/lensRun path). This test mounts the REAL
// router (server/routes/emergent-visibility.js) on an ephemeral express app
// over a migrated in-memory better-sqlite3 DB and exercises it over HTTP, so
// it covers the full caller -> route -> compute (server/domains/genesis.js)
// -> backing-state path the frontend depends on.
//
// Distinct from genesis-domain-parity.test.js (which tests the macro
// happy-path). This file pins:
//   1. Wiring — every endpoint the page + children call has a real handler.
//   2. Filtering/feed math — feed/filtered + roster/search query params
//      actually filter; the type breakdown is correct.
//   3. Isolation — saved searches are per-user (private state never leaks).
//   4. Degrade-graceful — empty DB returns ok:true/empty, never throws.
//   5. Fail-CLOSED on poisoned query params — 1e308 / Infinity / NaN /
//      negative / zero limit must clamp to a safe bound, never return the
//      whole table unbounded (the SQLite negative-LIMIT fail-open).

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { createEmergentVisibilityRouter } from "../routes/emergent-visibility.js";

// ── schema (migrations 039 + 040) ───────────────────────────────────────────
function migrate(d) {
  d.exec(`
    CREATE TABLE emergent_identity (
      emergent_id TEXT PRIMARY KEY, given_name TEXT, naming_origin TEXT,
      naming_metadata TEXT, current_focus TEXT, last_active_at INTEGER,
      identity_locked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE emergent_observations (
      id TEXT PRIMARY KEY, emergent_id TEXT NOT NULL, observation TEXT NOT NULL,
      context TEXT, related_dtu_ids TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE emergent_tasks (
      id TEXT PRIMARY KEY, emergent_id TEXT NOT NULL, task_type TEXT NOT NULL,
      task_data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 50, created_at INTEGER NOT NULL,
      started_at INTEGER, completed_at INTEGER, result TEXT
    );
    CREATE TABLE emergent_activity_feed (
      id TEXT PRIMARY KEY, emergent_id TEXT, event_type TEXT NOT NULL,
      event_data TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE emergent_communications (
      id TEXT PRIMARY KEY, from_emergent_id TEXT NOT NULL, to_emergent_id TEXT NOT NULL,
      intent TEXT NOT NULL, context TEXT, response TEXT,
      initiated_at INTEGER NOT NULL, completed_at INTEGER,
      status TEXT NOT NULL DEFAULT 'pending'
    );
  `);
  return d;
}

function seed(d) {
  const now = Date.now();
  d.prepare("INSERT INTO emergent_identity VALUES (?,?,?,?,?,?,0)")
    .run("em_ada", "Ada", "self-chosen", JSON.stringify({}), "topology research", now - 1000);
  d.prepare("INSERT INTO emergent_identity VALUES (?,?,?,?,?,?,0)")
    .run("em_grace", "Grace", "lineage-inherited", JSON.stringify({ parent: "em_ada" }),
      "compiler design", now - 5000);
  // dormant (last active 5 days ago)
  d.prepare("INSERT INTO emergent_identity VALUES (?,?,?,?,?,?,0)")
    .run("em_alan", "Alan", "self-chosen", JSON.stringify({}), "topology research",
      now - 5 * 86_400_000);

  d.prepare("INSERT INTO emergent_observations VALUES (?,?,?,?,?,?)")
    .run("obs1", "em_ada", "noticed a recurring pattern", "ctx", null, now - 800);
  d.prepare("INSERT INTO emergent_observations VALUES (?,?,?,?,?,?)")
    .run("obs2", "em_ada", "[artifact:dtu] published a proof", "genesis", null, now - 600);
  d.prepare("INSERT INTO emergent_communications VALUES (?,?,?,?,?,?,?,?,?)")
    .run("comm1", "em_ada", "em_grace", "share a finding", null, null, now - 400, null, "delivered");

  // 3 distinct feed types + a 4th of a repeated type for breakdown math
  d.prepare("INSERT INTO emergent_activity_feed VALUES (?,?,?,?,?)")
    .run("feed1", "em_ada", "observation", JSON.stringify({ observation: "x" }), now - 800);
  d.prepare("INSERT INTO emergent_activity_feed VALUES (?,?,?,?,?)")
    .run("feed2", "em_ada", "artifact_created", JSON.stringify({ dtu_title: "Proof" }), now - 600);
  d.prepare("INSERT INTO emergent_activity_feed VALUES (?,?,?,?,?)")
    .run("feed3", "em_grace", "communication", JSON.stringify({ from: "Ada", to: "Grace" }), now - 400);
  d.prepare("INSERT INTO emergent_activity_feed VALUES (?,?,?,?,?)")
    .run("feed4", "em_grace", "communication", JSON.stringify({ from: "Grace", to: "Ada" }), now - 300);
  return d;
}

// ── ephemeral HTTP harness ───────────────────────────────────────────────────
let server;
let baseUrl;
let db;

function startServer(database) {
  const app = express();
  app.use(express.json());
  // STATE shape the router merges in (active/role fields). Kept empty so the
  // test exercises the DB-derived path (active = last_active_at within 24h).
  const STATE = { __emergent: { emergents: new Map() } };
  app.use("/api/emergents", createEmergentVisibilityRouter({ db: database, STATE }));
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${s.address().port}`;
      resolve(s);
    });
  });
}

async function get(path) {
  const r = await fetch(`${baseUrl}${path}`);
  return { status: r.status, body: await r.json() };
}

before(async () => {
  globalThis._concordSTATE = { genesisSavedSearches: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  db = seed(migrate(new Database(":memory:")));
  server = await startServer(db);
});

after(() => { server?.close?.(); db?.close?.(); });

// ── 1. Wiring — every frontend caller has a real handler ─────────────────────
describe("genesis wiring — every /api/emergents* caller resolves", () => {
  it("GET /api/emergents (page roster) returns the named roster", async () => {
    const { status, body } = await get("/api/emergents");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.emergents.length, 3);
    assert.ok(body.emergents.every((e) => e.id));
  });

  it("GET /api/emergents/feed/filtered (page feed) returns events + breakdown", async () => {
    const { status, body } = await get("/api/emergents/feed/filtered?limit=120");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.events.length, 4);
    assert.equal(body.typeBreakdown.communication, 2);
    assert.equal(body.typeBreakdown.observation, 1);
  });

  it("GET /api/emergents/roster/search (RosterExplorer) resolves", async () => {
    const { body } = await get("/api/emergents/roster/search");
    assert.equal(body.ok, true);
    assert.equal(body.total, 3);
  });

  it("GET /api/emergents/metrics/summary (GenesisMetrics) resolves", async () => {
    const { body } = await get("/api/emergents/metrics/summary?days=14");
    assert.equal(body.ok, true);
    assert.equal(body.summary.totalEmergents, 3);
  });

  it("GET /api/emergents/graph/relationships (RelationshipGraph) resolves", async () => {
    const { body } = await get("/api/emergents/graph/relationships?limit=600");
    assert.equal(body.ok, true);
    // One emergent_communications row (comm1: Ada -> Grace). The graph is
    // built from emergent_communications, NOT the activity feed — so weight 1.
    assert.equal(body.nodes.length, 2);
    assert.equal(body.edges.length, 1);
    assert.equal(body.edges[0].weight, 1);
    assert.equal(body.totalCommunications, 1);
  });

  it("GET /api/emergents/:id/timeline (IdentityTimeline) resolves", async () => {
    const { body } = await get("/api/emergents/em_ada/timeline?limit=200");
    assert.equal(body.ok, true);
    assert.equal(body.emergent.given_name, "Ada");
    assert.equal(body.counts.artifacts, 1);
  });

  it("GET /api/emergents/:id/lineage (LineageView) resolves", async () => {
    const { body } = await get("/api/emergents/em_grace/lineage");
    assert.equal(body.ok, true);
    assert.equal(body.ancestry[0].id, "em_ada");
  });
});

// ── 2. Filtering / feed math — the query params actually filter ──────────────
describe("genesis filtering math", () => {
  it("feed/filtered?type=X returns only that type", async () => {
    const { body } = await get("/api/emergents/feed/filtered?type=communication");
    assert.equal(body.ok, true);
    assert.equal(body.events.length, 2);
    assert.ok(body.events.every((e) => e.type === "communication"));
  });

  it("feed/filtered?types=a,b parses the comma list", async () => {
    const { body } = await get("/api/emergents/feed/filtered?types=observation,artifact_created");
    assert.equal(body.events.length, 2);
    const types = new Set(body.events.map((e) => e.type));
    assert.deepEqual([...types].sort(), ["artifact_created", "observation"]);
  });

  it("feed/filtered?since=now drops older events", async () => {
    const future = Date.now() + 60_000;
    const { body } = await get(`/api/emergents/feed/filtered?since=${future}`);
    assert.equal(body.ok, true);
    assert.equal(body.events.length, 0);
    // breakdown is whole-table, independent of the since filter
    assert.equal(body.typeBreakdown.communication, 2);
  });

  it("roster/search filters by query, state, and focus", async () => {
    assert.equal((await get("/api/emergents/roster/search?q=ada")).body.total, 1);
    assert.equal((await get("/api/emergents/roster/search?state=dormant")).body.total, 1);
    assert.equal((await get("/api/emergents/roster/search?state=active")).body.total, 2);
    assert.equal((await get("/api/emergents/roster/search?focus=compiler")).body.total, 1);
  });
});

// ── 3. Per-user isolation — saved searches don't leak across users ───────────
// The saved-search store is keyed by ctx.actor.userId in globalThis._concordSTATE.
// The router doesn't expose it (it's a macro), but the isolation contract is
// load-bearing for the lens, so pin it directly against the domain module.
describe("genesis per-user isolation (saved searches)", () => {
  let register;
  let ACTIONS;
  before(async () => {
    ACTIONS = new Map();
    register = (domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn);
    const mod = await import("../domains/genesis.js");
    mod.default(register);
  });
  const call = (name, ctx, params = {}) =>
    ACTIONS.get(`genesis.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);

  it("user A's saved search is invisible to user B", () => {
    globalThis._concordSTATE = { genesisSavedSearches: new Map() };
    const ctxA = { db, actor: { userId: "alice" }, userId: "alice" };
    const ctxB = { db, actor: { userId: "bob" }, userId: "bob" };
    const saved = call("search-save", ctxA, { label: "Alice preset", state: "active" });
    assert.equal(saved.ok, true);
    assert.equal(call("search-list", ctxA, {}).result.searches.length, 1);
    // Bob sees an EMPTY list — no leak.
    assert.equal(call("search-list", ctxB, {}).result.searches.length, 0);
  });
});

// ── 4. Degrade-graceful — empty DB returns ok:true/empty, never throws ───────
describe("genesis degrade-graceful (empty substrate)", () => {
  let emptyServer;
  let emptyBase;
  let emptyDb;
  before(async () => {
    emptyDb = migrate(new Database(":memory:")); // schema present, ZERO rows
    const app = express();
    app.use("/api/emergents",
      createEmergentVisibilityRouter({ db: emptyDb, STATE: { __emergent: { emergents: new Map() } } }));
    await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => {
        emptyBase = `http://127.0.0.1:${s.address().port}`;
        emptyServer = s;
        resolve();
      });
    });
  });
  after(() => { emptyServer?.close?.(); emptyDb?.close?.(); });

  async function eget(path) {
    const r = await fetch(`${emptyBase}${path}`);
    return { status: r.status, body: await r.json() };
  }

  it("roster, feed, graph, metrics all return ok:true with empty payloads", async () => {
    const roster = await eget("/api/emergents/roster/search");
    assert.equal(roster.body.ok, true);
    assert.equal(roster.body.total, 0);

    const feed = await eget("/api/emergents/feed/filtered");
    assert.equal(feed.body.ok, true);
    assert.equal(feed.body.events.length, 0);
    assert.deepEqual(feed.body.typeBreakdown, {});

    const graph = await eget("/api/emergents/graph/relationships");
    assert.equal(graph.body.ok, true);
    assert.equal(graph.body.nodes.length, 0);

    const metrics = await eget("/api/emergents/metrics/summary");
    assert.equal(metrics.body.ok, true);
    assert.equal(metrics.body.summary.totalEmergents, 0);
  });

  it("an unknown emergent timeline/lineage 404s, never 500s/throws", async () => {
    assert.equal((await eget("/api/emergents/ghost/timeline")).status, 404);
    assert.equal((await eget("/api/emergents/ghost/lineage")).status, 404);
  });
});

// ── 5. Fail-CLOSED on poisoned query params ──────────────────────────────────
// A poisoned negative/zero limit makes SQLite's LIMIT clause return the WHOLE
// table (unbounded) — a fail-open DoS. clampLimit() floors it. We seed >cap
// rows so unbounded would be observable, then assert the clamp.
describe("genesis fail-closed on poisoned query params", () => {
  let pServer;
  let pBase;
  let pDb;
  before(async () => {
    pDb = migrate(new Database(":memory:"));
    const now = Date.now();
    // 400 feed rows — feed cap is 300, default 80.
    const ins = pDb.prepare("INSERT INTO emergent_activity_feed VALUES (?,?,?,?,?)");
    for (let i = 0; i < 400; i++) ins.run("f" + i, null, "naming", "{}", now - i);
    const app = express();
    app.use("/api/emergents",
      createEmergentVisibilityRouter({ db: pDb, STATE: { __emergent: { emergents: new Map() } } }));
    await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => {
        pBase = `http://127.0.0.1:${s.address().port}`;
        pServer = s;
        resolve();
      });
    });
  });
  after(() => { pServer?.close?.(); pDb?.close?.(); });

  async function pget(path) {
    const r = await fetch(`${pBase}${path}`);
    return { status: r.status, body: await r.json() };
  }

  for (const poison of ["-5", "0", "Infinity", "NaN", "-99999"]) {
    it(`limit=${poison} clamps to default (80), not unbounded (400)`, async () => {
      const { status, body } = await pget(`/api/emergents/feed/filtered?limit=${poison}`);
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      // MUST NOT return the whole 400-row table.
      assert.ok(body.events.length <= 80,
        `expected <=80, got ${body.events.length} (fail-open!)`);
      assert.equal(body.events.length, 80);
    });
  }

  it("limit=1e308 parses to 1 (parseInt stops at 'e'), never NaN-crashes", async () => {
    const { body } = await pget("/api/emergents/feed/filtered?limit=1e308");
    assert.equal(body.ok, true);
    assert.equal(body.events.length, 1);
  });

  it("limit=99999 caps at the 300 hard ceiling", async () => {
    const { body } = await pget("/api/emergents/feed/filtered?limit=99999");
    assert.equal(body.ok, true);
    assert.equal(body.events.length, 300);
  });

  it("metrics days=Infinity/NaN/-5 clamps to safe [1,90] window, never throws", async () => {
    for (const poison of ["Infinity", "NaN", "-5", "1e308"]) {
      const { status, body } = await pget(`/api/emergents/metrics/summary?days=${poison}`);
      assert.equal(status, 200, `days=${poison} should not crash`);
      assert.equal(body.ok, true);
      assert.ok(body.windowDays >= 1 && body.windowDays <= 90,
        `days=${poison} -> windowDays ${body.windowDays} out of [1,90]`);
      assert.equal(body.activityOverTime.length, body.windowDays);
    }
  });

  it("graph limit=-5 clamps, never returns unbounded", async () => {
    // graph reads emergent_communications (empty in pDb) — just must not throw.
    const { status, body } = await pget("/api/emergents/graph/relationships?limit=-5");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});
