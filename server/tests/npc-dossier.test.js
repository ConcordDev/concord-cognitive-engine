// Political dossier — aggregates an NPC's whole political life from the
// substrate, viewer-scoped, secret-safe, graceful on missing tables.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { buildDossier } from "../lib/npc-dossier.js";

function db0() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE npc_schemes (id TEXT PRIMARY KEY, plotter_kind TEXT, plotter_id TEXT, target_kind TEXT, target_id TEXT, kind TEXT, phase TEXT, success_pct INTEGER);
    CREATE TABLE secrets (id TEXT PRIMARY KEY, holder_npc_id TEXT, subject_kind TEXT, subject_id TEXT, kind TEXT, discovery_difficulty INTEGER);
    CREATE TABLE secret_discoveries (user_id TEXT, secret_id TEXT, PRIMARY KEY(user_id, secret_id));
    CREATE TABLE npc_stress (npc_id TEXT PRIMARY KEY, stress INTEGER, coping_trait TEXT);
    CREATE TABLE character_opinions (npc_id TEXT, target_kind TEXT, target_id TEXT, score INTEGER, kind TEXT);
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, faction TEXT, grief_level REAL, radicalized INTEGER);
    CREATE TABLE npc_hooks (id TEXT PRIMARY KEY, holder_kind TEXT, holder_id TEXT, target_kind TEXT, target_id TEXT, expires_at INTEGER);
  `);
  return db;
}

test("aggregates the full political life of an NPC, viewer-scoped", () => {
  const db = db0();
  const npc = "npc_vael", me = "u_player1", other = "u_player2";
  db.prepare(`INSERT INTO npc_schemes VALUES ('s1','npc',?,'player',?, 'blackmail','active',60)`).run(npc, me);
  db.prepare(`INSERT INTO npc_schemes VALUES ('s2','npc','npc_other','npc',?, 'assassinate','active',30)`).run(npc); // they're the target
  db.prepare(`INSERT INTO npc_schemes VALUES ('s3','npc',?, 'player',?, 'seduce','complete',90)`).run(npc, me); // terminal phase — not active
  db.prepare(`INSERT INTO secrets VALUES ('sec1',?, 'npc',?, 'heresy', 8)`).run(npc, npc);
  db.prepare(`INSERT INTO secret_discoveries VALUES (?, 'sec1')`).run(me);
  db.prepare(`INSERT INTO secrets VALUES ('sec2',?, 'npc',?, 'affair', 5)`).run(npc, npc); // NOT discovered by me
  db.prepare(`INSERT INTO npc_stress VALUES (?, 78, 'paranoid')`).run(npc);
  db.prepare(`INSERT INTO character_opinions VALUES (?, 'player', ?, -40, 'wary')`).run(npc, me);
  db.prepare(`INSERT INTO world_npcs VALUES (?, 'ashen_pact', 0.8, 1)`).run(npc);
  db.prepare(`INSERT INTO npc_hooks VALUES ('h1','npc',?, 'npc','npc_other', NULL)`).run(npc); // they hold one
  db.prepare(`INSERT INTO npc_hooks VALUES ('h2','npc','npc_x','npc',?, NULL)`).run(npc); // one held over them

  const d = buildDossier(db, npc, me);
  assert.equal(d.ok, true);
  assert.equal(d.schemes.length, 2, "2 active schemes (resolved excluded)");
  assert.ok(d.schemes.find((s) => s.id === "s1" && s.role === "plotter"));
  assert.ok(d.schemes.find((s) => s.id === "s2" && s.role === "target"));
  assert.equal(d.secretsDiscovered.length, 1, "only the discovered secret");
  assert.equal(d.secretsDiscovered[0].id, "sec1");
  assert.equal(d.stress.stress, 78);
  assert.equal(d.opinionOfYou.score, -40);
  assert.equal(d.opinionOfYou.kind, "wary");
  assert.equal(d.faction.faction, "ashen_pact");
  assert.equal(d.faction.radicalized, true);
  assert.equal(d.hooks.heldByThem, 1);
  assert.equal(d.hooks.overThem, 1);
});

test("undiscovered secrets never leak to a different viewer", () => {
  const db = db0();
  db.prepare(`INSERT INTO secrets VALUES ('sec1','npc_x','npc','npc_x','heresy',8)`).run();
  db.prepare(`INSERT INTO secret_discoveries VALUES ('u_other','sec1')`).run();
  const d = buildDossier(db, "npc_x", "u_me");
  assert.equal(d.secretsDiscovered.length, 0, "viewer who didn't discover it sees nothing");
});

test("graceful on missing tables + missing inputs", () => {
  const bare = new Database(":memory:");
  const d = buildDossier(bare, "npc_x", "u_me");
  assert.equal(d.ok, true, "missing tables degrade to empty, never throw");
  assert.deepEqual(d.schemes, []);
  assert.equal(d.stress, null);
  assert.equal(d.hooks.heldByThem, 0);
  assert.equal(buildDossier(null, "x").ok, false);
});
