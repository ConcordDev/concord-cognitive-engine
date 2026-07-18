// P-D — server/tests/fork-instantiate-preview.test.js
//
// Contract tests for the `fork.instantiate_preview` macro
// (server/domains/fork.js), the ONLY reachable wire for the lattice-fork
// "forked self" primitive (server/lib/lattice-fork.js). Covers:
//
//   (a) a real preview instantiates, marks is_agent=1 (verified by reading
//       the row back, not asserted), and returns a bounded DTU preview.
//   (b) an over-cap dtuIds set honest-fails with fork_bound_exceeded —
//       never silently truncated.
//   (c) a missing forkObjectId honest-fails with fork_not_found.
//   (d) auth_required / missing_input honest-fail paths.
//   (e) the macro CANNOT reach mint/transfer/rental — the confined sandbox
//       denies every macro call, and the return shape carries no pricing
//       field anywhere.
//
// Run: node --test tests/fork-instantiate-preview.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig351 from "../migrations/351_fork_objects.js";
import registerForkActions from "../domains/fork.js";
import { MAX_FORK_DTUS } from "../lib/lattice-fork.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, domain: name.split(".")[0], type: "domain_action", data: params, meta: {} }, params);
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
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      scopes TEXT NOT NULL DEFAULT '["read","write"]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_active INTEGER NOT NULL DEFAULT 1,
      is_agent INTEGER DEFAULT 0,
      agent_kind TEXT,
      agent_created_at TEXT
    );
  `);
  db.exec(`
    CREATE TABLE agent_identities (
      agent_id           TEXT PRIMARY KEY,
      user_id            TEXT,
      world_id           TEXT,
      given_name         TEXT NOT NULL,
      naming_origin      TEXT NOT NULL DEFAULT 'self_named',
      core_values_json   TEXT NOT NULL DEFAULT '[]',
      drive_profile_json TEXT NOT NULL DEFAULT '{}',
      identity_dtu_id    TEXT,
      status             TEXT NOT NULL DEFAULT 'active',
      deposit_sparks     INTEGER NOT NULL DEFAULT 0,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      last_evolved_at    INTEGER,
      last_reviewed_at   INTEGER,
      value_drift        REAL DEFAULT 0,
      drift_flagged_at   INTEGER
    );
  `);
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
  `);
  mig351.up(db);

  const now = new Date().toISOString();
  db.prepare("INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,?,?)")
    .run("u_owner", "owner", "owner@x.test", "x", now);
  db.prepare("INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,?,?)")
    .run("u_source", "sourcey", "source@x.test", "x", now);
  db.prepare(
    `INSERT INTO agent_identities (agent_id, user_id, given_name, core_values_json, drive_profile_json, value_drift)
     VALUES (?,?,?,?,?,?)`,
  ).run("aid_source", "u_source", "Sourcey", JSON.stringify(["curiosity", "honesty"]), JSON.stringify({ seeking: 0.8 }), 0.1);

  const insDtu = db.prepare(
    "INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json) VALUES (?,?,?,?,?)",
  );
  insDtu.run("dtu_1", "u_source", "First", JSON.stringify({ content: "hello", summary: "s1" }), JSON.stringify(["a"]));
  insDtu.run("dtu_2", "u_source", "Second", JSON.stringify({ content: "world", summary: "s2" }), JSON.stringify(["b"]));
});

afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

