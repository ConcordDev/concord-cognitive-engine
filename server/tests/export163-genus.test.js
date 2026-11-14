// GB-1538 — the export-empty genus (22 ids), premise + cure pins.
//
// The shared export read (collectLensExport) already gathers the
// caller's panel records from STATE.<domain>Lens bags for the canonical
// per-user-Map shapes — the first block pins that reach over the real
// bag shapes of the genus's lenses (the head-check evidence for the
// cured-at-head group), with the non-happy paths (another user's rows,
// ownerless/other-owner artifacts) held shut. The second block pins the
// two shared cures built under GB-1538: the per-user bucket-object
// descent (FIX-math-007) and the no-store honesty signal (FIX-lattice-003
// · FIX-narrative-walk-003 · FIX-frontier-003). The third block exercises
// the download route's JSON/CSV on state rows (FIX-daily-006's shape).

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import * as lensExport from "../lib/lens-export.js";
const { collectLensExport, exportCallerLensState } = lensExport;
// Absent on the pristine tree by design — the fallback lets the S2 pins
// fail as assertions there instead of killing the file at import.
const isNoStoreDomain = lensExport.isNoStoreDomain ?? (() => false);
import createUniversalExportRouter from "../routes/universal-export.js";

const UID = "u-export163";
const OTHER = "u-someone-else";
const ctx = { actor: { userId: UID }, userId: UID };
const rec = (id, title, extra = {}) => ({ id, title, createdAt: "2026-11-12T00:00:00Z", ...extra });
const M = (v) => new Map([[UID, v]]);

let artifacts = [];
const runMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected macro" };
};

beforeEach(() => { artifacts = []; });
afterEach(() => { globalThis._concordSTATE = undefined; });

async function collect(domain) {
  const out = await collectLensExport({ runMacro, domain, ctx, limit: 1000 });
  assert.equal(out.ok, true);
  return out;
}

describe("cured-at-head group: the gather reaches the real bag shapes", () => {
  const cases = [
    ["defense", { defenseLens: { personnel: M(new Map([["p1", rec("p1", "Personnel QA")]])), assets: M([rec("a1", "Asset QA")]) } }, ["p1", "a1"]],
    ["engineering", { engineeringLens: { parts: M([rec("pt1", "Part QA")]) } }, ["pt1"]],
    ["fashion", { fashionLens: { items: M([rec("f1", "Closet QA")]) } }, ["f1"]],
    ["federation", { federation: { moderation: M([rec("m1", "Mod QA")]), access: M({ example: { policy: "allow" } }) } }, ["m1"]],
    ["grounding", { groundingLens: { checks: M([rec("g1", "Check QA")]) } }, ["g1"]],
    ["hypothesis", { hypothesisLens: { datasets: M(new Map([["d1", rec("d1", "Data QA")]])), analyses: M([rec("an1", "Analysis QA")]) } }, ["d1", "an1"]],
    ["neuro", { neuroLens: { recordings: M(new Map([["r1", rec("r1", "Rec QA")]])) } }, ["r1"]],
    ["organ", { organLens: { roster: M([rec("o1", "Person QA")]) } }, ["o1"]],
    ["reflection", { reflectionLens: { journals: M([rec("j1", "Journal QA")]), entries: M([rec("e1", "Entry QA")]) } }, ["j1", "e1"]],
    ["root", { rootLens: { computations: M([rec("c1", "Comp QA")]) } }, ["c1"]],
    ["transfer", { transferLens: { connectors: M(new Map([["k1", rec("k1", "Conn QA")]])) } }, ["k1"]],
    ["home-improvement", { homeImprovementLens: { projects: M([rec("hp1", "Project QA")]), shopping: M([rec("hs1", "Shopping QA")]) } }, ["hp1", "hs1"]],
    ["docs", { docsLens: { pages: M([rec("pg1", "Page QA")]), databases: M([rec("db1", "Database QA")]) } }, ["pg1", "db1"]],
    ["meditation", { meditationLens: { sessions: M([{ id: "s1", title: "Session QA", journal: "river notes" }]) } }, ["s1"]],
    ["daily", { dailyLens: { entries: M([rec("de1", "Today QA", { notes: "walked the river" })]) } }, ["de1"]],
  ];
  for (const [domain, state, ids] of cases) {
    test(`${domain}: the caller's panel records ride`, async () => {
      globalThis._concordSTATE = state;
      const out = await collect(domain);
      const got = out.artifacts.map((r) => r.id);
      for (const id of ids) assert.ok(got.includes(id), `${domain} export missing ${id}: ${JSON.stringify(got)}`);
      assert.equal(out.stateBacked, true, `${domain} should report stateBacked`);
    });
  }

  test("another user's panel records never ride (every shape spot-checked)", async () => {
    globalThis._concordSTATE = {
      defenseLens: { personnel: new Map([[OTHER, [rec("x1", "Not mine")]]]) },
      organLens: { roster: new Map([[OTHER, [rec("x2", "Not mine")]]]) },
      mathCAS: new Map([[OTHER, { history: [{ latex: "y^2", category: "algebra" }] }]]),
    };
    for (const domain of ["defense", "organ", "math"]) {
      const out = await collect(domain);
      assert.equal(out.artifacts.length, 0, `${domain} leaked another user's records`);
    }
  });

  test("artifact leg: other-owner, ownerless and system artifacts never ride; the caller's own does", async () => {
    globalThis._concordSTATE = {};
    artifacts = [
      { id: "mine", type: "note", title: "Mine", ownerId: UID },
      { id: "theirs", type: "note", title: "Theirs", ownerId: OTHER },
      { id: "ownerless", type: "note", title: "Ownerless" },
      { id: "sys", type: "note", title: "System", ownerId: "system" },
      { id: "scaffold", type: "domain_action", title: "Scaffold", ownerId: UID },
    ];
    const out = await collect("defense");
    assert.deepEqual(out.artifacts.map((r) => r.id), ["mine"]);
  });

  test("meditation session rows carry the journal text in data (FIX-meditation-003 export leg)", async () => {
    globalThis._concordSTATE = { meditationLens: { sessions: M([{ id: "s1", title: "Session QA", journal: "river notes" }]) } };
    const out = await collect("meditation");
    assert.equal(out.artifacts[0].data.journal, "river notes");
  });
});

