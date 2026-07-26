/**
 * Tier-2 contract tests for the cross-world-schemes macro surface
 * (server/domains/cross-world-schemes.js), wiring the previously-orphaned
 * `server/lib/cross-world-schemes.js` engine to macros for the first time.
 *
 * Pins:
 *   - crossworld.discover actually raises discovery_pct (to 100) and
 *     flips phase to 'exposed'.
 *   - crossworld.consequences_for_world returns ONLY rows whose
 *     affected_world_id matches the requested world — no cross-world
 *     leak, verified against a DB seeded with consequences for TWO
 *     different worlds.
 *   - crossworld.schemes_active returns an honest empty list against an
 *     empty (freshly migrated) DB — never fabricated data.
 *   - crossworld.propose with plotter_kind:'player' targeting another
 *     real player persists with the same phase/discovery mechanics as
 *     an NPC-plotted scheme (no special-casing).
 *
 * Run: node --test tests/cross-world-schemes-macros.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerCrossWorldSchemesMacros from "../domains/cross-world-schemes.js";
import { up as up166 } from "../migrations/166_cross_world_economy.js";
import { up as up167 } from "../migrations/167_cross_world_relationships.js";

function setupDb() {
  const db = new Database(":memory:");
  up166(db);
  up167(db);
  return db;
}

function buildMacros() {
  const map = new Map();
  function register(domain, name, handler) {
    map.set(`${domain}.${name}`, handler);
  }
  registerCrossWorldSchemesMacros(register);
  return map;
}

function ctxFor(db, userId) {
  return { db, actor: { userId }, io: null };
}

function insertScheme(db, overrides = {}) {
  const row = {
    id: "xsch_test_1",
    plotter_world_id: "concordia-hub",
    plotter_kind: "npc",
    plotter_id: "npc_plotter",
    target_world_id: "tunya",
    target_kind: "npc",
    target_id: "npc_target",
    kind: "blackmail",
    phase: "recruiting",
    success_pct: 35,
    discovery_pct: 15,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO cross_world_schemes
      (id, plotter_world_id, plotter_kind, plotter_id,
       target_world_id, target_kind, target_id,
       kind, phase, success_pct, discovery_pct)
    VALUES (@id, @plotter_world_id, @plotter_kind, @plotter_id,
            @target_world_id, @target_kind, @target_id,
            @kind, @phase, @success_pct, @discovery_pct)
  `).run(row);
  return row;
}

function insertConsequence(db, id, schemeId, affectedWorldId, detail) {
  db.prepare(`
    INSERT INTO cross_world_scheme_consequences
      (id, scheme_id, affected_world_id, consequence_kind, affected_entity_kind, affected_entity_id, detail)
    VALUES (?, ?, ?, 'opinion_shift', 'npc', 'someone', ?)
  `).run(id, schemeId, affectedWorldId, detail);
}

describe("crossworld domain — schemes_active honest empty list", () => {
  it("returns an empty array (not fabricated data) against a fresh DB", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("crossworld.schemes_active")(ctxFor(db, "user_1"), {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.schemes, []);
  });
});

describe("crossworld domain — scheme_detail", () => {
  it("missing schemeId is rejected honestly", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("crossworld.scheme_detail")(ctxFor(db, "user_1"), {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("unknown schemeId returns scheme_not_found, not fabricated data", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("crossworld.scheme_detail")(ctxFor(db, "user_1"), { schemeId: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "scheme_not_found");
  });

  it("returns the real row for a known schemeId", async () => {
    const db = setupDb();
    insertScheme(db);
    const macros = buildMacros();
    const r = await macros.get("crossworld.scheme_detail")(ctxFor(db, "user_1"), { schemeId: "xsch_test_1" });
    assert.equal(r.ok, true);
    assert.equal(r.scheme.id, "xsch_test_1");
    assert.equal(r.scheme.kind, "blackmail");
  });
});

describe("crossworld domain — discover raises discovery_pct", () => {
  it("flips phase to exposed and sets discovery_pct to 100", async () => {
    const db = setupDb();
    const scheme = insertScheme(db, { discovery_pct: 20, phase: "recruiting" });
    const macros = buildMacros();

    const r = await macros.get("crossworld.discover")(ctxFor(db, "user_1"), {
      schemeId: scheme.id, evidenceKind: "intercepted_letter",
    });
    assert.equal(r.ok, true);
    assert.equal(r.exposed, true);

    const row = db.prepare(`SELECT phase, discovery_pct FROM cross_world_schemes WHERE id = ?`).get(scheme.id);
    assert.equal(row.phase, "exposed");
    assert.equal(row.discovery_pct, 100);
    assert.ok(row.discovery_pct > 20, "discovery_pct must have been raised, not left at seed value");
  });

  it("requires an authenticated user", async () => {
    const db = setupDb();
    const scheme = insertScheme(db);
    const macros = buildMacros();
    const r = await macros.get("crossworld.discover")({ db, actor: {} }, { schemeId: scheme.id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_user");
  });

  it("records consequences in BOTH affected worlds", async () => {
    const db = setupDb();
    const scheme = insertScheme(db, {
      plotter_world_id: "concordia-hub", target_world_id: "tunya",
    });
    const macros = buildMacros();
    await macros.get("crossworld.discover")(ctxFor(db, "user_1"), { schemeId: scheme.id });

    const rows = db.prepare(`SELECT affected_world_id FROM cross_world_scheme_consequences WHERE scheme_id = ?`)
      .all(scheme.id);
    const worlds = rows.map((r) => r.affected_world_id).sort();
    assert.deepEqual(worlds, ["concordia-hub", "tunya"]);
  });
});

describe("crossworld domain — consequences_for_world never leaks across worlds", () => {
  it("returns only rows matching the requested affected_world_id", async () => {
    const db = setupDb();
    const schemeA = insertScheme(db, { id: "xsch_a", target_world_id: "tunya" });
    const schemeB = insertScheme(db, { id: "xsch_b", plotter_world_id: "cyber", target_world_id: "fantasy" });

    insertConsequence(db, "xcon_1", schemeA.id, "concordia-hub", "hub-side consequence for scheme A");
    insertConsequence(db, "xcon_2", schemeA.id, "tunya", "tunya-side consequence for scheme A");
    insertConsequence(db, "xcon_3", schemeB.id, "cyber", "cyber-side consequence for scheme B");
    insertConsequence(db, "xcon_4", schemeB.id, "fantasy", "fantasy-side consequence for scheme B");

    const macros = buildMacros();

    const forHub = await macros.get("crossworld.consequences_for_world")(ctxFor(db, "user_1"), { worldId: "concordia-hub" });
    assert.equal(forHub.ok, true);
    assert.equal(forHub.consequences.length, 1);
    assert.equal(forHub.consequences[0].id, "xcon_1");
    for (const c of forHub.consequences) assert.equal(c.affected_world_id, "concordia-hub");

    const forTunya = await macros.get("crossworld.consequences_for_world")(ctxFor(db, "user_1"), { worldId: "tunya" });
    assert.equal(forTunya.consequences.length, 1);
    assert.equal(forTunya.consequences[0].id, "xcon_2");

    const forCyber = await macros.get("crossworld.consequences_for_world")(ctxFor(db, "user_1"), { worldId: "cyber" });
    assert.equal(forCyber.consequences.length, 1);
    assert.equal(forCyber.consequences[0].id, "xcon_3");

    // Requesting a world with zero consequences is an honest empty list.
    const forNowhere = await macros.get("crossworld.consequences_for_world")(ctxFor(db, "user_1"), { worldId: "sere" });
    assert.equal(forNowhere.ok, true);
    assert.deepEqual(forNowhere.consequences, []);
  });

  it("missing worldId is rejected honestly", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("crossworld.consequences_for_world")(ctxFor(db, "user_1"), {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });
});

describe("crossworld domain — consequences_for_scheme", () => {
  it("returns the full ledger for one scheme, both worlds included", async () => {
    const db = setupDb();
    const scheme = insertScheme(db);
    insertConsequence(db, "xcon_a", scheme.id, scheme.plotter_world_id, "plotter-side");
    insertConsequence(db, "xcon_b", scheme.id, scheme.target_world_id, "target-side");
    const macros = buildMacros();
    const r = await macros.get("crossworld.consequences_for_scheme")(ctxFor(db, "user_1"), { schemeId: scheme.id });
    assert.equal(r.ok, true);
    assert.equal(r.consequences.length, 2);
  });
});

describe("crossworld domain — propose full player/NPC parity", () => {
  it("plotter_kind:'npc' targeting an npc opens a scheme (baseline)", async () => {
    const db = setupDb();
    // npc-vs-npc plotting requires an existing cross-world relationship
    // (the lib's own gate: "you can't plot against someone you have no
    // resonance with"); player plotters bypass this per the lib.
    db.prepare(`
      INSERT INTO cross_npc_relationships (from_world_id, from_npc_id, to_world_id, to_npc_id, kind)
      VALUES ('concordia-hub', 'npc_matriarch', 'tunya', 'npc_rival', 'rival')
    `).run();
    const macros = buildMacros();
    const r = await macros.get("crossworld.propose")(ctxFor(db, "user_1"), {
      plotterWorld: "concordia-hub", plotterId: "npc_matriarch", plotterKind: "npc",
      targetWorld: "tunya", targetKind: "npc", targetId: "npc_rival",
      kind: "sabotage_decree",
    });
    assert.equal(r.ok, true);
    assert.ok(r.schemeId);
    const row = db.prepare(`SELECT * FROM cross_world_schemes WHERE id = ?`).get(r.schemeId);
    assert.equal(row.plotter_kind, "npc");
    assert.equal(row.phase, "planning");
  });

  it("plotter_kind:'player' targeting ANOTHER REAL PLAYER succeeds with identical phase/discovery mechanics", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("crossworld.propose")(ctxFor(db, "user_plotter"), {
      plotterWorld: "concordia-hub", plotterKind: "player",
      targetWorld: "tunya", targetKind: "player", targetId: "user_victim",
      kind: "blackmail",
    });
    assert.equal(r.ok, true);
    assert.ok(r.schemeId);

    const row = db.prepare(`SELECT * FROM cross_world_schemes WHERE id = ?`).get(r.schemeId);
    assert.equal(row.plotter_kind, "player");
    assert.equal(row.plotter_id, "user_plotter", "plotterId must be the calling user, never client-supplied");
    assert.equal(row.target_kind, "player");
    assert.equal(row.target_id, "user_victim");
    // Same state-machine defaults as the npc-plotted scheme above — no special-casing.
    assert.equal(row.phase, "planning");
    assert.equal(row.success_pct, 35); // blackmail successBase, identical formula regardless of plotter_kind
    assert.equal(row.discovery_pct, 15); // default discoveryBase for non-fabricate_secret kinds
  });

  it("a player cannot spoof another user as the plotter", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("crossworld.propose")(ctxFor(db, "user_real"), {
      plotterWorld: "concordia-hub", plotterKind: "player", plotterId: "user_someone_else",
      targetWorld: "tunya", targetKind: "npc", targetId: "npc_target",
      kind: "seduce",
    });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT plotter_id FROM cross_world_schemes WHERE id = ?`).get(r.schemeId);
    assert.equal(row.plotter_id, "user_real");
  });

  it("rejects an invalid kind honestly", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("crossworld.propose")(ctxFor(db, "user_1"), {
      plotterWorld: "concordia-hub", plotterKind: "player",
      targetWorld: "tunya", targetKind: "npc", targetId: "npc_target",
      kind: "haunting",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_kind");
  });

  it("rejects missing inputs honestly", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("crossworld.propose")(ctxFor(db, "user_1"), { plotterKind: "player" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("rejects a same-world scheme (lib invariant, passed through unchanged)", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("crossworld.propose")(ctxFor(db, "user_1"), {
      plotterWorld: "concordia-hub", plotterKind: "player",
      targetWorld: "concordia-hub", targetKind: "npc", targetId: "npc_target",
      kind: "blackmail",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "same_world");
  });
});
