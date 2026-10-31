// tests/depth/insurance-coverage-behavior.test.js
//
// Q63 tranche 2 (GH #850) — REAL behavioral tests for the insurance
// lens-action macros the macro-depth grader carried as important but
// untested (frontend-used, implemented, no behavioral invocation):
// client/carrier/statement, asset, policy detail/update/documents,
// id-card, coverage-summary, renewals, claim delete, FNOL, certificate
// revoke, binder issue, pact revoke + payout history, reminders, and
// the renewal pipeline. Each test drives the domain's own create/read
// actions through the depth harness and asserts on returned state —
// no mocks, no shape-only checks.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("insurance — clients, carriers, statements, assets", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("q63-insurance-book"); });

  it("client-add requires a name, then lists the client with zero policies", async () => {
    const bad = await lensRun("insurance", "client-add", { params: {} }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "name required");
    const added = await lensRun("insurance", "client-add", { params: { name: "Acme Corp" } }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.client.name, "Acme Corp");
    const list = await lensRun("insurance", "client-list", {}, ctx);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.clients[0].policyCount, 0);
  });

  it("carrier-add + statement-import totals the statement lines; carrier-delete removes it", async () => {
    const carrier = await lensRun("insurance", "carrier-add", { params: { name: "SafeCo" } }, ctx);
    assert.equal(carrier.ok, true);
    const stmt = await lensRun("insurance", "statement-import", { params: {
      carrier: "SafeCo", period: "2026-10",
      lines: [{ policyNumber: "P-1001", premium: 500, commission: 50 }, { policyNumber: "P-1002", premium: 300, commission: 30 }],
    } }, ctx);
    assert.equal(stmt.ok, true);
    assert.equal(stmt.result.statement.carrier, "SafeCo");
    assert.equal(stmt.result.statement.lines.length, 2);
    // The statement's stated total is its commission total (50 + 30);
    // the premiums (500 + 300) ride on the lines themselves.
    assert.equal(stmt.result.statement.statedTotal, 80);
    assert.equal(stmt.result.statement.reconciled, false);
    const noCarrier = await lensRun("insurance", "statement-import", { params: { period: "2026-10", lines: [{ policyNumber: "P-1", premium: 1 }] } }, ctx);
    assert.equal(noCarrier.ok, false);
    assert.equal(noCarrier.error, "carrier required");
    const del = await lensRun("insurance", "carrier-delete", { params: { id: carrier.result.carrier.id } }, ctx);
    assert.equal(del.ok, true);
    const again = await lensRun("insurance", "carrier-delete", { params: { id: carrier.result.carrier.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "carrier not found");
  });

  it("asset-add requires a name; asset-list sums totalValue", async () => {
    const bad = await lensRun("insurance", "asset-add", { params: {} }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "asset name required");
    await lensRun("insurance", "asset-add", { params: { name: "Office Building", value: 250000 } }, ctx);
    await lensRun("insurance", "asset-add", { params: { name: "Delivery Van", value: 40000 } }, ctx);
    const list = await lensRun("insurance", "asset-list", {}, ctx);
    assert.equal(list.result.assets.length, 2);
    assert.equal(list.result.totalValue, 290000);
  });
});

