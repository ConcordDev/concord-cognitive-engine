// Contract tests for server/domains/welding.js
// Covers the pure-compute engineering calculators plus the
// field-service operations substrate (scheduling, quotes, invoices,
// payments, WPS builder, cert tracking, photo docs, code library,
// client portal).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerWeldingActions from "../domains/welding.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact) {
  const fn = ACTIONS.get(`welding.${name}`);
  if (!fn) throw new Error(`welding.${name} not registered`);
  return fn(ctx, artifact || { id: null, data: {}, meta: {} }, params);
}

before(() => { registerWeldingActions(register); });

beforeEach(() => {
  // Fresh per-user STATE for every test so Maps don't leak across cases.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "welder_a" }, userId: "welder_a" };
const ctxB = { actor: { userId: "welder_b" }, userId: "welder_b" };

// ─── Pure-compute calculators ────────────────────────────────────────
describe("welding — engineering calculators", () => {
  it("jointStrength computes a safe working load", () => {
    const r = call("jointStrength", ctxA, {}, { data: { thickness: 8, weldType: "fillet", material: "mild-steel", length: 120 } });
    assert.equal(r.ok, true);
    assert.ok(r.result.safeWorkingLoad);
    assert.equal(r.result.safetyFactor, 1.5);
  });

  it("rodSelection recommends an electrode", () => {
    const r = call("rodSelection", ctxA, {}, { data: { baseMetal: "stainless-steel", position: "vertical", thickness: 4 } });
    assert.equal(r.ok, true);
    assert.ok(r.result.recommended.rod);
  });

  it("heatInput computes kJ/mm and a distortion risk", () => {
    const r = call("heatInput", ctxA, {}, { data: { voltage: 28, amperage: 200, travelSpeed: 4 } });
    assert.equal(r.ok, true);
    assert.ok(["low", "moderate", "high"].includes(r.result.distortionRisk));
  });

  it("inspectionChecklist produces a verdict", () => {
    const r = call("inspectionChecklist", ctxA, {}, { data: { weldType: "butt", code: "AWS D1.1" } });
    assert.equal(r.ok, true);
    assert.ok(r.result.checklist.length > 0);
    assert.ok(r.result.verdict);
  });
});

// ─── Scheduling calendar ─────────────────────────────────────────────
describe("welding — scheduling calendar", () => {
  it("job-schedule + calendar surface a scheduled job", () => {
    const today = new Date().toISOString().slice(0, 10);
    const j = call("job-schedule", ctxA, { title: "Handrail repair", client: "Acme", scheduledDate: today, crew: ["Sam", "Dee"] });
    assert.equal(j.ok, true);
    assert.equal(j.result.job.status, "scheduled");
    const cal = call("calendar", ctxA, { rangeDays: 14 });
    assert.equal(cal.ok, true);
    assert.equal(cal.result.scheduledCount, 1);
    assert.ok(cal.result.crewLoad.Sam >= 1);
  });

  it("job-update can assign a date to an unscheduled job", () => {
    const j = call("job-schedule", ctxA, { title: "No date job" });
    assert.equal(j.ok, true);
    let cal = call("calendar", ctxA, {});
    assert.equal(cal.result.unscheduled.length, 1);
    const today = new Date().toISOString().slice(0, 10);
    const u = call("job-update", ctxA, { jobId: j.result.job.id, scheduledDate: today });
    assert.equal(u.ok, true);
    cal = call("calendar", ctxA, {});
    assert.equal(cal.result.unscheduled.length, 0);
  });

  it("job-update rejects an unknown job id", () => {
    const r = call("job-update", ctxA, { jobId: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "job_not_found");
  });
});

// ─── Quote → job → invoice workflow ──────────────────────────────────
describe("welding — quote-to-invoice workflow", () => {
  it("estimate-create totals line items with tax", () => {
    const r = call("estimate-create", ctxA, {
      title: "Gate fabrication", client: "Bob", taxRate: 0.1,
      lineItems: [{ description: "Labor", quantity: 10, unitPrice: 50, kind: "labor" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.estimate.subtotal, 500);
    assert.equal(r.result.estimate.total, 550);
  });

  it("estimate-list reports pipeline value", () => {
    call("estimate-create", ctxA, { title: "E1", lineItems: [{ description: "x", quantity: 1, unitPrice: 200, kind: "material" }] });
    const r = call("estimate-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.pipelineValue, 200);
  });

  it("estimate-send issues a portal token", () => {
    const e = call("estimate-create", ctxA, { title: "E2", lineItems: [] });
    const s = call("estimate-send", ctxA, { estimateId: e.result.estimate.id });
    assert.equal(s.ok, true);
    assert.ok(s.result.portalToken);
    assert.equal(s.result.estimate.status, "sent");
  });

  it("estimate-to-job converts and links an estimate to a job", () => {
    const e = call("estimate-create", ctxA, { title: "Convert me", lineItems: [{ description: "x", quantity: 2, unitPrice: 100, kind: "labor" }] });
    const conv = call("estimate-to-job", ctxA, { estimateId: e.result.estimate.id });
    assert.equal(conv.ok, true);
    assert.equal(conv.result.job.estimateId, e.result.estimate.id);
    assert.equal(conv.result.estimate.jobId, conv.result.job.id);
    // double-convert is rejected
    const again = call("estimate-to-job", ctxA, { estimateId: e.result.estimate.id });
    assert.equal(again.ok, false);
  });

  it("invoice-from-job carries the estimate total", () => {
    const e = call("estimate-create", ctxA, { title: "Invoiceable", lineItems: [{ description: "x", quantity: 1, unitPrice: 400, kind: "labor" }] });
    const conv = call("estimate-to-job", ctxA, { estimateId: e.result.estimate.id });
    const inv = call("invoice-from-job", ctxA, { jobId: conv.result.job.id });
    assert.equal(inv.ok, true);
    assert.equal(inv.result.invoice.amount, 400);
    assert.equal(inv.result.invoice.balance, 400);
    assert.match(inv.result.invoice.invoiceNumber, /^INV-/);
  });
});

// ─── Payment processing ──────────────────────────────────────────────
describe("welding — invoice payments", () => {
  function seedInvoice(ctx) {
    const e = call("estimate-create", ctx, { title: "Paid job", lineItems: [{ description: "x", quantity: 1, unitPrice: 1000, kind: "labor" }] });
    const conv = call("estimate-to-job", ctx, { estimateId: e.result.estimate.id });
    return call("invoice-from-job", ctx, { jobId: conv.result.job.id }).result.invoice;
  }

  it("invoice-payment marks partial then paid", () => {
    const inv = seedInvoice(ctxA);
    const p1 = call("invoice-payment", ctxA, { invoiceId: inv.id, amount: 400, method: "card" });
    assert.equal(p1.ok, true);
    assert.equal(p1.result.invoice.status, "partial");
    const p2 = call("invoice-payment", ctxA, { invoiceId: inv.id, amount: 600, method: "ach" });
    assert.equal(p2.ok, true);
    assert.equal(p2.result.invoice.status, "paid");
    assert.equal(p2.result.invoice.balance, 0);
  });

  it("invoice-payment rejects overpayment", () => {
    const inv = seedInvoice(ctxA);
    const r = call("invoice-payment", ctxA, { invoiceId: inv.id, amount: 99999 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "amount_exceeds_balance");
  });

  it("invoice-list rolls up outstanding and collected", () => {
    const inv = seedInvoice(ctxA);
    call("invoice-payment", ctxA, { invoiceId: inv.id, amount: 250 });
    const r = call("invoice-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.collected, 250);
    assert.equal(r.result.outstanding, 750);
  });
});

// ─── WPS builder ─────────────────────────────────────────────────────
describe("welding — WPS builder", () => {
  it("wps-create + wps-list round-trip", () => {
    const c = call("wps-create", ctxA, { process: "GMAW", baseMetal: "stainless-steel", code: "ASME IX" });
    assert.equal(c.ok, true);
    assert.match(c.result.wps.wpsNumber, /^WPS-/);
    const l = call("wps-list", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.wps.length, 1);
  });

  it("wps-approve blocks an incomplete WPS", () => {
    const c = call("wps-create", ctxA, { process: "SMAW" });
    const a = call("wps-approve", ctxA, { wpsId: c.result.wps.id });
    assert.equal(a.ok, false);
    assert.equal(a.error, "incomplete_wps");
    assert.ok(Array.isArray(a.result.missing));
  });

  it("wps-approve passes a complete WPS", () => {
    const c = call("wps-create", ctxA, { fillerMetal: "ER70S-6", amperageRange: "100-180A", thicknessRange: "3-12mm" });
    const a = call("wps-approve", ctxA, { wpsId: c.result.wps.id, approvedBy: "CWI Jane" });
    assert.equal(a.ok, true);
    assert.equal(a.result.wps.status, "approved");
    assert.equal(a.result.wps.approvedBy, "CWI Jane");
  });
});

// ─── Welder-certification tracking ───────────────────────────────────
describe("welding — certification tracking", () => {
  it("cert-add + cert-status flags an expired cert", () => {
    const past = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    call("cert-add", ctxA, { welder: "Old Cert", certType: "AWS D1.1 Structural", expiryDate: past });
    const r = call("cert-status", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.certs[0].standing, "expired");
    assert.equal(r.result.atRiskCount, 1);
  });

  it("cert-status flags expiring-soon within the warn window", () => {
    const soon = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    call("cert-add", ctxA, { welder: "Soon", expiryDate: soon });
    const r = call("cert-status", ctxA, { warnDays: 60 });
    assert.equal(r.result.certs[0].standing, "expiring_soon");
  });

  it("cert-renew extends the expiry date", () => {
    const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const c = call("cert-add", ctxA, { welder: "Renew me", expiryDate: past });
    const future = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    const r = call("cert-renew", ctxA, { certId: c.result.cert.id, expiryDate: future });
    assert.equal(r.ok, true);
    assert.equal(r.result.cert.expiryDate, future);
    const status = call("cert-status", ctxA, {});
    assert.equal(status.result.certs[0].standing, "valid");
  });
});

// ─── Photo documentation ─────────────────────────────────────────────
describe("welding — weld photo documentation", () => {
  it("photo-attach + photo-list + photo-remove round-trip", () => {
    const j = call("job-schedule", ctxA, { title: "Photo job" });
    const a = call("photo-attach", ctxA, { jobId: j.result.job.id, url: "https://x/weld.jpg", stage: "root-pass", caption: "root" });
    assert.equal(a.ok, true);
    assert.equal(a.result.photoCount, 1);
    const l = call("photo-list", ctxA, { jobId: j.result.job.id });
    assert.equal(l.ok, true);
    assert.equal(l.result.photos.length, 1);
    assert.equal(l.result.byStage["root-pass"], 1);
    const rm = call("photo-remove", ctxA, { jobId: j.result.job.id, photoId: a.result.photo.id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.photoCount, 0);
  });

  it("photo-attach rejects a missing url", () => {
    const j = call("job-schedule", ctxA, { title: "No url" });
    const r = call("photo-attach", ctxA, { jobId: j.result.job.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "url_required");
  });
});

// ─── Code reference library ──────────────────────────────────────────
describe("welding — code reference library", () => {
  it("code-search returns all clauses with no query", () => {
    const r = call("code-search", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.results.length > 0);
    assert.ok(r.result.codes.includes("AWS D1.1"));
  });

  it("code-search ranks keyword matches", () => {
    const r = call("code-search", ctxA, { query: "preheat" });
    assert.equal(r.ok, true);
    assert.ok(r.result.results.length >= 1);
    assert.ok(r.result.results[0].body.toLowerCase().includes("preheat"));
  });

  it("code-search filters by code", () => {
    const r = call("code-search", ctxA, { code: "ASME IX" });
    assert.equal(r.ok, true);
    assert.ok(r.result.results.every((c) => c.code === "ASME IX"));
  });
});

// ─── Client portal ───────────────────────────────────────────────────
describe("welding — client portal", () => {
  it("portal-view + portal-approve for an estimate", () => {
    const e = call("estimate-create", ctxA, { title: "Portal quote", lineItems: [{ description: "x", quantity: 1, unitPrice: 300, kind: "labor" }] });
    const s = call("estimate-send", ctxA, { estimateId: e.result.estimate.id });
    const token = s.result.portalToken;
    const v = call("portal-view", ctxB, { token });
    assert.equal(v.ok, true);
    assert.equal(v.result.kind, "estimate");
    assert.equal(v.result.canApprove, true);
    const ap = call("portal-approve", ctxB, { token, decision: "approve", signature: "Client Signature" });
    assert.equal(ap.ok, true);
    assert.equal(ap.result.estimate.status, "accepted");
  });

  it("portal-pay records a client payment against an invoice", () => {
    const e = call("estimate-create", ctxA, { title: "Portal pay", lineItems: [{ description: "x", quantity: 1, unitPrice: 500, kind: "labor" }] });
    const conv = call("estimate-to-job", ctxA, { estimateId: e.result.estimate.id });
    const inv = call("invoice-from-job", ctxA, { jobId: conv.result.job.id });
    const token = inv.result.invoice.portalToken;
    const pay = call("portal-pay", ctxB, { token, amount: 500, method: "card" });
    assert.equal(pay.ok, true);
    assert.equal(pay.result.invoice.status, "paid");
  });

  it("portal-view rejects an invalid token", () => {
    const r = call("portal-view", ctxB, { token: "garbage" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_token");
  });
});

// ─── Operations rollup ───────────────────────────────────────────────
describe("welding — ops-summary", () => {
  it("ops-summary aggregates jobs, pipeline and invoices", () => {
    const e = call("estimate-create", ctxA, { title: "Summary job", lineItems: [{ description: "x", quantity: 1, unitPrice: 800, kind: "labor" }] });
    call("estimate-send", ctxA, { estimateId: e.result.estimate.id });
    const conv = call("estimate-to-job", ctxA, { estimateId: e.result.estimate.id });
    call("invoice-from-job", ctxA, { jobId: conv.result.job.id });
    const r = call("ops-summary", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.outstanding >= 0);
    assert.equal(typeof r.result.activeJobs, "number");
    assert.equal(typeof r.result.certAtRisk, "number");
  });
});
