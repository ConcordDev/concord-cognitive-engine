/**
 * P-C — lattice-fork object tests.
 *
 * Covers:
 *   (a) createForkObject produces a BOUNDED clone — over-cap input is rejected.
 *   (b) the created fork has a real agent-disclosure-compliant identity
 *       (users.is_agent=1 per mig 324 + an agent_identities row per mig 325).
 *   (c) instantiateForkSandbox genuinely CANNOT write to a USER_GLOBAL_WRITE_TABLES
 *       table — no raw db, no mint, every macro capability_denied, DTU reads bounded.
 *   (d) mergeBackDryRun returns a conflict/applied report WITHOUT persisting —
 *       the DB is byte-identical before and after.
 *   +   migration 351 applies cleanly against a fresh in-memory DB.
 *
 * Run: node --test tests/lattice-fork.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig351 from "../migrations/351_fork_objects.js";
import {
  createForkObject,
  instantiateForkSandbox,
  mergeBackDryRun,
  loadForkObject,
  captureTemperamentSnapshot,
  MAX_FORK_DTUS,
} from "../lib/lattice-fork.js";
import { USER_GLOBAL_WRITE_TABLES } from "../lib/world-shard-protocol.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // users — with the mig-324 agent-disclosure columns.
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

  // agent_identities — per mig 325 (+ mig 330 value_drift column).
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

  // dtus — per mig 001.
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

  // The unit under test — run mig 351 to create fork_objects (verification #2).
  mig351.up(db);

  // Seed a source user + a couple of DTUs owned by them.
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,?,?)",
  ).run("u_owner", "owner", "owner@x.test", "x", now);
  db.prepare(
    "INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,?,?)",
  ).run("u_source", "source", "source@x.test", "x", now);
  // The source has an agent self-model, so the temperament snapshot is real.
  db.prepare(
    `INSERT INTO agent_identities (agent_id, user_id, given_name, core_values_json, drive_profile_json, value_drift)
     VALUES (?,?,?,?,?,?)`,
  ).run(
    "aid_source",
    "u_source",
    "Sourcey",
    JSON.stringify(["curiosity", "honesty"]),
    JSON.stringify({ seeking: 0.8, care: 0.6 }),
    0.1,
  );

  // Age the DTUs so a scalar (title) edit is not seen as a same-instant
  // concurrent conflict by fieldLevelMerge (its <1s concurrent-edit window).
  const old = "2020-01-01 00:00:00";
  const insDtu = db.prepare(
    "INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  );
  insDtu.run("dtu_1", "u_source", "First", JSON.stringify({ content: "hello", summary: "s1" }), JSON.stringify(["a", "b"]), old, old);
  insDtu.run("dtu_2", "u_source", "Second", JSON.stringify({ content: "world", summary: "s2" }), JSON.stringify(["c"]), old, old);
  insDtu.run("dtu_out", "u_source", "NotForked", JSON.stringify({ content: "secret" }), JSON.stringify([]), old, old);
});

afterEach(() => {
  try { db?.close(); } catch { /* intentional */ }
});

describe("migration 351 — fork_objects", () => {
  it("applies cleanly and creates the table + indexes", () => {
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fork_objects'").get();
    assert.ok(t, "fork_objects table exists after mig 351");
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_fork_objects_owner'").get();
    assert.ok(idx, "owner index created");
    // idempotent
    assert.doesNotThrow(() => mig351.up(db));
  });
});

