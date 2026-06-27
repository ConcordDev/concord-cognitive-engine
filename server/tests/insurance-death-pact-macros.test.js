// Behavioral macro tests for the /lenses/death-insurance backend — the
// sparks-only inheritance-pact surface of server/domains/insurance.js.
//
// CONTEXT: domains/insurance.js used to register through the legacy
// registerLensAction convention AND was never imported by server.js, so every
// insurance.* macro (both the real-world insurance workbench AND the
// death-insurance pact lens) was invisible to runMacro / /api/lens/run — the
// "saved-class" bug. The file was rewritten to the canonical `register`
// convention (via an internal shim). This test drives the rewritten macros the
// way runMacro would — a (ctx, input) call — through a LOCAL register harness
// (NO server boot, <10s) against the REAL globalThis._concordSTATE the domain
// uses for persistence.
//
// These are NOT shape-only assertions. They assert ACTUAL values + multi-step
// round-trips: write a pact → list shows it → beneficiary accepts the
// handshake → claim-on-death (pact-record-payout) splits the REAL sparks
// amount across beneficiaries → payout-history + notifications reflect it.
// Plus per-user isolation, the self-pact block, idempotent firing, and the
// fail-CLOSED numeric guard the macro-assassin's V2 vector probes.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerInsuranceActions from "../domains/insurance.js";

// Local register harness — mirrors the canonical register(domain, name, fn).
// We invoke each fn directly with (ctx, input), exactly as runMacro / the
// /api/lens/run dispatch would after _unwrapLensEnvelope.
const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "insurance", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`insurance.${name} not registered`);
  return fn(ctx, input);
}

before(() => {
  // The saved-state debounce + STATE are read from globalThis; provide stubs.
  globalThis._concordSaveStateDebounced = () => {};
  registerInsuranceActions(register);
});
// Fresh STATE per test so pacts/policies never leak between cases.
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxInsured = { actor: { userId: "insured_1" } };
const ctxBene = { actor: { userId: "bene_1" } };
const ctxBene2 = { actor: { userId: "bene_2" } };
const ctxStranger = { actor: { userId: "stranger_9" } };

describe("insurance(death-pact) — registration", () => {
  it("registers every macro the death-insurance lens calls", () => {
    for (const m of [
      "pact-write", "pact-list", "pact-revoke", "pact-respond",
      "pact-record-payout", "pact-payout-history", "pact-notifications",
      "pact-renew", "pact-set-auto-renew", "pact-pay-premium", "pact-premium-schedule",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing insurance.${m}`);
    }
  });

  it("also registers the real-world insurance workbench macros (same file)", () => {
    for (const m of ["policy-add", "policy-list", "claim-file", "coverageGap", "carrier-rate"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing insurance.${m}`);
    }
  });
});

