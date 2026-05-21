import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerInsuranceActions from "../domains/insurance.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`insurance.${name}`);
  assert.ok(fn, `insurance.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerInsuranceActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("insurance.policy-* CRUD", () => {
  it("scoped per user", () => {
    const r = call("policy-add", ctxA, { carrier: "Geico", policyNumber: "ABC123", kind: "auto", annualPremium: 1800, deductible: 500 });
    assert.equal(r.ok, true);
    assert.equal(call("policy-list", ctxA, {}).result.policies.length, 1);
    assert.equal(call("policy-list", ctxB, {}).result.policies.length, 0);
  });
  it("rejects missing carrier or policy#", () => {
    assert.equal(call("policy-add", ctxA, { carrier: "Geico" }).ok, false);
  });
});

describe("insurance.claim-* CRUD", () => {
  it("file + list scoped per user", () => {
    const r = call("claim-file", ctxA, { carrier: "Geico", description: "Rear-ended in parking lot", claimAmount: 4500, kind: "collision" });
    assert.equal(r.ok, true);
    const list = call("claim-list", ctxA, {});
    assert.equal(list.result.claims.length, 1);
    assert.equal(list.result.claims[0].status, "submitted");
    assert.ok(list.result.claims[0].daysSinceSubmit >= 0);
  });
  it("rejects empty description", () => {
    assert.equal(call("claim-file", ctxA, { carrier: "X", description: "" }).ok, false);
  });
});

describe("insurance.quotes-compare (no synthetic carrier table)", () => {
  it("returns error pointing to broker API since no live integration is wired", () => {
    const r = call("quotes-compare", ctxA, { kind: "auto", zip: "94110", coverage: "standard" });
    assert.equal(r.ok, false);
    assert.match(r.error, /broker API|INSURIFY_API_KEY|ZEBRA_API_KEY/);
    assert.equal(r.meta.kind, "auto");
    assert.equal(r.meta.zip, "94110");
    assert.equal(r.meta.coverage, "standard");
  });
});

describe("insurance.coverage-analyze", () => {
  it("flags missing-everything as critical", () => {
    const r = call("coverage-analyze", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.gaps.some(g => g.area === "Auto liability"));
    assert.ok(r.result.gaps.some(g => g.area === "Home/renters"));
    assert.ok(r.result.score < 70);
  });

  it("score improves when policies added", () => {
    call("policy-add", ctxA, { carrier: "G", policyNumber: "1", kind: "auto", liabilityLimit: 100000 });
    call("policy-add", ctxA, { carrier: "G", policyNumber: "2", kind: "renters" });
    const r = call("coverage-analyze", ctxA, {});
    assert.ok(r.result.score > 50);
    assert.ok(r.result.gaps.length < 5);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("at least one registered", () => assert.ok(ACTIONS.size > 8));
});

// ─── Insurance policy-wallet 2026 parity ──────────────────────────────

function newPolicy(ctx = ctxA, over = {}) {
  return call("policy-add", ctx, {
    carrier: "Acme Insurance", policyNumber: "POL-123", kind: "auto",
    annualPremium: 1200, deductible: 500, ...over,
  }).result.policy;
}

describe("insurance.policy-update / detail / delete", () => {
  it("update changes premium and status", () => {
    const p = newPolicy();
    assert.equal(call("policy-update", ctxA, { id: p.id, annualPremium: 1400, status: "lapsed" }).result.policy.annualPremium, 1400);
    assert.equal(call("policy-detail", ctxA, { id: p.id }).result.policy.status, "lapsed");
    assert.equal(call("policy-delete", ctxA, { id: p.id }).ok, true);
    assert.equal(call("policy-detail", ctxA, { id: p.id }).ok, false);
  });
});

describe("insurance.documents + payments", () => {
  it("documents attach to a policy", () => {
    const p = newPolicy();
    call("policy-document-add", ctxA, { policyId: p.id, title: "Declarations page", kind: "declaration" });
    assert.equal(call("policy-document-list", ctxA, { policyId: p.id }).result.documents.length, 1);
    assert.equal(call("policy-document-add", ctxA, { policyId: p.id }).ok, false);
  });

  it("payments accumulate and premium-schedule computes installments", () => {
    const p = newPolicy(ctxA, { annualPremium: 1200 });
    call("payment-log", ctxA, { policyId: p.id, amount: 100, date: "2026-05-01" });
    call("payment-log", ctxA, { policyId: p.id, amount: 100, date: "2026-06-01" });
    assert.equal(call("payment-list", ctxA, { policyId: p.id }).result.totalPaid, 200);
    const sched = call("premium-schedule", ctxA, { policyId: p.id, frequency: "monthly" });
    assert.equal(sched.result.installment, 100);
    assert.equal(sched.result.perYear, 12);
  });
});

describe("insurance.claim-update / detail", () => {
  it("claim status flow and payout", () => {
    newPolicy();
    const claim = call("claim-file", ctxA, { carrier: "Acme", description: "Fender bender", claimAmount: 3000 }).result.claim;
    call("claim-update", ctxA, { id: claim.id, status: "approved", payoutAmount: 2500, note: "Approved by adjuster" });
    const d = call("claim-detail", ctxA, { id: claim.id });
    assert.equal(d.result.claim.status, "approved");
    assert.equal(d.result.claim.payoutAmount, 2500);
    assert.equal(call("claim-delete", ctxA, { id: claim.id }).ok, true);
  });
});

describe("insurance.agents + reminders", () => {
  it("agents add + list", () => {
    call("agent-add", ctxA, { name: "Jane Broker", agency: "Acme", phone: "555-1000" });
    assert.equal(call("agent-list", ctxA, {}).result.agents.length, 1);
    assert.equal(call("agent-add", ctxA, {}).ok, false);
  });

  it("reminders flag overdue and complete", () => {
    const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const rem = call("reminder-create", ctxA, { title: "Renew auto", kind: "renewal", dueDate: past }).result.reminder;
    assert.equal(call("reminder-list", ctxA, {}).result.overdue, 1);
    call("reminder-complete", ctxA, { id: rem.id });
    assert.equal(call("reminder-list", ctxA, {}).result.overdue, 0);
  });
});

describe("insurance.beneficiaries + assets", () => {
  it("beneficiary shares track balance", () => {
    const p = newPolicy(ctxA, { kind: "life" });
    call("beneficiary-add", ctxA, { policyId: p.id, name: "Spouse", sharePct: 60 });
    call("beneficiary-add", ctxA, { policyId: p.id, name: "Child", sharePct: 40 });
    const b = call("beneficiary-list", ctxA, { policyId: p.id });
    assert.equal(b.result.totalShare, 100);
    assert.equal(b.result.balanced, true);
  });

  it("covered assets sum value", () => {
    call("asset-add", ctxA, { name: "Honda Civic", kind: "vehicle", value: 22000 });
    call("asset-add", ctxA, { name: "Engagement ring", kind: "jewelry", value: 8000 });
    assert.equal(call("asset-list", ctxA, {}).result.totalValue, 30000);
  });
});

describe("insurance.id-card + summaries", () => {
  it("id-card returns policy essentials", () => {
    const p = newPolicy();
    const card = call("id-card", ctxA, { policyId: p.id });
    assert.equal(card.result.card.policyNumber, "POL-123");
    assert.equal(card.result.card.carrier, "Acme Insurance");
  });

  it("coverage-summary + dashboard aggregate", () => {
    newPolicy(ctxA, { annualPremium: 1200 });
    newPolicy(ctxA, { kind: "home", annualPremium: 800, policyNumber: "POL-999" });
    const cs = call("coverage-summary", ctxA, {});
    assert.equal(cs.result.activePolicies, 2);
    assert.equal(cs.result.totalAnnualPremium, 2000);
    const d = call("insurance-dashboard", ctxA, {});
    assert.equal(d.result.activePolicies, 2);
    assert.equal(d.result.annualPremium, 2000);
  });

  it("renewals-due flags soon-expiring policies", () => {
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    newPolicy(ctxA, { renewalDate: soon });
    assert.equal(call("renewals-due", ctxA, {}).result.count, 1);
  });
});

// ─── Inheritance-pact (death-insurance lens) parity backlog ────────────

describe("insurance.pact-write — multi-beneficiary split", () => {
  it("writes a pact and rebalances shares to 100", () => {
    const r = call("pact-write", ctxA, {
      beneficiaries: [
        { userId: "user_b", sharePct: 30 },
        { userId: "user_c", sharePct: 30 },
      ],
      payoutSparks: 1000,
      premiumSparks: 50,
      durationDays: 30,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.pact.beneficiaries.length, 2);
    const total = r.result.pact.beneficiaries.reduce((a, b) => a + b.sharePct, 0);
    assert.equal(total, 100);
  });

  it("blocks self-pact (insured cannot be a beneficiary)", () => {
    const r = call("pact-write", ctxA, {
      beneficiaries: [{ userId: "user_a", sharePct: 100 }],
      payoutSparks: 500,
      premiumSparks: 50,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /self_pact_blocked/);
  });

  it("rejects non-positive payout or premium", () => {
    assert.equal(
      call("pact-write", ctxA, { beneficiaryUserId: "user_b", payoutSparks: 0, premiumSparks: 50 }).ok,
      false,
    );
    assert.equal(
      call("pact-write", ctxA, { beneficiaryUserId: "user_b", payoutSparks: 500, premiumSparks: 0 }).ok,
      false,
    );
  });

  it("accepts single beneficiaryUserId fallback at 100%", () => {
    const r = call("pact-write", ctxA, {
      beneficiaryUserId: "user_b",
      payoutSparks: 200,
      premiumSparks: 20,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.pact.beneficiaries[0].sharePct, 100);
  });
});

describe("insurance.pact-list", () => {
  it("returns written and beneficiary-of buckets", () => {
    call("pact-write", ctxA, { beneficiaryUserId: "user_b", payoutSparks: 500, premiumSparks: 50 });
    const a = call("pact-list", ctxA, {});
    assert.equal(a.result.written.length, 1);
    assert.equal(a.result.beneficiaryOf.length, 0);
    const b = call("pact-list", ctxB, {});
    assert.equal(b.result.written.length, 0);
    assert.equal(b.result.beneficiaryOf.length, 1);
    assert.equal(b.result.beneficiaryOf[0].myShare.sharePct, 100);
  });
});

describe("insurance.pact-revoke", () => {
  it("revokes an active pact, rejects double revoke", () => {
    const p = call("pact-write", ctxA, { beneficiaryUserId: "user_b", payoutSparks: 500, premiumSparks: 50 }).result.pact;
    assert.equal(call("pact-revoke", ctxA, { pactId: p.id }).ok, true);
    assert.equal(call("pact-revoke", ctxA, { pactId: p.id }).ok, false);
    assert.equal(call("pact-list", ctxA, {}).result.written[0].status, "revoked");
  });
});

describe("insurance.pact-renew + pact-set-auto-renew", () => {
  it("renew extends expiry and bumps renewCount", () => {
    const p = call("pact-write", ctxA, { beneficiaryUserId: "user_b", payoutSparks: 500, premiumSparks: 50, durationDays: 10 }).result.pact;
    const beforeExpiry = p.expiresAt; // capture before renew mutates the shared object
    const r = call("pact-renew", ctxA, { pactId: p.id, durationDays: 20 });
    assert.equal(r.ok, true);
    assert.equal(r.result.pact.renewCount, 1);
    assert.ok(r.result.pact.expiresAt > beforeExpiry);
  });

  it("set-auto-renew toggles the flag", () => {
    const p = call("pact-write", ctxA, { beneficiaryUserId: "user_b", payoutSparks: 500, premiumSparks: 50 }).result.pact;
    assert.equal(call("pact-set-auto-renew", ctxA, { pactId: p.id, autoRenew: true }).result.autoRenew, true);
    assert.equal(call("pact-set-auto-renew", ctxA, { pactId: p.id, autoRenew: false }).result.autoRenew, false);
  });
});

describe("insurance.pact-pay-premium + pact-premium-schedule", () => {
  it("recurring premium accumulates installments", () => {
    const p = call("pact-write", ctxA, {
      beneficiaryUserId: "user_b", payoutSparks: 500, premiumSparks: 25,
      premiumFrequency: "monthly",
    }).result.pact;
    assert.equal(p.premiumFrequency, "monthly");
    const pay = call("pact-pay-premium", ctxA, { pactId: p.id });
    assert.equal(pay.ok, true);
    assert.equal(pay.result.premiumPaidSparks, 25);
    assert.equal(pay.result.installments, 1);
    const sched = call("pact-premium-schedule", ctxA, { pactId: p.id });
    assert.equal(sched.result.premiumFrequency, "monthly");
    assert.equal(sched.result.intervalDays, 30);
  });

  it("rejects pay-premium on an upfront pact", () => {
    const p = call("pact-write", ctxA, { beneficiaryUserId: "user_b", payoutSparks: 500, premiumSparks: 50 }).result.pact;
    assert.equal(call("pact-pay-premium", ctxA, { pactId: p.id }).ok, false);
  });
});

describe("insurance.pact-respond — acceptance handshake", () => {
  it("beneficiary accepts; allAccepted reflects it", () => {
    const p = call("pact-write", ctxA, { beneficiaryUserId: "user_b", payoutSparks: 500, premiumSparks: 50 }).result.pact;
    const r = call("pact-respond", ctxB, { pactId: p.id, accept: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.accepted, true);
    assert.equal(r.result.allAccepted, true);
  });

  it("non-beneficiary cannot respond", () => {
    const p = call("pact-write", ctxA, { beneficiaryUserId: "user_b", payoutSparks: 500, premiumSparks: 50 }).result.pact;
    assert.equal(call("pact-respond", ctxA, { pactId: p.id, accept: true }).ok, false);
  });
});

describe("insurance.pact-record-payout + pact-payout-history", () => {
  it("fires only after the 24h arming window", () => {
    const p = call("pact-write", ctxA, { beneficiaryUserId: "user_b", payoutSparks: 500, premiumSparks: 50, requireHandshake: false }).result.pact;
    // armsAt is 24h out — firing now must be blocked.
    assert.equal(call("pact-record-payout", ctxA, { pactId: p.id }).ok, false);
  });

  it("fires a past-armed pact and splits payout; history records it", () => {
    const p = call("pact-write", ctxA, {
      beneficiaries: [
        { userId: "user_b", sharePct: 60 },
        { userId: "user_c", sharePct: 40 },
      ],
      payoutSparks: 1000, premiumSparks: 50, requireHandshake: false,
    }).result.pact;
    // Backdate the arming guard so the payout can fire in-test.
    p.armsAt = Math.floor(Date.now() / 1000) - 10;
    const r = call("pact-record-payout", ctxA, { pactId: p.id, cause: "fell in raid" });
    assert.equal(r.ok, true);
    assert.equal(r.result.payout.splits.length, 2);
    assert.equal(r.result.payout.splits.reduce((a, s) => a + s.sparks, 0), 1000);
    const hist = call("pact-payout-history", ctxA, {});
    assert.equal(hist.result.paidOut.length, 1);
    assert.equal(hist.result.totalPaidOutSparks, 1000);
    const bHist = call("pact-payout-history", ctxB, {});
    assert.equal(bHist.result.received.length, 1);
    assert.equal(bHist.result.received[0].mySparks, 600);
  });

  it("blocks payout when handshake required and nobody accepted", () => {
    const p = call("pact-write", ctxA, { beneficiaryUserId: "user_b", payoutSparks: 500, premiumSparks: 50, requireHandshake: true }).result.pact;
    p.armsAt = Math.floor(Date.now() / 1000) - 10;
    assert.equal(call("pact-record-payout", ctxA, { pactId: p.id }).ok, false);
  });
});

describe("insurance.pact-notifications", () => {
  it("flags an expiring pact and a handshake request", () => {
    call("pact-write", ctxA, { beneficiaryUserId: "user_b", payoutSparks: 500, premiumSparks: 50, durationDays: 2 });
    const a = call("pact-notifications", ctxA, { windowDays: 7 });
    assert.equal(a.ok, true);
    assert.ok(a.result.notifications.some((n) => n.kind === "expiring"));
    const b = call("pact-notifications", ctxB, { windowDays: 7 });
    assert.ok(b.result.notifications.some((n) => n.kind === "handshake_request"));
  });
});
