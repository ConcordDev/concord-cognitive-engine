// server/tests/notebook.test.js
//
// V1.2 Wave E grounding audit — cross-domain reproducible notebooks
// (server/lib/notebook.js, server/domains/notebook.js,
// server/migrations/384_cross_domain_notebooks.js).
//
// Tests cover lib/notebook.js directly against a real in-memory
// better-sqlite3 DB run through the FULL migration ledger (mirroring
// tests/goal-decomposition.test.js's / tests/agent-projects.test.js's
// pattern), AND the five domains/notebook.js macros end-to-end through a
// minimal `register`/`call` harness (mirroring tests/agent-projects.test.js
// / tests/workspace-rooms.test.js's harness).
//
// `ctx.macro.run` in the real server is `(domain, name, input) =>
// runMacro(domain, name, input, ctx)` (server.js:15477/15666). This test's
// harness reproduces the SAME shape — `ctx.macro.run` dispatches back into
// the SAME registry `register()` populated — so `notebook.add-cell` /
// `notebook.replay-cell` exercise the real internal-call mechanism, not a
// parallel one. The composed macros themselves (`arith.square`,
// `chaos.roll`, a `dtu.create` shim, `catalog.lookup`, `broken.explode`)
// are controlled stand-ins registered directly in this file — the same
// choice tests/agent-projects.test.js makes for its own registry harness —
// chosen specifically to exercise:
//   - a genuinely deterministic pure function (`arith.square`), so replay
//     can assert a REAL match, not an assumed one;
//   - a genuinely non-deterministic one (`chaos.roll`, a monotonic
//     counter), so replay must honestly report a mismatch;
//   - the real `dtu.create` RESULT SHAPE (`{ ok, dtu:{ id, ... } }`) to
//     test notebook.js's OWN `extractDtuId` capture logic in isolation
//     from the real macro's heavy side effects (council gate, injection
//     scan, daily caps, mutex) — those are covered elsewhere, e.g.
//     tests/depth/royalty-flow-behavior.test.js, which calls the REAL
//     `dtu.create` through a full server boot.
//
// Run: node --test server/tests/notebook.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  createNotebook, listNotebooks, getNotebook, addCell, replayCell, extractDtuId,
} from "../lib/notebook.js";
import registerNotebookMacros from "../domains/notebook.js";

/** Minimal macro-registry harness mirroring server.js's real `register` +
 *  the `ctx.macro.run` internal-call convention (server.js's `makeCtx`:
 *  `macro: { run: (domain, name, input) => runMacro(domain, name, input, ctx) }`). */
function makeRegistry() {
  const macros = new Map();
  function register(domain, name, fn) {
    if (!macros.has(domain)) macros.set(domain, new Map());
    macros.get(domain).set(name, fn);
  }
  async function call(domain, name, ctx, input) {
    const fn = macros.get(domain)?.get(name);
    if (!fn) throw new Error(`macro not found: ${domain}.${name}`);
    return await fn(ctx, input);
  }
  return { register, call };
}