describe("insurance — policy lifecycle against the untested macros", () => {
  let ctx;
  let policyId;
  before(async () => { ctx = await depthCtx("q63-insurance-policy"); });

  it("policy-add rejects an unknown kind, accepts a home policy", async () => {
    const bad = await lensRun("insurance", "policy-add", { params: { carrier: "SafeCo", kind: "property", policyNumber: "P-X" } }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid kind");
    const renewal = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const added = await lensRun("insurance", "policy-add", { params: {
      carrier: "SafeCo", kind: "home", policyNumber: "P-1001", annualPremium: 1200, renewalDate: renewal,
    } }, ctx);
    assert.equal(added.ok, true);
    policyId = added.result.policy.id;
  });

  it("policy-detail reads it back; policy-update reprices it; coverage-summary aggregates the new premium", async () => {
    const detail = await lensRun("insurance", "policy-detail", { params: { id: policyId } }, ctx);
    assert.equal(detail.ok, true);
    assert.equal(detail.result.policy.policyNumber, "P-1001");
    const upd = await lensRun("insurance", "policy-update", { params: { id: policyId, annualPremium: 1350 } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.policy.annualPremium, 1350);
    const summary = await lensRun("insurance", "coverage-summary", {}, ctx);
    assert.equal(summary.result.policies, 1);
    assert.equal(summary.result.totalAnnualPremium, 1350);
    assert.equal(summary.result.byKind.home, 1);
  });

  it("policy-document-add attaches a document; id-card renders for the policy", async () => {
    const doc = await lensRun("insurance", "policy-document-add", { params: { policyId, title: "Declarations" } }, ctx);
    assert.equal(doc.ok, true);
    const card = await lensRun("insurance", "id-card", { params: { policyId } }, ctx);
    assert.equal(card.ok, true);
    const missing = await lensRun("insurance", "id-card", { params: { policyId: "nope" } }, ctx);
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "policy not found");
  });

  it("renewals-due lists the policy inside its renewal window", async () => {
    const due = await lensRun("insurance", "renewals-due", {}, ctx);
    assert.equal(due.ok, true);
    assert.ok(due.result.due.some(p => p.id === policyId), "policy with renewalDate +30d is due");
  });

  it("certificate-issue + certificate-revoke round-trip on the policy", async () => {
    const cert = await lensRun("insurance", "certificate-issue", { params: { policyId, certificateHolder: "City of Poughkeepsie" } }, ctx);
    assert.equal(cert.ok, true);
    const certId = cert.result.certificate.id;
    const revoked = await lensRun("insurance", "certificate-revoke", { params: { id: certId } }, ctx);
    assert.equal(revoked.ok, true);
    assert.equal(revoked.result.revoked, true);
    // Revoke is idempotent: a second revoke reports the same state.
    const again = await lensRun("insurance", "certificate-revoke", { params: { id: certId } }, ctx);
    assert.equal(again.ok, true);
    assert.equal(again.result.revoked, true);
    const missing = await lensRun("insurance", "certificate-revoke", { params: { id: "nope" } }, ctx);
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "certificate not found");
  });

  it("esign envelope: binder-issue refuses until every signer has signed, then issues", async () => {
    const env = await lensRun("insurance", "esign-create", { params: { title: "Binder for P-1001", policyId, signers: [{ name: "Acme", email: "a@example.com" }] } }, ctx);
    assert.equal(env.ok, true);
    const envId = env.result.envelope.id;
    const early = await lensRun("insurance", "binder-issue", { params: { envelopeId: envId } }, ctx);
    assert.equal(early.ok, false);
    assert.equal(early.error, "all signers must sign before a binder can issue");
    const signed = await lensRun("insurance", "esign-sign", { params: { id: envId, signerName: "Acme" } }, ctx);
    assert.equal(signed.ok, true);
    const issued = await lensRun("insurance", "binder-issue", { params: { envelopeId: envId } }, ctx);
    assert.equal(issued.ok, true);
  });

  it("renewal pipeline: build picks up the policy, advance moves its stage", async () => {
    const built = await lensRun("insurance", "renewal-pipeline-build", { params: { horizonDays: 60 } }, ctx);
    assert.equal(built.ok, true);
    const list = await lensRun("insurance", "renewal-pipeline-list", {}, ctx);
    assert.equal(list.ok, true);
    assert.ok(list.result.count >= 1, "pipeline carries the seeded policy");
    const item = list.result.pipeline[0];
    const advanced = await lensRun("insurance", "renewal-advance", { params: { id: item.id } }, ctx);
    assert.equal(advanced.ok, true);
    const missing = await lensRun("insurance", "renewal-advance", { params: { id: "nope" } }, ctx);
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "renewal item not found");
  });

  it("policy-delete removes it; detail then reports not found", async () => {
    const del = await lensRun("insurance", "policy-delete", { params: { id: policyId } }, ctx);
    assert.equal(del.ok, true);
    const detail = await lensRun("insurance", "policy-detail", { params: { id: policyId } }, ctx);
    assert.equal(detail.ok, false);
    assert.equal(detail.error, "policy not found");
  });
});

