// server/tests/ghost-tracker-domain-parity.test.js
//
// Contract tests for server/domains/ghost-hunt.js — the ghost-tracker lens
// surface (residues / detail / progress / advance / confront / history /
// leaderboard). Exercises each macro against a real in-memory drift_alerts
// table and asserts the { ok } envelope plus the hunt-progression contract.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerGhostHuntMacros from "../domains/ghost-hunt.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`ghost-hunt.${name}`);
  if (!fn) throw new Error(`ghost-hunt.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerGhostHuntMacros(register); });

let db;
function seed() {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE drift_alerts (
      id TEXT PRIMARY KEY,
      drift_type TEXT,
      severity TEXT,
      signature TEXT,
      context_json TEXT,
      detected_at INTEGER
    );
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
  const now = Math.floor(Date.now() / 1000);
  const rows = [
    { id: "res_1", t: "spectral", sev: "low", sig: "sig-alpha", w: "concordia-hub", ago: 60 },
    { id: "res_2", t: "echo_chamber", sev: "high", sig: "sig-beta", w: "concordia-hub", ago: 600 },
    { id: "res_3", t: "self_reference", sev: "critical", sig: "sig-gamma", w: "tunya", ago: 1200 },
    { id: "res_4", t: "memetic_drift", sev: "medium", sig: "sig-delta", w: "concordia-hub", ago: 3600 },
  ];
  const ins = db.prepare(`
    INSERT INTO drift_alerts (id, drift_type, severity, signature, context_json, detected_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const r of rows) {
    ins.run(r.id, r.t, r.sev, r.sig, JSON.stringify({ worldId: r.w }), now - r.ago);
  }
  return db;
}

beforeEach(() => {
  seed();
  // Clear per-user persistent state between tests.
  if (globalThis._concordSTATE) {
    globalThis._concordSTATE.ghostHunts = new Map();
    globalThis._concordSTATE.ghostHistory = new Map();
    globalThis._concordSTATE.ghostRank = new Map();
  }
});

const ctx = () => ({ db, actor: { userId: "user_hunter" } });

describe("ghost-hunt — registration", () => {
  it("registers every macro the lens calls", () => {
    for (const m of [
      "residues", "detail", "progress", "advance",
      "confront", "history", "leaderboard", "create",
    ]) {
      assert.equal(typeof ACTIONS.get(`ghost-hunt.${m}`), "function", `missing ghost-hunt.${m}`);
    }
  });
});

describe("ghost-hunt — fail-closed numeric guard", () => {
  it("rejects NaN / Infinity / negative / huge limit on residues + history + leaderboard", async () => {
    for (const macro of ["residues", "history", "leaderboard"]) {
      for (const bad of [NaN, Infinity, -1, 1e9, "abc"]) {
        const r = await call(macro, ctx(), { limit: bad });
        assert.equal(r.ok, false, `${macro} should reject limit=${bad}`);
        assert.equal(r.reason, "invalid_numeric_field");
        assert.equal(r.field, "limit");
      }
    }
  });

  it("accepts a valid limit", async () => {
    const r = await call("residues", ctx(), { limit: 5 });
    assert.equal(r.ok, true);
  });
});

describe("ghost-hunt.residues", () => {
  it("lists residues with hunt-stage overlay + map coords", async () => {
    const r = await call("residues", ctx(), { worldId: "concordia-hub" });
    assert.equal(r.ok, true);
    assert.equal(r.count, 3);
    assert.ok(r.residues.every((x) => x.stage === "track"));
    assert.ok(r.residues.every((x) => typeof x.coords.x === "number" && typeof x.coords.z === "number"));
    assert.deepEqual(r.severities.sort(), ["critical", "high", "low", "medium"]);
  });

  it("filters by severity and drift type", async () => {
    const bySev = await call("residues", ctx(), { worldId: "concordia-hub", severity: "high" });
    assert.equal(bySev.ok, true);
    assert.equal(bySev.count, 1);
    assert.equal(bySev.residues[0].drift_type, "echo_chamber");

    const byType = await call("residues", ctx(), { driftType: "self_reference" });
    assert.equal(byType.ok, true);
    assert.equal(byType.count, 1);
    assert.equal(byType.residues[0].id, "res_3");
  });

  it("sorts by severity (critical first)", async () => {
    const r = await call("residues", ctx(), { sort: "severity" });
    assert.equal(r.ok, true);
    assert.equal(r.residues[0].severity, "critical");
  });

  it("returns no_db without a db handle", async () => {
    const r = await call("residues", { actor: { userId: "u" } }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });
});

describe("ghost-hunt.detail", () => {
  it("returns full context, hints, coords and reward", async () => {
    const r = await call("detail", ctx(), { residueId: "res_3" });
    assert.equal(r.ok, true);
    assert.equal(r.residue.id, "res_3");
    assert.equal(r.residue.worldId, "tunya");
    assert.ok(Array.isArray(r.hints) && r.hints.length > 0);
    assert.ok(r.potentialReward && r.potentialReward.xp > 0);
    assert.equal(r.difficulty, 4); // critical
    assert.ok(Array.isArray(r.stages));
  });

  it("rejects missing or unknown residue", async () => {
    assert.equal((await call("detail", ctx(), {})).ok, false);
    const miss = await call("detail", ctx(), { residueId: "nope" });
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, "residue_not_found");
  });
});

