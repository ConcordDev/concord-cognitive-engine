// Job (b) — grounding packs seed real domain DTUs stamped with the owning lens,
// so the DTU→lens routing reaches them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";
import { seedGroundingPack } from "../lib/content-seeder.js";
import { searchDtus } from "../lib/cross-lens-discovery.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const groundingDir = path.join(here, "../../content/grounding");

function db0() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, type TEXT, title TEXT, data TEXT, lens_id TEXT DEFAULT 'unknown', created_at INTEGER, creator_id TEXT, visibility TEXT);`);
  return db;
}

test("every grounding pack JSON is well-formed with id+title+lens per entry", () => {
  const files = readdirSync(groundingDir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 1, "at least one grounding pack exists");
  for (const f of files) {
    const pack = JSON.parse(readFileSync(path.join(groundingDir, f), "utf8"));
    assert.ok(Array.isArray(pack.entries) && pack.entries.length > 0, `${f} has entries`);
    for (const e of pack.entries) {
      assert.ok(e.id && e.title && e.lens, `${f}: entry needs id+title+lens (${e.id})`);
      assert.ok((e.summary || "").length >= 80, `${f}: ${e.id} summary is substantive`);
    }
  }
});

test("control-theory pack seeds, stamps the owning lens, and is searchable by lens", () => {
  const db = db0();
  const pack = JSON.parse(readFileSync(path.join(groundingDir, "control-theory.json"), "utf8"));
  const n = seedGroundingPack(db, pack);
  assert.equal(n, pack.entries.length, "all entries minted");

  // routes split robotics vs ml exactly as authored
  const robotics = db.prepare("SELECT COUNT(*) c FROM dtus WHERE lens_id='robotics'").get().c;
  const ml = db.prepare("SELECT COUNT(*) c FROM dtus WHERE lens_id='ml'").get().c;
  assert.ok(robotics >= 14, `robotics grounding present (${robotics})`);
  assert.equal(ml, 2, "optimal-control↔RL + system-id route to ml");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM dtus WHERE lens_id='unknown'").get().c, 0, "nothing left unrouted");

  // the routing-aware search pulls only the robotics grounding for that lens
  const r = searchDtus(db, "control", { lens: "robotics" });
  assert.equal(r.ok, true);
  assert.ok(r.count >= 5, `robotics-scoped search returns grounding (${r.count})`);
  assert.ok(r.results.every((x) => x.title), "results shaped");
});

test("seeding is idempotent (INSERT OR IGNORE on stable id)", () => {
  const db = db0();
  const pack = JSON.parse(readFileSync(path.join(groundingDir, "control-theory.json"), "utf8"));
  assert.equal(seedGroundingPack(db, pack), pack.entries.length);
  assert.equal(seedGroundingPack(db, pack), 0, "re-seed mints nothing new");
});
