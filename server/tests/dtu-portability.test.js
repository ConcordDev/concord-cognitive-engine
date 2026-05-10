/**
 * Tier-2 contract tests for Phase 6b — DTU Portability.
 *
 * Run: node --test tests/dtu-portability.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalStringify,
  exportUserCorpus,
  validateEnvelope,
  importEnvelope,
} from "../lib/dtu-portability.js";

function makeFakeDb() {
  const tables = { dtus: new Map(), dtu_citations: new Map(), economy_ledger: new Map() };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { run: (...a) => runStmt(s, a), get: (...a) => getStmt(s, a), all: (...a) => allStmt(s, a) };
  }
  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO dtus")) {
      const [id, kind, title, creator, meta, level, exp, createdAt] = args;
      tables.dtus.set(id, { id, kind, title, creator_id: creator, meta_json: meta, skill_level: level, total_experience: exp, created_at: createdAt });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO dtu_citations")) {
      const id = args[0];
      tables.dtu_citations.set(id, { id, raw: args });
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  function getStmt(sql, args) {
    if (sql.startsWith("SELECT id FROM dtus WHERE id = ?")) {
      const r = tables.dtus.get(args[0]);
      return r ? { id: r.id } : null;
    }
    return null;
  }
  function allStmt(sql, args) {
    if (sql.startsWith("SELECT id, kind, title, creator_id, meta_json")) {
      const [creatorId, limit] = args;
      return Array.from(tables.dtus.values()).filter(d => d.creator_id === creatorId).slice(0, limit);
    }
    if (sql.startsWith("SELECT * FROM dtu_citations")) {
      const [creator, parentCreator] = args;
      return Array.from(tables.dtu_citations.values())
        .filter(c => c.creator_id === creator || c.parent_creator_id === parentCreator);
    }
    if (sql.startsWith("SELECT * FROM economy_ledger")) {
      return Array.from(tables.economy_ledger.values());
    }
    return [];
  }
  return { prepare, _tables: tables };
}

function seedDtu(db, userId, id, opts = {}) {
  db._tables.dtus.set(id, {
    id, kind: opts.kind || "skill", title: opts.title || `DTU ${id}`,
    creator_id: userId, meta_json: JSON.stringify(opts.meta || {}),
    skill_level: opts.skill_level || 1, total_experience: 0,
    created_at: opts.created_at || Math.floor(Date.now() / 1000),
  });
}

describe("canonicalStringify", () => {
  it("sorts object keys deterministically", () => {
    const a = canonicalStringify({ b: 2, a: 1 });
    const b = canonicalStringify({ a: 1, b: 2 });
    assert.equal(a, b);
  });
  it("handles arrays + nulls + nested", () => {
    const s = canonicalStringify({ arr: [1, 2], nested: { x: null } });
    assert.ok(s.includes('"arr":[1,2]'));
    assert.ok(s.includes('"nested":{"x":null}'));
  });
});

describe("exportUserCorpus", () => {
  it("packs DTUs into envelope with hashes", () => {
    const db = makeFakeDb();
    seedDtu(db, "u1", "dtu:1");
    seedDtu(db, "u1", "dtu:2");
    seedDtu(db, "u2", "dtu:3");
    const r = exportUserCorpus(db, "u1");
    assert.equal(r.ok, true);
    assert.equal(r.envelope.spec, "concord-dtu-pack/v1");
    assert.equal(r.envelope.creator_id, "u1");
    assert.equal(r.envelope.dtus.length, 2);
    assert.ok(r.envelope.hashes.dtus_sha256);
    assert.ok(r.envelope.instance_signature);
  });

  it("respects limit", () => {
    const db = makeFakeDb();
    for (let i = 0; i < 50; i++) seedDtu(db, "u1", `dtu:${i}`);
    const r = exportUserCorpus(db, "u1", { limit: 10 });
    assert.equal(r.envelope.dtus.length, 10);
  });
});

describe("validateEnvelope", () => {
  it("accepts a freshly exported envelope", () => {
    const db = makeFakeDb();
    seedDtu(db, "u1", "dtu:1");
    const exp = exportUserCorpus(db, "u1");
    const v = validateEnvelope(exp.envelope);
    assert.equal(v.ok, true);
    assert.equal(v.dtuCount, 1);
  });

  it("rejects bad spec", () => {
    const v = validateEnvelope({ spec: "wrong/v0", dtus: [], creator_id: "x" });
    assert.equal(v.ok, false);
    assert.equal(v.reason, "bad_spec");
  });

  it("rejects missing creator_id", () => {
    const v = validateEnvelope({ spec: "concord-dtu-pack/v1", dtus: [] });
    assert.equal(v.ok, false);
    assert.equal(v.reason, "no_creator_id");
  });

  it("detects tampered DTU bodies via hash mismatch", () => {
    const db = makeFakeDb();
    seedDtu(db, "u1", "dtu:1");
    const exp = exportUserCorpus(db, "u1");
    // Tamper with a DTU body
    exp.envelope.dtus[0].title = "tampered";
    const v = validateEnvelope(exp.envelope);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "dtu_hash_mismatch");
  });
});

describe("importEnvelope", () => {
  it("imports DTUs into target DB; idempotent on re-import", async () => {
    const sourceDb = makeFakeDb();
    seedDtu(sourceDb, "u1", "dtu:1");
    seedDtu(sourceDb, "u1", "dtu:2");
    const exp = exportUserCorpus(sourceDb, "u1");

    const targetDb = makeFakeDb();
    const r1 = await importEnvelope(targetDb, exp.envelope);
    assert.equal(r1.ok, true);
    assert.equal(r1.imported.dtus, 2);

    // Second import: idempotent (skipped via dtu.id existence check).
    const r2 = await importEnvelope(targetDb, exp.envelope);
    assert.equal(r2.ok, true);
    assert.equal(r2.imported.dtus, 0);
    assert.equal(r2.imported.skipped, 2);
  });

  it("rejects bad envelope", async () => {
    const targetDb = makeFakeDb();
    const r = await importEnvelope(targetDb, { spec: "wrong" });
    assert.equal(r.ok, false);
  });
});