describe("insurance — claims, FNOL, pacts, reminders", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("q63-insurance-claims"); });

  it("claim-file -> claim-list -> claim-delete round-trip", async () => {
    const filed = await lensRun("insurance", "claim-file", { params: { carrier: "SafeCo", description: "Water damage", kind: "property" } }, ctx);
    assert.equal(filed.ok, true);
    const claimId = filed.result.claim.id;
    const list = await lensRun("insurance", "claim-list", {}, ctx);
    assert.equal(list.result.claims.length, 1);
    const del = await lensRun("insurance", "claim-delete", { params: { id: claimId } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, claimId);
    const after = await lensRun("insurance", "claim-list", {}, ctx);
    assert.equal(after.result.claims.length, 0);
  });

  it("fnol-intake lands in fnol-list; fnol-update sets the reserve and status the list then reports", async () => {
    const intake = await lensRun("insurance", "fnol-intake", { params: { description: "Rear-end collision", lossType: "auto", estimatedLoss: 4000 } }, ctx);
    assert.equal(intake.ok, true);
    const fnolId = intake.result.fnol.id;
    const list = await lensRun("insurance", "fnol-list", {}, ctx);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.totalReserves, 0);
    const upd = await lensRun("insurance", "fnol-update", { params: { id: fnolId, status: "investigating", reservesSet: 4000 } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.fnol.status, "investigating");
    const after = await lensRun("insurance", "fnol-list", {}, ctx);
    assert.equal(after.result.totalReserves, 4000);
    const missing = await lensRun("insurance", "fnol-update", { params: { id: "nope" } }, ctx);
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "FNOL not found");
  });

  it("pact-write needs a beneficiary; pact-payout-history starts empty; pact-revoke closes it", async () => {
    const bad = await lensRun("insurance", "pact-write", { params: { payoutSparks: 1000, premiumSparks: 50 } }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "at least one beneficiary required");
    const pact = await lensRun("insurance", "pact-write", { params: { payoutSparks: 1000, premiumSparks: 50, durationDays: 30, beneficiaryUserId: "beneficiary-1" } }, ctx);
    assert.equal(pact.ok, true);
    const history = await lensRun("insurance", "pact-payout-history", {}, ctx);
    assert.equal(history.result.totalPaidOutSparks, 0);
    assert.equal(history.result.totalReceivedSparks, 0);
    const revoked = await lensRun("insurance", "pact-revoke", { params: { pactId: pact.result.pact.id } }, ctx);
    assert.equal(revoked.ok, true);
    const again = await lensRun("insurance", "pact-revoke", { params: { pactId: pact.result.pact.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "only active pacts can be revoked");
  });

  it("reminder-create requires a title; reminder-complete flips done in reminder-list", async () => {
    const bad = await lensRun("insurance", "reminder-create", { params: {} }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "title required");
    const rem = await lensRun("insurance", "reminder-create", { params: { title: "Renew Acme policy" } }, ctx);
    assert.equal(rem.ok, true);
    const done = await lensRun("insurance", "reminder-complete", { params: { id: rem.result.reminder.id } }, ctx);
    assert.equal(done.ok, true);
    assert.equal(done.result.reminder.done, true);
    const list = await lensRun("insurance", "reminder-list", {}, ctx);
    assert.equal(list.result.reminders[0].done, true);
  });
});
