/**
 * DW1 — DTU causal-edge layer tests.
 *
 * Covers:
 *   (a) migration 352 applies cleanly against a fresh in-memory DB.
 *   (b) addCausalEdge — CRUD create, JS-side edgeType validation, confidence
 *       range validation.
 *   (c) causalEdgesFor — both directions (asChild / asParent).
 *   (d) cycle-handling — a causal cycle IS allowed to be written (documented
 *       design decision), and traceCausalPath's visited-set BFS terminates
 *       safely over it regardless.
 *   (e) traceCausalPath — finds a real multi-hop path; returns null for an
 *       unreachable pair.
 *   (f) drift-monitor integration — a contradicting DTU pair with a
 *       `corrects`/`prevents` causal edge is enriched as "expected"; a
 *       contradicting pair with no causal edge is flagged "unexplained".
 *
 * Run: node --test tests/causal-edges.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig352 from "../migrations/352_dtu_causal_edges.js";
import {
  addCausalEdge,
  causalEdgesFor,
  directCausalEdgeBetween,
  traceCausalPath,
  traceCausalRoots,
  CAUSAL_EDGE_TYPES,
} from "../lib/causal-edges.js";
import { createEdge } from "../emergent/edges.js";
import { runDriftScan } from "../emergent/drift-monitor.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  mig352.up(db);
});

afterEach(() => {
  try { db?.close(); } catch { /* intentional */ }
});

describe("migration 352 — dtu_causal_edges", () => {
  it("applies cleanly and creates the table + indexes", () => {
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dtu_causal_edges'").get();
    assert.ok(t, "dtu_causal_edges table exists after mig 352");
    const idxChild = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_causal_edges_child'").get();
    const idxParent = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_causal_edges_parent'").get();
    assert.ok(idxChild, "child index created");
    assert.ok(idxParent, "parent index created");
    // idempotent
    assert.doesNotThrow(() => mig352.up(db));
  });

  it("the CHECK constraint rejects a bad edge_type at the raw SQL level", () => {
    assert.throws(() => {
      db.prepare(
        "INSERT INTO dtu_causal_edges (id, child_id, parent_id, edge_type, confidence, created_at) VALUES (?,?,?,?,?,?)",
      ).run("e1", "dtu_b", "dtu_a", "not_a_real_type", 0.5, Math.floor(Date.now() / 1000));
    }, /CHECK constraint failed/);
  });
});

describe("(b) addCausalEdge — create + validation", () => {
  it("creates an edge with the expected shape", () => {
    const edge = addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "causes", confidence: 0.8 });
    assert.ok(edge.id);
    assert.equal(edge.childId, "dtu_b");
    assert.equal(edge.parentId, "dtu_a");
    assert.equal(edge.edgeType, "causes");
    assert.equal(edge.confidence, 0.8);
    assert.equal(typeof edge.createdAt, "number");

    const row = db.prepare("SELECT * FROM dtu_causal_edges WHERE id = ?").get(edge.id);
    assert.ok(row, "persisted to the DB");
    assert.equal(row.child_id, "dtu_b");
    assert.equal(row.parent_id, "dtu_a");
  });

  it("defaults confidence to 0.5 when omitted", () => {
    const edge = addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "enables" });
    assert.equal(edge.confidence, 0.5);
  });

  it("CAUSAL_EDGE_TYPES matches the DB CHECK enum exactly", () => {
    assert.deepEqual([...CAUSAL_EDGE_TYPES].sort(), ["analogizes", "causes", "corrects", "enables", "prevents"]);
  });

  it("rejects an invalid edgeType in JS BEFORE hitting the DB (doesn't rely on the CHECK constraint)", () => {
    assert.throws(
      () => addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "bogus" }),
      (e) => e.code === "invalid_edge_type",
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtu_causal_edges").get().n, 0, "nothing persisted");
  });

  it("rejects an out-of-range confidence", () => {
    assert.throws(
      () => addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "causes", confidence: 1.5 }),
      (e) => e.code === "invalid_confidence",
    );
    assert.throws(
      () => addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "causes", confidence: -0.1 }),
      (e) => e.code === "invalid_confidence",
    );
  });

  it("rejects a missing childId or parentId", () => {
    assert.throws(
      () => addCausalEdge(db, { parentId: "dtu_a", edgeType: "causes" }),
      (e) => e.code === "missing_child_id",
    );
    assert.throws(
      () => addCausalEdge(db, { childId: "dtu_b", edgeType: "causes" }),
      (e) => e.code === "missing_parent_id",
    );
  });
});

