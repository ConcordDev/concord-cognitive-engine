// server/tests/cognitive-fingerprint.test.js
//
// Cognitive Fingerprint (#5) — derives a thinking-style profile from REAL
// activity (authored DTUs, domain breadth, citation influence). Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createDTU } from "../economy/dtu-pipeline.js";
import { computeFingerprint, snapshotFingerprint, getFingerprintHistory } from "../lib/cognitive-fingerprint.js";
import registerMetacogMacros from "../domains/metacog.js";
import { runCognitiveFingerprintCycle } from "../emergent/cognitive-fingerprint-cycle.js";

function mk(db, creator, lens, n = 1) {
  for (let i = 0; i < n; i++) {
    createDTU(db, { creatorId: creator, title: `${lens} ${i}`, content: `work in ${lens} #${i}`, contentType: "text", lensId: lens, citationMode: "original" });
  }
}

describe("Cognitive Fingerprint (#5)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    mk(db, "u1", "game", 2);
    mk(db, "u1", "code", 1);
    mk(db, "u1", "literary", 1);
    mk(db, "u2", "game", 1);
    // u1's work gets cited → citation influence.
    db.prepare(`INSERT INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator, created_at)
                VALUES ('rl1','c1','p1',1,'u2','u1', datetime('now'))`).run();
    macros = new Map();
    registerMetacogMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("computes the profile from real authored DTUs", () => {
    const fp = computeFingerprint(db, "u1");
    assert.equal(fp.output, 4, "4 authored DTUs");
    assert.equal(fp.domainBreadth, 3, "game/code/literary");
    assert.equal(fp.dominantDomains[0].domain, "game", "game is the top domain");
    assert.equal(fp.citationInfluence, 1, "cited once");
    assert.ok(typeof fp.style === "string" && fp.style !== "nascent");
  });

  it("a user with no activity is nascent (not fabricated)", () => {
    const fp = computeFingerprint(db, "ghost");
    assert.equal(fp.output, 0);
    assert.equal(fp.style, "nascent");
    assert.deepEqual(fp.dominantDomains, []);
  });

  it("snapshots into the time-series + reads history", () => {
    const s = snapshotFingerprint(db, "u1");
    assert.ok(s && s.id);
    const hist = getFingerprintHistory(db, "u1");
    assert.ok(hist.length >= 1);
    assert.equal(hist[0].output, 4);
    assert.ok(Array.isArray(hist[0].dominantDomains));
  });

  it("the heartbeat snapshots active authors (system excluded)", async () => {
    const r = await runCognitiveFingerprintCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.snapshotted >= 2, "u1 + u2 snapshotted");
  });

  it("metacog.fingerprint macro returns the profile", async () => {
    const r = await macros.get("metacog.fingerprint")({ db, actor: { userId: "u1" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.fingerprint.output, 4);
  });
});
