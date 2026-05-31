// Slice-of-Life SL2 — gossip propagation. Pins: a seeded rumor spreads along the
// npc_relationships graph one hop per pass (NPC→NPC→NPC), reaches a 3rd-hop NPC,
// and SURFACES a blackmail hook + opinion hits once it's spread far enough.
// Composes the N3 independent-cascade model over the social graph.
//
// Run: node --test tests/gossip.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { buildNpcAdjacency, seedRumor, spreadPass, getRumor, maybeSurface } from "../lib/social/gossip.js";

function mkNpc(db, id) { db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, is_dead) VALUES (?,?,?,0)`).run(id, "w1", "trader"); }
function rel(db, a, b, s = 1.5) { db.prepare(`INSERT INTO npc_relationships (npc_id, related_id, rel_type, strength) VALUES (?,?,?,?)`).run(a, b, "friend", s); }
function mkSecret(db, id) {
  // secrets requires holder_npc_id + a CHECK'd `kind` (mig 154 enum).
  db.prepare(`INSERT INTO secrets (id, holder_npc_id, subject_kind, subject_id, kind, body, discovery_difficulty) VALUES (?,?,?,?,?,?,?)`)
    .run(id, "a", "npc", "victim", "liaison", "a scandal", 5);
}

describe("SL2 gossip", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:"); await runMigrations(db);
    // chain a—b—c—d (friends), strength 1.5
    for (const n of ["a", "b", "c", "d"]) mkNpc(db, n);
    rel(db, "a", "b"); rel(db, "b", "c"); rel(db, "c", "d");
    mkSecret(db, "sec1");
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("builds adjacency from npc_relationships (undirected)", () => {
    const adj = buildNpcAdjacency(db, "w1");
    assert.ok(adj.a.some((x) => x.id === "b"));
    assert.ok(adj.b.some((x) => x.id === "a")); // undirected
    assert.ok(adj.b.some((x) => x.id === "c"));
  });

  it("a rumor spreads one hop per pass and reaches the 3rd-hop NPC", () => {
    const { rumorId } = seedRumor(db, { secretId: "sec1", subjectKind: "npc", subjectId: "victim", worldId: "w1", originNpcId: "a" });
    const flood = { prob: 1, rng: () => 0 }; // deterministic: every neighbor spreads
    spreadPass(db, "w1", flood); // a → b
    spreadPass(db, "w1", flood); // b → c
    spreadPass(db, "w1", flood); // c → d
    const r = getRumor(db, rumorId);
    assert.equal(r.reach, 4);    // a,b,c,d
    const carriers = db.prepare(`SELECT npc_id FROM rumor_carriers WHERE rumor_id=?`).all(rumorId).map((x) => x.npc_id);
    assert.ok(carriers.includes("d")); // reached the far end
  });

  it("surfaces a hook + opinion hits once reach ≥ threshold", () => {
    const { rumorId } = seedRumor(db, { secretId: "sec1", subjectId: "victim", worldId: "w1", originNpcId: "a" });
    const flood = { prob: 1, rng: () => 0 };
    spreadPass(db, "w1", flood); spreadPass(db, "w1", flood); spreadPass(db, "w1", flood); // reach 4
    let hookCalls = 0, opinionCalls = 0;
    const r = maybeSurface(db, rumorId, {
      generateHook: () => { hookCalls++; },
      recordOpinion: () => { opinionCalls++; },
      threshold: 4,
    });
    assert.equal(r.surfaced, true);
    assert.equal(r.hookGranted, true);
    assert.equal(hookCalls, 1);
    assert.ok(opinionCalls >= 4);            // every carrier's opinion of the subject drops
    assert.equal(getRumor(db, rumorId).surfaced, 1);
  });

  it("does not surface while still spreading (reach < threshold)", () => {
    const { rumorId } = seedRumor(db, { secretId: "sec1", subjectId: "victim", worldId: "w1", originNpcId: "a" });
    spreadPass(db, "w1", { prob: 1, rng: () => 0 }); // reach 2 only
    const r = maybeSurface(db, rumorId, { generateHook: () => {}, threshold: 4 });
    assert.equal(r.surfaced, false);
    assert.equal(r.reason, "still_spreading");
  });
});
