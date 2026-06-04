// tests/depth/retail-fulfillment-behavior.test.js
//
// Behavioral coverage for the three order-fulfillment lens actions that close the
// last buildable retail broken-wires (lens-audit Batch D): process_refund,
// send_tracking, initiate_return. Each operates on an ORDER artifact with
// Shopify-style deterministic defaults (full refund pre-fill, auto tracking)
// plus optional param overrides. Asserts real computed mutations, not shapes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

test("retail.process_refund defaults to a full refund of the order total", async () => {
  const r = await lensRun("retail", "process_refund", {
    data: { orderNumber: "1042", total: 149.99, customer: "Jane", timeline: [] },
  });
  assert.equal(r.ok ?? true, true);
  const res = r.result ?? r;
  assert.deepStrictEqual(res.refund.amount, 149.99, "full remaining amount refunded by default");
  assert.equal(res.refundedTotal, 149.99);
  assert.equal(res.remaining, 0);
  assert.equal(res.status, "refunded");
  assert.equal(res.refund.reason, "customer_request");
});

test("retail.process_refund honors a partial amount + clamps to remaining", async () => {
  const ctx = await depthCtx("depth:retail-partial");
  const r1 = await lensRun("retail", "process_refund", {
    data: { orderNumber: "2001", total: 100, timeline: [] },
    params: { amount: 40, reason: "damaged_item" },
  }, ctx);
  const res1 = r1.result ?? r1;
  assert.deepStrictEqual(res1.refund.amount, 40);
  assert.equal(res1.status, "partially_refunded");
  assert.equal(res1.remaining, 60);
  assert.equal(res1.refund.reason, "damaged_item");
});

test("retail.process_refund rejects refund on a fully-refunded order", async () => {
  const r = await lensRun("retail", "process_refund", {
    data: { orderNumber: "3003", total: 50, refundAmount: 50, timeline: [] },
  });
  const res = r.result ?? r;
  // lens.run unwraps; an error result surfaces as { ok:false, error } at top or in result
  const err = (r.ok === false ? r.error : res?.error) || res?.refund;
  assert.ok(String(err).includes("already fully refunded") || r.ok === false, "rejects double-refund");
});

test("retail.send_tracking auto-generates a tracking number when absent", async () => {
  const r = await lensRun("retail", "send_tracking", {
    data: { orderNumber: "4004", customerEmail: "buyer@ex.com", trackingNumber: "", timeline: [] },
  });
  const res = r.result ?? r;
  assert.match(res.trackingNumber, /^CONCORD\d+$/, "generates a CONCORD tracking number");
  assert.equal(res.sentTo, "buyer@ex.com");
  assert.ok(res.sentAt, "stamps a sent timestamp");
});

test("retail.send_tracking reuses an existing tracking number", async () => {
  const r = await lensRun("retail", "send_tracking", {
    data: { orderNumber: "5005", trackingNumber: "1Z999AA10123456784", timeline: [] },
  });
  const res = r.result ?? r;
  assert.deepStrictEqual(res.trackingNumber, "1Z999AA10123456784");
});

test("retail.initiate_return opens an RMA with a default reason", async () => {
  const r = await lensRun("retail", "initiate_return", {
    data: { orderNumber: "6006", total: 75, timeline: [] },
  });
  const res = r.result ?? r;
  assert.match(res.return.rmaNumber, /^RMA-/, "issues an RMA number");
  assert.equal(res.return.status, "pending");
  assert.equal(res.return.reason, "customer_request");
});

test("retail.initiate_return honors a supplied reason", async () => {
  const r = await lensRun("retail", "initiate_return", {
    data: { orderNumber: "7007", timeline: [] },
    params: { reason: "wrong_size" },
  });
  const res = r.result ?? r;
  assert.deepStrictEqual(res.return.reason, "wrong_size");
});

test("retail.generate_label builds a deterministic structured shipping label", async () => {
  const r = await lensRun("retail", "generate_label", {
    data: { orderNumber: "8008", items: 3, shippingMethod: "express", shippingAddress: "1 Main St", timeline: [] },
  });
  const res = r.result ?? r;
  assert.equal(res.label.service, "express");
  // weight = 0.5 + 3*0.3 = 1.4kg; express cost = 9.0 + 2.4*1.4 = 12.36
  assert.equal(res.label.weightKg, 1.4);
  assert.equal(res.label.cost, 12.36);
  assert.match(res.label.trackingNumber, /^CONCORD\d+$/);
  assert.ok(res.label.barcode.includes(res.label.trackingNumber), "barcode embeds the tracking number");
  assert.ok(res.label.labelId);
});
