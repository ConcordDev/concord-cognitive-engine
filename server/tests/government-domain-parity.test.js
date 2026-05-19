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

describe("government.budget-breakdown (real USAspending.gov)", () => {
  it("federal scope fetches USAspending.gov and shapes categories", async () => {
    globalThis.fetch = async (url, opts) => {
      assert.match(url, /api\.usaspending\.gov\/api\/v2\/spending/);
      const body = JSON.parse(opts.body);
      assert.equal(body.type, "budget_function");
      assert.equal(body.filters.fy, "2026");
      return {
        ok: true,
        json: async () => ({
          results: [
            { name: "Social Security", amount: 1.42e12 },
            { name: "Medicare", amount: 8.7e11 },
            { name: "National Defense", amount: 9.2e11 },
          ],
        }),
      };
    };
    const r = await call("budget-breakdown", ctxA, { scope: "federal", year: 2026 });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "usaspending.gov");
    assert.ok(r.result.totalBillions > 0);
    assert.equal(r.result.categories[0].name, "Social Security");
    const sumPct = r.result.categories.reduce((s, c) => s + c.pctOfTotal, 0);
    assert.ok(Math.abs(sumPct - 100) < 2);
  });

  it("federal scope returns error when USAspending unreachable", async () => {
    globalThis.fetch = async () => { throw new Error("network down"); };
    const r = await call("budget-breakdown", ctxA, { scope: "federal", year: 2026 });
    assert.equal(r.ok, false);
    assert.match(r.error, /usaspending unreachable/);
  });

  it("state scope returns error pointing to state open-data portal (no hardcoded table)", async () => {
    const r = await call("budget-breakdown", ctxA, { scope: "state" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not centrally aggregated|open-data portal/);
  });

  it("local scope returns error pointing to OpenGov / Tyler Civic", async () => {
    const r = await call("budget-breakdown", ctxA, { scope: "local" });
    assert.equal(r.ok, false);
    assert.match(r.error, /OpenGov|Tyler/);
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

// ── Full-app parity (SeeClickFix 311 + Accela Civic 2026) ──────

describe("government.departments-*", () => {
  it("add / list / delete cycle per-user scoped", () => {
    const d = call("departments-add", ctxA, { name: "Public Works", shortCode: "dpw", categories: ["pothole", "streetlight_out"] });
    assert.equal(d.ok, true);
    assert.equal(d.result.department.shortCode, "DPW");
    assert.equal(call("departments-list", ctxA, {}).result.departments.length, 1);
    assert.equal(call("departments-list", ctxB, {}).result.departments.length, 0);
    assert.equal(call("departments-delete", ctxA, { id: d.result.department.id }).ok, true);
  });
  it("rejects empty name", () => {
    assert.equal(call("departments-add", ctxA, { name: "" }).ok, false);
  });
});

describe("government.service-requests-* (311)", () => {
  it("create / assign / update-status cycle with reference number", () => {
    const d = call("departments-add", ctxA, { name: "DPW", shortCode: "dpw" });
    const r = call("service-requests-create", ctxA, { category: "pothole", description: "Big hole on Main St", lat: 42.36, lng: -71.05, reporterName: "Citizen A", reporterEmail: "a@x" });
    assert.equal(r.ok, true);
    assert.match(r.result.request.referenceNumber, /^SR-/);
    assert.equal(r.result.request.status, "submitted");
    const assigned = call("service-requests-assign", ctxA, { id: r.result.request.id, departmentId: d.result.department.id });
    assert.equal(assigned.result.request.status, "assigned");
    assert.equal(assigned.result.request.assignedDepartmentName, "DPW");
    const closed = call("service-requests-update-status", ctxA, { id: r.result.request.id, status: "closed_resolved", note: "Patched 2026-05-05" });
    assert.equal(closed.result.request.status, "closed_resolved");
    assert.ok(closed.result.request.closedAt);
  });
  it("rejects invalid category and missing lat/lng", () => {
    assert.equal(call("service-requests-create", ctxA, { category: "ufo_sighting", description: "X", lat: 1, lng: 1 }).ok, false);
    assert.equal(call("service-requests-create", ctxA, { category: "pothole", description: "X" }).ok, false);
  });
  it("filters by status and category", () => {
    call("service-requests-create", ctxA, { category: "pothole", description: "A", lat: 1, lng: 1 });
    call("service-requests-create", ctxA, { category: "streetlight_out", description: "B", lat: 1, lng: 1 });
    assert.equal(call("service-requests-list", ctxA, { category: "pothole" }).result.requests.length, 1);
  });
});

describe("government.routing-rules-* (auto-assign by category)", () => {
  it("rule auto-assigns on create", () => {
    const dpw = call("departments-add", ctxA, { name: "DPW", shortCode: "dpw" });
    call("routing-rules-set", ctxA, { category: "pothole", departmentId: dpw.result.department.id });
    const r = call("service-requests-create", ctxA, { category: "pothole", description: "X", lat: 1, lng: 1 });
    assert.equal(r.result.request.status, "assigned");
    assert.equal(r.result.request.assignedDepartmentId, dpw.result.department.id);
  });
  it("rejects bad category / unknown dept", () => {
    assert.equal(call("routing-rules-set", ctxA, { category: "ufo", departmentId: "x" }).ok, false);
    assert.equal(call("routing-rules-set", ctxA, { category: "pothole", departmentId: "nope" }).ok, false);
  });
});

describe("government.permits-* (Accela-shape lifecycle)", () => {
  it("apply / pay / approve / issue cycle", () => {
    const p = call("permits-apply", ctxA, { applicantName: "Bob Builder", applicantEmail: "b@x", kind: "building_residential", description: "Add deck", feeUsd: 250 });
    assert.equal(p.ok, true);
    assert.match(p.result.permit.recordNumber, /^PMT-/);
    assert.equal(p.result.permit.status, "applied");
    const paid = call("permits-pay-fee", ctxA, { id: p.result.permit.id });
    assert.equal(paid.result.permit.status, "under_review");
    const approved = call("permits-approve", ctxA, { id: p.result.permit.id });
    assert.equal(approved.result.permit.status, "approved");
    const issued = call("permits-issue", ctxA, { id: p.result.permit.id, validForDays: 180 });
    assert.equal(issued.result.permit.status, "issued");
    assert.ok(issued.result.permit.expiresAt);
  });
  it("approve before payment rejected", () => {
    const p = call("permits-apply", ctxA, { applicantName: "X", applicantEmail: "x@x", kind: "fence" });
    assert.equal(call("permits-approve", ctxA, { id: p.result.permit.id }).ok, false);
  });
  it("deny captures reason", () => {
    const p = call("permits-apply", ctxA, { applicantName: "X", applicantEmail: "x@x", kind: "fence" });
    const denied = call("permits-deny", ctxA, { id: p.result.permit.id, reason: "Wrong zone" });
    assert.equal(denied.result.permit.status, "denied");
    assert.equal(denied.result.permit.denialReason, "Wrong zone");
  });
});

describe("government.inspections-* (linked to permits)", () => {
  it("schedule + complete with result", () => {
    const p = call("permits-apply", ctxA, { applicantName: "X", applicantEmail: "x@x", kind: "building" });
    const i = call("inspections-schedule", ctxA, { permitId: p.result.permit.id, kind: "framing", date: "2026-06-01", inspectorName: "Insp1" });
    assert.equal(i.ok, true);
    const done = call("inspections-complete", ctxA, { id: i.result.inspection.id, result: "pass", notes: "OK" });
    assert.equal(done.result.inspection.result, "pass");
  });
  it("rejects bad result", () => {
    const p = call("permits-apply", ctxA, { applicantName: "X", applicantEmail: "x@x", kind: "building" });
    const i = call("inspections-schedule", ctxA, { permitId: p.result.permit.id, kind: "final", date: "2026-06-01" });
    assert.equal(call("inspections-complete", ctxA, { id: i.result.inspection.id, result: "maybe" }).ok, false);
  });
});

describe("government.assets-* (street infrastructure)", () => {
  it("add / list / log-maintenance / delete cycle", () => {
    const a = call("assets-add", ctxA, { kind: "streetlight", label: "SL-001 Main & Elm", lat: 42.36, lng: -71.05 });
    assert.equal(a.ok, true);
    assert.equal(a.result.asset.condition, "good");
    const log = call("assets-log-maintenance", ctxA, { id: a.result.asset.id, work: "Replaced bulb", crew: "DPW-3", condition: "good" });
    assert.equal(log.result.asset.maintenanceLog.length, 1);
    assert.ok(log.result.asset.lastInspectedAt);
    assert.equal(call("assets-list", ctxA, { kind: "streetlight" }).result.assets.length, 1);
    assert.equal(call("assets-delete", ctxA, { id: a.result.asset.id }).ok, true);
  });
  it("rejects invalid kind / missing coords", () => {
    assert.equal(call("assets-add", ctxA, { kind: "ufo", lat: 1, lng: 1 }).ok, false);
    assert.equal(call("assets-add", ctxA, { kind: "streetlight" }).ok, false);
  });
});

describe("government.open-data-search (data.gov CKAN)", () => {
  it("rejects empty query", async () => {
    const r = await call("open-data-search", ctxA, { query: "" });
    assert.equal(r.ok, false);
  });
  it("returns honest error on network failure", async () => {
    const r = await call("open-data-search", ctxA, { query: "potholes" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable|network/);
  });
});

describe("government.dashboard-summary (CityGovShell data source)", () => {
  it("aggregates 311 + permits + assets + departments", () => {
    const ctxC = { actor: { userId: "user_gov_dash" }, userId: "user_gov_dash" };
    call("departments-add", ctxC, { name: "DPW", shortCode: "dpw" });
    const r = call("service-requests-create", ctxC, { category: "pothole", description: "X", lat: 1, lng: 1 });
    call("service-requests-update-status", ctxC, { id: r.result.request.id, status: "closed_resolved" });
    call("service-requests-create", ctxC, { category: "trash_missed", description: "Y", lat: 1, lng: 1 });
    call("permits-apply", ctxC, { applicantName: "X", applicantEmail: "x@x", kind: "building" });
    call("assets-add", ctxC, { kind: "streetlight", lat: 1, lng: 1, condition: "broken" });
    const d = call("dashboard-summary", ctxC, {});
    assert.equal(d.result.totalServiceRequests, 2);
    assert.equal(d.result.openRequests, 1);
    assert.equal(d.result.closed30d, 1);
    assert.equal(d.result.permitCount, 1);
    assert.equal(d.result.assetCount, 1);
    assert.equal(d.result.brokenAssets, 1);
  });
});