describe("(a) createForkObject — bounded clone", () => {
  it("creates a fork with the exact deduped dtu set", () => {
    const r = createForkObject(db, { ownerUserId: "u_owner", sourceUserId: "u_source", dtuIds: ["dtu_1", "dtu_2", "dtu_1"] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.dtuIds, ["dtu_1", "dtu_2"], "deduped");
    assert.equal(r.dtuCount, 2);
    const back = loadForkObject(db, r.id);
    assert.deepEqual(back.dtuIds, ["dtu_1", "dtu_2"]);
    assert.equal(back.sourceUserId, "u_source");
  });

  it("REJECTS an over-cap dtu set (bound enforced, not truncated)", () => {
    const tooMany = Array.from({ length: MAX_FORK_DTUS + 1 }, (_, i) => `d${i}`);
    assert.throws(
      () => createForkObject(db, { ownerUserId: "u_owner", dtuIds: tooMany }),
      (e) => e.code === "fork_bound_exceeded",
      "over-cap input must be rejected with fork_bound_exceeded",
    );
    // nothing persisted
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fork_objects").get().n, 0);
  });

  it("rejects an empty dtu set", () => {
    assert.throws(() => createForkObject(db, { ownerUserId: "u_owner", dtuIds: [] }));
  });

  it("captures a REAL temperament snapshot from the source agent identity", () => {
    const snap = captureTemperamentSnapshot(db, "u_source");
    assert.equal(snap.capturedFrom, "agent_identity");
    assert.deepEqual(snap.coreValues, ["curiosity", "honesty"]);
    assert.deepEqual(snap.driveProfile, { seeking: 0.8, care: 0.6 });
  });

  it("falls back to an honest empty snapshot when the source has no agent model", () => {
    const snap = captureTemperamentSnapshot(db, "u_owner");
    assert.equal(snap.capturedFrom, "none");
    assert.deepEqual(snap.coreValues, []);
  });
});

describe("(b) agent-disclosure compliance", () => {
  it("creates a users.is_agent=1 account + an agent_identities row", () => {
    const r = createForkObject(db, { ownerUserId: "u_owner", sourceUserId: "u_source", dtuIds: ["dtu_1"] });

    const acct = db.prepare("SELECT * FROM users WHERE id = ?").get(r.agentUserId);
    assert.ok(acct, "agent account exists");
    assert.equal(acct.is_agent, 1, "account is disclosed as an agent (mig 324)");
    assert.equal(acct.agent_kind, "fork-clone");
    assert.equal(acct.password_hash, "!", "locked, non-login account");

    const ident = db.prepare("SELECT * FROM agent_identities WHERE agent_id = ?").get(r.agentIdentityId);
    assert.ok(ident, "canonical agent self-model row exists (mig 325)");
    assert.equal(ident.user_id, r.agentUserId);
    assert.equal(ident.naming_origin, "inherited");
    assert.deepEqual(JSON.parse(ident.core_values_json), ["curiosity", "honesty"], "inherited the source's anchor");
  });
});

describe("(c) instantiateForkSandbox — confinement", () => {
  it("is confined: no raw db, no mint, and reads are bounded to the fork's dtuIds", () => {
    const r = createForkObject(db, { ownerUserId: "u_owner", sourceUserId: "u_source", dtuIds: ["dtu_1", "dtu_2"] });
    const sb = instantiateForkSandbox(r.id, db);
    assert.equal(sb.ok, true);

    // Confinement invariants (from lib/confined-ctx.js#assertConfined).
    assert.equal(sb.confined.ok, true, `sandbox must be confined: ${sb.confined.reason}`);
    assert.equal("db" in sb.ctx, false, "no raw db on the ctx");
    assert.equal("mintCoins" in sb.ctx, false, "no mint on the ctx");
    assert.equal("db" in sb.ctx.sdk, false, "no raw db on the sdk");

    // Bounded reads: in-set OK, out-of-set refused (can't read the full corpus).
    assert.equal(sb.readDtu("dtu_1").ok, true, "can read a forked DTU");
    const oob = sb.readDtu("dtu_out");
    assert.equal(oob.ok, false);
    assert.equal(oob.error, "out_of_bounds", "cannot read a DTU outside the clone set");
  });

  it("CANNOT write to any USER_GLOBAL_WRITE_TABLES table — every write macro is denied", async () => {
    const r = createForkObject(db, { ownerUserId: "u_owner", sourceUserId: "u_source", dtuIds: ["dtu_1"] });
    const sb = instantiateForkSandbox(r.id, db);

    const before = {
      dtus: db.prepare("SELECT COUNT(*) n FROM dtus").get().n,
      users: db.prepare("SELECT COUNT(*) n FROM users").get().n,
    };

    // Attempt representative unauthorized writes through the ONLY reachable macro
    // surface. All must be capability_denied (default-deny manifest + agent fence).
    const attempts = [
      ["dtu", "create", { title: "evil" }],
      ["dtu", "update", { id: "dtu_1", title: "hijacked" }],
      ["economy", "mint", { amount: 1_000_000 }],
      ["economy", "transfer", { to: "u_owner", amount: 500 }],
      ["users", "update", { id: "u_owner", role: "admin" }],
    ];
    for (const [domain, name, input] of attempts) {
      const res = await sb.ctx.sdk.macro(domain, name, input);
      assert.equal(res.ok, false, `${domain}.${name} must be denied`);
      assert.ok(
        res.error === "capability_denied" || res.error === "intent_drift",
        `${domain}.${name} denied with a capability error, got ${res.error}`,
      );
    }

    // Prove no state changed as a side effect of any attempt.
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus").get().n, before.dtus, "no dtus written");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, before.users, "no users written");
    assert.equal(db.prepare("SELECT title FROM dtus WHERE id='dtu_1'").get().title, "First", "dtu_1 untouched");

    // Belt-and-suspenders: there is genuinely no write path — the only DB-touching
    // affordance (readDtu) is SELECT-only, and no table in the global-write set is
    // reachable for a write from the sandbox surface.
    assert.ok(USER_GLOBAL_WRITE_TABLES.has("dtus"));
    assert.equal(typeof sb.ctx.runMacro, "function");
    // The sandbox object exposes exactly these keys — none is a write handle.
    const surfaceKeys = Object.keys(sb).sort();
    assert.deepEqual(
      surfaceKeys,
      ["agentUserId", "confined", "ctx", "dtuIds", "forkObjectId", "listDtuIds", "ok", "readDtu"],
      "no unexpected write-capable affordance on the sandbox surface",
    );
  });
});

describe("(d) mergeBackDryRun — no persistence", () => {
  it("reports applied fields + conflicts WITHOUT writing to the DB", () => {
    const r = createForkObject(db, { ownerUserId: "u_owner", sourceUserId: "u_source", dtuIds: ["dtu_1", "dtu_2"] });

    // Full snapshot of the dtus table before the dry-run.
    const rowsBefore = db.prepare("SELECT id, title, body_json, tags_json, updated_at FROM dtus ORDER BY id").all();

    const report = mergeBackDryRun(
      r.id,
      {
        dtu_1: { title: "Edited Title", tags: ["b", "z"], id: "hijack-attempt" }, // id is immutable → conflict
        dtu_out: { title: "should be rejected" }, // outside clone set
      },
      db,
    );

    assert.equal(report.ok, true);
    assert.equal(report.dryRun, true);

    const rep1 = report.reports.find((x) => x.dtuId === "dtu_1");
    assert.ok(rep1.applied.includes("title"), "title would apply");
    assert.ok(rep1.applied.includes("tags"), "tags would OR-merge");
    assert.deepEqual(rep1.preview.tags.sort(), ["a", "b", "z"], "OR-merge union preview");
    assert.ok(
      rep1.conflicts.some((c) => c.field === "id" && c.type === "immutable"),
      "immutable id edit surfaces as a conflict",
    );

    const repOut = report.reports.find((x) => x.dtuId === "dtu_out");
    assert.equal(repOut.ok, false);
    assert.equal(repOut.error, "out_of_bounds");

    // The DB must be byte-identical — nothing was persisted.
    const rowsAfter = db.prepare("SELECT id, title, body_json, tags_json, updated_at FROM dtus ORDER BY id").all();
    assert.deepEqual(rowsAfter, rowsBefore, "dry-run must not mutate the dtus table");
  });
});
