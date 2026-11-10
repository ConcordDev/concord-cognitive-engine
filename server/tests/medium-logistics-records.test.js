import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLogisticsActions from "../domains/logistics.js";
import registerInsuranceActions from "../domains/insurance.js";
import registerPaperActions from "../domains/paper.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, params = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  return fn({ actor: { userId: "user_a" } }, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerLogisticsActions(register);
  registerInsuranceActions(register);
  registerPaperActions(register);
});
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("logistics records can be removed by their owner", () => {
  it("drops a proof of delivery when its shipment is deleted", () => {
    const made = call("logistics", "shipments-create", { origin: "A", destination: "B", poNumber: "PO-9" });
    assert.equal(made.ok, true);
    const id = made.result.shipment.id;
    const renamed = call("logistics", "shipments-update", { id, poNumber: "PO-10" });
    assert.equal(renamed.result.shipment.poNumber, "PO-10");
    const pod = call("logistics", "delivery-confirm", { shipmentId: id, signatureName: "Ada" });
    assert.equal(pod.ok, true);
    assert.equal(call("logistics", "pods-list").result.pods.length, 1);
    assert.equal(call("logistics", "shipments-delete", { id }).ok, true);
    assert.equal(call("logistics", "pods-list").result.pods.length, 0);
  });

  it("deletes a pickup, a dock, and a load", () => {
    const carrier = call("logistics", "carriers-add", { name: "North", code: "NTH" });
    const pickup = call("logistics", "pickups-schedule", {
      carrierId: carrier.result.carrier.id, address: "1 Dock St", date: "2026-11-12",
    });
    assert.equal(call("logistics", "pickups-delete", { id: pickup.result.pickup.id }).ok, true);
    assert.equal(call("logistics", "pickups-list").result.pickups.length, 0);
    const dock = call("logistics", "docks-create", { name: "Door 2", facility: "Yard" });
    assert.equal(call("logistics", "docks-delete", { id: dock.result.dock.id }).ok, true);
    const load = call("logistics", "loads-post", { origin: "A", destination: "B", ratePerMile: 2, weightLbs: 100 });
    assert.equal(call("logistics", "loads-delete", { id: load.result.load.id }).ok, true);
    assert.equal(call("logistics", "loads-list").result.loads.length, 0);
  });
});

describe("insurance quotes refuse a blank zip before the broker", () => {
  it("says the zip must be 5 digits", () => {
    const blank = call("insurance", "quotes-compare", { kind: "auto", zip: "", coverage: "standard" });
    assert.equal(blank.ok, false);
    assert.match(blank.message, /5 digits/);
    const live = call("insurance", "quotes-compare", { kind: "auto", zip: "94110", coverage: "standard" });
    assert.match(live.error, /INSURIFY_API_KEY|ZEBRA_API_KEY/);
  });
});

describe("paper abstract reads the manuscript sections", () => {
  it("summarizes section bodies and names both minimums when the text is short", () => {
    const empty = ACTIONS.get("paper.abstractSummarize")(
      { actor: { userId: "user_a" } },
      { id: null, data: { sections: [{ heading: "Abstract", body: "Too short." }] }, meta: {} },
      {},
    );
    assert.match(empty.result.message, /100 characters and 3 sentences/);
    const body = [
      "Quantum computing leverages superposition to process information.",
      "Classical bits are limited to a single state at any moment.",
      "Quantum bits exploit entanglement for parallel computation across states.",
    ].join(" ");
    const ok = ACTIONS.get("paper.abstractSummarize")(
      { actor: { userId: "user_a" } },
      { id: null, data: { sections: [{ heading: "Introduction", body }] }, meta: {} },
      {},
    );
    assert.ok(ok.result.summary.includes("Quantum"));
  });
});
