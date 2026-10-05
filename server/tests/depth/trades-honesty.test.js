// tests/depth/trades-honesty.test.js
//
// Trades actions must not imply something happened when it didn't:
// no fake hosted payment URL, reminders logged as not sent, route distances
// in real (straight-line) miles with a stated drive assumption, and
// utilization over a real window.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("trades — honest outputs", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("trades-honesty"); });

  it("payments-create-link records a request with no fake checkout URL", async () => {
    const r = await lensRun("trades", "payments-create-link", { params: { invoiceRef: "INV-9", amount: 50 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.payment.hostedUrl, null);
    assert.equal(r.result.payment.status, "pending");
  });

  it("notifications-send logs the reminder as not sent", async () => {
    const r = await lensRun("trades", "notifications-send", { params: { channel: "sms", recipient: "555-0100", message: "On the way" } }, ctx);
    assert.equal(r.result.notification.status, "not_sent");
    assert.match(r.result.notification.delivery, /nothing was sent/);
  });

  it("route-optimize returns great-circle miles; with no start it begins at the first stop", async () => {
    // SF → Oakland ≈ 8.3 mi straight-line.
    const r = await lensRun("trades", "route-optimize", { params: { stops: [
      { id: "sf", lat: 37.7749, lng: -122.4194 },
      { id: "oak", lat: 37.8044, lng: -122.2712 },
    ] } }, ctx);
    assert.equal(r.result.ordered[0].id, "sf");
    assert.equal(r.result.ordered[0].distanceFromPrev, 0);
    assert.equal(r.result.startedAt, "first stop");
    assert.ok(r.result.totalMiles > 7.5 && r.result.totalMiles < 9, `totalMiles ${r.result.totalMiles}`);
    assert.equal(r.result.estimatedDriveMin, Math.round((r.result.totalMiles / 30) * 60));
  });

  it("report-overview utilization covers the last 24 h, not all time", async () => {
    const r = await lensRun("trades", "report-overview", { params: {} }, ctx);
    assert.equal(r.result.labor.window, "last 24 h");
    assert.ok(r.result.labor.utilization >= 0 && r.result.labor.utilization <= 100);
  });
});