describe("(c) causalEdgesFor — both directions", () => {
  it("returns edges split by asChild / asParent", () => {
    // dtu_a -[causes]-> dtu_b ; dtu_b -[enables]-> dtu_c
    addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "causes" });
    addCausalEdge(db, { childId: "dtu_c", parentId: "dtu_b", edgeType: "enables" });

    const forB = causalEdgesFor(db, "dtu_b");
    assert.equal(forB.asChild.length, 1, "dtu_b is the child of the causes edge");
    assert.equal(forB.asChild[0].parent_id, "dtu_a");
    assert.equal(forB.asParent.length, 1, "dtu_b is the parent of the enables edge");
    assert.equal(forB.asParent[0].child_id, "dtu_c");

    const forA = causalEdgesFor(db, "dtu_a");
    assert.equal(forA.asChild.length, 0);
    assert.equal(forA.asParent.length, 1);
  });

  it("returns an honest empty shape for a DTU with no causal edges", () => {
    const r = causalEdgesFor(db, "dtu_lonely");
    assert.deepEqual(r, { asChild: [], asParent: [] });
  });

  it("returns an honest empty shape when the table is missing (minimal build)", () => {
    const barebonesDb = new Database(":memory:");
    const r = causalEdgesFor(barebonesDb, "dtu_x");
    assert.deepEqual(r, { asChild: [], asParent: [] });
    barebonesDb.close();
  });

  it("directCausalEdgeBetween finds an edge in either direction", () => {
    addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "corrects" });
    const found1 = directCausalEdgeBetween(db, "dtu_a", "dtu_b");
    const found2 = directCausalEdgeBetween(db, "dtu_b", "dtu_a");
    assert.ok(found1 && found1.edge_type === "corrects");
    assert.ok(found2 && found2.edge_type === "corrects");
    assert.equal(directCausalEdgeBetween(db, "dtu_a", "dtu_z"), null, "no edge -> null");
  });
});

describe("(d) cycle handling — cycles are legitimate content, BFS still terminates", () => {
  it("addCausalEdge does NOT reject an edge that closes a cycle", () => {
    // A enables B, B causes C, C prevents A — a genuine feedback loop.
    addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "enables" });
    addCausalEdge(db, { childId: "dtu_c", parentId: "dtu_b", edgeType: "causes" });
    assert.doesNotThrow(() =>
      addCausalEdge(db, { childId: "dtu_a", parentId: "dtu_c", edgeType: "prevents" }),
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtu_causal_edges").get().n, 3, "all three edges persisted, cycle included");
  });

  it("traceCausalPath terminates safely (visited-set BFS) over a cyclic graph and still finds a real path", () => {
    addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "enables" });
    addCausalEdge(db, { childId: "dtu_c", parentId: "dtu_b", edgeType: "causes" });
    addCausalEdge(db, { childId: "dtu_a", parentId: "dtu_c", edgeType: "prevents" }); // closes the cycle

    const start = Date.now();
    const path = traceCausalPath(db, "dtu_a", "dtu_c", { maxDepth: 25 });
    const elapsedMs = Date.now() - start;

    assert.ok(elapsedMs < 2000, "BFS returns quickly even over a cyclic graph (no infinite loop)");
    assert.ok(Array.isArray(path), "a path was found despite the cycle");
    assert.equal(path.length, 2, "dtu_a -> dtu_b -> dtu_c is the shortest chain");
    assert.equal(path[0].parent_id, "dtu_a");
    assert.equal(path[0].child_id, "dtu_b");
    assert.equal(path[1].parent_id, "dtu_b");
    assert.equal(path[1].child_id, "dtu_c");
  });
});

