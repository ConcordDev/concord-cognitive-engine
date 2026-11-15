import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerRetailActions from "../domains/retail.js";

const actions = new Map();
registerRetailActions((domain, name, fn) => actions.set(`${domain}:${name}`, fn));
function call(name, input = {}, userId = "u1") {
  const fn = actions.get(`retail:${name}`);
  assert.ok(fn, `missing action ${name}`);
  return fn({ actor: { userId } }, { id: null, domain: "retail", type: "domain_action", data: input, meta: {} }, input);
}
beforeEach(() => { globalThis._concordSTATE = {}; });

test("FIX-retail-007: customers-update edits in place with add's validations", () => {
  const c = call("customers-add", { name: "Ada", email: "ada@example.com", city: "Troy" }).result.customer;
  const u = call("customers-update", { id: c.id, name: "Ada Lovelace", city: "Albany", acceptsMarketing: false });
  assert.equal(u.ok, true);
  assert.equal(u.result.customer.name, "Ada Lovelace");
  assert.equal(u.result.customer.city, "Albany");
  assert.equal(u.result.customer.email, "ada@example.com"); // untouched keeps
  assert.equal(u.result.customer.acceptsMarketing, false);
  const list = call("customers-list", {});
  assert.equal(list.result.customers.length, 1);
  assert.equal(list.result.customers[0].name, "Ada Lovelace");
  assert.equal(call("customers-update", { id: c.id, email: "not-an-email" }).ok, false);
  assert.equal(call("customers-update", { id: c.id, name: " " }).ok, false);
  assert.equal(call("customers-update", { id: "nope", name: "X" }).ok, false);
});
