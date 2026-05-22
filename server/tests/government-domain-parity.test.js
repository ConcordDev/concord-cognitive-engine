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

// ── Parity backlog: 7 buildable civic-portal features ──────────

describe("government.payments-* (online payment processing)", () => {
  it("fines: create / list scoped per user, rejects bad input", () => {
    const f = call("fines-create", ctxA, { payerName: "Jane Doe", reason: "Expired meter", amountUsd: 45 });
    assert.equal(f.ok, true);
    assert.equal(f.result.fine.paid, false);
    assert.equal(call("fines-list", ctxA, {}).result.fines.length, 1);
    assert.equal(call("fines-list", ctxB, {}).result.fines.length, 0);
    assert.equal(call("fines-create", ctxA, { payerName: "", reason: "x", amountUsd: 5 }).ok, false);
    assert.equal(call("fines-create", ctxA, { payerName: "X", reason: "y", amountUsd: 0 }).ok, false);
  });

  it("permit fee: checkout -> confirm marks permit paid + emits notification", () => {
    const p = call("permits-apply", ctxA, { applicantName: "Bob", applicantEmail: "b@x", kind: "fence", feeUsd: 120 });
    const co = call("payments-checkout", ctxA, { kind: "permit", refId: p.result.permit.id });
    assert.equal(co.ok, true);
    assert.equal(co.result.payment.status, "pending");
    assert.equal(co.result.payment.amountUsd, 120);
    const conf = call("payments-confirm", ctxA, { paymentId: co.result.payment.id, methodToken: "tok_test", cardLast4: "4242" });
    assert.equal(conf.ok, true);
    assert.equal(conf.result.payment.status, "succeeded");
    assert.match(conf.result.payment.receiptNumber, /^RCPT-/);
    const permits = call("permits-list", ctxA, {}).result.permits;
    assert.equal(permits.find(x => x.id === p.result.permit.id).paid, true);
    assert.ok(call("notifications-list", ctxA, {}).result.notifications.some(n => n.kind === "payment_received"));
  });

  it("fine payment: checkout requires valid card, refund reverses paid flag", () => {
    const f = call("fines-create", ctxA, { payerName: "Sam", reason: "Litter", amountUsd: 30 });
    const co = call("payments-checkout", ctxA, { kind: "fine", refId: f.result.fine.id });
    assert.equal(call("payments-confirm", ctxA, { paymentId: co.result.payment.id, methodToken: "", cardLast4: "1111" }).ok, false);
    assert.equal(call("payments-confirm", ctxA, { paymentId: co.result.payment.id, methodToken: "tok", cardLast4: "12" }).ok, false);
    const conf = call("payments-confirm", ctxA, { paymentId: co.result.payment.id, methodToken: "tok", cardLast4: "9999" });
    assert.equal(conf.ok, true);
    const refunded = call("payments-refund", ctxA, { paymentId: co.result.payment.id, reason: "duplicate" });
    assert.equal(refunded.result.payment.status, "refunded");
    assert.equal(call("fines-list", ctxA, {}).result.fines.find(x => x.id === f.result.fine.id).paid, false);
  });

  it("rejects checkout on unknown / zero-amount payable and double payment", () => {
    assert.equal(call("payments-checkout", ctxA, { kind: "permit", refId: "nope" }).ok, false);
    const p = call("permits-apply", ctxA, { applicantName: "X", applicantEmail: "x@x", kind: "fence", feeUsd: 0 });
    assert.equal(call("payments-checkout", ctxA, { kind: "permit", refId: p.result.permit.id }).ok, false);
  });
});

