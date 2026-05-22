// Contract tests for the genesis lens — emergent-AI observatory in
// server/domains/genesis.js. Exercises every macro against a real in-memory
// SQLite DB seeded with the emergent-identity schema (migrations 039 + 040).
// Each macro must return { ok: true } on the happy path.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerGenesisActions from "../domains/genesis.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`genesis.${name}`);
  assert.ok(fn, `genesis.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerGenesisActions(register); });

let db;
let ctxA;

function seedDb() {
  const d = new Database(":memory:");
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
  const now = Date.now();
  // Two named emergents: ada (active, parent) + grace (active, descendant of ada).
  d.prepare(
    "INSERT INTO emergent_identity VALUES (?,?,?,?,?,?,0)"
  ).run("em_ada", "Ada", "self-chosen", JSON.stringify({}), "topology research", now - 1000);
  d.prepare(
    "INSERT INTO emergent_identity VALUES (?,?,?,?,?,?,0)"
  ).run("em_grace", "Grace", "lineage-inherited", JSON.stringify({ parent: "em_ada" }),
    "compiler design", now - 5000);
  // A dormant emergent (no recent activity).
  d.prepare(
    "INSERT INTO emergent_identity VALUES (?,?,?,?,?,?,0)"
  ).run("em_alan", "Alan", "self-chosen", JSON.stringify({}), "topology research",
    now - 5 * 86_400_000);

  d.prepare("INSERT INTO emergent_observations VALUES (?,?,?,?,?,?)")
    .run("obs1", "em_ada", "noticed a recurring pattern", "during a deliberation", null, now - 800);
  d.prepare("INSERT INTO emergent_observations VALUES (?,?,?,?,?,?)")
    .run("obs2", "em_ada", "[artifact:dtu] published a proof", "genesis lens", null, now - 600);
  d.prepare("INSERT INTO emergent_tasks VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("task1", "em_ada", "synthesis", "{}", "completed", 50, now - 900, now - 850, now - 700,
      "result text");
  d.prepare("INSERT INTO emergent_communications VALUES (?,?,?,?,?,?,?,?,?)")
    .run("comm1", "em_ada", "em_grace", "share a finding", null, null, now - 400, null, "delivered");
  d.prepare("INSERT INTO emergent_activity_feed VALUES (?,?,?,?,?)")
    .run("feed1", "em_ada", "observation", JSON.stringify({ observation: "x" }), now - 800);
  d.prepare("INSERT INTO emergent_activity_feed VALUES (?,?,?,?,?)")
    .run("feed2", "em_ada", "artifact_created", JSON.stringify({ dtu_title: "Proof" }), now - 600);
  d.prepare("INSERT INTO emergent_activity_feed VALUES (?,?,?,?,?)")
    .run("feed3", "em_grace", "communication", JSON.stringify({ from: "Ada", to: "Grace" }), now - 400);
  return d;
}

beforeEach(() => {
  db = seedDb();
  globalThis._concordSTATE = { genesisSavedSearches: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  ctxA = { db, actor: { userId: "user_a" }, userId: "user_a" };
});

describe("genesis.identity-detail", () => {
  it("returns a full chronological action/decision timeline", () => {
    const r = call("identity-detail", ctxA, { emergentId: "em_ada" });
    assert.equal(r.ok, true);
    assert.equal(r.result.emergent.given_name, "Ada");
    assert.ok(r.result.timeline.length >= 4); // 2 obs + 1 task + 1 comm
    assert.equal(r.result.counts.artifacts, 1);
    assert.equal(r.result.counts.observations, 1);
    assert.equal(r.result.counts.communications, 1);
    // timeline must be sorted newest-first
    for (let i = 1; i < r.result.timeline.length; i++) {
      assert.ok(r.result.timeline[i - 1].time >= r.result.timeline[i].time);
    }
  });
  it("resolves an emergent by name", () => {
    const r = call("identity-detail", ctxA, { name: "Grace" });
    assert.equal(r.ok, true);
    assert.equal(r.result.emergent.id, "em_grace");
  });
  it("rejects missing target and unknown emergents", () => {
    assert.equal(call("identity-detail", ctxA, {}).ok, false);
    assert.equal(call("identity-detail", ctxA, { emergentId: "nope" }).ok, false);
  });
});

describe("genesis.roster-search", () => {
  it("returns the full roster with available filter values", () => {
    const r = call("roster-search", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 3);
    assert.ok(r.result.availableOrigins.includes("self-chosen"));
  });
  it("filters by query, activity state, and focus", () => {
    assert.equal(call("roster-search", ctxA, { query: "ada" }).result.total, 1);
    assert.equal(call("roster-search", ctxA, { state: "dormant" }).result.total, 1);
    assert.equal(call("roster-search", ctxA, { state: "active" }).result.total, 2);
    assert.equal(call("roster-search", ctxA, { focus: "compiler" }).result.total, 1);
  });
});

describe("genesis.relationship-graph", () => {
  it("builds an undirected weighted communication graph", () => {
    const r = call("relationship-graph", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.nodes.length, 2);
    assert.equal(r.result.edges.length, 1);
    assert.equal(r.result.edges[0].weight, 1);
    assert.equal(r.result.totalCommunications, 1);
  });
});

describe("genesis.feed-filtered", () => {
  it("returns the feed plus a type breakdown", () => {
    const r = call("feed-filtered", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.events.length, 3);
    assert.equal(r.result.typeBreakdown.observation, 1);
  });
  it("filters by event type", () => {
    const r = call("feed-filtered", ctxA, { type: "communication" });
    assert.equal(r.ok, true);
    assert.equal(r.result.events.length, 1);
    assert.equal(r.result.events[0].type, "communication");
  });
});

describe("genesis.lineage", () => {
  it("traces the naming-origin ancestry chain", () => {
    const r = call("lineage", ctxA, { emergentId: "em_grace" });
    assert.equal(r.ok, true);
    assert.equal(r.result.depth, 1);
    assert.equal(r.result.ancestry[0].id, "em_ada");
  });
  it("surfaces descendants and the same-origin cohort", () => {
    const r = call("lineage", ctxA, { emergentId: "em_ada" });
    assert.equal(r.ok, true);
    assert.equal(r.result.descendants.length, 1);
    assert.equal(r.result.descendants[0].id, "em_grace");
    // Ada + Alan share the "self-chosen" origin
    assert.equal(r.result.cohort.length, 1);
    assert.equal(r.result.cohort[0].id, "em_alan");
  });
  it("rejects missing or unknown emergents", () => {
    assert.equal(call("lineage", ctxA, {}).ok, false);
    assert.equal(call("lineage", ctxA, { emergentId: "nope" }).ok, false);
  });
});

describe("genesis.metrics", () => {
  it("computes counts, focus distribution, and activity over time", () => {
    const r = call("metrics", ctxA, { days: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.totalEmergents, 3);
    assert.equal(r.result.summary.activeEmergents, 2);
    assert.equal(r.result.summary.dormantEmergents, 1);
    assert.equal(r.result.summary.totalCommunications, 1);
    assert.ok(Array.isArray(r.result.activityOverTime));
    assert.equal(r.result.activityOverTime.length, 30);
    // "topology research" is shared by Ada + Alan -> count 2
    const topo = r.result.focusDistribution.find((f) => f.focus === "topology research");
    assert.equal(topo.count, 2);
    assert.equal(r.result.eventTypeTotals.observation, 1);
    assert.ok(r.result.topContributors.length >= 1);
  });
});

describe("genesis saved searches", () => {
  it("saves, lists, and deletes per-user roster filter presets", () => {
    const saved = call("search-save", ctxA, { label: "Active researchers", state: "active", focus: "topology" });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.searches.length, 1);

    const listed = call("search-list", ctxA, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.searches.length, 1);
    assert.equal(listed.result.searches[0].label, "Active researchers");

    const removed = call("search-delete", ctxA, { id: saved.result.saved.id });
    assert.equal(removed.ok, true);
    assert.equal(removed.result.removed, 1);
    assert.equal(call("search-list", ctxA, {}).result.searches.length, 0);
  });
  it("rejects an empty label and a missing id", () => {
    assert.equal(call("search-save", ctxA, {}).ok, false);
    assert.equal(call("search-delete", ctxA, {}).ok, false);
  });
});

describe("genesis macros never throw without a db", () => {
  it("returns ok:false instead of throwing", () => {
    const noDb = { actor: { userId: "u" }, userId: "u" };
    for (const m of ["identity-detail", "roster-search", "relationship-graph",
      "feed-filtered", "lineage", "metrics"]) {
      const r = call(m, noDb, { emergentId: "x" });
      assert.equal(r.ok, false, `${m} should return ok:false`);
    }
  });
});
