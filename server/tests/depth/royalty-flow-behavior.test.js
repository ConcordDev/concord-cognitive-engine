// tests/depth/royalty-flow-behavior.test.js — REAL behavioral tests for the
// `economy.royaltyFlow` macro (EC2), the real-money counterpart to
// `computeCascadeTree`'s projection: actual historical ROYALTY_PAYOUT ledger
// rows (lineage -> earner -> CC), composed from
//   1. economy_ledger ROYALTY_PAYOUT rows (filtered via the canonical
//      CREDIT_ROW_PREDICATE, economy/balances.js), and
//   2. getAncestorChain() (economy/royalty-cascade.js) — the SAME function
//      the real payout path and the EC1 dtu.lineage macro use.
//
// This test seeds REAL rows directly (royalty_lineage + economy_ledger) — no
// mock data, no reimplemented math — and asserts the macro's numbers are an
// exact, independently-computed sum of what was inserted (no drift from the
// real cascade math).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";
import { computeRoyaltyFlow } from "../../lib/creator-dashboard.js";

let runMacro, STATE, ctx;
let creatorId, dtuA, dtuB; // dtuA = the ancestor that earns royalties; dtuB = its (unsold) derivative

before(async () => {
  ({ runMacro, STATE, ctx } = await macroRuntime("royalty-flow"));
  creatorId = ctx.actor.userId;

  // Real DTU rows (STATE.dtus) so contentTitle lookups resolve to a real
  // title, exactly like the EC1 dtu.lineage macro's _dtuLineageRef helper.
  const a = await runMacro("dtu", "create", {
    title: "Royalty Flow Probe — Ancestor Work",
    source: "user",
    core: { definitions: ["ancestor work"], claims: ["a real claim body"] },
    human: { summary: "the earning ancestor DTU" },
  }, ctx);
  assert.equal(a.ok, true, `dtu.create (ancestor) should succeed: ${JSON.stringify(a)}`);
  dtuA = a.dtu;

  const b = await runMacro("dtu", "create", {
    title: "Royalty Flow Probe — Unsold Derivative",
    source: "user",
    core: { definitions: ["derivative work"], claims: ["a real claim body"] },
    human: { summary: "a derivative that cites dtuA but has never sold" },
  }, ctx);
  assert.equal(b.ok, true, `dtu.create (derivative) should succeed: ${JSON.stringify(b)}`);
  dtuB = b.dtu;

  const db = STATE.db;

  // Real royalty_lineage row: dtuB cites dtuA at generation 1. This is what
  // getAncestorChain(db, dtuB.id) walks — the SAME table registerCitation()
  // writes to and distributeRoyalties() reads from.
  db.prepare(`
    INSERT INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("rf-lin-1", dtuB.id, dtuA.id, 1, creatorId, creatorId, "2026-07-01 00:00:00");

  // Real economy_ledger ROYALTY_PAYOUT rows crediting the creator. These are
  // single-sided credits (from=buyer/seller, to=recipient) — the exact shape
  // distributeRoyalties() inserts, written directly here so the test seeds
  // the ledger itself rather than round-tripping a full marketplace purchase.
  const insertPayout = db.prepare(`
    INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, metadata_json, created_at)
    VALUES (?, 'ROYALTY_PAYOUT', ?, ?, ?, 0, ?, 'complete', ?, ?)
  `);
  // Generation 1 payout: rate 0.21, amount 21.00, from a real sale of a
  // (different, unmodeled) descendant of dtuA.
  insertPayout.run(
    "rf-pay-1", "buyer1", creatorId, 21.00, 21.00,
    JSON.stringify({ contentId: dtuA.id, generation: 1, rate: 0.21, sourceTxId: "tx-1", crossWorldHop: false }),
    "2026-07-02 00:00:00",
  );
  // Generation 2 payout: rate halved to 0.105, amount 10.50, from a
  // different sale.
  insertPayout.run(
    "rf-pay-2", "buyer2", creatorId, 10.50, 10.50,
    JSON.stringify({ contentId: dtuA.id, generation: 2, rate: 0.105, sourceTxId: "tx-2", crossWorldHop: false }),
    "2026-07-03 00:00:00",
  );
  // A payout with malformed metadata — must not crash the query, must still
  // count toward totalCC (it IS a real credited ROYALTY_PAYOUT row), but
  // renders honest nulls for generation/rate/contentId/contentTitle rather
  // than guessing.
  insertPayout.run(
    "rf-pay-3", "buyer3", creatorId, 5.00, 5.00,
    "not valid json{{",
    "2026-07-04 00:00:00",
  );

  // A same-type row credited to a DIFFERENT user — must never leak into
  // creatorId's flow card.
  insertPayout.run(
    "rf-pay-other", "buyer4", "someone-else", 999.00, 999.00,
    JSON.stringify({ contentId: dtuA.id, generation: 1, rate: 0.21, sourceTxId: "tx-3" }),
    "2026-07-05 00:00:00",
  );
});

describe("economy.royaltyFlow — user-scoped real earnings", () => {
  it("sums exactly the real ROYALTY_PAYOUT rows credited to this user (no drift, no double-count, no leak)", async () => {
    const r = await runMacro("economy", "royaltyFlow", { userId: creatorId }, ctx);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.userId, creatorId);
    assert.equal(r.dtuId, null);

    // Exactly the 3 rows credited to creatorId — NOT the 4th (someone-else).
    assert.equal(r.hopCount, 3);
    // Independently computed from the raw seeded amounts: 21 + 10.5 + 5 = 36.5
    assert.equal(r.totalCC, 36.5);

    // byGeneration aggregation: gen 1 = 21, gen 2 = 10.5, "unknown" (malformed
    // metadata row) = 5.
    assert.equal(r.byGeneration["1"], 21);
    assert.equal(r.byGeneration["2"], 10.5);
    assert.equal(r.byGeneration["unknown"], 5);

    // Newest-first ordering (created_at DESC): rf-pay-3, rf-pay-2, rf-pay-1.
    assert.deepEqual(r.hops.map((h) => h.ledgerId), ["rf-pay-3", "rf-pay-2", "rf-pay-1"]);

    const gen1 = r.hops.find((h) => h.ledgerId === "rf-pay-1");
    assert.equal(gen1.contentId, dtuA.id);
    assert.equal(gen1.contentTitle, dtuA.title, "resolves the real DTU title, not a placeholder");
    assert.equal(gen1.generation, 1);
    assert.equal(gen1.royaltyRate, 0.21);
    assert.equal(gen1.royaltyPercent, "21.00%");
    assert.equal(gen1.amount, 21);
    assert.equal(gen1.fromUserId, "buyer1");
    assert.equal(gen1.toUserId, creatorId);
    assert.equal(gen1.sourceTxId, "tx-1");

    const gen2 = r.hops.find((h) => h.ledgerId === "rf-pay-2");
    assert.equal(gen2.generation, 2);
    assert.equal(gen2.royaltyRate, 0.105);
    assert.equal(gen2.amount, 10.5);

    // Malformed-metadata row: honest nulls, but the real credited amount
    // still counts (it's a genuine complete ledger credit).
    const malformed = r.hops.find((h) => h.ledgerId === "rf-pay-3");
    assert.equal(malformed.contentId, null);
    assert.equal(malformed.contentTitle, null);
    assert.equal(malformed.generation, null);
    assert.equal(malformed.royaltyRate, null);
    assert.equal(malformed.amount, 5);

    // No leak: the 999-amount row credited to "someone-else" must not appear.
    assert.ok(!r.hops.some((h) => h.ledgerId === "rf-pay-other"));
  });

  it("honest empty state: a user with zero royalty history gets ok:true and zeroed totals, not an error", async () => {
    const r = await runMacro("economy", "royaltyFlow", { userId: "nobody-has-ever-earned-anything" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.hopCount, 0);
    assert.equal(r.totalCC, 0);
    assert.deepEqual(r.hops, []);
    assert.deepEqual(r.byGeneration, {});
  });

  it("rejects a call with neither userId nor dtuId — never silently returns a fabricated empty card", () => {
    // The macro itself defaults userId to the caller when no dtuId is given
    // (the "my own dashboard" convenience default — see server.js), so this
    // pure-guard contract is checked directly against the underlying
    // function, which has no such caller-identity fallback to hide behind.
    const r = computeRoyaltyFlow(STATE.db, STATE, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "user_or_dtu_required");
  });
});

describe("economy.royaltyFlow — DTU-scoped view (real ancestor chain + real earnings)", () => {
  it("scoping to the earning DTU filters hops to just its own real payouts, across ALL earners (not just the caller)", async () => {
    const r = await runMacro("economy", "royaltyFlow", { dtuId: dtuA.id }, ctx);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.dtuId, dtuA.id);
    // Every row whose ledger metadata.contentId === dtuA.id, regardless of
    // which user received it (dtu-scoped, not narrowed to the calling
    // user) — rf-pay-1/2 (creatorId) + rf-pay-other (someone-else) all
    // name dtuA as the earning ancestor. rf-pay-3's metadata is malformed
    // (contentId resolves to null), so it correctly does NOT match a
    // dtuId scope — that row only ever surfaces in the user-scoped view.
    assert.equal(r.hopCount, 3);
    assert.equal(r.totalCC, 1030.5); // 21 + 10.5 + 999
    assert.ok(r.hops.some((h) => h.toUserId === "someone-else"), "dtu-scope is not narrowed to the calling user");
  });

  it("a DTU with a real ancestor but zero sales of its own gets an honest empty hops + a real, non-empty lineage", async () => {
    const r = await runMacro("economy", "royaltyFlow", { dtuId: dtuB.id }, ctx);
    assert.equal(r.ok, true, JSON.stringify(r));
    // dtuB has never itself been sold — no ledger rows carry contentId===dtuB.id.
    assert.equal(r.hopCount, 0);
    assert.equal(r.totalCC, 0);
    assert.deepEqual(r.hops, []);

    // But the REAL ancestor chain (via getAncestorChain, the same function
    // the payout path uses) shows dtuA as a generation-1 ancestor with its
    // real rate — proving the lineage structure is real even though no
    // money has flowed for THIS specific DTU yet.
    assert.equal(r.lineage.length, 1);
    assert.equal(r.lineage[0].contentId, dtuA.id);
    assert.equal(r.lineage[0].contentTitle, dtuA.title);
    assert.equal(r.lineage[0].generation, 1);
    // calculateGenerationalRate(1, 0.21) === 0.105 — same formula
    // getAncestorChain always applies; not reimplemented here.
    assert.equal(r.lineage[0].royaltyRate, 0.105);
    assert.equal(r.lineage[0].royaltyPercent, "10.50%");
  });
});