describe("(e) traceCausalPath — reachability", () => {
  it("finds a real multi-hop path (parent -> child forward chain)", () => {
    // dtu_1 -[causes]-> dtu_2 -[enables]-> dtu_3 -[causes]-> dtu_4
    addCausalEdge(db, { childId: "dtu_2", parentId: "dtu_1", edgeType: "causes" });
    addCausalEdge(db, { childId: "dtu_3", parentId: "dtu_2", edgeType: "enables" });
    addCausalEdge(db, { childId: "dtu_4", parentId: "dtu_3", edgeType: "causes" });

    const path = traceCausalPath(db, "dtu_1", "dtu_4");
    assert.ok(Array.isArray(path));
    assert.equal(path.length, 3);
    assert.deepEqual(path.map((e) => e.child_id), ["dtu_2", "dtu_3", "dtu_4"]);
  });

  it("returns [] for a trivial fromId === toId path", () => {
    assert.deepEqual(traceCausalPath(db, "dtu_x", "dtu_x"), []);
  });

  it("returns null for an unreachable pair", () => {
    addCausalEdge(db, { childId: "dtu_2", parentId: "dtu_1", edgeType: "causes" });
    // dtu_9 has no edges at all
    assert.equal(traceCausalPath(db, "dtu_1", "dtu_9"), null);
    assert.equal(traceCausalPath(db, "dtu_9", "dtu_1"), null);
  });

  it("respects maxDepth — a real path beyond the cap is reported as null", () => {
    addCausalEdge(db, { childId: "dtu_2", parentId: "dtu_1", edgeType: "causes" });
    addCausalEdge(db, { childId: "dtu_3", parentId: "dtu_2", edgeType: "causes" });
    addCausalEdge(db, { childId: "dtu_4", parentId: "dtu_3", edgeType: "causes" });
    assert.equal(traceCausalPath(db, "dtu_1", "dtu_4", { maxDepth: 1 }), null, "3 hops exceeds a maxDepth of 1");
    assert.ok(traceCausalPath(db, "dtu_1", "dtu_4", { maxDepth: 3 }), "3 hops within a maxDepth of 3");
  });
});

