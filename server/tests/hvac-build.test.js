// Build tests for the HVAC full-lens build (B2, 2026-11-03) — the slices
// from the lens's filed first-pass review (R5 gate record + R2 full pass,
// determination PROBE-LIVE) and the Lead compilation addendum:
//   S2 — Codes is a corpus and Materials a priced catalog (new verbs over
//        lib/hvac-codes.js + lib/hvac-materials.js; the desk views had no
//        reference machinery at all, cross-check #73(a)/(b)).
//   S4 — Ducts states ONE friction figure per run: the recommendation text
//        cites the at-standard-size rate, the same figure the headline
//        shows (F5: 0.058 headline vs 0.092 text for one run).
// The dialog fix (S1), dashboard aggregation (S3), delete confirmation (F4)
// and payments honesty are frontend behaviour, pinned in the FE suites.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHVACActions from "../domains/hvac.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`hvac.${name}`);
  if (!fn) throw new Error(`hvac.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerHVACActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctx = { actor: { userId: "hvac_build_user" }, userId: "hvac_build_user" };

describe("S2 — Codes corpus", () => {
  it("an unfiltered search returns the whole corpus", () => {
    const r = call("code-search", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 15, `corpus too small: ${r.result.count}`);
    assert.equal(r.result.count, r.result.total);
  });

  it('"EPA" returns the Section 608 entries — the pass\'s exact probe', () => {
    const r = call("code-search", ctx, { q: "EPA" });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 4, `EPA should match the 608 family, got ${r.result.count}`);
    const titles = r.result.entries.map((e) => e.title).join(" · ");
    assert.match(titles, /Venting prohibition/);
    assert.match(titles, /Technician certification/);
  });

  it("a real term returns its reference; a nonsense term returns an honest empty", () => {
    const hit = call("code-search", ctx, { q: "condensate" });
    assert.ok(hit.result.count >= 1);
    assert.equal(hit.result.entries[0].source.includes("IMC") || hit.result.entries[0].summary.toLowerCase().includes("condensate"), true);
    const miss = call("code-search", ctx, { q: "zzzz-not-a-code-term" });
    assert.equal(miss.ok, true);
    assert.equal(miss.result.count, 0);
  });

  it("every entry carries a source, a section, a title and a summary", () => {
    const r = call("code-search", ctx, {});
    for (const e of r.result.entries) {
      assert.ok(e.source && e.section && e.title && e.summary, `incomplete entry ${e.id}`);
    }
  });
});

describe("S2 — Materials catalog", () => {
  it("returns a priced catalog with the reference-price note", () => {
    const r = call("materials-catalog", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 18, `catalog too small: ${r.result.count}`);
    assert.match(r.result.priceNote, /not a quote/i);
    for (const m of r.result.items) {
      assert.ok(m.name && m.unit && m.referencePriceUsd > 0, `unpriced item ${m.name}`);
    }
  });

  it("search narrows the catalog", () => {
    const r = call("materials-catalog", ctx, { q: "refrigerant" });
    assert.ok(r.result.count >= 3);
    assert.ok(r.result.items.every((m) => /refrigerant/i.test(m.name) || /refrigerant/i.test(m.category)));
  });
});

describe("Field Service payments — the summary counts only money still held", () => {
  it("a refunded receipt drops out of collected", () => {
    const pay = call("payment-charge", ctx, { invoiceId: "INV-9", amount: 200, method: "check" });
    assert.equal(pay.ok, true);
    call("payment-charge", ctx, { invoiceId: "INV-10", amount: 50, method: "cash" });
    const refund = call("payment-refund", ctx, { id: pay.result.payment.id });
    assert.equal(refund.ok, true);
    const list = call("payment-list", ctx, {});
    assert.equal(list.result.summary.count, 2);
    assert.equal(list.result.summary.collected, 50);
  });
});

describe("S4 — Ducts: one friction figure per run", () => {
  it("the recommendation cites the at-standard-size figure the headline shows (800 CFM defaults)", () => {
    const r = call("ductulator", ctx, {}, { data: { cfm: 800, shape: "round", method: "velocity", velocityFpm: 900 } });
    assert.equal(r.ok, true);
    const std = r.result.frictionAtStandardSizePer100ft;
    const exact = r.result.frictionRatePer100ft;
    assert.ok(std > 0 && exact > 0 && std !== exact, "the two quantities must differ for this test to mean anything");
    assert.ok(
      r.result.recommendation.includes(String(std)),
      `recommendation must cite the standard-size figure ${std}: ${r.result.recommendation}`,
    );
    assert.ok(
      !r.result.recommendation.includes(`~${exact} in.wg`),
      `recommendation must not state the exact-diameter figure as the run's friction: ${r.result.recommendation}`,
    );
    assert.match(r.result.recommendation, /at that standard size/);
  });

  it("the friction-method recommendation also cites the standard-size figure", () => {
    const r = call("ductulator", ctx, {}, { data: { cfm: 800, shape: "round", method: "friction", frictionRate: 0.08 } });
    assert.equal(r.ok, true);
    assert.ok(r.result.recommendation.includes(String(r.result.frictionAtStandardSizePer100ft)));
  });
});