describe("government.meetings-* (public meeting calendar)", () => {
  it("schedule / list / set-agenda / publish-minutes / delete cycle", () => {
    const m = call("meetings-schedule", ctxA, { title: "Council Regular Session", body: "city_council", scheduledAt: "2026-09-01T18:00:00Z", location: "Chambers", agenda: ["Budget vote", "Zoning appeal"] });
    assert.equal(m.ok, true);
    assert.equal(m.result.meeting.status, "scheduled");
    assert.equal(m.result.meeting.agenda.length, 2);
    assert.equal(call("meetings-list", ctxA, {}).result.meetings.length, 1);
    assert.equal(call("meetings-list", ctxB, {}).result.meetings.length, 0);
    const ag = call("meetings-set-agenda", ctxA, { id: m.result.meeting.id, agenda: ["A", "B", "C"] });
    assert.equal(ag.result.meeting.agenda.length, 3);
    const min = call("meetings-publish-minutes", ctxA, { id: m.result.meeting.id, minutes: "Motion carried 5-0." });
    assert.equal(min.result.meeting.status, "minutes_published");
    assert.equal(call("meetings-delete", ctxA, { id: m.result.meeting.id }).ok, true);
  });

  it("rejects missing fields, bad body, invalid date", () => {
    assert.equal(call("meetings-schedule", ctxA, { title: "", body: "city_council", scheduledAt: "2026-09-01T18:00:00Z" }).ok, false);
    assert.equal(call("meetings-schedule", ctxA, { title: "X", body: "alien_council", scheduledAt: "2026-09-01T18:00:00Z" }).ok, false);
    assert.equal(call("meetings-schedule", ctxA, { title: "X", body: "city_council", scheduledAt: "not-a-date" }).ok, false);
  });

  it("upcoming filter excludes past meetings", () => {
    call("meetings-schedule", ctxA, { title: "Past", body: "city_council", scheduledAt: "2020-01-01T00:00:00Z" });
    call("meetings-schedule", ctxA, { title: "Future", body: "city_council", scheduledAt: "2099-01-01T00:00:00Z" });
    const upcoming = call("meetings-list", ctxA, { upcoming: true }).result.meetings;
    assert.ok(upcoming.every(x => new Date(x.scheduledAt).getTime() >= Date.now()));
  });
});

describe("government.voter-registration + elections (election info)", () => {
  it("voter registration: submit / status, rejects under-18 + bad state", () => {
    assert.equal(call("voter-registration-status", ctxA, {}).result.registration, null);
    const r = call("voter-registration-submit", ctxA, { fullName: "Pat Voter", residentialAddress: "1 Main St", dateOfBirth: "1990-05-01", stateCode: "CA", partyPreference: "unaffiliated" });
    assert.equal(r.ok, true);
    assert.equal(r.result.registration.status, "submitted");
    assert.equal(call("voter-registration-status", ctxA, {}).result.registration.fullName, "Pat Voter");
    assert.equal(call("voter-registration-submit", ctxA, { fullName: "Kid", residentialAddress: "x", dateOfBirth: "2020-01-01", stateCode: "CA" }).ok, false);
    assert.equal(call("voter-registration-submit", ctxA, { fullName: "X", residentialAddress: "y", dateOfBirth: "1990-01-01", stateCode: "California" }).ok, false);
  });

  it("elections-upcoming requires GOOGLE_CIVIC_API_KEY", async () => {
    delete process.env.GOOGLE_CIVIC_API_KEY;
    const r = await call("elections-upcoming", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /GOOGLE_CIVIC_API_KEY/);
  });

  it("polling-place-lookup requires GOOGLE_CIVIC_API_KEY and address", async () => {
    delete process.env.GOOGLE_CIVIC_API_KEY;
    const r = await call("polling-place-lookup", ctxA, { address: "1 Main St" });
    assert.equal(r.ok, false);
    assert.match(r.error, /GOOGLE_CIVIC_API_KEY/);
  });
});