describe("(g) traceCausalRoots — reverse BFS to root causes (LC3)", () => {
  it("a DTU with no incoming causal edge is its own root (chainLength 0)", () => {
    addCausalEdge(db, { childId: "dtu_2", parentId: "dtu_1", edgeType: "causes" });
    // dtu_1 has no incoming edge at all — it's already a root.
    const r = traceCausalRoots(db, "dtu_1");
    assert.deepEqual(r.rootIds, ["dtu_1"]);
    assert.equal(r.chainLength, 0);
  });

  it("finds the single root of a real multi-hop chain (uses batchFetchIncomingEdges under the hood)", () => {
    // dtu_root -[causes]-> dtu_mid -[enables]-> dtu_leaf
    addCausalEdge(db, { childId: "dtu_mid", parentId: "dtu_root", edgeType: "causes" });
    addCausalEdge(db, { childId: "dtu_leaf", parentId: "dtu_mid", edgeType: "enables" });

    const r = traceCausalRoots(db, "dtu_leaf");
    assert.deepEqual(r.rootIds, ["dtu_root"]);
    assert.equal(r.chainLength, 2, "2 hops back from dtu_leaf to dtu_root");
  });

  it("finds MULTIPLE roots when two independent causal chains converge on one DTU", () => {
    // dtu_root_a -[causes]-> dtu_converge ; dtu_root_b -[enables]-> dtu_converge
    addCausalEdge(db, { childId: "dtu_converge", parentId: "dtu_root_a", edgeType: "causes" });
    addCausalEdge(db, { childId: "dtu_converge", parentId: "dtu_root_b", edgeType: "enables" });

    const r = traceCausalRoots(db, "dtu_converge");
    assert.deepEqual([...r.rootIds].sort(), ["dtu_root_a", "dtu_root_b"]);
    assert.equal(r.chainLength, 1);
  });

  it("terminates safely (bounded BFS) over a cyclic graph and reports zero roots for a fully closed loop", () => {
    // A enables B, B causes C, C prevents A — a genuine feedback loop, no
    // node outside the cycle, so there is no root cause to find.
    addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "enables" });
    addCausalEdge(db, { childId: "dtu_c", parentId: "dtu_b", edgeType: "causes" });
    addCausalEdge(db, { childId: "dtu_a", parentId: "dtu_c", edgeType: "prevents" });

    const start = Date.now();
    const r = traceCausalRoots(db, "dtu_a", { maxDepth: 25 });
    const elapsedMs = Date.now() - start;

    assert.ok(elapsedMs < 2000, "reverse BFS returns quickly even over a cyclic graph (no infinite loop)");
    assert.deepEqual(r.rootIds, [], "a fully closed cycle has no root outside itself");
  });

  it("respects maxDepth — reports the unresolved frontier as roots when the cap is hit before a real root", () => {
    addCausalEdge(db, { childId: "dtu_2", parentId: "dtu_1", edgeType: "causes" });
    addCausalEdge(db, { childId: "dtu_3", parentId: "dtu_2", edgeType: "causes" });
    addCausalEdge(db, { childId: "dtu_4", parentId: "dtu_3", edgeType: "causes" });
    // dtu_1 is the real root, 3 hops back from dtu_4.
    const capped = traceCausalRoots(db, "dtu_4", { maxDepth: 1 });
    assert.equal(capped.chainLength, 1);
    assert.deepEqual(capped.rootIds, ["dtu_3"], "cut off after 1 hop, reports the frontier reached as-of-budget");

    const full = traceCausalRoots(db, "dtu_4", { maxDepth: 10 });
    assert.deepEqual(full.rootIds, ["dtu_1"], "given enough budget, finds the real root");
    assert.equal(full.chainLength, 3);
  });

  it("returns an honest empty shape for a falsy dtuId or a missing table", () => {
    assert.deepEqual(traceCausalRoots(db, null), { rootIds: [], chainLength: 0 });
    const barebonesDb = new Database(":memory:");
    assert.deepEqual(traceCausalRoots(barebonesDb, "dtu_x"), { rootIds: [], chainLength: 0 });
    barebonesDb.close();
  });
});

