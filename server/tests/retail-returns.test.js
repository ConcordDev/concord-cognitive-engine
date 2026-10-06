import { test } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = globalThis._concordSTATE || {};
const { default: registerRetail } = await import("../domains/retail.js");
const H = new Map();
registerRetail((_d, n, fn) => H.set(n, fn));
const ctx = { actor: { userId: "ret-u1" }, userId: "ret-u1" };
const call = (n, p = {}) => H.get(n)(ctx, { data: p }, p);

function seedOrder() {
  call("orders-list");
  const st = Object.values(globalThis._concordSTATE).find((v) => v && v.orders instanceof Map);
  st.orders.set("ret-u1", [{ id: "o1", number: "#1001", total: 59.5, lines: [] }]);
}

test("returns: open, refuse duplicates and skipped states, walk to closed", () => {
  seedOrder();
  const c = call("returns-create", { orderId: "o1", reason: "defective" });
  assert.equal(c.ok, true);
  assert.equal(c.result.return.status, "pending");
  assert.match(c.result.return.rmaNumber, /^RMA-/);
  assert.equal(call("returns-create", { orderId: "o1" }).ok, false);
  const id = c.result.return.id;
  assert.equal(call("returns-update", { id, status: "received" }).ok, false);
  for (const s of ["approved", "received", "closed"]) assert.equal(call("returns-update", { id, status: s }).result.return.status, s);
  assert.equal(call("returns-update", { id, status: "approved" }).ok, false);
  assert.equal(call("returns-create", { orderId: "o1" }).ok, true, "a closed return lets the order be returned again");
  assert.equal(call("returns-list").result.returns.length, 2);
});

test("returns: unknown order is refused", () => {
  assert.equal(call("returns-create", { orderId: "nope" }).ok, false);
});
