// server/tests/literary-salience.test.js
//
// Tier-1 LRL-as-hub (#8) — resonance salience: the consolidation-seed signal that
// literary.crystallize ranks by. Pure function + DB-backed helper + macro.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { salienceFrom, resonanceSalience } from "../lib/literary-resonance.js";
import registerLiteraryMacros from "../domains/literary.js";

describe("LRL hub — resonance salience (#8)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    const ins = db.prepare("INSERT INTO literary_resonance_edges (id, literary_dtu_id, target_dtu_id, target_domain, kind, score) VALUES (?,?,?,?,?,?)");
    ins.run("e1", "lit1", "t1", "game", "cross_domain", 0.9);
    ins.run("e2", "lit1", "t2", "engineering", "cross_domain", 0.85);
    ins.run("e3", "lit1", "t3", "code", "cross_domain", 0.8);
    ins.run("e4", "lit2", "t4", "game", "cross_domain", 0.6); // fewer bridges
    macros = new Map();
    registerLiteraryMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("salienceFrom is 0 with no edges and monotonic in breadth", () => {
    assert.equal(salienceFrom(0, 0), 0);
    assert.ok(salienceFrom(9, 0.9) > salienceFrom(1, 0.3), "more bridges → higher salience");
    assert.ok(salienceFrom(3, 0.9) <= 1 && salienceFrom(3, 0.9) > 0);
  });

  it("resonanceSalience ranks a broadly-bridged DTU above a narrow one", () => {
    assert.ok(resonanceSalience(db, "lit1") > resonanceSalience(db, "lit2"));
    assert.equal(resonanceSalience(db, "nope"), 0);
  });

  it("literary.salience macro returns the signal", async () => {
    const r = await macros.get("literary.salience")({ db }, { dtuId: "lit1" });
    assert.equal(r.ok, true);
    assert.ok(r.salience > 0 && r.salience <= 1);
  });
});
