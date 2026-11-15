// FIX-logistics-012 — shipment tracking's unavailable state is honest
// and visible: shipments-list reports whether live tracking is
// configured at all (so the panel can say so before submit), and the
// shipment-track refusal no longer advertises a USPS_TRACKING_USERID
// fallback that no code path implements (the refusal fired even with
// that variable set).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLogisticsActions from "../domains/logistics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`logistics.${name}`);
  assert.ok(fn, `logistics.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerLogisticsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("logistics tracking configuration honesty (FIX-logistics-012)", () => {
  it("shipments-list reports trackingConfigured=false when no broker key is set", async () => {
    delete process.env.SHIPENGINE_API_KEY;
    delete process.env.EASYPOST_API_KEY;
    const r = await call("shipments-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.trackingConfigured, false);
    assert.deepEqual(r.result.shipments, []);
  });

  it("shipments-list reports trackingConfigured=true when a broker key is set", async () => {
    process.env.SHIPENGINE_API_KEY = "<redacted>";
    try {
      const r = await call("shipments-list", ctxA, {});
      assert.equal(r.result.trackingConfigured, true);
    } finally {
      delete process.env.SHIPENGINE_API_KEY;
    }
  });

  it("the not-configured refusal does not promise a USPS fallback that does not exist", async () => {
    delete process.env.SHIPENGINE_API_KEY;
    delete process.env.EASYPOST_API_KEY;
    process.env.USPS_TRACKING_USERID = "someone";
    try {
      const r = await call("shipment-track", ctxA, { trackingNumber: "9400111899223856928499", carrier: "USPS" });
      assert.equal(r.ok, false);
      assert.doesNotMatch(r.error, /USPS_TRACKING_USERID/);
      assert.match(r.error, /not configured/i);
    } finally {
      delete process.env.USPS_TRACKING_USERID;
    }
  });
});
