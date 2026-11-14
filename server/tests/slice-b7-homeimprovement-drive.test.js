import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHomeImprovementActions from "../domains/homeimprovement.js";

const actions = new Map();
registerHomeImprovementActions((domain, name, fn) => actions.set(`${domain}:${name}`, fn));
function call(name, input = {}, userId = "u1") {
  const fn = actions.get(`home-improvement:${name}`);
  assert.ok(fn, `missing action ${name}`);
  return fn({ actor: { userId } }, { id: null, domain: "home-improvement", type: "domain_action", data: input, meta: {} }, input);
}
beforeEach(() => { globalThis._concordSTATE = {}; });

test("FIX-home-improvement-011: board/inventory/maintenance/pro updates round-trip", () => {
  const board = call("board-add", { name: "Kitchen dreams", room: "kitchen" }).result.board;
  const upd = call("board-update", { id: board.id, name: "Kitchen, final", description: "white oak" });
  assert.equal(upd.ok, true);
  assert.equal(upd.result.board.name, "Kitchen, final");
  assert.equal(upd.result.board.description, "white oak");
  assert.equal(upd.result.board.room, "kitchen"); // untouched fields keep
  assert.equal(call("board-update", { id: board.id, name: "  " }).ok, false);

  const asset = call("inventory-add", { name: "Fridge", brand: "OldBrand" }).result.asset;
  const au = call("inventory-update", { id: asset.id, brand: "NewBrand", serial: "SN-9" });
  assert.equal(au.result.asset.brand, "NewBrand");
  assert.equal(au.result.asset.serial, "SN-9");
  assert.equal(au.result.asset.name, "Fridge");

  const rem = call("maintenance-add", { task: "Clean gutters" }).result.reminder;
  const mu = call("maintenance-update", { id: rem.id, task: "Clean gutters + downspouts", intervalDays: 180 });
  assert.equal(mu.result.reminder.task, "Clean gutters + downspouts");
  assert.equal(mu.result.reminder.intervalDays, 180);

  const pro = call("pro-add", { name: "Pat Plumber", phone: "555-1" }).result.pro;
  const pu = call("pro-update", { id: pro.id, phone: "555-2", license: "LIC-77" });
  assert.equal(pu.result.pro.phone, "555-2");
  assert.equal(pu.result.pro.license, "LIC-77");
  assert.equal(pu.result.pro.name, "Pat Plumber");
});
