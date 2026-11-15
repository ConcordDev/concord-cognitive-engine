import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAccounting from "../domains/accounting.js";
import registerFitness from "../domains/fitness.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(key, userId, params) {
  return ACTIONS.get(key)(
    { actor: { userId } },
    { id: null, data: {}, meta: {} },
    params,
  );
}
before(() => {
  registerAccounting(register);
  registerFitness(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("accounting ratios use the P&L year", () => {
  it("counts this year's revenue and skips last year's", () => {
    const coa = call("accounting.coa-list", "user_a", {});
    const sales = coa.result.accounts.find((a) => a.code === "4000");
    const cash = coa.result.accounts.find((a) => a.code === "1000");
    assert.ok(sales && cash);
    const year = new Date().getFullYear();
    const post = (date, amount) => call("accounting.je-post", "user_a", {
      date,
      lines: [
        { accountId: cash.id, debit: amount, credit: 0 },
        { accountId: sales.id, debit: 0, credit: amount },
      ],
    });
    assert.equal(post(`${year - 1}-06-01`, 5).ok, true);
    assert.equal(post(`${year}-06-01`, 1).ok, true);
    const pl = call("accounting.pl-compute", "user_a", {});
    const ratios = call("accounting.financial-ratios", "user_a", {});
    assert.equal(pl.result.revenue.total, 1);
    assert.equal(ratios.result.totals.revenue, 1);
    assert.equal(ratios.result.period.start, `${year}-01-01`);
  });
});

describe("fitness owner delete", () => {
  it("drops an empty club when its creator leaves, and lets the owner delete a segment", () => {
    const club = call("fitness.club-create", "user_a", { name: "Dawn runners" });
    const id = club.result.club.id;
    const left = call("fitness.club-join", "user_a", { id, leave: true });
    assert.equal(left.result.deleted, true);
    assert.equal(call("fitness.club-list", "user_a", {}).result.clubs.length, 0);

    const seg = call("fitness.segment-create", "user_a", { name: "Hill", distanceKm: 1 });
    const segId = seg.result.segment.id;
    assert.equal(call("fitness.segment-delete", "user_b", { id: segId }).ok, false);
    assert.equal(call("fitness.segment-delete", "user_a", { id: segId }).ok, true);
    assert.equal(call("fitness.segment-list", "user_a", {}).result.count, 0);
  });
});