describe("(f) drift-monitor integration — contradiction enrichment", () => {
  function makeSTATE(dbHandle) {
    return { __emergent: {}, db: dbHandle, dtus: new Map() };
  }

  it("enriches a contradicting pair with an EXPECTED note when a `corrects` causal edge exists between them", () => {
    const STATE = makeSTATE(db);
    // dtu_b `corrects` dtu_a — a deliberate, expected contradiction.
    addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "corrects" });
    createEdge(STATE, { sourceId: "dtu_a", targetId: "dtu_b", edgeType: "contradicts" });

    const { alerts } = runDriftScan(STATE);
    const enriched = alerts.find((a) => a.data?.dtuA && a.data?.expected === true);
    assert.ok(enriched, "an 'expected' alert was produced");
    assert.match(enriched.message, /expected/);
    assert.equal(enriched.data.causalEdgeType, "corrects");
    assert.equal(enriched.severity, "info");
  });

  it("flags a contradicting pair with NO causal edge as unexplained", () => {
    const STATE = makeSTATE(db);
    createEdge(STATE, { sourceId: "dtu_x", targetId: "dtu_y", edgeType: "contradicts" });

    const { alerts } = runDriftScan(STATE);
    const unexplained = alerts.find((a) => a.data?.dtuA === "dtu_x" && a.data?.dtuB === "dtu_y");
    assert.ok(unexplained, "an 'unexplained' alert was produced");
    assert.match(unexplained.message, /unexplained contradiction/);
    assert.equal(unexplained.data.causalEdgeId, null);
    assert.equal(unexplained.data.expected, false);
  });

  it("never throws even when STATE has no db (best-effort enrichment)", () => {
    const STATE = { __emergent: {}, dtus: new Map() };
    createEdge(STATE, { sourceId: "dtu_x", targetId: "dtu_y", edgeType: "contradicts" });
    assert.doesNotThrow(() => runDriftScan(STATE));
  });

  describe("LC3 — unexplained-contradiction severity + causal-root diagnostics", () => {
    const ENV_KEY = "CONCORD_CONTRADICTION_HLR";
    let prevEnv;

    beforeEach(() => { prevEnv = process.env[ENV_KEY]; });
    afterEach(() => {
      if (prevEnv === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prevEnv;
    });

    it("emits ALERT severity by default (unset env var) — so the HLR bridge's alert+critical filter picks it up", () => {
      delete process.env[ENV_KEY];
      const STATE = makeSTATE(db);
      createEdge(STATE, { sourceId: "dtu_x", targetId: "dtu_y", edgeType: "contradicts" });

      const { alerts } = runDriftScan(STATE);
      const unexplained = alerts.find((a) => a.data?.dtuA === "dtu_x" && a.data?.dtuB === "dtu_y");
      assert.ok(unexplained);
      assert.equal(unexplained.severity, "alert", "default-on: unexplained contradictions are ALERT severity");
    });

    it("falls back to WARNING severity when CONCORD_CONTRADICTION_HLR=0 (opt-out kill switch)", () => {
      process.env[ENV_KEY] = "0";
      const STATE = makeSTATE(db);
      createEdge(STATE, { sourceId: "dtu_x", targetId: "dtu_y", edgeType: "contradicts" });

      const { alerts } = runDriftScan(STATE);
      const unexplained = alerts.find((a) => a.data?.dtuA === "dtu_x" && a.data?.dtuB === "dtu_y");
      assert.ok(unexplained);
      assert.equal(unexplained.severity, "warning", "CONCORD_CONTRADICTION_HLR=0 opts back into the old behavior");
    });

    it('any value OTHER than the string "0" keeps the new default-on ALERT behavior', () => {
      process.env[ENV_KEY] = "false"; // not the literal "0" — must NOT opt out
      const STATE = makeSTATE(db);
      createEdge(STATE, { sourceId: "dtu_x", targetId: "dtu_y", edgeType: "contradicts" });

      const { alerts } = runDriftScan(STATE);
      const unexplained = alerts.find((a) => a.data?.dtuA === "dtu_x" && a.data?.dtuB === "dtu_y");
      assert.equal(unexplained.severity, "alert");
    });

    it("attaches rootDtuIds/chainLength for a multi-hop scenario: no direct edge between the pair, but a shared ancestor", () => {
      // dtu_shared_root -[causes]-> dtu_x   (chain of 1)
      // dtu_shared_root -[enables]-> dtu_mid -[causes]-> dtu_y   (chain of 2)
      // dtu_x and dtu_y have NO direct edge between them, but both trace
      // back to dtu_shared_root — the actual root cause of the contradiction.
      addCausalEdge(db, { childId: "dtu_x", parentId: "dtu_shared_root", edgeType: "causes" });
      addCausalEdge(db, { childId: "dtu_mid", parentId: "dtu_shared_root", edgeType: "enables" });
      addCausalEdge(db, { childId: "dtu_y", parentId: "dtu_mid", edgeType: "causes" });

      const STATE = makeSTATE(db);
      createEdge(STATE, { sourceId: "dtu_x", targetId: "dtu_y", edgeType: "contradicts" });

      const { alerts } = runDriftScan(STATE);
      const unexplained = alerts.find((a) => a.data?.dtuA === "dtu_x" && a.data?.dtuB === "dtu_y");
      assert.ok(unexplained, "still flagged unexplained — no DIRECT edge between dtu_x and dtu_y");
      assert.deepEqual(unexplained.data.rootDtuIds, ["dtu_shared_root"], "both sides trace back to the same root");
      assert.equal(unexplained.data.chainLength, 2, "the longer of the two chains (dtu_y is 2 hops from the root)");
    });
  });
});
