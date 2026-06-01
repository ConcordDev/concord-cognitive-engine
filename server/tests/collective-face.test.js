// Political gap #4 — abstract collective scheme parties resolve to an embodied
// leader (the face you confront).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { resolveCollectiveFace } from "../lib/collective-face.js";

test("npc/player parties pass through as their own face", () => {
  const r = resolveCollectiveFace(null, "npc", "npc_vael");
  assert.equal(r.face.id, "npc_vael");
  assert.equal(r.collective, false);
});

test("kingdom resolves to its NPC ruler", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE realms (id TEXT PRIMARY KEY, ruler_kind TEXT, ruler_id TEXT)");
  db.prepare("INSERT INTO realms VALUES ('realm_north','npc','npc_king')").run();
  const r = resolveCollectiveFace(db, "kingdom", "realm_north");
  assert.equal(r.collective, true);
  assert.equal(r.face.id, "npc_king");
  assert.equal(r.face.via, "kingdom_ruler");
});

test("an interregnum / player-ruled realm has no NPC face", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE realms (id TEXT PRIMARY KEY, ruler_kind TEXT, ruler_id TEXT)");
  db.prepare("INSERT INTO realms VALUES ('realm_x','interregnum',NULL)").run();
  assert.equal(resolveCollectiveFace(db, "kingdom", "realm_x").face, null);
});

test("faction resolves to its ranking NPC when no elected leader", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE world_npcs (id TEXT PRIMARY KEY, faction TEXT, level INTEGER, is_dead INTEGER)");
  db.prepare("INSERT INTO world_npcs VALUES ('npc_grunt','ashen_pact',5,0)").run();
  db.prepare("INSERT INTO world_npcs VALUES ('npc_boss','ashen_pact',40,0)").run();
  db.prepare("INSERT INTO world_npcs VALUES ('npc_dead','ashen_pact',99,1)").run();
  const r = resolveCollectiveFace(db, "faction", "ashen_pact");
  assert.equal(r.face.id, "npc_boss", "highest-level living member fronts the faction");
  assert.equal(r.face.via, "ranking_member");
});

test("graceful when nothing resolves", () => {
  const bare = new Database(":memory:");
  const r = resolveCollectiveFace(bare, "faction", "ghost_faction");
  assert.equal(r.collective, true);
  assert.equal(r.face, null);
});
