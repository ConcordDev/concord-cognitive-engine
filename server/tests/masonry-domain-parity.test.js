// Contract tests for server/domains/masonry.js — pure-math calculators
// plus the 8 contractor-suite feature macros (takeoff, proposals, schedule,
// photos, change orders, price book, invoices, code library).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMasonryActions from "../domains/masonry.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact) {
  const fn = ACTIONS.get(`masonry.${name}`);
  if (!fn) throw new Error(`masonry.${name} not registered`);
  return fn(ctx, artifact || { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMasonryActions(register); });

beforeEach(() => {
  // fresh in-memory STATE per test so per-user Maps don't bleed
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "mason_a" }, userId: "mason_a" };
const ctxB = { actor: { userId: "mason_b" }, userId: "mason_b" };

describe("masonry — pure-math calculators", () => {
  it("materialEstimate computes units, mortar, and grand total", () => {
    const r = call("materialEstimate", ctxA, {}, { data: { squareFootage: 200, material: "brick" } });
    assert.equal(r.ok, true);
    assert.ok(r.result.unitsNeeded > 0);
    assert.ok(r.result.grandTotal > 0);
  });
  it("mortarMix returns a recipe for a known application", () => {
    const r = call("mortarMix", ctxA, {}, { data: { application: "structural" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "Type S");
  });
  it("wallStrength flags an over-slender wall", () => {
    const r = call("wallStrength", ctxA, {}, { data: { heightFeet: 30, thicknessInches: 6, reinforced: false } });
    assert.equal(r.ok, true);
    assert.equal(r.result.passesSlenderness, false);
  });
  it("jobCosting rolls up labor, overhead, and profit", () => {
    const r = call("jobCosting", ctxA, {}, { data: { items: [{ name: "Pour", hours: 10, rate: 55, materialCost: 200 }] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.grandTotal > r.result.subtotalLabor);
  });
});

describe("masonry — Feature 1: visual takeoff", () => {
  it("takeoff-save derives net area and material counts", () => {
    const r = call("takeoff-save", ctxA, {
      name: "Retaining wall", material: "brick", wastePct: 10,
      segments: [{ label: "North", lengthFeet: 20, heightFeet: 8 }],
      openings: [{ label: "Gate", widthFeet: 4, heightFeet: 6 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.grossAreaSqFt, 160);
    assert.equal(r.result.openingAreaSqFt, 24);
    assert.equal(r.result.netAreaSqFt, 136);
    assert.ok(r.result.unitsNeeded > 0);
  });
  it("takeoff-list / takeoff-delete round-trip and isolate per user", () => {
    call("takeoff-save", ctxA, { name: "A", segments: [{ lengthFeet: 10, heightFeet: 8 }] });
    const saved = call("takeoff-save", ctxA, { name: "B", segments: [{ lengthFeet: 5, heightFeet: 8 }] }).result;
    assert.equal(call("takeoff-list", ctxA).result.takeoffs.length, 2);
    assert.equal(call("takeoff-list", ctxB).result.takeoffs.length, 0);
    const del = call("takeoff-delete", ctxA, { id: saved.id });
    assert.equal(del.ok, true);
    assert.equal(call("takeoff-list", ctxA).result.takeoffs.length, 1);
  });
});

describe("masonry — Feature 2: proposals", () => {
  it("proposal-create prices line items with margin and tax", () => {
    const r = call("proposal-create", ctxA, {
      client: "Jane Doe", projectTitle: "Patio", marginPct: 20, taxPct: 8,
      lineItems: [{ description: "Brick", unit: "each", quantity: 500, unitCost: 0.75 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 375);
    assert.ok(r.result.total > r.result.subtotal);
    assert.equal(r.result.status, "draft");
  });
  it("proposal-create rejects missing client", () => {
    assert.equal(call("proposal-create", ctxA, { projectTitle: "X" }).ok, false);
  });
  it("proposal-update-status to accepted stamps acceptedAt", () => {
    const p = call("proposal-create", ctxA, { client: "C", lineItems: [] }).result;
    const up = call("proposal-update-status", ctxA, { id: p.id, status: "accepted" });
    assert.equal(up.ok, true);
    assert.equal(up.result.status, "accepted");
    assert.ok(up.result.acceptedAt);
  });
  it("proposal-render produces a document string", () => {
    const p = call("proposal-create", ctxA, { client: "C", lineItems: [{ description: "Block", quantity: 1, unitCost: 2.5 }] }).result;
    const r = call("proposal-render", ctxA, { id: p.id });
    assert.equal(r.ok, true);
    assert.match(r.result.document, /PROPOSAL/);
  });
});

describe("masonry — Feature 3: job scheduling", () => {
  it("schedule-add records a job and surfaces a freeze advisory", () => {
    const r = call("schedule-add", ctxA, {
      title: "Foundation", startDate: "2026-02-01", durationDays: 3,
      crew: ["Mike", "Dave"], forecastLowF: 28, precipChancePct: 70,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.weather.risk, "high");
    assert.ok(r.result.weather.advisories.length >= 2);
  });
  it("schedule-list aggregates crew load; schedule-delete removes", () => {
    const j = call("schedule-add", ctxA, { title: "Wall", startDate: "2026-03-01", durationDays: 4, crew: ["Sam"] }).result;
    const list = call("schedule-list", ctxA).result;
    assert.equal(list.crewLoad.Sam, 4);
    assert.equal(call("schedule-delete", ctxA, { id: j.id }).ok, true);
  });
  it("schedule-add rejects missing title or date", () => {
    assert.equal(call("schedule-add", ctxA, { startDate: "2026-01-01" }).ok, false);
  });
});

describe("masonry — Feature 4: photo documentation", () => {
  it("photo-add stores a phase-tagged photo; photo-list groups by phase", () => {
    call("photo-add", ctxA, { url: "https://x/a.jpg", phase: "before", jobId: "j1" });
    call("photo-add", ctxA, { url: "https://x/b.jpg", phase: "after", jobId: "j1" });
    const r = call("photo-list", ctxA, { jobId: "j1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.byPhase.before.length, 1);
    assert.equal(r.result.byPhase.after.length, 1);
    assert.equal(r.result.timeline.length, 2);
  });
  it("photo-add rejects empty url; photo-delete removes", () => {
    assert.equal(call("photo-add", ctxA, { phase: "during" }).ok, false);
    const p = call("photo-add", ctxA, { url: "https://x/c.jpg" }).result;
    assert.equal(call("photo-delete", ctxA, { id: p.id }).ok, true);
  });
});

describe("masonry — Feature 5: change orders", () => {
  it("change-order-create prices labor + materials", () => {
    const r = call("change-order-create", ctxA, {
      description: "Add chimney cap", jobId: "j1", laborHours: 8, laborRate: 60, materialCost: 150,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.amount, 630);
    assert.equal(r.result.status, "pending");
  });
  it("change-order-sign approves and stamps signoff; list rolls up totals", () => {
    const co = call("change-order-create", ctxA, { description: "Extra footing", laborHours: 4, laborRate: 50 }).result;
    const signed = call("change-order-sign", ctxA, { id: co.id, status: "approved", signedBy: "Owner" });
    assert.equal(signed.ok, true);
    assert.equal(signed.result.signedBy, "Owner");
    assert.ok(signed.result.signedOffAt);
    assert.equal(call("change-order-list", ctxA).result.approvedTotal, 200);
  });
  it("change-order-create rejects empty description", () => {
    assert.equal(call("change-order-create", ctxA, { laborHours: 1 }).ok, false);
  });
});

describe("masonry — Feature 6: material price book", () => {
  it("pricebook-list seeds defaults on first call", () => {
    const r = call("pricebook-list", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.items.length >= 5);
  });
  it("pricebook-save adds and updates; pricebook-delete removes", () => {
    const created = call("pricebook-save", ctxA, { sku: "CST-1", name: "Custom mix", unit: "bag", unitCost: 14.5 }).result;
    assert.equal(created.name, "Custom mix");
    const updated = call("pricebook-save", ctxA, { id: created.id, name: "Updated mix", unitCost: 15 });
    assert.equal(updated.result.name, "Updated mix");
    assert.equal(call("pricebook-delete", ctxA, { id: created.id }).ok, true);
  });
  it("pricebook-save rejects missing name", () => {
    assert.equal(call("pricebook-save", ctxA, { sku: "X" }).ok, false);
  });
});

describe("masonry — Feature 7: invoicing with progress billing", () => {
  it("invoice-create bills a progress percentage of the contract", () => {
    const r = call("invoice-create", ctxA, { client: "Acme", contractTotal: 10000, progressPct: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.result.amount, 5000);
    assert.equal(r.result.balance, 5000);
    assert.equal(r.result.status, "unpaid");
  });
  it("invoice-record-payment tracks partial then full payment", () => {
    const inv = call("invoice-create", ctxA, { client: "Acme", contractTotal: 1000, progressPct: 100 }).result;
    const partial = call("invoice-record-payment", ctxA, { id: inv.id, amount: 400, method: "check" });
    assert.equal(partial.result.status, "partial");
    assert.equal(partial.result.balance, 600);
    const full = call("invoice-record-payment", ctxA, { id: inv.id, amount: 600 });
    assert.equal(full.result.status, "paid");
    assert.equal(full.result.balance, 0);
  });
  it("invoice-list aggregates billed/collected/outstanding; invoice-delete removes", () => {
    const inv = call("invoice-create", ctxA, { client: "X", contractTotal: 2000, progressPct: 100 }).result;
    call("invoice-record-payment", ctxA, { id: inv.id, amount: 500 });
    const list = call("invoice-list", ctxA).result;
    assert.equal(list.totalBilled, 2000);
    assert.equal(list.totalCollected, 500);
    assert.equal(list.outstanding, 1500);
    assert.equal(call("invoice-delete", ctxA, { id: inv.id }).ok, true);
  });
  it("invoice-create rejects bad inputs", () => {
    assert.equal(call("invoice-create", ctxA, { client: "X", contractTotal: 0 }).ok, false);
  });
});

describe("masonry — Feature 8: code-reference library", () => {
  it("code-search filters by query and standard", () => {
    const all = call("code-search", ctxA, {});
    assert.equal(all.ok, true);
    assert.ok(all.result.results.length > 0);
    const tms = call("code-search", ctxA, { standard: "TMS" });
    assert.ok(tms.result.results.every((c) => c.standard === "TMS"));
    const q = call("code-search", ctxA, { query: "slenderness" });
    assert.ok(q.result.results.length >= 1);
  });
  it("code-for-check returns references tied to a check type", () => {
    const r = call("code-for-check", ctxA, { checkType: "mortar" });
    assert.equal(r.ok, true);
    assert.ok(r.result.references.length >= 1);
    assert.ok(r.result.references.every((c) => (c.tags || []).includes("mortar")));
  });
});