describe("fork.instantiate_preview — (a) real preview + honest disclosure", () => {
  it("creates a bounded preview, marks is_agent=1 (verified by re-reading users), and returns bounded DTU previews", async () => {
    const r = await call("fork.instantiate_preview", ctxFor("u_owner"), {
      sourceUserId: "u_source",
      dtuIds: ["dtu_1", "dtu_2"],
    });
    assert.equal(r.ok, true);
    const out = r.result;

    assert.equal(out.preview, true);
    assert.equal(out.ownerUserId, "u_owner");
    assert.equal(out.sourceUserId, "u_source");
    assert.equal(out.sourceDisplayName, "sourcey");
    assert.equal(out.dtuCount, 2);
    assert.equal(out.status, "draft");
    assert.equal(out.isAgentDisclosed, true, "disclosure must be verified by re-reading users.is_agent");
    assert.equal(out.agentKind, "fork-clone");
    assert.equal(out.confined.ok, true);
    assert.equal(out.dtus.length, 2);
    assert.ok(out.dtus.some((d) => d.id === "dtu_1" && d.summary === "s1"));

    // The disclosure row genuinely exists on disk — not merely claimed.
    const row = db.prepare("SELECT is_agent, agent_kind, password_hash FROM users WHERE id = ?").get(out.agentUserId);
    assert.equal(row.is_agent, 1);
    assert.equal(row.agent_kind, "fork-clone");
    assert.equal(row.password_hash, "!", "agent account must be non-login");

    // Re-instantiating the SAME fork object (preview step 2) works and stays
    // consistent — this is the "view a preview fork" half of the round trip.
    const r2 = await call("fork.instantiate_preview", ctxFor("u_owner"), { forkObjectId: out.forkObjectId });
    assert.equal(r2.ok, true);
    assert.equal(r2.result.forkObjectId, out.forkObjectId);
    assert.equal(r2.result.dtus.length, 2);
  });

  it("a stranger cannot instantiate someone else's fork preview", async () => {
    const created = await call("fork.instantiate_preview", ctxFor("u_owner"), { dtuIds: ["dtu_1"] });
    assert.equal(created.ok, true);
    const r = await call("fork.instantiate_preview", ctxFor("u_source"), { forkObjectId: created.result.forkObjectId });
    assert.equal(r.ok, false);
    assert.equal(r.error, "forbidden");
  });
});

describe("fork.instantiate_preview — (b)/(c)/(d) honest failures", () => {
  it("REJECTS an over-cap dtuIds set with fork_bound_exceeded (not truncated)", async () => {
    const tooMany = Array.from({ length: MAX_FORK_DTUS + 1 }, (_, i) => `d${i}`);
    const r = await call("fork.instantiate_preview", ctxFor("u_owner"), { dtuIds: tooMany });
    assert.equal(r.ok, false);
    assert.equal(r.error, "fork_bound_exceeded");
    assert.equal(r.maxForkDtus, MAX_FORK_DTUS);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fork_objects").get().n, 0, "nothing persisted on rejection");
  });

  it("fails honestly on a missing forkObjectId", async () => {
    const r = await call("fork.instantiate_preview", ctxFor("u_owner"), { forkObjectId: "fork_does_not_exist" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "fork_not_found");
  });

  it("fails honestly with no forkObjectId and no dtuIds", async () => {
    const r = await call("fork.instantiate_preview", ctxFor("u_owner"), {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing_input");
  });

  it("requires real auth — anon is rejected", async () => {
    const r = await call("fork.instantiate_preview", ctxFor("anon"), { dtuIds: ["dtu_1"] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "auth_required");
  });
});

describe("fork.instantiate_preview — (e) CANNOT monetize / rent", () => {
  it("the confined sandbox denies every macro call, including mint/transfer — proven, not assumed", async () => {
    const r = await call("fork.instantiate_preview", ctxFor("u_owner"), { dtuIds: ["dtu_1"] });
    assert.equal(r.ok, true);

    // Re-derive the sandbox the same way the handler did and prove its macro
    // surface is default-deny for the money-moving domains.
    const { instantiateForkSandbox } = await import("../lib/lattice-fork.js");
    const sandbox = instantiateForkSandbox(r.result.forkObjectId, db);
    assert.equal(sandbox.ok, true);
    for (const [domain, name] of [["economy", "mint"], ["economy", "transfer"], ["marketplace", "list"], ["fork", "instantiate_preview"]]) {
      const denied = await sandbox.ctx.sdk.macro(domain, name, {});
      assert.equal(denied.ok, false);
      assert.ok(denied.error === "capability_denied" || denied.error === "intent_drift");
    }
  });

  it("the return shape carries no pricing/rental field anywhere", async () => {
    const r = await call("fork.instantiate_preview", ctxFor("u_owner"), { dtuIds: ["dtu_1"] });
    assert.equal(r.ok, true);
    const flat = JSON.stringify(r.result).toLowerCase();
    for (const forbidden of ["price", "rent", "cost", "fee", "purchase", "mint", "sale"]) {
      assert.ok(!flat.includes(forbidden), `result must not mention "${forbidden}"`);
    }
  });
});