describe("insurance(death-pact) — full lifecycle: write → list → accept → claim → payout", () => {
  it("buys a pact, list shows it, and a claim on death pays out the real split amount", () => {
    // ── write a 2-beneficiary pact: bene_1 60% / bene_2 40%, no handshake ──
    const written = call("pact-write", ctxInsured, {
      beneficiaries: [
        { userId: "bene_1", sharePct: 60 },
        { userId: "bene_2", sharePct: 40 },
      ],
      payoutSparks: 1000,
      premiumSparks: 50,
      durationDays: 30,
      requireHandshake: false,
    });
    assert.equal(written.ok, true);
    const pactId = written.result.pact.id;
    assert.equal(written.result.pact.payoutSparks, 1000);
    assert.equal(written.result.pact.status, "active");
    assert.equal(written.result.pact.beneficiaries.length, 2);

    // ── the insured's list shows the written pact ──
    const insuredList = call("pact-list", ctxInsured, {});
    assert.equal(insuredList.ok, true);
    assert.equal(insuredList.result.written.length, 1);
    assert.equal(insuredList.result.written[0].id, pactId);
    assert.equal(insuredList.result.beneficiaryOf.length, 0);

    // ── bene_1 sees it on the beneficiary side with the right share ──
    const beneList = call("pact-list", ctxBene, {});
    assert.equal(beneList.result.written.length, 0);
    assert.equal(beneList.result.beneficiaryOf.length, 1);
    assert.equal(beneList.result.beneficiaryOf[0].myShare.sharePct, 60);

    // ── 24h-arm guard: firing immediately is rejected ──
    const tooSoon = call("pact-record-payout", ctxInsured, { pactId });
    assert.equal(tooSoon.ok, false);
    assert.match(tooSoon.error, /24h/);

    // ── arm the pact (simulate 24h passing) then claim on death ──
    globalThis._concordSTATE.inheritPacts.pacts.get("insured_1")[0].armsAt =
      Math.floor(Date.now() / 1000) - 10;
    const payout = call("pact-record-payout", ctxInsured, { pactId, cause: "fell in Concordia" });
    assert.equal(payout.ok, true);
    // The REAL split: 1000 sparks → 600 / 400 by share.
    assert.equal(payout.result.payout.totalSparks, 1000);
    const splitFor = (u) => payout.result.payout.splits.find((s) => s.userId === u).sparks;
    assert.equal(splitFor("bene_1"), 600);
    assert.equal(splitFor("bene_2"), 400);
    // Splits sum to exactly the payout — no sparks minted or lost.
    assert.equal(payout.result.payout.splits.reduce((a, s) => a + s.sparks, 0), 1000);

    // ── firing again is idempotent-rejected (pact already fired) ──
    const again = call("pact-record-payout", ctxInsured, { pactId });
    assert.equal(again.ok, false);
    assert.match(again.error, /already fired/);

    // ── payout-history reflects the real amounts on both sides ──
    const insuredHist = call("pact-payout-history", ctxInsured, {});
    assert.equal(insuredHist.result.paidOut.length, 1);
    assert.equal(insuredHist.result.totalPaidOutSparks, 1000);

    const beneHist = call("pact-payout-history", ctxBene, {});
    assert.equal(beneHist.result.received.length, 1);
    assert.equal(beneHist.result.totalReceivedSparks, 600);
  });
});

describe("insurance(death-pact) — handshake gating", () => {
  it("only pays accepted beneficiaries when a handshake is required", () => {
    const written = call("pact-write", ctxInsured, {
      beneficiaries: [
        { userId: "bene_1", sharePct: 50 },
        { userId: "bene_2", sharePct: 50 },
      ],
      payoutSparks: 800,
      premiumSparks: 40,
      durationDays: 10,
      requireHandshake: true,
    });
    const pactId = written.result.pact.id;

    // Only bene_1 accepts.
    const resp = call("pact-respond", ctxBene, { pactId, accept: true });
    assert.equal(resp.ok, true);
    assert.equal(resp.result.accepted, true);
    assert.equal(resp.result.allAccepted, false);

    // Arm and fire — the whole 800 goes to the single accepted beneficiary.
    globalThis._concordSTATE.inheritPacts.pacts.get("insured_1")[0].armsAt =
      Math.floor(Date.now() / 1000) - 10;
    const payout = call("pact-record-payout", ctxInsured, { pactId });
    assert.equal(payout.ok, true);
    assert.equal(payout.result.payout.splits.length, 1);
    assert.equal(payout.result.payout.splits[0].userId, "bene_1");
    assert.equal(payout.result.payout.splits[0].sparks, 800);
  });

  it("refuses to fire when no beneficiary has accepted a required handshake", () => {
    const written = call("pact-write", ctxInsured, {
      beneficiaryUserId: "bene_1",
      payoutSparks: 300,
      premiumSparks: 30,
      durationDays: 10,
      requireHandshake: true,
    });
    globalThis._concordSTATE.inheritPacts.pacts.get("insured_1")[0].armsAt =
      Math.floor(Date.now() / 1000) - 10;
    const payout = call("pact-record-payout", ctxInsured, { pactId: written.result.pact.id });
    assert.equal(payout.ok, false);
    assert.match(payout.error, /no beneficiary has accepted/);
  });
});

