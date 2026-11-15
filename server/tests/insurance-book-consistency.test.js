/**
 * FIX-insurance-002: the Agency Workbench and the book disagreed.
 * (a) FNOL intake wrote only to the AMS store — claim-list never saw
 *     the claim. (b) The renewal pipeline froze daysUntil/stage at
 *     build time, so a past-due row still read "renews in 1d".
 * (c) client-add stored free text ('whenever') as a birth date.
 */
import { describe, it, expect, beforeEach } from "vitest";
import registerInsuranceActions from "../domains/insurance.js";

const actions = new Map();
registerInsuranceActions((domain, action, handler) => actions.set(`${domain}:${action}`, handler));
const ctx = { actor: { userId: "u1" }, userId: "u1" };
const run = (action, params = {}, artifact = null) => actions.get(`insurance:${action}`)(ctx, artifact, params);
const DAY = 86400000;
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);

describe("insurance book consistency", () => {
  beforeEach(() => { globalThis._concordSTATE = {}; });

  it("FNOL intake files a linked claim in the book", () => {
    const pol = run("policy-add", { carrier: "Acme Mutual", policyNumber: "P-1", kind: "auto", annualPremium: 1200 });
    expect(pol.ok).toBe(true);
    const f = run("fnol-intake", { policyId: pol.result.policy.id, description: "Rear-ended at a light", estimatedLoss: 3000 });
    expect(f.ok).toBe(true);
    expect(f.result.fnol.claimId).toBeTruthy();
    const claims = run("claim-list").result.claims;
    expect(claims).toHaveLength(1);
    expect(claims[0].fnolId).toBe(f.result.fnol.id);
    expect(claims[0].claimAmount).toBe(3000);
    expect(claims[0].policyNumber).toBe("P-1");
    // The AMS list still shows exactly the one FNOL (no double count).
    expect(run("fnol-list").result.count).toBe(1);
  });

  it("renewal list recomputes a stale row: past-due reads lapsed, not 'renews in 1d'", () => {
    const S = globalThis._concordSTATE;
    S.insAms = { renewalPipeline: new Map([["u1", [
      { id: "rnw_1", policyId: "pol_1", renewalDate: dayStr(Date.now()), daysUntil: 1, stage: "to_quote" },
      { id: "rnw_2", policyId: "pol_2", renewalDate: dayStr(Date.now() + 10 * DAY), daysUntil: 99, stage: "quoted" },
    ]]]) };
    const list = run("renewal-pipeline-list").result;
    const stale = list.pipeline.find((r) => r.id === "rnw_1");
    expect(stale.daysUntil).toBe(Math.floor((new Date(stale.renewalDate + "T00:00:00Z").getTime() - Date.now()) / DAY));
    expect(stale.daysUntil).toBeLessThan(0);
    expect(stale.stage).toBe("lapsed");
    const future = list.pipeline.find((r) => r.id === "rnw_2");
    expect(future.daysUntil).toBe(9);
    expect(future.stage).toBe("quoted");
    expect(list.byStage.lapsed).toBe(1);
  });

  it("client-add refuses a non-date dob and stores a real one", () => {
    const bad = run("client-add", { name: "Sam", dob: "whenever" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/dob must be a real date/);
    const good = run("client-add", { name: "Sam", dob: "1990-05-17" });
    expect(good.ok).toBe(true);
    expect(good.result.client.dob).toBe("1990-05-17");
    const none = run("client-add", { name: "Jo" });
    expect(none.result.client.dob).toBeNull();
  });
});
