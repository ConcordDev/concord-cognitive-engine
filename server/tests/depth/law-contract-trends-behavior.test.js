// tests/depth/law-contract-trends-behavior.test.js — REAL behavioral tests
// for law.contract-trends (server/domains/law.js ~line 1185), the deeper
// trend-analytics macro that closes docs/lens-specs/law-capability-map.md's
// "Deeper trend analytics is GENUINELY MISSING" gap: cycle-time-to-signature,
// spend-by-counterparty-by-month, and renewal-rate-by-month.
//
// contract-create/contract-sign/obligation-add don't accept a caller-supplied
// timestamp, so multi-month fixtures are built by creating real contracts
// through the macro (exercising the real validation/CRUD path) and then
// directly patching their createdAt/signatures fields in the shared in-memory
// STATE — the same direct-STATE pattern used by
// tests/depth/plumbing-behavior.test.js and tests/depth/hub-behavior.test.js.
// Obligation due dates ARE settable via params, so renewal-rate fixtures go
// entirely through the macro layer.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";

describe("law — contract-trends: hand-computed fixture", () => {
  let ctx, STATE;
  before(async () => {
    ctx = await depthCtx("law-trends-fixture");
    ({ STATE } = await load());
  });

  it("computes cycle-time-to-signature, spend-by-counterparty-by-month, and renewal-rate-by-month exactly", async () => {
    const userId = ctx.actor.userId;

    // Three contracts, created via the real macro so title/type/value
    // validation is exercised, then dates patched directly for a
    // controlled multi-month fixture (contract-create always stamps "now").
    const c1 = await lensRun("law", "contract-create", { params: { title: "C1", counterparty: "Acme", value: 1000 } }, ctx);
    const c2 = await lensRun("law", "contract-create", { params: { title: "C2", counterparty: "Acme", value: 2000 } }, ctx);
    const c3 = await lensRun("law", "contract-create", { params: { title: "C3", counterparty: "Beta", value: 500 } }, ctx);

    const list = STATE.lawLens.contracts.get(userId);
    const cc1 = list.find((c) => c.id === c1.result.contract.id);
    const cc2 = list.find((c) => c.id === c2.result.contract.id);
    const cc3 = list.find((c) => c.id === c3.result.contract.id);

    // Cycle-time fixture: cc1 created Jan 5, signed Jan 10 -> 5 days.
    // cc2 created Jan 15, signed Jan 25 -> 10 days. cc3 has NO signature,
    // so it must be excluded from cycle-time entirely (never fabricated).
    cc1.createdAt = "2026-01-05T00:00:00.000Z";
    cc1.signatures.push({ party: "Alice", signedAt: "2026-01-10T00:00:00.000Z" });
    cc2.createdAt = "2026-01-15T00:00:00.000Z";
    cc2.signatures.push({ party: "Bob", signedAt: "2026-01-25T00:00:00.000Z" });
    cc3.createdAt = "2026-02-01T00:00:00.000Z";
    // cc3 deliberately left unsigned.

    // Renewal obligations, added through the real macro (dueDate IS
    // settable via params, so no direct-STATE patching needed here).
    // Jan 2026: 2 renewal obligations, 1 completed -> 50%.
    const ob1 = await lensRun("law", "obligation-add", { params: { contractId: cc1.id, label: "Renew A", kind: "renewal", dueDate: "2026-01-20" } }, ctx);
    await lensRun("law", "obligation-add", { params: { contractId: cc1.id, label: "Renew B", kind: "renewal", dueDate: "2026-01-25" } }, ctx);
    await lensRun("law", "obligation-complete", { params: { contractId: cc1.id, obligationId: ob1.result.obligation.id } }, ctx);
    // Feb 2026: 1 renewal obligation, 1 completed -> 100%.
    const ob3 = await lensRun("law", "obligation-add", { params: { contractId: cc2.id, label: "Renew C", kind: "renewal", dueDate: "2026-02-05" } }, ctx);
    await lensRun("law", "obligation-complete", { params: { contractId: cc2.id, obligationId: ob3.result.obligation.id } }, ctx);
    // A non-renewal obligation in Feb must NOT count toward renewal rate.
    await lensRun("law", "obligation-add", { params: { contractId: cc3.id, label: "Deliverable", kind: "delivery", dueDate: "2026-02-10" } }, ctx);

    const r = await lensRun("law", "contract-trends", {}, ctx);
    const { cycleTime, spendTrend, renewalTrend } = r.result;

    // --- cycle-time-to-signature ---
    // Hand math: samples [5, 10] -> avg 7.5, median 7.5 (mean of the two
    // middle values since n=2 is even), min 5, max 10, count 2 (cc3 excluded).
    assert.equal(cycleTime.hasData, true);
    assert.equal(cycleTime.count, 2);
    assert.equal(cycleTime.avgDays, 7.5);
    assert.equal(cycleTime.medianDays, 7.5);
    assert.equal(cycleTime.minDays, 5);
    assert.equal(cycleTime.maxDays, 10);
    assert.ok(cycleTime.samples.every((s) => s.contractId !== cc3.id));

    // --- spend-by-counterparty-by-month ---
    // Hand math: Jan 2026 Acme = 1000 + 2000 = 3000. Feb 2026 Beta = 500.
    assert.equal(spendTrend.hasData, true);
    assert.equal(spendTrend.hasTrend, true); // 2 distinct months
    assert.deepEqual(spendTrend.months, ["2026-01", "2026-02"]);
    assert.ok(spendTrend.counterparties.includes("Acme"));
    assert.ok(spendTrend.counterparties.includes("Beta"));
    const jan = spendTrend.series.find((row) => row.month === "2026-01");
    const feb = spendTrend.series.find((row) => row.month === "2026-02");
    assert.equal(jan.Acme, 3000);
    assert.equal(jan.Beta ?? 0, 0);
    assert.equal(feb.Beta, 500);
    assert.equal(feb.Acme ?? 0, 0);

    // --- renewal-rate-by-month ---
    // Hand math: Jan total 2, completed 1 -> 50.00%. Feb total 1, completed 1 -> 100%.
    assert.equal(renewalTrend.hasData, true);
    assert.equal(renewalTrend.hasTrend, true); // 2 distinct months
    const janR = renewalTrend.series.find((row) => row.month === "2026-01");
    const febR = renewalTrend.series.find((row) => row.month === "2026-02");
    assert.equal(janR.total, 2);
    assert.equal(janR.completed, 1);
    assert.equal(janR.renewalRate, 50);
    assert.equal(febR.total, 1);
    assert.equal(febR.completed, 1);
    assert.equal(febR.renewalRate, 100);
  });
});

