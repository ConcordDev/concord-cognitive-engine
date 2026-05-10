// server/tests/cross-world-relationships-acceptance.test.js
//
// Sprint 2 acceptance criterion (per user spec):
//   "Scheme initiated in Tunya against world #2 NPC can complete /
//   fail / be discovered, consequences propagate to both worlds."
//
// Test plan:
//   1. Spin up :memory: with mig 166 (kill switch + economy parity)
//      and mig 167 (cross-world relationships + schemes).
//   2. Seed authored NPCs in 3 worlds with concord_link_resonance fields.
//   3. seedRelationshipsFromAuthored — assert edges created.
//   4. Propose a cross-world assassinate scheme (Tunya → fantasy).
//   5. Drive through advance() with rng=0 (always succeed).
//   6. Assert: target NPC marked dead in fantasy, consequence rows
//      recorded in BOTH tunya AND fantasy.
//   7. Boundary discipline: same-world proposal rejected.
//   8. Kill switch: paused mode blocks every cross-world op.
//   9. Discovery path: player exposes a mid-flight scheme; both worlds
//      get a discovery consequence row.

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  seedRelationshipsFromAuthored,
  parseResonance,
  getRelation,
  recordCrossWorldSignal,
  setRelation,
} from "../lib/cross-world-relationships.js";
import {
  proposeCrossWorldScheme,
  advanceCrossWorldScheme,
  discoverCrossWorldScheme,
  listConsequencesForScheme,
  listConsequencesForWorld,
} from "../lib/cross-world-schemes.js";
import { setKillSwitchMode } from "../lib/cross-world-economy.js";

import { up as upMig166 } from "../migrations/166_cross_world_economy.js";
import { up as upMig167 } from "../migrations/167_cross_world_relationships.js";

