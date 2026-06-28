// Behavioral macro tests for server/domains/services.js — the service-business
// substrate the /lenses/services lens drives via lensRun('services', …) +
// the RevenueRetentionPanel / BookingActionDock / EndOfDayClose components.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39285-39290):
// handlers registered through `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, data)` — the 3-ARG convention,
// where the server first PEELS exactly one redundant `{ artifact: { data } }`
// wrapper (lib/lens-input-normalize.js#peelRedundantArtifactWrapper), then sets
// BOTH `virtualArtifact.data = data` AND passes `data` as the 3rd `params` arg.
// Our `call()` harness reproduces that EXACTLY (peel + double-set).
//
// COMPONENT-EXACT SHAPE — the load-bearing part. The RevenueRetentionPanel sends:
//   revenueByProvider     ← { artifact: { data: { appointments, period } } }  (SOLE-KEY → peeled)
//   clientRetentionReport ← { artifact: { data: { clients } } }               (SOLE-KEY → peeled)
// The 2-key `{ artifact:{data}, period }` body the panel USED to send for
// revenueByProvider is deliberately NOT peeled — it stranded `appointments`
// inside the un-unwrapped wrapper so the handler read `artifact.data.appointments
// === undefined` and returned an EMPTY summary while the panel "looked wired"
// (the carpentry-class dead-calculator defect). The `deadCallShape` test below
// pins that the OLD shape is dead and the NEW sole-key shape is alive, so a
// regression to the 2-key body resurfaces here.
//
// Plus: clientRetentionReport RETURNS `averageLifetimeValue` (NOT
// `avgLifetimeValue`) — the panel was reading the wrong key (Avg LTV always
// blank); `retentionFieldNames` pins the exact returned key set.
//
// These are NOT shape-only assertions. Every test pins ACTUAL computed values:
// per-provider revenue + period totals, repeat rate %, average lifetime value,
// churn-risk segmentation, tiered commission, daily-close revenue split. Plus
// validation-rejection, degrade-graceful (empty/missing data), per-user
// isolation of the booking substrate, and fail-CLOSED poisoned-numeric cases
// (Infinity/NaN never reach a money total — Number.isFinite holds).
//
// Hermetic: no server boot, no network, no LLM.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerServicesActions from "../domains/services.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "services", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the live dispatch EXACTLY: peel the redundant artifact wrapper, then
// invoke handler(ctx, virtualArtifact, data) with virtualArtifact.data === data.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`services.${name} not registered`);
  const data = peelRedundantArtifactWrapper(input || {});
  const virtualArtifact = { id: null, domain: "services", type: "domain_action", data, meta: {} };
  return fn(ctx, virtualArtifact, data);
}

