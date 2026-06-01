// DTU→lens routing — searchDtus filters to a lens's own grounding.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { searchDtus } from "../lib/cross-lens-discovery.js";

function withRouting(on, fn) {
  const prev = process.env.CONCORD_DTU_ROUTING;
  process.env.CONCORD_DTU_ROUTING = on ? "1" : "0";
  try { return fn(); } finally { if (prev === undefined) delete process.env.CONCORD_DTU_ROUTING; else process.env.CONCORD_DTU_ROUTING = prev; }
}
function seed() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT, data TEXT, lens_id TEXT DEFAULT 'unknown', created_at INTEGER);`);
  const ins = db.prepare(`INSERT INTO dtus (id, type, title, creator_id, data, lens_id, created_at) VALUES (?,?,?,?,?,?,?)`);
  ins.run("m1", "manifold", "control theory note", "u1", "{}", "math", 100);
  ins.run("m2", "theorem", "fixed point theory", "u1", "{}", "math", 101);
  ins.run("r1", "control_theory", "control theory for robots", "u1", "{}", "robotics", 102);
  ins.run("c1", "material", "iron theory sample", "u1", "{}", "crafting", 103);
  return db;
}

test("lens filter returns only that lens's grounding", () => {
  withRouting(true, () => {
    const db = seed();
    const math = searchDtus(db, "theory", { lens: "math" });
    assert.equal(math.ok, true);
    assert.ok(math.results.length === 2, `expected 2 math rows, got ${math.results.length}`);
    assert.ok(math.results.every((r) => r.id === "m1" || r.id === "m2"));

    const robotics = searchDtus(db, "theory", { lens: "robotics" });
    assert.equal(robotics.results.length, 1);
    assert.equal(robotics.results[0].id, "r1");
  });
});

test("no lens → flat search across the whole pool (today's behavior)", () => {
  withRouting(true, () => {
    const db = seed();
    const flat = searchDtus(db, "theory", {});
    assert.equal(flat.results.length, 4, "all four 'theory' rows regardless of lens");
  });
});

test("kill-switch off → lens filter is ignored (flat)", () => {
  withRouting(false, () => {
    const db = seed();
    const r = searchDtus(db, "theory", { lens: "math" });
    assert.equal(r.results.length, 4, "routing off → lens filter does not apply");
  });
});

test("lens + kind compose", () => {
  withRouting(true, () => {
    const db = seed();
    const r = searchDtus(db, "theory", { lens: "math", kind: "manifold" });
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].id, "m1");
  });
});
