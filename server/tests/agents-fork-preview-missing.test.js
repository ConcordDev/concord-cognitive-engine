// INC-SWEEP agents F16 — fork.instantiate_preview refuses missing DTU ids;
// dtuCount matches the returned dtus array for a real id.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as mig351 from "../migrations/351_fork_objects.js";
import registerForkActions from "../domains/fork.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, domain: "fork", type: "domain_action", data: params, meta: {} }, params);
}

let db;
function ctxFor(userId) {
  return { db, actor: { userId }, userId };
}

beforeEach(() => {
  ACTIONS.clear();
  registerForkActions(register);
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
      scopes TEXT NOT NULL DEFAULT '["read","write"]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_active INTEGER NOT NULL DEFAULT 1, is_agent INTEGER DEFAULT 0, agent_kind TEXT, agent_created_at TEXT
    );
    CREATE TABLE agent_identities (
      agent_id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT, given_name TEXT NOT NULL,
      naming_origin TEXT NOT NULL DEFAULT 'self_named', core_values_json TEXT NOT NULL DEFAULT '[]',
      drive_profile_json TEXT NOT NULL DEFAULT '{}', identity_dtu_id TEXT,
      status TEXT NOT NULL DEFAULT 'active', deposit_sparks INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), last_evolved_at INTEGER,
      last_reviewed_at INTEGER, value_drift REAL DEFAULT 0, drift_flagged_at INTEGER
    );
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, owner_user_id TEXT, title TEXT NOT NULL DEFAULT 'Untitled',
      body_json TEXT NOT NULL DEFAULT '{}', tags_json TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'private', tier TEXT NOT NULL DEFAULT 'regular',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  mig351.up(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,?,?)")
    .run("u_owner", "owner", "owner@x.test", "x", now);
  db.prepare(
    "INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json) VALUES (?,?,?,?,?)",
  ).run("dtu_real_agt", "u_owner", "Agent note", JSON.stringify({ summary: "s" }), JSON.stringify(["agents"]));
});

afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

describe("agents F16 fork.instantiate_preview missing DTU", () => {
  it("missing id refuses with dtu_not_found", () => {
    const r = call("fork.instantiate_preview", ctxFor("u_owner"), {
      dtuIds: ["dtu_nope_agtmv8jn6c2"],
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "dtu_not_found");
    assert.equal(shapeLensRunHttp(r).status, 404);
  });

  it("real id returns dtuCount equal to dtus.length", () => {
    const r = call("fork.instantiate_preview", ctxFor("u_owner"), {
      dtuIds: ["dtu_real_agt"],
    });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    assert.equal(r.result.dtuCount, r.result.dtus.length);
    assert.equal(r.result.dtus.length, 1);
    assert.equal(r.result.dtus[0].id, "dtu_real_agt");
  });
});