describe("V1.2 Wave E — notebook lib (direct, real migrated DB)", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
  });

  it("migration applied cleanly — notebooks + notebook_cells tables exist", () => {
    const t1 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='notebooks'`).get();
    const t2 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='notebook_cells'`).get();
    assert.ok(t1, "notebooks table exists");
    assert.ok(t2, "notebook_cells table exists");
  });

  it("createNotebook requires a user and a non-empty title", () => {
    assert.equal(createNotebook(db, "", "x").ok, false);
    assert.equal(createNotebook(db, "u1", "").ok, false);
    assert.equal(createNotebook(db, "u1", "   ").ok, false);
  });

  it("createNotebook mints a fresh id + persists title/description", () => {
    const r = createNotebook(db, "u1", "  R&D on frost enchant yields  ", { description: "tracking replicated results" });
    assert.equal(r.ok, true);
    assert.match(r.notebook.id, /^nb_[0-9a-f-]{16}$/);
    assert.equal(r.notebook.title, "R&D on frost enchant yields");
    assert.equal(r.notebook.ownerUserId, "u1");
    assert.equal(r.notebook.description, "tracking replicated results");
  });

  it("extractDtuId recognizes the real dtu.create shape and honestly returns null otherwise", () => {
    assert.equal(extractDtuId({ ok: true, dtu: { id: "dtu_abc" } }), "dtu_abc");
    assert.equal(extractDtuId({ ok: true, dtuId: "dtu_direct" }), "dtu_direct");
    assert.equal(extractDtuId({ ok: true, result: { dtuId: "dtu_nested" } }), "dtu_nested");
    assert.equal(extractDtuId({ ok: true, result: { dtu: { id: "dtu_nested2" } } }), "dtu_nested2");
    // Multi-id ingestion shape — deliberately NOT collapsed to a single id.
    assert.equal(extractDtuId({ ok: true, result: { dtuIds: ["a", "b"] } }), null);
    assert.equal(extractDtuId({ ok: true, result: { entries: ["x"] } }), null);
    assert.equal(extractDtuId(null), null);
    assert.equal(extractDtuId({}), null);
  });

  describe("addCell — real macro execution + honest capture", () => {
    let notebookId;
    let deterministicRunner;
    let rollCount;

    before(() => {
      notebookId = createNotebook(db, "u2", "Composition notebook").notebook.id;
      rollCount = 0;
      // A controlled stand-in "macro runtime" with the exact
      // `(domain, action, input) => Promise<result>` shape ctx.macro.run
      // has. `arith.square` is pure/deterministic; `chaos.roll` is a
      // monotonic counter (genuinely differs call to call); `dtu.create`
      // mirrors the real macro's result shape only; `catalog.lookup`
      // never produces a dtu id; `broken.explode` always throws.
      deterministicRunner = async (domain, action, input) => {
        if (domain === "arith" && action === "square") {
          const n = Number(input.n);
          if (!Number.isFinite(n)) return { ok: false, error: "n must be finite" };
          return { ok: true, n, square: n * n };
        }
        if (domain === "chaos" && action === "roll") {
          rollCount += 1;
          return { ok: true, roll: rollCount };
        }
        if (domain === "dtu" && action === "create") {
          return { ok: true, dtu: { id: `dtu_${input.title || "untitled"}_${rollCount}_${Math.random().toString(36).slice(2, 8)}`, title: input.title || "Untitled" } };
        }
        if (domain === "catalog" && action === "lookup") {
          return { ok: true, result: { entries: [`entry-for-${input.key}`] } };
        }
        if (domain === "broken" && action === "explode") {
          throw new Error("boom: simulated macro crash");
        }
        throw new Error(`macro not found: ${domain}.${action}`);
      };
    });

    it("records a real deterministic macro call, no DTU id (honest null)", async () => {
      const r = await addCell(db, "u2", notebookId, { domain: "arith", action: "square", input: { n: 5 } }, deterministicRunner);
      assert.equal(r.ok, true);
      assert.equal(r.cell.ok, true);
      assert.deepEqual(r.cell.output, { ok: true, n: 5, square: 25 });
      assert.equal(r.cell.outputDtuId, null, "arith.square produces no DTU — honest null, not fabricated");
      assert.equal(r.cell.domain, "arith");
      assert.equal(r.cell.action, "square");
      assert.equal(r.cell.position, 0, "first cell in this notebook");
    });

    it("captures a real output_dtu_id when the macro genuinely produces a DTU-shaped result", async () => {
      const r = await addCell(db, "u2", notebookId, { domain: "dtu", action: "create", input: { title: "Reaction log A" } }, deterministicRunner);
      assert.equal(r.ok, true);
      assert.equal(r.cell.ok, true);
      assert.ok(r.cell.outputDtuId, "dtu.create shape must be captured");
      assert.match(r.cell.outputDtuId, /^dtu_/);
      assert.equal(r.cell.output.dtu.id, r.cell.outputDtuId);
    });

    it("a non-DTU-producing macro call honestly has output_dtu_id: null", async () => {
      const r = await addCell(db, "u2", notebookId, { domain: "catalog", action: "lookup", input: { key: "frost" } }, deterministicRunner);
      assert.equal(r.ok, true);
      assert.equal(r.cell.ok, true);
      assert.equal(r.cell.outputDtuId, null);
    });

    it("a macro call that THROWS records an honest failure, never a fabricated success", async () => {
      const r = await addCell(db, "u2", notebookId, { domain: "broken", action: "explode", input: {} }, deterministicRunner);
      assert.equal(r.ok, true, "recording the failure itself succeeds");
      assert.equal(r.cell.ok, false, "the underlying macro call's failure is honestly reflected");
      assert.match(r.cell.error, /boom/);
      assert.equal(r.cell.output, null);
      assert.equal(r.cell.outputDtuId, null);
    });

    it("a nonexistent domain/action is recorded as an honest failure, not silently dropped", async () => {
      const r = await addCell(db, "u2", notebookId, { domain: "ghost", action: "nope", input: {} }, deterministicRunner);
      assert.equal(r.ok, true);
      assert.equal(r.cell.ok, false);
      assert.match(r.cell.error, /macro not found/);
    });

    it("addCell requires an owner, a notebook, and a macro runtime", async () => {
      assert.equal((await addCell(db, "", notebookId, { domain: "arith", action: "square", input: {} }, deterministicRunner)).reason, "no_user");
      assert.equal((await addCell(db, "u2", "nb_missing", { domain: "arith", action: "square", input: {} }, deterministicRunner)).reason, "notebook_not_found");
      assert.equal((await addCell(db, "mallory", notebookId, { domain: "arith", action: "square", input: {} }, deterministicRunner)).reason, "not_owned");
      assert.equal((await addCell(db, "u2", notebookId, { domain: "arith", action: "square", input: {} })).reason, "no_macro_runtime");
    });

    it("getNotebook returns the notebook + all real cells in position order", () => {
      const r = getNotebook(db, "u2", notebookId);
      assert.equal(r.ok, true);
      assert.equal(r.cells.length, 5);
      const positions = r.cells.map((c) => c.position);
      assert.deepEqual(positions, [0, 1, 2, 3, 4], "strictly increasing, insertion order");
      assert.deepEqual(r.cells.map((c) => `${c.domain}.${c.action}`), [
        "arith.square", "dtu.create", "catalog.lookup", "broken.explode", "ghost.nope",
      ]);
    });

    it("getNotebook enforces ownership honestly", () => {
      const r = getNotebook(db, "mallory", notebookId);
      assert.equal(r.ok, false);
      assert.equal(r.reason, "not_owned");
    });

    describe("replayCell — honest reproducibility", () => {
      let squareCellId, rollCellId;

      before(async () => {
        const nb = getNotebook(db, "u2", notebookId);
        squareCellId = nb.cells.find((c) => c.domain === "arith").id;
        // Fresh chaos.roll cell for this describe block, isolated from the
        // outer counter state used by the DTU-capture tests above.
        const r = await addCell(db, "u2", notebookId, { domain: "chaos", action: "roll", input: {} }, deterministicRunner);
        rollCellId = r.cell.id;
      });

      it("replaying a genuinely deterministic macro call reports a REAL match", async () => {
        const r = await replayCell(db, "u2", notebookId, squareCellId, deterministicRunner);
        assert.equal(r.ok, true);
        assert.equal(r.cell.replayOfCellId, squareCellId);
        assert.equal(r.cell.ok, true);
        assert.deepEqual(r.cell.output, { ok: true, n: 5, square: 25 });
        assert.equal(r.replay.matched, true, "same input, same pure function -> identical output");
        assert.equal(r.replay.diff, null, "no fabricated diff on a genuine match");
      });

      it("replaying a genuinely non-deterministic macro call HONESTLY reports a mismatch, never a fabricated match", async () => {
        const original = getNotebook(db, "u2", notebookId).cells.find((c) => c.id === rollCellId);
        const r = await replayCell(db, "u2", notebookId, rollCellId, deterministicRunner);
        assert.equal(r.ok, true);
        assert.equal(r.replay.matched, false, "chaos.roll increments — the two calls cannot genuinely match");
        assert.ok(r.replay.diff, "a real diff must be reported, not silently swallowed");
        assert.deepEqual(r.replay.diff.changedFields, ["roll"]);
        assert.equal(r.replay.diff.original.output.roll, original.output.roll);
        assert.equal(r.replay.diff.replay.output.roll, r.cell.output.roll);
        assert.notEqual(r.replay.diff.original.output.roll, r.replay.diff.replay.output.roll);
      });

      it("replayCell requires the cell to genuinely exist and belong to the notebook", async () => {
        assert.equal((await replayCell(db, "u2", notebookId, "nbc_missing", deterministicRunner)).reason, "cell_not_found");
        assert.equal((await replayCell(db, "mallory", notebookId, squareCellId, deterministicRunner)).reason, "not_owned");
      });
    });
  });

  describe("addCell — optional real citation registration (explicit, never inferred)", () => {
    let notebookId, dtusMap;

    before(() => {
      notebookId = createNotebook(db, "u3", "Citation notebook").notebook.id;
      // A fake write-through DTU store shaped like the real STATE.dtus map
      // (ownerId + visibility), mirroring tests/agent-projects.test.js's
      // fakeMemoryStore convention. "system"-owned so canCiteSpecificDtu
      // (economy/royalty-cascade.js -> lib/consent.js) grants citation
      // consent unconditionally, matching real system/emergent content.
      dtusMap = new Map();
      dtusMap.set("dtu_parent_seed", { id: "dtu_parent_seed", ownerId: "system", visibility: "public", title: "Seed reaction" });
    });

    it("registers a REAL citation row when the caller explicitly names a resolvable parent DTU", async () => {
      const runner = async (_domain, _action, input) => ({ ok: true, dtu: { id: `dtu_child_${input.title}`, title: input.title } });
      const r = await addCell(
        db, "u3", notebookId,
        { domain: "dtu", action: "create", input: { title: "Derived result" } },
        runner,
        { citeParentDtuId: "dtu_parent_seed", dtus: dtusMap },
      );
      assert.equal(r.ok, true);
      assert.ok(r.cell.outputDtuId);
      assert.equal(r.citation.ok, true, `citation should register: ${JSON.stringify(r.citation)}`);

      const row = db.prepare(`SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?`).get(r.cell.outputDtuId, "dtu_parent_seed");
      assert.ok(row, "a real royalty_lineage row must exist");
      assert.equal(row.creator_id, "u3");
      assert.equal(row.parent_creator, "system");
    });

    it("an unresolvable citeParentDtuId is honestly reported, never fabricated", async () => {
      const runner = async (_domain, _action, input) => ({ ok: true, dtu: { id: `dtu_child2_${input.title}`, title: input.title } });
      const r = await addCell(
        db, "u3", notebookId,
        { domain: "dtu", action: "create", input: { title: "Orphan derivation" } },
        runner,
        { citeParentDtuId: "dtu_totally_unknown", dtus: dtusMap },
      );
      assert.equal(r.ok, true);
      assert.equal(r.citation.ok, false);
      assert.equal(r.citation.reason, "parent_not_found");
    });

    it("no citation is attempted when citeParentDtuId is omitted", async () => {
      const runner = async (_domain, _action, input) => ({ ok: true, dtu: { id: `dtu_child3_${input.title}`, title: input.title } });
      const r = await addCell(db, "u3", notebookId, { domain: "dtu", action: "create", input: { title: "No citation" } }, runner);
      assert.equal(r.ok, true);
      assert.equal(r.citation, null);
    });
  });

  it("listNotebooks returns only the caller's own notebooks with a cheap cell count", async () => {
    createNotebook(db, "u4", "Alpha");
    const beta = createNotebook(db, "u4", "Beta");
    createNotebook(db, "u5", "Not u4's notebook");

    const mine = listNotebooks(db, "u4");
    assert.equal(mine.length, 2);
    assert.ok(mine.every((n) => n.title === "Alpha" || n.title === "Beta"));
    assert.ok(mine.every((n) => n.cellCount === 0));

    const runner = async () => ({ ok: true, value: 1 });
    await addCell(db, "u4", beta.notebook.id, { domain: "arith", action: "square", input: { n: 2 } }, runner);
    const mineAfter = listNotebooks(db, "u4");
    const betaRow = mineAfter.find((n) => n.id === beta.notebook.id);
    assert.equal(betaRow.cellCount, 1);
  });

  it("listNotebooks returns [] for no db / no user, never throws", () => {
    assert.deepEqual(listNotebooks(null, "u1"), []);
    assert.deepEqual(listNotebooks(db, null), []);
  });
});

