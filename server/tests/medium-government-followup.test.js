import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerGovernment from "../domains/government.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(name, params) {
  return actions.get(`government.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerGovernment(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});
afterEach(() => { delete globalThis.fetch; });

describe("government spending falls back a period", () => {
  it("reads the previous closed period when the requested one is not published", async () => {
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      if (calls === 1) {
        assert.equal(body.filters.fy, "2026");
        return { ok: false, status: 400, json: async () => ({ detail: "Fiscal parameters provided do not belong to a current submission period" }) };
      }
      assert.ok(body.filters.period === "11" || body.filters.fy === "2025");
      return { ok: true, json: async () => ({ results: [{ name: "Defense", amount: 2e9 }] }) };
    };
    const r = await call("budget-breakdown", { scope: "federal", year: 2026 });
    assert.equal(r.ok, true);
    assert.equal(calls, 2);
    assert.match(r.result.note, /not published yet/);
    assert.equal(r.result.categories[0].name, "Defense");
  });
});
