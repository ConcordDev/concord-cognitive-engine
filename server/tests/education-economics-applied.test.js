// education-economics must only report a wallet move as `applied` when the
// wallet accepted it. A wallet answering { ok:false } moved no funds.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as mod from "../lib/education-economics.js";

const Cls = mod.EducationEconomics || mod.default;

describe("education-economics applied flag", () => {
  it("credit refused by the wallet is not applied", async () => {
    const econ = new Cls({ walletService: { credit: async () => ({ ok: false, error: "invalid_mint_amount" }) } });
    const r = await econ._credit("s1", 5, "test_reward");
    assert.equal(r.applied, false);
    assert.equal(r.walletError, "invalid_mint_amount");
  });

  it("credit accepted by the wallet is applied", async () => {
    const econ = new Cls({ walletService: { credit: async () => ({ ok: true }) } });
    const r = await econ._credit("s1", 5, "test_reward");
    assert.equal(r.applied, true);
  });

  it("charge refused by the wallet is not applied", async () => {
    const econ = new Cls({ walletService: { debit: async () => ({ ok: false, reason: "insufficient" }) } });
    const r = await econ._charge("s1", 5, "test_fee");
    assert.equal(r.applied, false);
  });
});
