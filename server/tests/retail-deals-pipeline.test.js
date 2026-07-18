import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/retail.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`retail.${name}`);
  if (!fn) throw new Error(`retail.${name} not registered`);
  return fn(ctx, { id: null, data: params, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

describe("retail — CRM / sales pipeline (deals-*)", () => {
  describe("deals-upsert: create", () => {
    it("requires a name", () => {
      const r = call("deals-upsert", ctxA, {});
      assert.equal(r.ok, false);
    });

    it("rejects an unknown stage", () => {
      const r = call("deals-upsert", ctxA, { name: "Acme deal", stage: "haggling" });
      assert.equal(r.ok, false);
      assert.match(r.error, /unknown stage/);
    });

    it("creates a deal with defaults: stage=lead, probability from the stage default, value 0", () => {
      const r = call("deals-upsert", ctxA, { name: "Acme deal", company: "Acme Co" });
      assert.equal(r.ok, true);
      assert.equal(r.result.deal.stage, "lead");
      assert.equal(r.result.deal.probability, 10);
      assert.equal(r.result.deal.value, 0);
      assert.equal(r.result.deal.company, "Acme Co");
      assert.equal(r.result.deal.stageHistory.length, 1);
      assert.equal(r.result.deal.stageHistory[0].to, "lead");
      assert.equal(r.result.deal.stageHistory[0].from, null);
    });

    it("honors an explicit probability/value/stage at create", () => {
      const r = call("deals-upsert", ctxA, { name: "Big deal", value: 5000, probability: 75, stage: "proposal" });
      assert.equal(r.ok, true);
      assert.equal(r.result.deal.value, 5000);
      assert.equal(r.result.deal.probability, 75);
      assert.equal(r.result.deal.stage, "proposal");
    });

    it("rejects a negative value or an out-of-range probability", () => {
      assert.equal(call("deals-upsert", ctxA, { name: "x", value: -1 }).ok, false);
      assert.equal(call("deals-upsert", ctxA, { name: "x", probability: 150 }).ok, false);
      assert.equal(call("deals-upsert", ctxA, { name: "x", probability: -5 }).ok, false);
    });

    it("creating a deal already in a terminal stage stamps closedAt", () => {
      const r = call("deals-upsert", ctxA, { name: "Fast close", stage: "won" });
      assert.equal(r.ok, true);
      assert.ok(r.result.deal.closedAt);
    });
  });

  describe("deals-upsert: update", () => {
    it("updates non-stage fields in place without touching stageHistory", () => {
      const created = call("deals-upsert", ctxA, { name: "Original", value: 100 }).result.deal;
      const r = call("deals-upsert", ctxA, { id: created.id, name: "Renamed", value: 200, notes: "follow up Friday" });
      assert.equal(r.ok, true);
      assert.equal(r.result.deal.name, "Renamed");
      assert.equal(r.result.deal.value, 200);
      assert.equal(r.result.deal.notes, "follow up Friday");
      assert.equal(r.result.deal.stageHistory.length, 1);
    });

    it("rejects a stage change through deals-upsert — must go through deals-stage-move", () => {
      const created = call("deals-upsert", ctxA, { name: "Original" }).result.deal;
      const r = call("deals-upsert", ctxA, { id: created.id, stage: "won" });
      assert.equal(r.ok, false);
      assert.match(r.error, /deals-stage-move/);
      // Unaffected.
      assert.equal(call("deals-list", ctxA).result.deals[0].stage, "lead");
    });

    it("404s on an unknown id", () => {
      const r = call("deals-upsert", ctxA, { id: "deal_does_not_exist", name: "x" });
      assert.equal(r.ok, false);
    });
  });

  describe("deals-stage-move", () => {
    it("moves through the open funnel and appends an auditable stageHistory entry", () => {
      const created = call("deals-upsert", ctxA, { name: "Funnel deal" }).result.deal;
      const r = call("deals-stage-move", ctxA, { id: created.id, stage: "contacted", note: "left voicemail" });
      assert.equal(r.ok, true);
      assert.equal(r.result.deal.stage, "contacted");
      assert.equal(r.result.deal.stageHistory.length, 2);
      assert.equal(r.result.deal.stageHistory[1].from, "lead");
      assert.equal(r.result.deal.stageHistory[1].to, "contacted");
      assert.equal(r.result.deal.stageHistory[1].note, "left voicemail");
    });

    it("rejects moving to the same stage", () => {
      const created = call("deals-upsert", ctxA, { name: "x" }).result.deal;
      const r = call("deals-stage-move", ctxA, { id: created.id, stage: "lead" });
      assert.equal(r.ok, false);
    });

    it("rejects an unknown stage or an unknown deal id", () => {
      const created = call("deals-upsert", ctxA, { name: "x" }).result.deal;
      assert.equal(call("deals-stage-move", ctxA, { id: created.id, stage: "haggling" }).ok, false);
      assert.equal(call("deals-stage-move", ctxA, { id: "deal_missing", stage: "won" }).ok, false);
    });

    it("closing to won forces probability=100 and stamps closedAt", () => {
      const created = call("deals-upsert", ctxA, { name: "x", probability: 30 }).result.deal;
      const r = call("deals-stage-move", ctxA, { id: created.id, stage: "won" });
      assert.equal(r.ok, true);
      assert.equal(r.result.deal.probability, 100);
      assert.ok(r.result.deal.closedAt);
    });

    it("closing to lost forces probability=0 and stamps closedAt", () => {
      const created = call("deals-upsert", ctxA, { name: "x", probability: 60 }).result.deal;
      const r = call("deals-stage-move", ctxA, { id: created.id, stage: "lost" });
      assert.equal(r.ok, true);
      assert.equal(r.result.deal.probability, 0);
      assert.ok(r.result.deal.closedAt);
    });

    it("a closed deal cannot move without reopen:true", () => {
      const created = call("deals-upsert", ctxA, { name: "x" }).result.deal;
      call("deals-stage-move", ctxA, { id: created.id, stage: "won" });
      const r = call("deals-stage-move", ctxA, { id: created.id, stage: "lead" });
      assert.equal(r.ok, false);
      assert.match(r.error, /reopen/);
    });

    it("reopen:true moves a closed deal back into an OPEN stage, clears closedAt, and marks the history entry reopened", () => {
      const created = call("deals-upsert", ctxA, { name: "x" }).result.deal;
      call("deals-stage-move", ctxA, { id: created.id, stage: "won" });
      const r = call("deals-stage-move", ctxA, { id: created.id, stage: "negotiation", reopen: true });
      assert.equal(r.ok, true);
      assert.equal(r.result.deal.stage, "negotiation");
      assert.equal(r.result.deal.closedAt, null);
      assert.equal(r.result.deal.stageHistory.at(-1).reopened, true);
    });

    it("won cannot reopen directly into lost (or vice versa) — must reopen into an open stage first", () => {
      const created = call("deals-upsert", ctxA, { name: "x" }).result.deal;
      call("deals-stage-move", ctxA, { id: created.id, stage: "won" });
      const r = call("deals-stage-move", ctxA, { id: created.id, stage: "lost", reopen: true });
      assert.equal(r.ok, false);
    });
  });

  describe("deals-list: rollups", () => {
    it("computes exact total/weighted pipeline value from known inputs", () => {
      call("deals-upsert", ctxA, { name: "A", value: 1000, probability: 50, stage: "proposal" });
      call("deals-upsert", ctxA, { name: "B", value: 2000, probability: 25, stage: "lead" });
      const r = call("deals-list", ctxA);
      assert.equal(r.ok, true);
      // 1000*0.5 + 2000*0.25 = 500 + 500 = 1000
      assert.equal(r.result.rollup.totalPipelineValue, 3000);
      assert.equal(r.result.rollup.weightedPipelineValue, 1000);
      assert.equal(r.result.rollup.openCount, 2);
    });

    it("won/lost deals are excluded from open pipeline totals but tracked separately", () => {
      call("deals-upsert", ctxA, { name: "Open", value: 1000, probability: 50, stage: "proposal" });
      const closed = call("deals-upsert", ctxA, { name: "ToClose", value: 500 }).result.deal;
      call("deals-stage-move", ctxA, { id: closed.id, stage: "won" });
      const r = call("deals-list", ctxA);
      assert.equal(r.result.rollup.totalPipelineValue, 1000);
      assert.equal(r.result.rollup.wonValue, 500);
      assert.equal(r.result.rollup.wonCount, 1);
    });

    it("filters by stage without changing the (full-book) rollup numbers", () => {
      call("deals-upsert", ctxA, { name: "A", stage: "lead", value: 100 });
      call("deals-upsert", ctxA, { name: "B", stage: "proposal", value: 200 });
      const filtered = call("deals-list", ctxA, { stage: "lead" });
      assert.equal(filtered.result.deals.length, 1);
      assert.equal(filtered.result.deals[0].name, "A");
      // Rollup still reflects the FULL book, not the filtered view.
      assert.equal(filtered.result.rollup.totalDeals, 2);
    });

    it("rejects an unknown stage filter", () => {
      const r = call("deals-list", ctxA, { stage: "nope" });
      assert.equal(r.ok, false);
    });
  });

  describe("deals-delete", () => {
    it("deletes and 404s a second time", () => {
      const created = call("deals-upsert", ctxA, { name: "x" }).result.deal;
      assert.equal(call("deals-delete", ctxA, { id: created.id }).ok, true);
      assert.equal(call("deals-delete", ctxA, { id: created.id }).ok, false);
      assert.equal(call("deals-list", ctxA).result.deals.length, 0);
    });
  });

  describe("INVARIANT: per-user isolation", () => {
    it("user B never sees user A's deals, and cannot move/delete them", () => {
      const created = call("deals-upsert", ctxA, { name: "A-only" }).result.deal;
      assert.equal(call("deals-list", ctxB).result.deals.length, 0);
      assert.equal(call("deals-stage-move", ctxB, { id: created.id, stage: "contacted" }).ok, false);
      assert.equal(call("deals-delete", ctxB, { id: created.id }).ok, false);
      // Untouched from A's side.
      assert.equal(call("deals-list", ctxA).result.deals[0].stage, "lead");
    });
  });

  describe("degrade-graceful when STATE is unavailable", () => {
    it("every deals-* macro fails soft with {ok:false}, never throws", () => {
      const saved = globalThis._concordSTATE;
      globalThis._concordSTATE = undefined;
      assert.equal(call("deals-list", ctxA).ok, false);
      assert.equal(call("deals-upsert", ctxA, { name: "x" }).ok, false);
      assert.equal(call("deals-stage-move", ctxA, { id: "x", stage: "won" }).ok, false);
      assert.equal(call("deals-delete", ctxA, { id: "x" }).ok, false);
      globalThis._concordSTATE = saved;
    });
  });

  describe("pipelineValue relationship: falls back to persisted deals only when no book is pasted", () => {
    it("no deals/opportunities key at all → reads the real persisted deals-* book", () => {
      call("deals-upsert", ctxA, { name: "Persisted deal", value: 400, probability: 50, stage: "proposal" });
      const r = call("pipelineValue", ctxA, {});
      assert.equal(r.ok, true);
      assert.equal(r.result.dealSource, "persisted");
      assert.equal(r.result.totalDeals, 1);
      assert.equal(r.result.totalUnweighted, 400);
    });

    it("an explicit (even garbage/malformed) deals key is honored as 'pasted' and does NOT read persisted deals — exact pre-existing contract", () => {
      call("deals-upsert", ctxA, { name: "Persisted deal", value: 999999 });
      const r = call("pipelineValue", ctxA, { deals: { boom: true } });
      assert.equal(r.ok, true);
      assert.equal(r.result.dealSource, "pasted");
      assert.equal(r.result.totalDeals, 0);
      assert.equal(r.result.totalWeighted, 0);
    });

    it("a real pasted array (even empty) is honored as 'pasted' and does NOT read persisted deals", () => {
      call("deals-upsert", ctxA, { name: "Persisted deal", value: 999999 });
      const r = call("pipelineValue", ctxA, { deals: [] });
      assert.equal(r.ok, true);
      assert.equal(r.result.dealSource, "pasted");
      assert.equal(r.result.totalDeals, 0);
    });

    it("pipelineValue's persisted-fallback weighted math matches deals-list's rollup exactly", () => {
      call("deals-upsert", ctxA, { name: "A", value: 1000, probability: 50, stage: "proposal" });
      call("deals-upsert", ctxA, { name: "B", value: 2000, probability: 25, stage: "lead" });
      const list = call("deals-list", ctxA);
      const pv = call("pipelineValue", ctxA, {});
      assert.equal(pv.result.dealSource, "persisted");
      assert.equal(pv.result.totalUnweighted, list.result.rollup.totalPipelineValue);
      assert.equal(pv.result.totalWeighted, list.result.rollup.weightedPipelineValue);
    });
  });
});
