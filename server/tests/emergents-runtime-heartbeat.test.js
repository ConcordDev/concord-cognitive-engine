// Entity runtime heartbeat (launchd com.concord.entity-heartbeat → POST
// /mcp/call rt_tick) and the governor growth pass.
//
// Regression: rt_tick/rt_drives/rt_tick_history were implemented in
// lib/agent-runtime.js but never dispatched by callMCPTool, so every heartbeat
// call returned "Unknown tool: rt_tick" (last real tick 2026-08-31). The
// governor growth loop passed raw emergents (no homeostasis) to
// entity-growth and threw twice per emergent per tick.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { mcpLocalGuardAllows, isDirectLocalRequest } from "../lib/mcp-local-guard.js";
import { callMCPTool } from "../lib/mcp-tools.js";
import { runtimeEntityIds } from "../lib/agent-runtime.js";
import { runGrowthAutonomyTick, createNewbornEntity, saveGrowthProfile, deleteGrowthProfile } from "../emergent/entity-growth.js";

const localReq = (headers = {}, extra = {}) => ({ socket: { remoteAddress: "::ffff:127.0.0.1" }, headers, ...extra });

describe("mcp-local-guard", () => {
  it("allows the on-host heartbeat (loopback peer, no proxy headers)", () => {
    assert.equal(isDirectLocalRequest(localReq()), true);
    assert.equal(mcpLocalGuardAllows("rt_tick", localReq({}, { user: { id: "mcp-anonymous" }, authMethod: "mcp-bypass" })), true);
  });
  it("rejects tunnel/proxy traffic that rides the anonymous bypass", () => {
    const bypass = { user: { id: "mcp-anonymous" }, authMethod: "mcp-bypass" };
    assert.equal(mcpLocalGuardAllows("rt_tick", localReq({ "cf-connecting-ip": "203.0.113.9" }, bypass)), false);
    assert.equal(mcpLocalGuardAllows("rt_tick", localReq({ "x-forwarded-for": "203.0.113.9" }, bypass)), false);
    assert.equal(mcpLocalGuardAllows("rt_drives", { socket: { remoteAddress: "203.0.113.9" }, headers: {}, ...bypass }), false);
  });
  it("allows a real authenticated user from anywhere", () => {
    assert.equal(mcpLocalGuardAllows("rt_tick", { socket: { remoteAddress: "203.0.113.9" }, headers: { "cf-connecting-ip": "203.0.113.9" }, user: { id: "u1" }, authMethod: "jwt" }), true);
  });
  it("does not judge tools outside its set", () => {
    assert.equal(mcpLocalGuardAllows("dtu_search", { socket: { remoteAddress: "203.0.113.9" }, headers: {} }), true);
  });
});

describe("rt_* MCP tools", () => {
  let db; let prevDb;
  before(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE entity_drives (entity_id TEXT PRIMARY KEY, drives_json TEXT NOT NULL DEFAULT '{}', dominant_drive TEXT, resting_drive TEXT, last_updated INTEGER NOT NULL DEFAULT (unixepoch()));
      CREATE TABLE entity_tick_history (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id TEXT NOT NULL, tick_at INTEGER NOT NULL DEFAULT (unixepoch()), hooks_fired INTEGER NOT NULL DEFAULT 0, drives_json TEXT, fingerprint_total_queries INTEGER, affect_state_json TEXT);
      CREATE TABLE agent_reasoning_traces (id TEXT PRIMARY KEY, agent_id TEXT, world_id TEXT, attended TEXT, quale TEXT, surprise REAL, awareness_index REAL, reason TEXT, note TEXT, created_at INTEGER, entity_id TEXT);
    `);
    prevDb = globalThis._concordDB;
    globalThis._concordDB = db;
  });
  after(() => { globalThis._concordDB = prevDb; db.close(); });

  it("rt_tick is a known tool and records drives, history and a trace", async () => {
    const r = await callMCPTool(db, "rt_tick", { entity_id: "dila", tick_ts: 1 }, null);
    assert.notEqual(r.error, "Unknown tool: rt_tick");
    assert.equal(r.ok, true);
    assert.equal(r.status, "available");
    const row = db.prepare("SELECT * FROM entity_drives WHERE entity_id = 'dila'").get();
    assert.ok(row, "entity_drives row written");
    assert.equal(typeof row.dominant_drive, "string");
    assert.ok(row.resting_drive, "resting_drive persisted (dominant was bound as an object before)");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM entity_tick_history WHERE entity_id = 'dila'").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM agent_reasoning_traces WHERE entity_id = 'dila'").get().n, 1);
  });

  it("rt_drives and rt_tick_history read it back", async () => {
    const d = await callMCPTool(db, "rt_drives", { entity_id: "dila" }, null);
    assert.equal(d.ok, true); assert.equal(d.found, true);
    const h = await callMCPTool(db, "rt_tick_history", { entity_id: "dila", limit: 5 }, null);
    assert.equal(h.ok, true); assert.equal(h.count, 1);
  });

  it("rejects ids outside the runtime entity set and missing ids", async () => {
    const r = await callMCPTool(db, "rt_tick", { entity_id: "attacker-spam-1" }, null);
    assert.equal(r.ok, false); assert.equal(r.error, "unknown_runtime_entity");
    const m = await callMCPTool(db, "rt_tick", {}, null);
    assert.equal(m.ok, false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM entity_tick_history WHERE entity_id = 'attacker-spam-1'").get().n, 0);
  });

  it("the default runtime set is the four heartbeat entities", () => {
    assert.deepEqual([...runtimeEntityIds({})].sort(), ["concord-root", "dila", "hermes-agent", "zuko"]);
  });
});

describe("runGrowthAutonomyTick", () => {
  it("skips raw emergents without a growth profile instead of throwing", async () => {
    const raw = [{ id: "em_raw_1", active: true }, { id: "em_raw_2", active: true, age: 3 }];
    const s = await runGrowthAutonomyTick(raw);
    assert.equal(s.considered, 2); assert.equal(s.skippedNoProfile, 2); assert.equal(s.errors, 0);
    assert.equal(raw[1].age, 3, "emergent's own age is not mutated");
  });
  it("ticks emergents that have a stored growth profile", async () => {
    const p = createNewbornEntity("digital_native", "genesis");
    saveGrowthProfile(p);
    try {
      const age0 = p.age;
      const s = await runGrowthAutonomyTick([{ id: p.id, active: true }]);
      assert.equal(s.errors, 0); assert.equal(s.ticked, 1);
      assert.equal(p.age, age0 + 1);
    } finally { deleteGrowthProfile(p.id); }
  });
});