function setup() {
  const db = new Database(":memory:");
  // Minimal world_npcs so resolution-side mutation can mark NPCs dead.
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      name TEXT,
      faction TEXT,
      archetype TEXT,
      is_dead INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE economy_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE world_market (
      world_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      current_price REAL NOT NULL,
      PRIMARY KEY (world_id, resource_id)
    );
  `);
  upMig166(db);
  upMig167(db);
  return db;
}

function seedAuthoredNpcs(db) {
  // Three Tunyan NPCs with authored cross-world resonance to fantasy/crime/sovereign.
  const rows = [
    { id: "iyatte", world_id: "tunya", concord_link_resonance: "fantasy:lady_seraphine_voss" },
    { id: "aerasi", world_id: "tunya", concord_link_resonance: "fantasy:thorne_blackroot" },
    { id: "renn",   world_id: "tunya", concord_link_resonance: "crime:archivist_who_keeps_other_peoples_secrets" },
    // Cree has null resonance — should be skipped.
    { id: "cree",   world_id: "tunya", concord_link_resonance: null },
    // Fantasy NPC reciprocates Iyatte.
    { id: "lady_seraphine_voss", world_id: "fantasy", concord_link_resonance: "tunya:iyatte" },
  ];
  for (const r of rows) {
    db.prepare(`INSERT INTO world_npcs (id, world_id, name) VALUES (?, ?, ?)`)
      .run(r.id, r.world_id, r.id);
  }
  return rows;
}

test("parseResonance handles all authored shapes correctly", () => {
  assert.deepEqual(parseResonance("fantasy:lady_seraphine_voss"), { world: "fantasy", id: "lady_seraphine_voss" });
  assert.deepEqual(parseResonance("fantasy:wildwood_circle:elder_grove"), { world: "fantasy", id: "wildwood_circle:elder_grove" });
  assert.equal(parseResonance(null), null);
  assert.equal(parseResonance(""), null);
  assert.equal(parseResonance("just_a_world"), null);
  assert.equal(parseResonance(":missing_world"), null);
});

test("seedRelationshipsFromAuthored creates one edge per authored resonance", () => {
  const db = setup();
  const rows = seedAuthoredNpcs(db);
  const r = seedRelationshipsFromAuthored(db, rows);
  assert.equal(r.ok, true);
  assert.equal(r.created, 4, "iyatte→voss + aerasi→thorne + renn→archivist + voss→iyatte = 4");

  const iyatteRel = getRelation(db, "tunya", "iyatte", "fantasy", "lady_seraphine_voss");
  assert.ok(iyatteRel);
  assert.equal(iyatteRel.authored, 1);
  assert.equal(iyatteRel.resonance_strength, 70);
  assert.equal(iyatteRel.kind, "correspondent");
});

test("acceptance — cross-world scheme can complete; consequences propagate to BOTH worlds", () => {
  const db = setup();
  const rows = seedAuthoredNpcs(db);
  seedRelationshipsFromAuthored(db, rows);

  // Iyatte (tunya) plots an assassination of Lady Voss (fantasy).
  const proposal = proposeCrossWorldScheme(db, {
    plotterWorld: "tunya", plotterId: "iyatte",
    targetWorld: "fantasy", targetKind: "npc", targetId: "lady_seraphine_voss",
    kind: "assassinate",
  });
  assert.equal(proposal.ok, true, `proposal ok: ${JSON.stringify(proposal)}`);
  const schemeId = proposal.schemeId;

  // Add a fantasy-side accomplice for recruiting to find.
  setRelation(db, "tunya", "iyatte", "fantasy", "thorne_blackroot",
    { kind: "correspondent", resonanceStrength: 80, authored: true });

  // planning → recruiting
  let r = advanceCrossWorldScheme(db, schemeId);
  assert.equal(r.transitioned, true);
  assert.equal(r.toPhase, "recruiting");

  // recruiting → gathering_evidence (assassinate REQUIRES evidence)
  r = advanceCrossWorldScheme(db, schemeId);
  assert.equal(r.toPhase, "gathering_evidence",
    `expected gathering_evidence, got ${r.toPhase} — accomplice required not met?`);

  // 3 evidence ticks → moving
  for (let i = 0; i < 3; i++) {
    advanceCrossWorldScheme(db, schemeId);
  }
  const midSch = db.prepare(`SELECT * FROM cross_world_schemes WHERE id = ?`).get(schemeId);
  assert.equal(midSch.phase, "moving", `expected moving, got ${midSch.phase}`);

  // Force success.
  r = advanceCrossWorldScheme(db, schemeId, { rng: () => 0 });
  assert.equal(r.transitioned, true);
  assert.equal(r.toPhase, "complete");

  // ── Acceptance: BOTH worlds got consequence rows ───────────────
  const conseq = listConsequencesForScheme(db, schemeId);
  const tunyaConseqs = conseq.filter(c => c.affected_world_id === "tunya");
  const fantasyConseqs = conseq.filter(c => c.affected_world_id === "fantasy");
  assert.ok(tunyaConseqs.length >= 1, "plotter world (tunya) must have at least one consequence row");
  assert.ok(fantasyConseqs.length >= 1, "target world (fantasy) must have at least one consequence row");

  // Acceptance: target NPC actually died in target world.
  const dead = db.prepare(`SELECT is_dead FROM world_npcs WHERE id = ? AND world_id = ?`)
    .get("lady_seraphine_voss", "fantasy");
  assert.equal(dead.is_dead, 1, "target NPC must be marked dead in target world");

  // The consequence kind should be 'death' for the target world.
  assert.ok(fantasyConseqs.some(c => c.consequence_kind === "death"),
    "fantasy world should have a death consequence row");
  // Plotter world records an opinion shift (the satisfaction of a successful plot).
  assert.ok(tunyaConseqs.some(c => c.consequence_kind === "opinion_shift"),
    "tunya world should have an opinion_shift consequence row for the plotter");
});

test("acceptance — cross-world scheme can be discovered mid-flight; both worlds notified", () => {
  const db = setup();
  const rows = seedAuthoredNpcs(db);
  seedRelationshipsFromAuthored(db, rows);
  setRelation(db, "tunya", "renn", "crime", "fixer_two", { kind: "correspondent", resonanceStrength: 80 });

  const proposal = proposeCrossWorldScheme(db, {
    plotterWorld: "tunya", plotterId: "renn",
    targetWorld: "crime", targetKind: "npc", targetId: "archivist_who_keeps_other_peoples_secrets",
    kind: "blackmail",
  });
  assert.equal(proposal.ok, true);

  // Advance one tick (planning → recruiting). Player discovers immediately.
  advanceCrossWorldScheme(db, proposal.schemeId);
  const disc = discoverCrossWorldScheme(db, "test_player", proposal.schemeId, "intercepted_letter");
  assert.equal(disc.ok, true);
  assert.equal(disc.exposed, true);

  const sch = db.prepare(`SELECT phase FROM cross_world_schemes WHERE id = ?`).get(proposal.schemeId);
  assert.equal(sch.phase, "exposed");

  const conseq = listConsequencesForScheme(db, proposal.schemeId);
  assert.ok(conseq.some(c => c.affected_world_id === "tunya" && c.consequence_kind === "discovery"));
  assert.ok(conseq.some(c => c.affected_world_id === "crime" && c.consequence_kind === "discovery"));
});

test("acceptance — cross-world scheme can fail; both worlds notified of plot exposure", () => {
  const db = setup();
  const rows = seedAuthoredNpcs(db);
  seedRelationshipsFromAuthored(db, rows);
  setRelation(db, "tunya", "iyatte", "fantasy", "thorne_blackroot",
    { kind: "correspondent", resonanceStrength: 80 });

  const proposal = proposeCrossWorldScheme(db, {
    plotterWorld: "tunya", plotterId: "iyatte",
    targetWorld: "fantasy", targetKind: "npc", targetId: "lady_seraphine_voss",
    kind: "seduce", // seduce skips evidence
  });
  assert.equal(proposal.ok, true);

  // planning → recruiting → moving
  advanceCrossWorldScheme(db, proposal.schemeId);
  advanceCrossWorldScheme(db, proposal.schemeId);
  // Force failure with rng = 1 (always rolls above success_pct).
  const r = advanceCrossWorldScheme(db, proposal.schemeId, { rng: () => 1 });
  assert.equal(r.toPhase, "exposed");

  const conseq = listConsequencesForScheme(db, proposal.schemeId);
  assert.ok(conseq.some(c => c.affected_world_id === "tunya" && c.consequence_kind === "plot_exposed"));
  assert.ok(conseq.some(c => c.affected_world_id === "fantasy" && c.consequence_kind === "plot_exposed"));
});

test("boundary discipline — same-world proposal rejected", () => {
  const db = setup();
  const r = proposeCrossWorldScheme(db, {
    plotterWorld: "tunya", plotterId: "iyatte",
    targetWorld: "tunya", targetKind: "npc", targetId: "aerasi",
    kind: "assassinate",
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "same_world");
});

test("boundary discipline — both world IDs are required, no implicit current world", () => {
  const db = setup();
  let r = proposeCrossWorldScheme(db, {
    plotterWorld: null, plotterId: "iyatte",
    targetWorld: "fantasy", targetId: "lady_seraphine_voss",
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "missing_inputs");

  r = proposeCrossWorldScheme(db, {
    plotterWorld: "tunya", plotterId: "iyatte",
    targetWorld: null, targetId: "lady_seraphine_voss",
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "missing_inputs");
});

test("boundary discipline — npc proposer requires existing relationship", () => {
  const db = setup();
  // No seeding — graph is empty.
  const r = proposeCrossWorldScheme(db, {
    plotterWorld: "tunya", plotterId: "iyatte",
    targetWorld: "fantasy", targetKind: "npc", targetId: "lady_seraphine_voss",
    kind: "assassinate",
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_relationship");
});

test("boundary discipline — table CHECK rejects same-world relationship rows", () => {
  const db = setup();
  const r = setRelation(db, "tunya", "a", "tunya", "b");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "same_world");
});

test("kill switch — every cross-world op blocked when not 'live'", () => {
  const db = setup();
  const rows = seedAuthoredNpcs(db);
  seedRelationshipsFromAuthored(db, rows);

  for (const mode of ["paused", "isolated_per_world", "rolled_back_single_world"]) {
    setKillSwitchMode(db, mode);

    const proposal = proposeCrossWorldScheme(db, {
      plotterWorld: "tunya", plotterId: "iyatte",
      targetWorld: "fantasy", targetKind: "npc", targetId: "lady_seraphine_voss",
      kind: "assassinate",
    });
    assert.equal(proposal.ok, false);
    assert.equal(proposal.reason, `kill_switch_${mode}`);

    const advance = advanceCrossWorldScheme(db, "anything");
    assert.equal(advance.ok, false);
    assert.equal(advance.reason, `kill_switch_${mode}`);

    const discover = discoverCrossWorldScheme(db, "user", "anything");
    assert.equal(discover.ok, false);
    assert.equal(discover.reason, `kill_switch_${mode}`);

    const signal = recordCrossWorldSignal(db, "tunya", "iyatte", "fantasy", "lady_seraphine_voss");
    assert.equal(signal.ok, false);
    assert.equal(signal.reason, `kill_switch_${mode}`);
  }

  // Restore live and verify the same proposal works.
  setKillSwitchMode(db, "live");
  const live = proposeCrossWorldScheme(db, {
    plotterWorld: "tunya", plotterId: "iyatte",
    targetWorld: "fantasy", targetKind: "npc", targetId: "lady_seraphine_voss",
    kind: "assassinate",
  });
  assert.equal(live.ok, true);
});

test("organic edges — recordCrossWorldSignal upserts when no edge exists", () => {
  const db = setup();
  // Fresh signal, no prior edge.
  const r = recordCrossWorldSignal(db, "tunya", "iyatte", "fantasy", "stranger", {
    via: "carried_letter",
  });
  assert.equal(r.ok, true);
  const rel = getRelation(db, "tunya", "iyatte", "fantasy", "stranger");
  assert.ok(rel);
  assert.equal(rel.authored, 0, "organic edge must be flagged as not-authored");
  assert.ok(rel.last_signal_at);
});

test("listConsequencesForWorld surfaces the in-world feed for both sides", () => {
  const db = setup();
  const rows = seedAuthoredNpcs(db);
  seedRelationshipsFromAuthored(db, rows);
  setRelation(db, "tunya", "iyatte", "fantasy", "thorne_blackroot",
    { kind: "correspondent", resonanceStrength: 80 });

  const proposal = proposeCrossWorldScheme(db, {
    plotterWorld: "tunya", plotterId: "iyatte",
    targetWorld: "fantasy", targetKind: "npc", targetId: "lady_seraphine_voss",
    kind: "assassinate",
  });
  // Drive to completion.
  advanceCrossWorldScheme(db, proposal.schemeId);
  advanceCrossWorldScheme(db, proposal.schemeId);
  for (let i = 0; i < 3; i++) advanceCrossWorldScheme(db, proposal.schemeId);
  advanceCrossWorldScheme(db, proposal.schemeId, { rng: () => 0 });

  const tunyaFeed = listConsequencesForWorld(db, "tunya");
  const fantasyFeed = listConsequencesForWorld(db, "fantasy");
  assert.ok(tunyaFeed.length >= 1, "tunya world feed must surface the consequence");
  assert.ok(fantasyFeed.length >= 1, "fantasy world feed must surface the consequence");
});