describe("S1 — per-user bucket objects (FIX-math-007)", () => {
  test("mathCAS history entries ride, with latex + category in data and latex as the title", async () => {
    globalThis._concordSTATE = {
      mathCAS: new Map([[UID, { history: [{ latex: "x^2 + 1", category: "algebra", result: "factored", at: "2026-11-12T00:00:00Z" }] }]]),
    };
    const out = await collect("math");
    assert.equal(out.artifacts.length, 1);
    const row = out.artifacts[0];
    assert.equal(row.type, "history");
    assert.equal(row.title, "x^2 + 1");
    assert.equal(row.data.latex, "x^2 + 1");
    assert.equal(row.data.category, "algebra");
  });

  test("a bucket that IS a single record still rides as one record (invariant)", () => {
    const state = { syntheticLens: new Map([[UID, { id: "one", title: "Single" }]]) };
    const rows = exportCallerLensState(state, "synthetic", ctx);
    assert.deepEqual(rows.map((r) => r.id), ["one"]);
  });

  test("a bucket object with no record lists yields nothing (workspace-state shape)", () => {
    const state = { syntheticLens: { panels: new Map([[UID, { main: { state: "open", updatedAt: "t" } }]]) } };
    const rows = exportCallerLensState(state, "synthetic", ctx);
    assert.equal(rows.length, 0);
  });
});

describe("S2 — no-store honesty signal (lattice · narrative-walk · frontier)", () => {
  test("the three verified no-store lenses report stateBacked on an empty export", async () => {
    globalThis._concordSTATE = {};
    for (const domain of ["lattice", "narrative-walk", "frontier"]) {
      assert.equal(isNoStoreDomain(domain), true);
      const out = await collect(domain);
      assert.equal(out.artifacts.length, 0);
      assert.equal(out.stateBacked, true, `${domain} must not claim panel records were excluded`);
    }
  });

  test("an unlisted no-bag domain keeps the old signal (conservative invariant)", async () => {
    globalThis._concordSTATE = {};
    assert.equal(isNoStoreDomain("some-db-domain"), false);
    const out = await collect("some-db-domain");
    assert.equal(out.stateBacked, false);
  });
});

describe("download route on state rows (FIX-daily-006 shape)", () => {
  async function withServer(fn) {
    globalThis._concordSTATE = {
      dailyLens: { entries: M([rec("de1", "Today QA", { notes: "walked the river", mood: "calm" })]) },
    };
    const app = express();
    app.use(createUniversalExportRouter(globalThis._concordSTATE, runMacro, () => ctx));
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      await fn(base);
    } finally {
      server.close();
    }
  }

  test("CSV carries the entry body fields past the envelope columns", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/lens/daily/export/download?format=csv`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.ok(body.split("\n")[0].includes("notes"), `CSV header lacks the notes column: ${body.split("\n")[0]}`);
      assert.ok(body.includes("walked the river"), "CSV body lacks the entry notes");
    });
  });

  test("JSON carries the state row whole", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/lens/daily/export/download?format=json`);
      assert.equal(res.status, 200);
      const rows = await res.json();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].data.notes, "walked the river");
    });
  });

  test("an empty lens downloads nothing (404, never an empty file)", async () => {
    globalThis._concordSTATE = { dailyLens: { entries: new Map() } };
    const app = express();
    app.use(createUniversalExportRouter(globalThis._concordSTATE, runMacro, () => ctx));
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const res = await fetch(`${base}/api/lens/daily/export/download?format=csv`);
      assert.equal(res.status, 404);
    } finally {
      server.close();
    }
  });
});
