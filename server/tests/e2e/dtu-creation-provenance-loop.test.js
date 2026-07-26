/**
 * Tier-3 flagship E2E loop (R8/CL3, loop 2): "Create artifact → DTU →
 * reuse-with-provenance."
 *
 * Boots the REAL server (macroRuntime, same pattern as
 * server/tests/depth/royalty-flow-behavior.test.js) and drives the actual
 * production macro two different authors would really call:
 *
 *   1. `dtu.create` (server.js) — author "aria" mints a public DTU.
 *   2. `dtu.create` again — author "vex" mints a derivative that cites it
 *      via the standard `input.lineage` array. This is NOT a mock of the
 *      citation system: `dtu.create`'s own "Auto-register citation lineage"
 *      block (server.js, right after DTU persistence) calls the REAL
 *      `economyRegisterCitation` (server/economy/royalty-cascade.js) against
 *      the SAME live SQL db every other citation in Concord uses.
 *   3. `dtu.lineage` (EC1 — the frontend Lineage tab's macro) resolves the
 *      derivative's ancestor.
 *   4. `distributeRoyalties` (economy/royalty-cascade.js) — a real
 *      (simulated) purchase of vex's derivative — proving the royalty
 *      cascade actually pays the real cited ancestor, via `getBalance`
 *      (economy/balances.js), which applies the canonical
 *      `CREDIT_ROW_PREDICATE` per CLAUDE.md's ledger-credit-summing
 *      invariant.
 *
 * REAL GAP FOUND (reported, not papered over): `dtu.create` has TWO
 * different, non-overlapping ways to declare "this DTU has a parent," and a
 * caller who only knows one of them gets only HALF of "lineage" working:
 *
 *   - `input.lineage: [parentId, ...]` — the field the auto-citation block
 *     actually reads (server.js, "Auto-register citation lineage"). This is
 *     what drives the REAL royalty cascade (registerCitation →
 *     royalty_lineage table → distributeRoyalties pays the ancestor). A
 *     derivative created with ONLY this field has fully-working royalties.
 *   - `input.parents: [parentId, ...]` — a SEPARATE field that, if and only
 *     if supplied, sets `dtu.lineage = { parents: input.parents, ... }` on
 *     the in-memory STATE.dtus object (server.js, "Explicit lineage parents
 *     and citation type"). This is the ONLY thing the `dtu.lineage` macro's
 *     one-hop `parents`/`children` arrays (the frontend Lineage tab's
 *     "traversal" view, as opposed to its "royaltyCascade" section) ever
 *     read — because when only `input.lineage` is set, `dtu.lineage` on the
 *     resulting object is a plain ARRAY (not `{parents:[...]}`), so the
 *     macro's `dtu.lineage?.parents` lookup finds nothing.
 *
 * A derivative created the "obvious" way — passing only `lineage` (the name
 * that actually matches the money-moving mechanism) — gets fully-working
 * royalties AND a correctly-populated `royaltyCascade` array from
 * `dtu.lineage`, but an EMPTY `parents` array from that SAME macro call, even
 * though a real ancestor demonstrably exists. This test proves both facts
 * side by side: the royalty math is honest and correct; the one-hop
 * traversal display silently misses it unless the caller ALSO passes the
 * differently-named `parents` field.
 *
 * Run: node --test tests/e2e/dtu-creation-provenance-loop.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime, depthCtx } from "../depth/_harness.js";
import { distributeRoyalties, calculateGenerationalRate } from "../../economy/royalty-cascade.js";
import { getBalance } from "../../economy/balances.js";

let runMacro, STATE, ariaCtx, vexCtx;
let parentDtu, childDtu;

before(async () => {
  const rt = await macroRuntime("dtu-provenance");
  runMacro = rt.runMacro;
  STATE = rt.STATE;
  // Two DIFFERENT stable, owner-scoped ctx's — depthCtx(label) resolves to
  // makeInternalCtx(label), which sets ctx.actor.userId = label directly, so
  // these are genuinely two different authors on the same live server, not
  // two calls from one identity.
  ariaCtx = await depthCtx("e2e_author_aria");
  vexCtx = await depthCtx("e2e_author_vex");
});

describe("Create artifact → DTU E2E loop — Stage 1: authorship + citation", () => {
  it("aria mints a real, public DTU via the production dtu.create macro", async () => {
    const r = await runMacro("dtu", "create", {
      title: "Cold Stance — Fighting Style Recipe",
      source: "user",
      visibility: "public",
      core: { definitions: ["a defensive fighting stance"], claims: ["reduces incoming damage by channeling cold affinity"] },
      human: { summary: "Aria's original cold-affinity defensive stance." },
    }, ariaCtx);
    assert.equal(r.ok, true, `dtu.create must succeed: ${JSON.stringify(r)}`);
    parentDtu = r.dtu;
    assert.equal(parentDtu.ownerId, "e2e_author_aria");
    assert.equal(parentDtu.visibility, "public");
  });

  it("vex mints a real derivative that cites aria's DTU via the standard `lineage` field — auto-citation actually fires", async () => {
    const r = await runMacro("dtu", "create", {
      title: "Dome Buckler — Derivative Stance",
      source: "user",
      visibility: "public",
      lineage: [parentDtu.id],
      core: { definitions: ["a shield-focused derivative of the Cold Stance"], claims: ["adds a buckler parry window"] },
      human: { summary: "Vex's derivative built on Aria's Cold Stance." },
    }, vexCtx);
    assert.equal(r.ok, true, `dtu.create (derivative) must succeed: ${JSON.stringify(r)}`);
    childDtu = r.dtu;
    assert.equal(childDtu.ownerId, "e2e_author_vex");

    // The REAL auto-citation wire: a royalty_lineage row now exists in the
    // live SQL db, written by the SAME economyRegisterCitation() path every
    // other citation in Concord goes through — not seeded by this test.
    const lineageRow = STATE.db.prepare(
      `SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?`
    ).get(childDtu.id, parentDtu.id);
    assert.ok(lineageRow, "dtu.create's auto-citation block must have inserted a real royalty_lineage row");
    assert.equal(lineageRow.generation, 1);
    assert.equal(lineageRow.creator_id, "e2e_author_vex");
    assert.equal(lineageRow.parent_creator, "e2e_author_aria");
  });
});

describe("Create artifact → DTU E2E loop — Stage 2: dtu.lineage (EC1) resolves the ancestor", () => {
  it("royaltyCascade correctly resolves aria as a real gen-1 ancestor with the right rate — via the SAME getAncestorChain the payout path uses", async () => {
    const r = await runMacro("dtu", "lineage", { id: childDtu.id }, vexCtx);
    assert.equal(r.ok, true, `dtu.lineage must succeed: ${JSON.stringify(r)}`);
    assert.equal(r.current.id, childDtu.id);

    assert.equal(r.royaltyCascade.length, 1, "the real ancestor chain must resolve exactly one hop");
    assert.equal(r.royaltyCascade[0].id, parentDtu.id);
    assert.equal(r.royaltyCascade[0].title, parentDtu.title, "resolves the REAL parent title, not a placeholder");
    assert.equal(r.royaltyCascade[0].ownerId, "e2e_author_aria");
    assert.equal(r.royaltyCascade[0].generation, 1);
    assert.equal(r.royaltyCascade[0].royaltyRate, calculateGenerationalRate(1));
  });

  it("GAP CLOSED: the one-hop `parents` array now derives from `input.lineage` alone — dtu.create's split lineage/parents fields no longer silently diverge for the common case", async () => {
    const r = await runMacro("dtu", "lineage", { id: childDtu.id }, vexCtx);
    assert.equal(r.ok, true);
    // Previously this was `[]` even though a real ancestor demonstrably
    // exists (Stage 1 + the royaltyCascade assertion above both prove it) —
    // `dtu.lineage` macro's one-hop `parents` lookup only ever read the
    // separately-named `dtu.lineage.parents` object-shape field, which
    // `input.lineage`-only creation never sets. The fix (server.js, `dtu`
    // `lineage` macro) derives `parentIds` from the plain-array
    // `dtu.lineage` form as a fallback when the object-shape parents list
    // is empty — never mutates the stored DTU, so it can't regress any of
    // the many OTHER server.js call sites that still read `dtu.lineage` as
    // a plain array (mega/hyper consolidation, orphan detection, etc).
    assert.equal(r.parents.length, 1,
      "dtu.lineage's one-hop `parents` array must now populate from `input.lineage` alone, not stay silently empty");
    assert.equal(r.parents[0].id, parentDtu.id);
    assert.equal(r.parents[0].title, parentDtu.title, "resolves the REAL parent title, not a placeholder");
    assert.equal(r.parents[0].ownerId, "e2e_author_aria");
  });

  it("a caller who explicitly supplies BOTH `lineage` AND a DIFFERENT `parents` list keeps them independently — the fallback only fires when the object-shape parents list is empty", async () => {
    const r = await runMacro("dtu", "create", {
      title: "Divergent Lineage Demo — royalty ancestor differs from displayed parent",
      source: "user",
      visibility: "public",
      lineage: [parentDtu.id], // drives the real royalty cascade
      parents: [childDtu.id],  // deliberately a DIFFERENT id for the one-hop display
      core: { definitions: ["a DTU exercising the legitimate lineage/parents divergence case"], claims: ["demonstrates the escape hatch still works"] },
      human: { summary: "Exercises the case where royalty lineage and display parents intentionally differ." },
    }, vexCtx);
    assert.equal(r.ok, true, `dtu.create must succeed: ${JSON.stringify(r)}`);
    const divergentDtu = r.dtu;

    const lin = await runMacro("dtu", "lineage", { id: divergentDtu.id }, vexCtx);
    assert.equal(lin.ok, true);
    // Royalty cascade still resolves the REAL cited ancestor from `lineage`.
    assert.equal(lin.royaltyCascade.length, 1);
    assert.equal(lin.royaltyCascade[0].id, parentDtu.id);
    // The one-hop display honors the EXPLICIT, differently-valued `parents`
    // field verbatim — the fallback derivation never overrides an explicit
    // (even if deliberately divergent) object-shape parents list.
    assert.equal(lin.parents.length, 1);
    assert.equal(lin.parents[0].id, childDtu.id);
  });

  it("the gap has a real, working escape hatch: supplying BOTH `lineage` AND `parents` populates both views correctly", async () => {
    const r = await runMacro("dtu", "create", {
      title: "Dome Buckler II — with explicit parents field",
      source: "user",
      visibility: "public",
      lineage: [parentDtu.id],
      parents: [parentDtu.id], // the second, differently-named field
      core: { definitions: ["a second derivative, this time also setting parents"], claims: ["adds a second, independently-tracked parry variant"] },
      human: { summary: "Vex's second derivative, built the same way but also declaring the explicit parents field." },
    }, vexCtx);
    assert.equal(r.ok, true, `dtu.create must pass the value-scoring gate: ${JSON.stringify(r)}`);
    const dtu2 = r.dtu;

    const lin = await runMacro("dtu", "lineage", { id: dtu2.id }, vexCtx);
    assert.equal(lin.ok, true);
    assert.equal(lin.royaltyCascade.length, 1, "royalty cascade still resolves via input.lineage as before");
    assert.equal(lin.parents.length, 1, "and now the one-hop traversal view ALSO resolves, once `parents` is explicitly passed");
    assert.equal(lin.parents[0].id, parentDtu.id);
    assert.equal(lin.parents[0].title, parentDtu.title);
  });
});

describe("Create artifact → DTU E2E loop — Stage 3: a real (simulated) purchase pays the real ancestor", () => {
  it("distributeRoyalties pays aria the exact gen-1 rate on a real sale of vex's derivative, verified via CREDIT_ROW_PREDICATE-honest getBalance", async () => {
    const before = {
      aria: getBalance(STATE.db, "e2e_author_aria").balance,
      vex: getBalance(STATE.db, "e2e_author_vex").balance,
    };

    const out = distributeRoyalties(STATE.db, {
      contentId: childDtu.id,
      transactionAmount: 300,
      sourceTxId: `e2e-loop2-tx-${childDtu.id}`,
      sellerId: "e2e_author_vex",
      buyerId: "e2e_buyer_1",
    });
    assert.equal(out.ok, true, `distributeRoyalties must succeed: ${JSON.stringify(out)}`);
    assert.equal(out.payouts.length, 1);
    assert.equal(out.payouts[0].recipientId, "e2e_author_aria");
    // gen-1 rate = 0.21/2 = 0.105; 300 * 0.105 = 31.50
    const expectedRoyalty = 300 * calculateGenerationalRate(1);
    assert.equal(out.payouts[0].amount, expectedRoyalty);

    const after = {
      aria: getBalance(STATE.db, "e2e_author_aria").balance,
      vex: getBalance(STATE.db, "e2e_author_vex").balance,
    };

    // Aria's real balance, computed the honest way (getBalance applies
    // CREDIT_ROW_PREDICATE internally) — went up by EXACTLY the royalty.
    assert.equal(Math.round((after.aria - before.aria) * 100) / 100, expectedRoyalty);
    // The royalty is debited from the seller (vex) per the constitutional
    // "seller keeps ≥64.54%" invariant (CLAUDE.md) — distributeRoyalties'
    // ledger row carries from:sellerId — proving this loop's payout isn't a
    // no-cost mint, it's a real transfer out of vex's own proceeds.
    assert.equal(Math.round((after.vex - before.vex) * 100) / 100, -expectedRoyalty);
  });
});