describe("V1.2 Wave E — notebook macros (end-to-end through the registry harness)", () => {
  let db, registry, ctx;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);

    registry = makeRegistry();
    registerNotebookMacros(registry.register);

    // A real, genuinely deterministic pure-function macro, registered
    // through the SAME `register()` the notebook macros themselves use —
    // this is what makes `ctx.macro.run` (below) a faithful reproduction
    // of the real server.js mechanism rather than a parallel one.
    registry.register("arith", "add", (_ctx, input = {}) => {
      const a = Number(input.a), b = Number(input.b);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: false, error: "a and b must be finite" };
      return { ok: true, a, b, sum: a + b };
    });

    ctx = {
      db,
      actor: { userId: "alice" },
      state: { dtus: new Map() },
      macro: { run: (domain, name, input) => registry.call(domain, name, ctx, input) },
    };
  });

  it("notebook.create requires an authenticated actor and a title", async () => {
    const noUser = await registry.call("notebook", "create", { db, actor: {} }, { title: "x" });
    assert.equal(noUser.ok, false);
    assert.equal(noUser.reason, "no_user");

    const noTitle = await registry.call("notebook", "create", ctx, {});
    assert.equal(noTitle.ok, false);
    assert.equal(noTitle.reason, "missing_title");
  });

  it("full round-trip: create -> add-cell (real ctx.macro.run dispatch) -> get -> list-mine -> replay-cell", async () => {
    const created = await registry.call("notebook", "create", ctx, { title: "Arithmetic R&D" });
    assert.equal(created.ok, true);
    const notebookId = created.notebook.id;

    const added = await registry.call("notebook", "add-cell", ctx, {
      notebookId, domain: "arith", action: "add", input: { a: 3, b: 4 },
    });
    assert.equal(added.ok, true);
    assert.equal(added.cell.ok, true);
    assert.deepEqual(added.cell.output, { ok: true, a: 3, b: 4, sum: 7 });

    const got = await registry.call("notebook", "get", ctx, { notebookId });
    assert.equal(got.ok, true);
    assert.equal(got.cells.length, 1);
    assert.equal(got.cells[0].id, added.cell.id);

    const listed = await registry.call("notebook", "list-mine", ctx, {});
    assert.equal(listed.ok, true);
    assert.ok(listed.notebooks.some((n) => n.id === notebookId && n.cellCount === 1));

    const replayed = await registry.call("notebook", "replay-cell", ctx, { notebookId, cellId: added.cell.id });
    assert.equal(replayed.ok, true);
    assert.equal(replayed.replay.matched, true, "arith.add(3,4) is deterministic — replay must genuinely match");
  });

  it("notebook.add-cell honestly fails a macro call the live registry can no longer resolve", async () => {
    const created = await registry.call("notebook", "create", ctx, { title: "Will hit a missing macro" });
    const r = await registry.call("notebook", "add-cell", ctx, {
      notebookId: created.notebook.id, domain: "nonexistent", action: "vanished", input: {},
    });
    assert.equal(r.ok, true, "recording the failure succeeds");
    assert.equal(r.cell.ok, false);
    assert.match(r.cell.error, /macro not found/);
  });

  it("ownership is enforced through the macro layer (not just the lib)", async () => {
    const created = await registry.call("notebook", "create", ctx, { title: "Owned notebook" });
    const malloryCtx = { db, actor: { userId: "mallory" }, macro: ctx.macro };
    const r = await registry.call("notebook", "add-cell", malloryCtx, {
      notebookId: created.notebook.id, domain: "arith", action: "add", input: { a: 1, b: 1 },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owned");
  });
});
