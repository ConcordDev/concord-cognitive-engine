import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFitness from "../domains/fitness.js";
import registerSecurity from "../domains/security.js";
import registerLegal from "../domains/legal.js";
import registerNonprofit from "../domains/nonprofit.js";
import registerAccounting from "../domains/accounting.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(domain, name, params) {
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerFitness(register);
  registerSecurity(register);
  registerLegal(register);
  registerNonprofit(register);
  registerAccounting(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("validation sweep", () => {
  it("refuses a negative workout distance and a nonsense duration", () => {
    const dist = call("fitness", "activity-create", { type: "run", durationSec: 600, distanceKm: -1 });
    assert.equal(dist.ok, false);
    assert.equal(dist.field, "distanceKm");
    const dur = call("fitness", "activity-create", { type: "run", durationSec: "abc", distanceKm: 1 });
    assert.equal(dur.ok, false);
    assert.equal(dur.field, "durationSec");
    const ok = call("fitness", "activity-create", { type: "run", durationSec: 600, distanceKm: 5 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.activity.distanceKm, 5);
  });

  it("refuses a CVSS score outside 0 to 10 instead of clamping it", () => {
    const bad = call("security", "vuln-add", { title: "Open port", cvss: 99 });
    assert.equal(bad.ok, false);
    assert.equal(bad.field, "cvss");
    const ok = call("security", "vuln-add", { title: "Open port", cvss: 7.5 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.vuln.cvss, 7.5);
  });

  it("refuses an hourly rate above 10000", () => {
    const bad = call("legal", "matters-create", { name: "Ada v. Bea", hourlyRate: 999999999 });
    assert.equal(bad.ok, false);
    assert.equal(bad.field, "hourlyRate");
    const ok = call("legal", "matters-create", { name: "Ada v. Bea", hourlyRate: 350 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.matter.hourlyRate, 350);
  });

  it("refuses a donor name over 160 characters and a negative gift", () => {
    const name = call("nonprofit", "donor-create", { name: "n".repeat(300) });
    assert.equal(name.ok, false);
    assert.equal(name.field, "name");
    const donor = call("nonprofit", "donor-create", { name: "Ada" });
    assert.equal(donor.ok, true);
    const campaign = call("nonprofit", "campaign-create", { name: "Roof", goal: 100 });
    if (campaign.ok) {
      const gift = call("nonprofit", "donation-log", { campaignId: campaign.result.campaign.id, amount: -5 });
      assert.equal(gift.ok, false);
      assert.equal(gift.field, "amount");
    }
  });

  it("refuses an expense date that is not a calendar day", () => {
    const bad = call("accounting", "expenses-create", { amount: 12, accountId: "x", date: "2026-13-45" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /YYYY-MM-DD/);
    const journal = call("accounting", "je-post", { date: "2026-13-45", lines: [{ accountId: "a", debit: 1 }, { accountId: "b", credit: 1 }] });
    assert.equal(journal.ok, false);
    assert.match(journal.error, /YYYY-MM-DD/);
  });
});