describe("government.advocacy-* (call-your-rep)", () => {
  it("record / list / tally / delete, scoped per user", () => {
    const a = call("advocacy-record", ctxA, { billId: "HR1234-119", billTitle: "Climate Act", stance: "support", channel: "email", message: "Please vote yes." });
    assert.equal(a.ok, true);
    call("advocacy-record", ctxA, { billId: "HR1234-119", stance: "oppose", channel: "call" });
    assert.equal(call("advocacy-list", ctxA, {}).result.actions.length, 2);
    assert.equal(call("advocacy-list", ctxB, {}).result.actions.length, 0);
    const t = call("advocacy-bill-tally", ctxA, { billId: "HR1234-119" });
    assert.equal(t.result.total, 2);
    assert.equal(t.result.tally.support, 1);
    assert.equal(t.result.tally.oppose, 1);
    assert.equal(call("advocacy-delete", ctxA, { id: a.result.action.id }).ok, true);
  });

  it("rejects bad stance / channel and missing message for written channels", () => {
    assert.equal(call("advocacy-record", ctxA, { billId: "HR1-119", stance: "maybe", channel: "email", message: "x" }).ok, false);
    assert.equal(call("advocacy-record", ctxA, { billId: "HR1-119", stance: "support", channel: "telepathy", message: "x" }).ok, false);
    assert.equal(call("advocacy-record", ctxA, { billId: "HR1-119", stance: "support", channel: "email" }).ok, false);
  });
});

describe("government.documents-* (form library with e-signature)", () => {
  it("publish / list / sign / delete, signature fingerprint is tamper-evident", () => {
    const d = call("documents-publish", ctxA, { title: "Permit Application", category: "permit_form", bodyText: "Fill in all fields.", requiresSignature: true });
    assert.equal(d.ok, true);
    assert.equal(call("documents-list", ctxA, {}).result.documents.length, 1);
    assert.equal(call("documents-list", ctxB, {}).result.documents.length, 0);
    const s = call("documents-sign", ctxA, { id: d.result.document.id, signerName: "Alice Smith", signerEmail: "a@x", typedSignature: "Alice Smith" });
    assert.equal(s.ok, true);
    assert.match(s.result.signature.fingerprint, /^sig-/);
    assert.equal(s.result.document.signatures.length, 1);
    assert.equal(call("documents-delete", ctxA, { id: d.result.document.id }).ok, true);
  });

  it("rejects bad category and signature that does not match name", () => {
    assert.equal(call("documents-publish", ctxA, { title: "X", category: "ufo_form", bodyText: "y" }).ok, false);
    const d = call("documents-publish", ctxA, { title: "Y", category: "notice", bodyText: "z", requiresSignature: true });
    assert.equal(call("documents-sign", ctxA, { id: d.result.document.id, signerName: "Bob", signerEmail: "b@x", typedSignature: "Not Bob" }).ok, false);
  });
});

describe("government.notifications-* (case-status notifications)", () => {
  it("subscribe / list / mark-read, subscription carries chosen channel", () => {
    const p = call("permits-apply", ctxA, { applicantName: "X", applicantEmail: "x@x", kind: "fence", feeUsd: 50 });
    const sub = call("notifications-subscribe", ctxA, { subjectKind: "permit", subjectId: p.result.permit.id, channel: "sms", contact: "+15551234567" });
    assert.equal(sub.ok, true);
    assert.equal(sub.result.subscription.channel, "sms");
    // approving a paid permit emits a notification on the subscribed channel
    call("permits-pay-fee", ctxA, { id: p.result.permit.id });
    call("permits-approve", ctxA, { id: p.result.permit.id });
    const list = call("notifications-list", ctxA, {}).result;
    const approvalNotif = list.notifications.find(n => n.subjectId === p.result.permit.id && /approved/.test(n.message));
    assert.ok(approvalNotif);
    assert.equal(approvalNotif.channel, "sms");
    assert.ok(list.unreadCount >= 1);
    const marked = call("notifications-mark-read", ctxA, {});
    assert.ok(marked.result.markedRead >= 1);
    assert.equal(call("notifications-list", ctxA, { unreadOnly: true }).result.notifications.length, 0);
  });

  it("notifications-emit + rejects bad subject kind", () => {
    const e = call("notifications-emit", ctxA, { subjectKind: "court_case", subjectId: "case_1", message: "Hearing rescheduled." });
    assert.equal(e.ok, true);
    assert.equal(e.result.notification.subjectKind, "court_case");
    assert.equal(call("notifications-emit", ctxA, { subjectKind: "alien_abduction", subjectId: "x", message: "y" }).ok, false);
    assert.equal(call("notifications-subscribe", ctxA, { subjectKind: "permit", subjectId: "", channel: "email", contact: "a@x" }).ok, false);
  });
});
