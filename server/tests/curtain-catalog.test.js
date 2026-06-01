// The Curtain — secrets redacted until declassified. Pins that listWorldCatalog
// returns the seeable surface (holder/kind/difficulty for every world secret) but
// withholds the body until THIS user has discovered it, and that the macro reports
// the declassified count.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { listWorldCatalog } from "../lib/secrets.js";
import registerSecretsMacros from "../domains/secrets.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE secrets (id TEXT PRIMARY KEY, holder_npc_id TEXT, subject_kind TEXT, subject_id TEXT, kind TEXT, body TEXT, discovery_difficulty INTEGER);
    CREATE TABLE secret_discoveries (secret_id TEXT, user_id TEXT, discovered_at INTEGER);
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT);
  `);
  db.prepare("INSERT INTO world_npcs (id, world_id) VALUES ('pell_of_keshar','sere')").run();
  db.prepare("INSERT INTO world_npcs (id, world_id) VALUES ('the_ferryman_wend','sere')").run();
  db.prepare("INSERT INTO secrets VALUES ('s1','pell_of_keshar','npc','pell_of_keshar','observed','Pell witnessed the other side of the manufactured border incident.',6)").run();
  db.prepare("INSERT INTO secrets VALUES ('s2','the_ferryman_wend','world','sere','structural','There is no one to surrender to.',8)").run();
  return db;
}

describe("Curtain catalog (redaction)", () => {
  it("lists every world secret but withholds the body until discovered", () => {
    const db = freshDb();
    const before = listWorldCatalog(db, "sere", "u1");
    assert.equal(before.length, 2, "both classified files are visible as existing");
    assert.ok(before.every((e) => e.body === null), "all bodies redacted before any discovery");
    assert.ok(before.every((e) => e.discovered === false));

    // the player declassifies s1
    db.prepare("INSERT INTO secret_discoveries (secret_id, user_id, discovered_at) VALUES ('s1','u1',unixepoch())").run();
    const after = listWorldCatalog(db, "sere", "u1");
    const s1 = after.find((e) => e.id === "s1");
    const s2 = after.find((e) => e.id === "s2");
    assert.equal(s1.discovered, true);
    assert.ok(s1.body && s1.body.includes("manufactured border incident"), "declassified body now readable");
    assert.equal(s2.body, null, "the other file stays redacted");
  });

  it("is per-user: another player sees s1 still redacted", () => {
    const db = freshDb();
    db.prepare("INSERT INTO secret_discoveries (secret_id, user_id, discovered_at) VALUES ('s1','u1',unixepoch())").run();
    const other = listWorldCatalog(db, "sere", "u2");
    assert.equal(other.find((e) => e.id === "s1").body, null, "u2 hasn't declassified it");
  });

  it("the world_catalog macro reports the declassified count", async () => {
    const db = freshDb();
    db.prepare("INSERT INTO secret_discoveries (secret_id, user_id, discovered_at) VALUES ('s1','u1',unixepoch())").run();
    const m = new Map();
    registerSecretsMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
    const r = await m.get("secrets.world_catalog")({ db, actor: { userId: "u1" } }, { worldId: "sere" });
    assert.equal(r.ok, true);
    assert.equal(r.total, 2);
    assert.equal(r.declassified, 1);
  });
});