before(() => { registerServicesActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

// Fixed reference points for deterministic date math.
const DAY = 86400000;
const isoDaysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

// ── Registration ─────────────────────────────────────────────────

describe("services — registration", () => {
  it("registers every macro the lens + its components call", () => {
    for (const m of [
      // RevenueRetentionPanel calculators
      "revenueByProvider", "clientRetentionReport",
      // page Action Result + EndOfDayClose calculators
      "scheduleOptimize", "reminderGenerate", "commissionCalc", "dailyCloseReport", "supplyCheck",
      // BookingSuite persistent substrate (sample)
      "bookingGridCreate", "bookingGridList", "paymentCapture", "waitlistAdd",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing services.${m}`);
    }
  });
});

// ── revenueByProvider (COMPONENT-EXACT shape + SOLE-KEY peel wiring) ──

describe("services — revenueByProvider", () => {
  // The RevenueRetentionPanel sends a SOLE-KEY body so the peel unwraps to
  // { appointments, period } — feeding artifact.data.appointments AND params.period.
  const panelBody = (appointments, period) => ({ artifact: { data: { appointments, period } } });

  it("computes per-provider revenue + total from the component's exact shape", () => {
    const appts = [
      { provider: "Ana", price: 120, status: "completed", date: isoDaysAgo(1) },
      { provider: "Ana", price: 80,  status: "paid",      date: isoDaysAgo(2) },
      { provider: "Bo",  price: 200, status: "completed", date: isoDaysAgo(3) },
      { provider: "Bo",  price: 50,  status: "scheduled", date: isoDaysAgo(1) }, // not counted (status)
    ];
    const r = call("revenueByProvider", ctxA, panelBody(appts, 30));
    assert.equal(r.ok, true);
    assert.equal(r.result.period, 30);
    // sorted desc by revenue: Bo (200) then Ana (120+80=200 → tie, both 200) — assert by lookup.
    const ana = r.result.summary.find((s) => s.provider === "Ana");
    const bo = r.result.summary.find((s) => s.provider === "Bo");
    assert.equal(ana.revenue, 200);
    assert.equal(ana.appointments, 2);
    assert.equal(bo.revenue, 200);
    assert.equal(bo.appointments, 1); // scheduled one excluded
    assert.equal(r.result.totalRevenue, 400);
  });

  it("DEAD-CALL PIN: the OLD 2-key {artifact:{data},period} body strands appointments (dead); the SOLE-KEY body is alive", () => {
    const appts = [{ provider: "Ana", price: 120, status: "completed", date: isoDaysAgo(1) }];
    // OLD shape the panel used to send — peel does NOT touch a 2-key body, so
    // artifact.data.appointments is undefined and the summary is empty.
    const deadBody = { artifact: { data: { appointments: appts } }, period: 30 };
    const dead = call("revenueByProvider", ctxA, deadBody);
    assert.equal(dead.ok, true);
    assert.equal(dead.result.summary.length, 0, "2-key body must be DEAD (this is the bug we fixed)");
    assert.equal(dead.result.totalRevenue, 0);
    // NEW sole-key shape the panel now sends — alive.
    const alive = call("revenueByProvider", ctxA, { artifact: { data: { appointments: appts, period: 30 } } });
    assert.equal(alive.result.summary.length, 1);
    assert.equal(alive.result.totalRevenue, 120);
  });

  it("respects the period window (old appointments excluded)", () => {
    const appts = [
      { provider: "Ana", price: 100, status: "completed", date: isoDaysAgo(5) },
      { provider: "Ana", price: 999, status: "completed", date: isoDaysAgo(400) }, // outside 30d
    ];
    const r = call("revenueByProvider", ctxA, panelBody(appts, 30));
    assert.equal(r.result.totalRevenue, 100);
  });

  it("degrades gracefully on empty / missing data", () => {
    assert.deepEqual(call("revenueByProvider", ctxA, panelBody([], 30)).result.summary, []);
    const bare = call("revenueByProvider", ctxA, {});
    assert.equal(bare.ok, true);
    assert.deepEqual(bare.result.summary, []);
    assert.equal(bare.result.totalRevenue, 0);
  });

  it("fail-CLOSED: a poisoned non-finite price never poisons the money total", () => {
    const appts = [
      { provider: "Ana", price: "1e999", status: "completed", date: isoDaysAgo(1) }, // Infinity-ish
      { provider: "Ana", price: NaN,      status: "completed", date: isoDaysAgo(1) },
      { provider: "Ana", price: 75,       status: "completed", date: isoDaysAgo(1) },
    ];
    const r = call("revenueByProvider", ctxA, panelBody(appts, 30));
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalRevenue), "totalRevenue must stay finite");
    assert.equal(r.result.totalRevenue, 75);
    for (const s of r.result.summary) assert.ok(Number.isFinite(s.revenue));
  });
});

// ── clientRetentionReport (COMPONENT-EXACT shape + field-name pin) ──

describe("services — clientRetentionReport", () => {
  // SOLE-KEY body → peel unwraps to { clients }.
  const panelBody = (clients) => ({ artifact: { data: { clients } } });

  it("computes repeat rate, average LTV, total revenue, churn segments", () => {
    const clients = [
      { name: "Mia", visits: 4, totalRevenue: 800, lastVisit: isoDaysAgo(10) },   // repeat, low risk
      { name: "Jo",  visits: 1, totalRevenue: 100, lastVisit: isoDaysAgo(120) },  // not repeat, medium risk
      { name: "Sky", visits: 3, totalRevenue: 600, lastVisit: isoDaysAgo(200) },  // repeat, high risk
    ];
    const r = call("clientRetentionReport", ctxA, panelBody(clients));
    assert.equal(r.ok, true);
    assert.equal(r.result.totalClients, 3);
    assert.equal(r.result.repeatClients, 2);
    assert.equal(r.result.repeatRate, Math.round((2 / 3) * 10000) / 100); // 66.67
    assert.equal(r.result.totalRevenue, 1500);
    assert.equal(r.result.averageLifetimeValue, 500); // 1500/3
    // at-risk = high|medium → Jo + Sky, sorted by LTV desc (Sky 600 before Jo 100)
    assert.equal(r.result.atRiskCount, 2);
    assert.deepEqual(r.result.atRiskClients.map((c) => c.name), ["Sky", "Jo"]);
    assert.equal(r.result.atRiskClients[0].churnRisk, "high");
    assert.equal(r.result.atRiskClients[1].churnRisk, "medium");
  });

  it("FIELD-NAME PIN: returns averageLifetimeValue (the panel reads this exact key, NOT avgLifetimeValue)", () => {
    const r = call("clientRetentionReport", ctxA, panelBody([
      { name: "Mia", visits: 2, totalRevenue: 200, lastVisit: isoDaysAgo(5) },
    ]));
    assert.ok("averageLifetimeValue" in r.result, "result must carry averageLifetimeValue");
    assert.equal(r.result.avgLifetimeValue, undefined, "must NOT use the stale avgLifetimeValue key");
    // The panel's other rendered keys must all be present.
    for (const k of ["totalClients", "repeatRate", "averageLifetimeValue", "atRiskCount", "atRiskClients"]) {
      assert.ok(k in r.result, `missing rendered key ${k}`);
    }
  });

  it("degrades gracefully on empty / missing data", () => {
    const empty = call("clientRetentionReport", ctxA, panelBody([]));
    assert.equal(empty.ok, true);
    assert.equal(empty.result.totalClients, 0);
    assert.equal(empty.result.repeatRate, 0);
    assert.equal(empty.result.averageLifetimeValue, 0);
    assert.deepEqual(empty.result.atRiskClients, []);
    assert.equal(call("clientRetentionReport", ctxA, {}).ok, true);
  });

  it("fail-CLOSED: a poisoned non-finite lifetime value never poisons totals", () => {
    const clients = [
      { name: "Mia", visits: 2, totalRevenue: "1e999", lastVisit: isoDaysAgo(5) },
      { name: "Jo",  visits: 2, totalRevenue: NaN,      lastVisit: isoDaysAgo(5) },
      { name: "Sky", visits: 2, totalRevenue: 300,      lastVisit: isoDaysAgo(5) },
    ];
    const r = call("clientRetentionReport", ctxA, panelBody(clients));
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalRevenue), "totalRevenue must stay finite");
    assert.ok(Number.isFinite(r.result.averageLifetimeValue), "averageLifetimeValue must stay finite");
    assert.equal(r.result.totalRevenue, 300);
    assert.equal(r.result.averageLifetimeValue, 100); // 300/3
  });
});

// ── commissionCalc (tiered commission + fail-closed) ──

describe("services — commissionCalc", () => {
  const body = (sales, tiers) => ({ artifact: { data: { sales } }, ...(tiers ? { tiers } : {}) });

  it("computes tiered marginal commission per line + per salesperson", () => {
    // $10,000 sale on default tiers: 5000@5% + 5000@8% = 250 + 400 = 650
    const r = call("commissionCalc", ctxA, { artifact: { data: { sales: [{ salesperson: "Ray", amount: 10000 }] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalSales, 10000);
    assert.equal(r.result.totalCommission, 650);
    assert.equal(r.result.lineItems[0].commission, 650);
    assert.equal(r.result.bySalesperson[0].salesperson, "Ray");
    assert.equal(r.result.bySalesperson[0].totalCommission, 650);
  });

  it("fail-CLOSED: a poisoned non-finite sale amount never poisons the commission total", () => {
    const r = call("commissionCalc", ctxA, { artifact: { data: { sales: [
      { salesperson: "Ray", amount: "1e999" },
      { salesperson: "Ray", amount: 1000 },
    ] } } });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalSales));
    assert.ok(Number.isFinite(r.result.totalCommission));
    assert.equal(r.result.totalSales, 1000);
    for (const l of r.result.lineItems) assert.ok(Number.isFinite(l.commission));
  });

  it("degrades gracefully on empty", () => {
    const r = call("commissionCalc", ctxA, { artifact: { data: { sales: [] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCommission, 0);
  });
});

// ── dailyCloseReport (revenue split + fail-closed) ──

describe("services — dailyCloseReport", () => {
  it("splits service vs product revenue for the target date", () => {
    const date = "2026-06-28";
    const r = call("dailyCloseReport", ctxA, { artifact: { data: {
      appointments: [
        { provider: "Ana", price: 120, status: "completed", date },
        { provider: "Bo",  price: 50,  status: "no_show",   date },
        { provider: "Ana", price: 80,  status: "completed", date: "2026-06-27" }, // wrong day
      ],
      productsSold: [{ price: 30, quantity: 2 }],
    }, date } });
    assert.equal(r.ok, true);
    assert.equal(r.result.date, date);
    assert.equal(r.result.completedCount, 1);
    assert.equal(r.result.noShowCount, 1);
    assert.equal(r.result.serviceRevenue, 120);
    assert.equal(r.result.productRevenue, 60);
    assert.equal(r.result.totalRevenue, 180);
  });

  it("fail-CLOSED: a poisoned price never poisons the close totals", () => {
    const date = "2026-06-28";
    const r = call("dailyCloseReport", ctxA, { artifact: { data: {
      appointments: [
        { provider: "Ana", price: "Infinity", status: "completed", date },
        { provider: "Ana", price: 90,         status: "completed", date },
      ],
    }, date } });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.serviceRevenue));
    assert.ok(Number.isFinite(r.result.totalRevenue));
    assert.equal(r.result.serviceRevenue, 90);
  });
});

// ── scheduleOptimize + reminderGenerate (shape sanity) ──

describe("services — scheduleOptimize / reminderGenerate", () => {
  it("scheduleOptimize returns ordered appointments + finite total gap", () => {
    const r = call("scheduleOptimize", ctxA, { artifact: { data: { appointments: [
      { client: "A", time: "2026-06-28T11:00:00Z", endTime: "2026-06-28T11:30:00Z", serviceType: "Color" },
      { client: "B", time: "2026-06-28T09:00:00Z", endTime: "2026-06-28T09:30:00Z", serviceType: "Cut" },
    ] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.optimizedOrder[0].client, "B"); // earlier time sorts first
    assert.ok(Number.isFinite(r.result.totalGapMinutes));
    assert.equal(r.result.totalGapMinutes, 90); // 09:30 → 11:00 = 90min gap
  });

  it("reminderGenerate counts upcoming appointments inside the window", () => {
    // Sole-key body so the peel unwraps to { appointments, hoursAhead } — the
    // handler reads artifact.data.appointments AND params.hoursAhead.
    const r = call("reminderGenerate", ctxA, {
      artifact: { data: {
        appointments: [
          { client: "A", serviceType: "Cut", date: new Date(Date.now() + 2 * 3600000).toISOString() },
          { client: "B", serviceType: "Color", date: new Date(Date.now() + 5 * DAY).toISOString() }, // outside 24h
        ],
        hoursAhead: 24,
      } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.reminders[0].client, "A");
  });
});

// ── supplyCheck (low-stock detection) ──

describe("services — supplyCheck", () => {
  it("flags items at/under reorder point", () => {
    const r = call("supplyCheck", ctxA, { artifact: { data: { supplies: [
      { name: "Dye", currentStock: 2, reorderPoint: 5, supplier: "Acme" },
      { name: "Foil", currentStock: 50, reorderPoint: 10, supplier: "Acme" },
    ] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.totalItems, 2);
    assert.equal(r.result.needsOrder, true);
    assert.equal(r.result.lowStock[0].name, "Dye");
  });

  it("degrades gracefully on empty", () => {
    const r = call("supplyCheck", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.needsOrder, false);
  });
});

// ── Persistent booking substrate — validation + per-user isolation ──

describe("services — booking substrate (validation + isolation)", () => {
  it("rejects a booking with an invalid time", () => {
    const r = call("bookingGridCreate", ctxA, { client: "Mia", staff: "Ana", time: "nope", duration: 30 });
    assert.equal(r.ok, false);
    assert.match(r.error, /time/);
  });

  it("creates a booking and lists it back (per-user isolated)", () => {
    const date = isoDaysAgo(0);
    const made = call("bookingGridCreate", ctxA, { client: "Mia", staff: "Ana", time: "10:00", duration: 60, date });
    assert.equal(made.ok, true);
    const listA = call("bookingGridList", ctxA, { date });
    assert.equal(listA.result.count, 1);
    // user_b sees nothing — isolation.
    const listB = call("bookingGridList", ctxB, { date });
    assert.equal(listB.result.count, 0);
  });

  it("rejects a conflicting booking on the same staff/slot", () => {
    const date = isoDaysAgo(0);
    assert.equal(call("bookingGridCreate", ctxA, { client: "Mia", staff: "Ana", time: "10:00", duration: 60, date }).ok, true);
    const clash = call("bookingGridCreate", ctxA, { client: "Jo", staff: "Ana", time: "10:30", duration: 60, date });
    assert.equal(clash.ok, false);
    assert.match(clash.error, /conflict/);
  });

  it("paymentCapture rejects a non-positive subtotal", () => {
    const r = call("paymentCapture", ctxA, { client: "Mia", subtotal: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /subtotal/);
  });
});
