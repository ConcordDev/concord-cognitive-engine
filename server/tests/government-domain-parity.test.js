import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGovernmentActions from "../domains/government.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`government.${name}`);
  assert.ok(fn, `government.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerGovernmentActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("government.representatives-find (api.congress.gov live)", () => {
  it("requires CONGRESS_GOV_API_KEY env var", async () => {
    delete process.env.CONGRESS_GOV_API_KEY;
    const r = await call("representatives-find", ctxA, { state: "CA" });
    assert.equal(r.ok, false);
    assert.match(r.error, /CONGRESS_GOV_API_KEY/);
  });

  it("requires 2-letter state code", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";
    const r = await call("representatives-find", ctxA, { state: "" });
    assert.equal(r.ok, false);
    assert.match(r.error, /state required as 2-letter code/);
  });

  it("parses Congress.gov response shape", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";
    globalThis.fetch = async (url) => {
      assert.match(url, /api\.congress\.gov/);
      assert.match(url, /stateCode=CA/);
      assert.match(url, /api_key=test-key/);
      return {
        ok: true,
        json: async () => ({
          members: [
            {
              bioguideId: "P000197", name: "Pelosi, Nancy", firstName: "Nancy", lastName: "Pelosi",
              partyName: "Democratic", state: "CA", district: 11,
              terms: { item: [{ chamber: "House of Representatives", startYear: 2023, endYear: 2025 }] },
              depiction: { imageUrl: "https://example.com/p.jpg" },
              url: "https://api.congress.gov/v3/member/P000197",
            },
          ],
          pagination: { count: 1 },
        }),
      };
    };
    const r = await call("representatives-find", ctxA, { state: "CA" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "api.congress.gov (current Congress)");
    assert.equal(r.result.representatives.length, 1);
    assert.equal(r.result.representatives[0].party, "D");
    assert.equal(r.result.representatives[0].office, "U.S. House");
    assert.equal(r.result.representatives[0].district, "11");
  });
});

describe("government.bills-list (api.congress.gov live)", () => {
  it("requires CONGRESS_GOV_API_KEY env var", async () => {
    delete process.env.CONGRESS_GOV_API_KEY;
    const r = await call("bills-list", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /CONGRESS_GOV_API_KEY/);
  });

  it("parses Congress.gov bill response", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";
    globalThis.fetch = async (url) => {
      assert.match(url, /v3\/bill\/119/);
      return {
        ok: true,
        json: async () => ({
          bills: [
            {
              type: "HR", number: 1234, congress: 119,
              title: "American Climate Resilience Act of 2026",
              introducedDate: "2026-02-14",
              latestAction: { text: "Reported by Committee on Energy and Commerce", actionDate: "2026-04-22" },
              originChamber: "House",
              url: "https://api.congress.gov/v3/bill/119/hr/1234",
            },
          ],
          pagination: { count: 1 },
        }),
      };
    };
    const r = await call("bills-list", ctxA, { limit: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.bills.length, 1);
    assert.equal(r.result.bills[0].billId, "HR1234-119");
    assert.match(r.result.bills[0].title, /Climate Resilience/);
  });

  it("topic filter applied after fetch (substring match on title)", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        bills: [
          { type: "HR", number: 1, congress: 119, title: "Climate Act" },
          { type: "S",  number: 2, congress: 119, title: "AI Accountability" },
        ],
      }),
    });
    const r = await call("bills-list", ctxA, { topic: "climate" });
    assert.equal(r.result.bills.length, 1);
    assert.match(r.result.bills[0].title, /Climate/);
  });
});

describe("government.alerts-current", () => {
  it("rejects missing coords", async () => {
    assert.equal((await call("alerts-current", ctxA, {})).ok, false);
  });

  it("graceful fallback when NWS unreachable", async () => {
    const r = await call("alerts-current", ctxA, { lat: 37.77, lng: -122.42 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.alerts, []);
    assert.equal(r.result.source, "fallback");
  });
});

describe("government.foia-list / -create", () => {
  it("create + list scoped per user", () => {
    const r = call("foia-create", ctxA, { agency: "FBI", subject: "Test request", body: "Body here" });
    assert.equal(r.ok, true);
    assert.equal(r.result.request.status, "draft");
    const list = call("foia-list", ctxA, {});
    assert.equal(list.result.requests.length, 1);
    assert.equal(call("foia-list", ctxB, {}).result.requests.length, 0);
  });

  it("rejects missing fields", () => {
    assert.equal(call("foia-create", ctxA, { agency: "FBI", subject: "x" }).ok, false);
    assert.equal(call("foia-create", ctxA, { agency: "", subject: "x", body: "y" }).ok, false);
  });
});

describe("government.budget-breakdown", () => {
  it("federal scope returns categories summing to total within 1%", () => {
    const r = call("budget-breakdown", ctxA, { scope: "federal", year: 2026 });
    assert.equal(r.ok, true);
    assert.ok(r.result.totalBillions > 0);
    const sumPct = r.result.categories.reduce((s, c) => s + c.pctOfTotal, 0);
    assert.ok(Math.abs(sumPct - 100) < 2, `category pcts should sum near 100, got ${sumPct}`);
  });

  it("state scope returns different totals than federal", () => {
    const fed = call("budget-breakdown", ctxA, { scope: "federal" });
    const st = call("budget-breakdown", ctxA, { scope: "state" });
    assert.ok(fed.result.totalBillions > st.result.totalBillions);
  });

  it("local scope returns valid categories", () => {
    const r = call("budget-breakdown", ctxA, { scope: "local" });
    assert.ok(r.result.categories.length >= 5);
    assert.ok(r.result.categories.every(c => c.amountBillions > 0));
  });

  it("clamps year", () => {
    const r1 = call("budget-breakdown", ctxA, { scope: "federal", year: 2050 });
    assert.equal(r1.result.year, 2030);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("permitTimeline computes on-time", () => {
    const r = ACTIONS.get("government.permitTimeline")(ctxA, { id: "p1", data: { applicationDate: "2026-04-01", approvalDate: "2026-04-15", type: "building" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.processingDays, 14);
    assert.equal(r.result.onTime, true);
  });
});