describe("insurance(death-pact) — revoke + notifications", () => {
  it("revokes an active pact and blocks a payout afterward", () => {
    const written = call("pact-write", ctxInsured, {
      beneficiaryUserId: "bene_1", payoutSparks: 500, premiumSparks: 50, durationDays: 30,
      requireHandshake: false,
    });
    const pactId = written.result.pact.id;
    const rev = call("pact-revoke", ctxInsured, { pactId });
    assert.equal(rev.ok, true);
    assert.equal(rev.result.status, "revoked");

    globalThis._concordSTATE.inheritPacts.pacts.get("insured_1")[0].armsAt =
      Math.floor(Date.now() / 1000) - 10;
    const payout = call("pact-record-payout", ctxInsured, { pactId });
    assert.equal(payout.ok, false);
    assert.match(payout.error, /revoked/);
  });

  it("surfaces a handshake_request notification to an un-responded beneficiary", () => {
    call("pact-write", ctxInsured, {
      beneficiaryUserId: "bene_1", payoutSparks: 500, premiumSparks: 50, durationDays: 30,
      requireHandshake: true,
    });
    const notif = call("pact-notifications", ctxBene, { windowDays: 14 });
    assert.equal(notif.ok, true);
    assert.equal(notif.result.count, notif.result.notifications.length);
    assert.ok(notif.result.notifications.some((n) => n.kind === "handshake_request"));
  });
});

describe("insurance(death-pact) — guards + isolation", () => {
  it("blocks a self-pact (beneficiary equals insured)", () => {
    const r = call("pact-write", ctxInsured, {
      beneficiaryUserId: "insured_1", payoutSparks: 500, premiumSparks: 50,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /self_pact_blocked/);
  });

  it("rejects a stranger responding to a pact they are not named in", () => {
    const written = call("pact-write", ctxInsured, {
      beneficiaryUserId: "bene_1", payoutSparks: 500, premiumSparks: 50,
    });
    const r = call("pact-respond", ctxStranger, { pactId: written.result.pact.id, accept: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /not a beneficiary/);
  });

  it("never leaks one insured's pacts into another user's written list", () => {
    call("pact-write", ctxInsured, { beneficiaryUserId: "bene_1", payoutSparks: 500, premiumSparks: 50 });
    assert.equal(call("pact-list", ctxInsured, {}).result.written.length, 1);
    assert.equal(call("pact-list", ctxBene2, {}).result.written.length, 0);
  });
});

describe("insurance(death-pact) — fail-CLOSED numeric guard (assassin V2)", () => {
  it("rejects poisoned payout/premium/duration instead of clamping to ok:true", () => {
    for (const bad of [NaN, Infinity, -1, 1e308]) {
      const r1 = call("pact-write", ctxInsured, { beneficiaryUserId: "bene_1", payoutSparks: bad, premiumSparks: 50 });
      assert.equal(r1.ok, false, `payoutSparks=${bad} should fail-closed`);
      const r2 = call("pact-write", ctxInsured, { beneficiaryUserId: "bene_1", payoutSparks: 500, premiumSparks: bad });
      assert.equal(r2.ok, false, `premiumSparks=${bad} should fail-closed`);
    }
    // 1e308 specifically returns the invalid_<field> reason (not a clamped row).
    const r = call("pact-write", ctxInsured, { beneficiaryUserId: "bene_1", payoutSparks: 1e308, premiumSparks: 50 });
    assert.equal(r.error, "invalid_payoutSparks");
  });

  it("rejects a poisoned windowDays on pact-notifications", () => {
    const r = call("pact-notifications", ctxInsured, { windowDays: 1e308 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_windowDays");
  });

  it("reads return ok:true on empty input (NEVER no_db / no_user)", () => {
    assert.equal(call("pact-list", ctxInsured, {}).ok, true);
    assert.equal(call("pact-notifications", ctxInsured, {}).ok, true);
    assert.equal(call("pact-payout-history", ctxInsured, {}).ok, true);
  });
});

describe("insurance(real-world workbench) — policy round-trip + numeric guard", () => {
  it("adds a policy, lists it, and fail-closes a poisoned annualPremium", () => {
    const added = call("policy-add", ctxInsured, {
      carrier: "Acme Mutual", policyNumber: "P-1001", kind: "auto", annualPremium: 1200, deductible: 500,
    });
    assert.equal(added.ok, true);
    assert.equal(added.result.policy.status, "active");
    assert.equal(added.result.policy.annualPremium, 1200);

    const list = call("policy-list", ctxInsured, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.policies.length, 1);
    assert.equal(list.result.policies[0].policyNumber, "P-1001");

    const bad = call("policy-add", ctxInsured, { carrier: "Acme", policyNumber: "P-2", annualPremium: 1e308 });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_annualPremium");

    const missing = call("policy-add", ctxInsured, {});
    assert.equal(missing.ok, false);
    assert.match(missing.error, /carrier and policyNumber required/);
  });
});
