import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDefense from "../domains/defense.js";
const ACTIONS = new Map();
function register(d, n, fn) { ACTIONS.set(`${d}.${n}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`defense.${name}`);
  assert.ok(fn, `defense.${name} missing`);
  return await fn(ctx, { id: null, domain: "defense", type: "domain_action", data: params, meta: {} }, params);
}
before(() => registerDefense(register));
beforeEach(() => { globalThis._concordSTATE = {}; });
const u1 = { actor: { userId: "u1" } };

describe("FIX-defense-003 update verbs", () => {
  it("cop-update edits a plotted marker in place", async () => {
    const a = await call("cop-add", u1, { kind: "operation", label: "FOB Alpha", lat: 10, lon: 20 });
    assert.equal(a.ok, true);
    const id = a.result.marker.id;
    const u = await call("cop-update", u1, { id, label: "FOB Alpha North", lat: 11.5, note: "moved" });
    assert.equal(u.ok, true);
    assert.equal(u.result.marker.label, "FOB Alpha North");
    assert.equal(u.result.marker.lat, 11.5);
    assert.equal(u.result.marker.lon, 20); // untouched keeps
    assert.equal((await call("cop-update", u1, { id, lat: 999 })).ok, false);
    assert.equal((await call("cop-update", u1, { id, label: " " })).ok, false);
  });

  it("supply-update edits a request; comms-update edits a log entry", async () => {
    const s = await call("supply-request", u1, { item: "Fuel", quantity: 10, priority: "routine" });
    const sid = s.result.request.id;
    const su = await call("supply-update", u1, { id: sid, quantity: 25, priority: "urgent", destination: "Depot 9" });
    assert.equal(su.ok, true);
    assert.equal(su.result.request.quantity, 25);
    assert.equal(su.result.request.priority, "urgent");
    assert.equal(su.result.request.item, "Fuel");
    assert.equal((await call("supply-update", u1, { id: sid, quantity: 0 })).ok, false);

    const c = await call("comms-post", u1, { channel: "ops", body: "All quiet" });
    const cid = c.result.message.id;
    const cu = await call("comms-update", u1, { id: cid, body: "Contact at grid 4" });
    assert.equal(cu.ok, true);
    assert.equal(cu.result.message.body, "Contact at grid 4");
    assert.equal((await call("comms-update", u1, { id: cid, body: "" })).ok, false);
  });

  it("threat-update now carries name + severity (with history)", async () => {
    const t = await call("threat-add", u1, { name: "Unknown patrol", severity: "low" });
    const tid = t.result.threat.id;
    const tu = await call("threat-update", u1, { id: tid, name: "Armored patrol", severity: "high" });
    assert.equal(tu.ok, true);
    assert.equal(tu.result.threat.name, "Armored patrol");
    assert.equal(tu.result.threat.severity, "high");
    assert.ok(tu.result.threat.history.some((h) => h.event === "severity:high"));
  });
});