describe("law — contract-trends: honest empty/insufficient-history states", () => {
  it("zero contracts: every bucket reports hasData:false with no fabricated series", async () => {
    const ctx = await depthCtx("law-trends-empty");
    const r = await lensRun("law", "contract-trends", {}, ctx);
    const { cycleTime, spendTrend, renewalTrend } = r.result;
    assert.equal(cycleTime.hasData, false);
    assert.equal(cycleTime.count, 0);
    assert.equal(cycleTime.avgDays, null);
    assert.deepEqual(cycleTime.samples, []);
    assert.equal(spendTrend.hasData, false);
    assert.equal(spendTrend.hasTrend, false);
    assert.deepEqual(spendTrend.series, []);
    assert.equal(renewalTrend.hasData, false);
    assert.equal(renewalTrend.hasTrend, false);
    assert.deepEqual(renewalTrend.series, []);
  });

  it("2 contracts, no signatures, no obligations, same month: honest 'not enough data' — not a fabricated trend line", async () => {
    const ctx = await depthCtx("law-trends-thin");
    await lensRun("law", "contract-create", { params: { title: "Thin A", counterparty: "Acme", value: 100 } }, ctx);
    await lensRun("law", "contract-create", { params: { title: "Thin B", counterparty: "Acme", value: 200 } }, ctx);
    const r = await lensRun("law", "contract-trends", {}, ctx);
    const { cycleTime, spendTrend, renewalTrend } = r.result;
    // No signatures anywhere -> cycle-time must never fabricate a value.
    assert.equal(cycleTime.hasData, false);
    assert.equal(cycleTime.avgDays, null);
    // Real spend data exists (both contracts, real values) but both were
    // created in the same real-world month, so there's exactly one bucket —
    // honestly not enough distinct periods to call it a trend.
    assert.equal(spendTrend.hasData, true);
    assert.equal(spendTrend.hasTrend, false);
    assert.equal(spendTrend.months.length, 1);
    // No obligations at all -> renewal trend has no data to report.
    assert.equal(renewalTrend.hasData, false);
    assert.deepEqual(renewalTrend.series, []);
  });

  it("a single renewal obligation reports hasData:true but hasTrend:false (1 period is not a trend)", async () => {
    const ctx = await depthCtx("law-trends-single-renewal");
    const c = await lensRun("law", "contract-create", { params: { title: "Solo Renewal" } }, ctx);
    await lensRun("law", "obligation-add", { params: { contractId: c.result.contract.id, label: "Renew", kind: "renewal", dueDate: "2026-03-01" } }, ctx);
    const r = await lensRun("law", "contract-trends", {}, ctx);
    const { renewalTrend } = r.result;
    assert.equal(renewalTrend.hasData, true);
    assert.equal(renewalTrend.hasTrend, false);
    assert.equal(renewalTrend.series.length, 1);
    assert.equal(renewalTrend.series[0].total, 1);
    assert.equal(renewalTrend.series[0].completed, 0);
    assert.equal(renewalTrend.series[0].renewalRate, 0);
  });
});
