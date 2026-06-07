/**
 * reason-verify — deterministic citation-resolution floor.
 *
 * The council (LLM judge) layer needs Ollama and is exercised live; this pins
 * the brains-OFF floor that makes verification useful even without a model:
 *   - a citation that resolves to a real, visible DTU = good
 *   - a citation to a non-existent DTU = fabricated_citation (hallucination caught)
 *   - a citation to someone else's personal-scoped DTU = not resolvable
 *   - no citations = unverified (nothing to check)
 *
 * Run: node --test server/tests/reason-verify.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { verifyClaim } from "../lib/reason-verify.js";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT, data TEXT, lens_id TEXT, created_at TEXT);`);
  const ins = db.prepare(`INSERT INTO dtus (id, type, title, creator_id, data) VALUES (?, ?, ?, ?, ?)`);
  ins.run("dtu_real_1", "note", "Photosynthesis basics", "u1", "{}");
  ins.run("dtu_real_2", "note", "Chlorophyll absorption", "u1", "{}");
  ins.run("dtu_personal", "note", "Private", "u1", '{"scope":"personal"}');
  return db;
}

describe("reason.verify — citation-resolution floor (brains off)", () => {
  let db;
  beforeEach(() => { db = createDb(); });

  it("all citations resolve → citations_resolve, allResolved", async () => {
    const r = await verifyClaim(db, { claim: "Plants make energy from light.", citationIds: ["dtu_real_1", "dtu_real_2"], requesterId: "u1", useCouncil: false });
    assert.equal(r.ok, true);
    assert.equal(r.verdict, "citations_resolve");
    assert.equal(r.allResolved, true);
    assert.equal(r.citationsResolved, 2);
    assert.equal(r.unresolvedIds.length, 0);
  });

  it("a non-existent citation → fabricated_citation (hallucination caught)", async () => {
    const r = await verifyClaim(db, { claim: "X", citationIds: ["dtu_real_1", "dtu_DOES_NOT_EXIST"], requesterId: "u1", useCouncil: false });
    assert.equal(r.verdict, "fabricated_citation");
    assert.equal(r.allResolved, false);
    assert.deepEqual(r.unresolvedIds, ["dtu_DOES_NOT_EXIST"]);
  });

  it("another user's personal DTU is not resolvable", async () => {
    const r = await verifyClaim(db, { claim: "X", citationIds: ["dtu_personal"], requesterId: "someone-else", useCouncil: false });
    assert.equal(r.verdict, "fabricated_citation");
    assert.deepEqual(r.unresolvedIds, ["dtu_personal"]);
    // ...but the owner CAN resolve it.
    const owner = await verifyClaim(db, { claim: "X", citationIds: ["dtu_personal"], requesterId: "u1", useCouncil: false });
    assert.equal(owner.allResolved, true);
  });

  it("no citations → unverified (nothing to check)", async () => {
    const r = await verifyClaim(db, { claim: "Some unsourced assertion.", citationIds: [], requesterId: "u1", useCouncil: false });
    assert.equal(r.verdict, "unverified");
    assert.equal(r.supported, null);
  });

  it("never throws on a missing db", async () => {
    const r = await verifyClaim(null, { claim: "x", citationIds: ["a"] });
    assert.equal(r.ok, false);
  });
});