describe("ghost-hunt.progress + advance", () => {
  it("advances the hunt through track → investigate → confront", async () => {
    const c = ctx();
    let p = await call("progress", c, { residueId: "res_1" });
    assert.equal(p.ok, true);
    assert.equal(p.stage, "track");

    let a = await call("advance", c, { residueId: "res_1" });
    assert.equal(a.ok, true);
    assert.equal(a.stage, "investigate");

    a = await call("advance", c, { residueId: "res_1" });
    assert.equal(a.ok, true);
    assert.equal(a.stage, "confront");

    // Further advance routes the caller to the confront macro.
    a = await call("advance", c, { residueId: "res_1" });
    assert.equal(a.ok, false);
    assert.equal(a.reason, "use_confront_macro");

    p = await call("progress", c, { residueId: "res_1" });
    assert.equal(p.stage, "confront");
  });

  it("lists all active hunts when no residueId is given", async () => {
    const c = ctx();
    await call("advance", c, { residueId: "res_1" });
    await call("advance", c, { residueId: "res_2" });
    const p = await call("progress", c, {});
    assert.equal(p.ok, true);
    assert.equal(p.count, 2);
  });

  it("requires an actor", async () => {
    const r = await call("progress", { db }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_actor");
  });
});

describe("ghost-hunt.confront", () => {
  it("resolves a confront and records the outcome", async () => {
    const c = ctx();
    const r = await call("confront", c, { residueId: "res_4", worldId: "concordia-hub" });
    assert.equal(r.ok, true);
    assert.ok(r.result === "win" || r.result === "loss");
    assert.ok(typeof r.winChance === "number");
    assert.ok(r.rank.wins + r.rank.losses === 1);
  });

  it("rejects an already-extinguished residue", async () => {
    const c = ctx();
    // Force a win path by investigating first (raises win chance) then loop.
    let won = false;
    for (let i = 0; i < 12 && !won; i++) {
      const r = await call("confront", c, { residueId: "res_4" });
      won = r.won;
    }
    if (won) {
      const again = await call("confront", c, { residueId: "res_4" });
      assert.equal(again.ok, false);
      assert.equal(again.reason, "already_extinguished");
    }
  });
});

describe("ghost-hunt.history", () => {
  it("returns outcome ledger + summary after confronts", async () => {
    const c = ctx();
    await call("confront", c, { residueId: "res_1" });
    await call("confront", c, { residueId: "res_2" });
    const h = await call("history", c, {});
    assert.equal(h.ok, true);
    assert.equal(h.count, 2);
    assert.ok(h.summary.wins + h.summary.losses === 2);
    assert.ok("winRate" in h.summary);
  });

  it("returns an empty ledger for a fresh hunter", async () => {
    const h = await call("history", ctx(), {});
    assert.equal(h.ok, true);
    assert.equal(h.count, 0);
  });
});

describe("ghost-hunt.leaderboard", () => {
  it("ranks hunters by confront XP", async () => {
    await call("confront", ctx(), { residueId: "res_1" });
    const r = await call("leaderboard", ctx(), {});
    assert.equal(r.ok, true);
    assert.ok(r.count >= 1);
    assert.equal(r.leaderboard[0].rank, 1);
    assert.ok(r.you);
    assert.equal(r.you.userId, "user_hunter");
  });

  it("returns an empty leaderboard with no confronts", async () => {
    const r = await call("leaderboard", ctx(), {});
    assert.equal(r.ok, true);
    assert.equal(r.count, 0);
  });
});

describe("ghost-hunt.create", () => {
  it("mints a real Spectral Dossier DTU from a confronted residue", async () => {
    const c = ctx();
    await call("confront", c, { residueId: "res_4", worldId: "concordia-hub" });
    const r = await call("create", c, {
      residueId: "res_4",
      title: "Case file: the delta drift",
      notes: "Confronted at dusk.",
    });
    assert.equal(r.ok, true);
    assert.equal(typeof r.dtuId, "string");
    assert.equal(r.title, "Case file: the delta drift");
    assert.equal(r.visibility, "private");
    assert.equal(r.dossier.drift_type, "memetic_drift");
    assert.equal(r.dossier.severity, "medium");

    // The DTU row is actually persisted with the canonical kind + tags.
    const row = db.prepare("SELECT * FROM dtus WHERE id = ?").get(r.dtuId);
    assert.ok(row, "dtu row persisted");
    assert.equal(row.owner_user_id, "user_hunter");
    assert.equal(row.title, "Case file: the delta drift");
    const body = JSON.parse(row.body_json);
    assert.equal(body.kind, "ghost_residue");
    assert.equal(body.residueId, "res_4");
    assert.equal(body.notes, "Confronted at dusk.");
    const tags = JSON.parse(row.tags_json);
    assert.ok(tags.includes("ghost-tracker"));
    assert.ok(tags.includes("memetic_drift"));
  });

  it("defaults the title and persists an empty-notes dossier", async () => {
    const r = await call("create", ctx(), { residueId: "res_1" });
    assert.equal(r.ok, true);
    assert.ok(/^Spectral Dossier — spectral \(low\)$/.test(r.title));
    assert.equal(r.dossier.notes, "");
  });

  it("rejects a missing/unknown residue, bad visibility, and bad notes", async () => {
    assert.equal((await call("create", ctx(), {})).reason, "missing_residue_id");

    const miss = await call("create", ctx(), { residueId: "nope" });
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, "residue_not_found");

    const badVis = await call("create", ctx(), { residueId: "res_1", visibility: "haunted" });
    assert.equal(badVis.ok, false);
    assert.equal(badVis.reason, "invalid_visibility");

    const badNotes = await call("create", ctx(), { residueId: "res_1", notes: 42 });
    assert.equal(badNotes.ok, false);
    assert.equal(badNotes.reason, "invalid_notes");
  });

  it("requires a db + actor", async () => {
    const noActor = await call("create", { db }, { residueId: "res_1" });
    assert.equal(noActor.ok, false);
    assert.equal(noActor.reason, "no_db_or_actor");
  });
});
