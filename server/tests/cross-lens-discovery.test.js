/**
 * Tier-2 contract tests for Phase 6c — Cross-lens Discovery.
 *
 * Run: node --test tests/cross-lens-discovery.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  searchDtus,
  getKindFacets,
  getTrending,
  _internal,
} from "../lib/cross-lens-discovery.js";

function makeFakeDb() {
  const tables = { dtus: new Map(), dtu_citations: new Map() };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { run: (...a) => runStmt(s, a), all: (...a) => allStmt(s, a) };
  }
  function runStmt() { return { changes: 0 }; }
  function allStmt(sql, args) {
    if (sql.startsWith("SELECT id, type AS kind, title, creator_id, data AS meta_json, created_at FROM dtus")) {
      // Walk all params: like1, like2, [kind], [creatorId], [requesterId], limit
      // We extract the limit (last param) and the like pattern (first).
      const limit = args[args.length - 1];
      const likePattern = args[0]; // "%query%"
      const pattern = likePattern.slice(1, -1).toLowerCase();
      const requesterId = sql.includes("d.creator_id = ? OR") ? args[args.length - 2] : null;
      const filterKind = sql.includes("d.type = ?") ? args[2] : null;
      const filterCreator = sql.includes("d.creator_id = ? AND") ? args[3] : null;

      const all = Array.from(tables.dtus.values()).filter(d => {
        const hay = `${d.title} ${d.meta_json}`.toLowerCase();
        if (!hay.includes(pattern)) return false;
        if (filterKind && d.kind !== filterKind) return false;
        if (filterCreator && d.creator_id !== filterCreator) return false;
        // Privacy filter: if not owner, exclude personal-scope.
        const meta = d.meta_json || "";
        if (requesterId && d.creator_id !== requesterId && meta.includes('"scope":"personal"')) return false;
        if (!requesterId && meta.includes('"scope":"personal"')) return false;
        return true;
      });
      return all.sort((a, b) => b.created_at - a.created_at).slice(0, limit);
    }
    if (sql.startsWith("SELECT type AS kind, COUNT(*) AS n FROM dtus")) {
      const requesterId = args[0] || null;
      const counts = {};
      for (const d of tables.dtus.values()) {
        if (requesterId && d.creator_id !== requesterId && (d.meta_json || "").includes('"scope":"personal"')) continue;
        if (!requesterId && (d.meta_json || "").includes('"scope":"personal"')) continue;
        counts[d.kind] = (counts[d.kind] || 0) + 1;
      }
      return Object.entries(counts).map(([kind, n]) => ({ kind, n }));
    }
    if (sql.startsWith("SELECT c.parent_id AS id, COUNT(*) AS citations,")) {
      const [cutoff, limit] = args;
      const counts = {};
      for (const c of tables.dtu_citations.values()) {
        if (c.created_at <= cutoff) continue;
        counts[c.parent_id] = (counts[c.parent_id] || 0) + 1;
      }
      return Object.entries(counts).map(([id, n]) => {
        const d = tables.dtus.get(id);
        return { id, citations: n, title: d?.title, kind: d?.kind, creator_id: d?.creator_id };
      }).sort((a, b) => b.citations - a.citations).slice(0, limit);
    }
    return [];
  }
  return { prepare, _tables: tables };
}

function seedDtu(db, opts) {
  db._tables.dtus.set(opts.id, {
    id: opts.id, kind: opts.kind || "skill", title: opts.title || "untitled",
    creator_id: opts.creator_id || "u1",
    meta_json: typeof opts.meta_json === "string" ? opts.meta_json : JSON.stringify(opts.meta_json || {}),
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  });
}

describe("searchDtus", () => {
  it("matches by title", () => {
    const db = makeFakeDb();
    seedDtu(db, { id: "d1", title: "Frostbreaker" });
    seedDtu(db, { id: "d2", title: "Fireball" });
    const r = searchDtus(db, "frost");
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].id, "d1");
  });

  it("matches by meta_json content", () => {
    const db = makeFakeDb();
    seedDtu(db, { id: "d1", title: "x", meta_json: { author_kind: "npc", element: "ice" } });
    seedDtu(db, { id: "d2", title: "y", meta_json: { author_kind: "player", element: "fire" } });
    const r = searchDtus(db, "ice");
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].id, "d1");
  });

  it("rejects too-short query", () => {
    const db = makeFakeDb();
    const r = searchDtus(db, "a");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "query_too_short");
  });

  it("rejects too-long query", () => {
    const db = makeFakeDb();
    const r = searchDtus(db, "x".repeat(300));
    assert.equal(r.ok, false);
    assert.equal(r.reason, "query_too_long");
  });

  it("respects kind filter", () => {
    const db = makeFakeDb();
    seedDtu(db, { id: "d1", kind: "skill", title: "frost shard" });
    seedDtu(db, { id: "d2", kind: "spell_recipe", title: "frost dome" });
    const r = searchDtus(db, "frost", { kind: "skill" });
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].kind, "skill");
  });

  it("excludes personal-scope DTUs from non-owner queries", () => {
    const db = makeFakeDb();
    seedDtu(db, { id: "d1", title: "secret journal", creator_id: "u1", meta_json: JSON.stringify({ scope: "personal" }) });
    const rNonOwner = searchDtus(db, "journal", { requesterId: "u2" });
    assert.equal(rNonOwner.results.length, 0);
    const rOwner = searchDtus(db, "journal", { requesterId: "u1" });
    assert.equal(rOwner.results.length, 1);
  });

  it("computes a snippet around the match", () => {
    const db = makeFakeDb();
    seedDtu(db, { id: "d1", title: "Some title Frostbreaker tier", meta_json: { extra: "stuff" } });
    const r = searchDtus(db, "frost");
    assert.ok(r.results[0].snippet.toLowerCase().includes("frost"));
  });
});

describe("getKindFacets", () => {
  it("counts by kind", () => {
    const db = makeFakeDb();
    seedDtu(db, { id: "d1", kind: "skill" });
    seedDtu(db, { id: "d2", kind: "skill" });
    seedDtu(db, { id: "d3", kind: "spell_recipe" });
    const facets = getKindFacets(db);
    const skill = facets.find(f => f.kind === "skill");
    assert.equal(skill.n, 2);
  });
});

describe("getTrending", () => {
  it("ranks by citation count in lookback window", () => {
    const db = makeFakeDb();
    seedDtu(db, { id: "popular", title: "Popular" });
    seedDtu(db, { id: "quiet",   title: "Quiet" });
    const now = Math.floor(Date.now() / 1000);
    db._tables.dtu_citations.set("c1", { id: "c1", parent_id: "popular", created_at: now });
    db._tables.dtu_citations.set("c2", { id: "c2", parent_id: "popular", created_at: now });
    db._tables.dtu_citations.set("c3", { id: "c3", parent_id: "quiet",   created_at: now });
    const t = getTrending(db, { lookbackS: 3600, limit: 10 });
    assert.equal(t[0].id, "popular");
    assert.equal(t[0].citations, 2);
  });
});

describe("internals", () => {
  it("MAX_RESULTS bound", () => {
    assert.equal(_internal.MAX_RESULTS, 100);
  });
});
