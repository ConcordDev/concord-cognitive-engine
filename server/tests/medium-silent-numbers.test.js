import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerInheritance from "../domains/inheritance.js";
import registerHr from "../domains/hr.js";
import registerPets from "../domains/pets.js";
import registerPlumbing from "../domains/plumbing.js";
import registerStaking from "../domains/staking.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(domain, name, params) {
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerInheritance(register);
  registerHr(register);
  registerPets(register);
  registerPlumbing(register);
  registerStaking(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("bad numbers are refused with a message", () => {
  it("refuses a beneficiary share outside 0 to 100", () => {
    const high = call("inheritance", "add_beneficiary", { name: "Greedy", sharePct: 101 });
    assert.equal(high.ok, false);
    assert.match(high.message, /0 to 100/);
    const low = call("inheritance", "add_beneficiary", { name: "Greedy", sharePct: -5 });
    assert.equal(low.ok, false);
    const ok = call("inheritance", "add_beneficiary", { name: "Mira", sharePct: 40 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.beneficiary.sharePct, 40);
  });

  it("refuses a salary that is negative or not a number, and an email with no domain", () => {
    assert.equal(call("hr", "employee-add", { name: "Ada", salary: -5 }).ok, false);
    assert.match(call("hr", "employee-add", { name: "Ada", salary: "abc" }).message, /Salary/);
    assert.match(call("hr", "employee-add", { name: "Ada", email: "not-an-email" }).message, /Email/);
    const ok = call("hr", "employee-add", { name: "Ada", salary: 90000, email: "ada@example.com" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.employee.salary, 90000);
  });

  it("refuses a pet weight that is not a positive number", () => {
    assert.match(call("pets", "pet-add", { name: "Rex", weightKg: "abc" }).message, /Weight/);
    assert.equal(call("pets", "pet-add", { name: "Rex", weightKg: -5 }).ok, false);
    const pet = call("pets", "pet-add", { name: "Rex" });
    assert.equal(pet.ok, true);
    assert.equal(pet.result.pet.weightKg, 0);
    const logged = call("pets", "weight-log", { petId: pet.result.pet.id, weightKg: -5 });
    assert.equal(logged.ok, false);
    assert.match(logged.message, /Weight/);
  });

  it("refuses a negative plumbing cost instead of storing zero", () => {
    const bad = call("plumbing", "priceItemAdd", { name: "Valve", cost: -5, markupPct: 10 });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /Cost/);
    const ok = call("plumbing", "priceItemAdd", { name: "Valve", cost: 10, markupPct: 50 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.item.price, 15);
  });

  it("names the staking principal limit instead of returning only a code", () => {
    const r = call("staking", "estimate_rewards", { poolId: "core", principalCc: 9999999999, months: 6 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_principalCc");
    assert.match(r.message, /Principal/);
  });
});
