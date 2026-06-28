// Phase-2 NON-SCORE gate behavioral tests for the /lenses/death-insurance
// backend — the sparks-only inheritance-pact surface of
// server/domains/insurance.js.
//
// CONTEXT: the lens dir is `death-insurance` but the backend DOMAIN string is
// `insurance` — the page calls `lensRun('insurance', …)`. domains/insurance.js
// registers through PATH 3 (domains/index.js → server.js domainModules.forEach,
// 3-arg registerLensAction(domain, action, (ctx, artifact, params))). The
// public macro signature the dispatcher / runMacro present is a 2-arg
// (ctx, input) call (the file adapts that back to (ctx, artifact, params) via
// an internal shim). This harness mirrors the dispatcher: it invokes each
// registered fn with (ctx, input) directly, with NO server boot / network /
// LLM, against the REAL globalThis._concordSTATE the domain persists into.
//
// This file COMPLEMENTS server/tests/insurance-death-pact-macros.test.js
// (lifecycle + handshake + self-pact + numeric-guard). It pins the parts that
// file does not exercise to value-depth:
//   • renewal / auto-renew round-trips (expired → renew → active; date math),
//   • recurring-premium payment schedule (pay-premium accumulation + next-due),
//   • premium-schedule read derived from real installments,
//   • MONEY-CONSERVATION across a 3-beneficiary split (no sparks minted/lost),
//   • a SECOND independent pact firing into the same writer's history
//     (totals add, per-user isolation holds),
//   • fail-CLOSED poisoned-numeric on the write + renew + notifications paths.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerInsuranceActions from "../domains/insurance.js";

// Local register harness — mirrors canonical register(domain, name, fn). We
// call each fn directly with (ctx, input), exactly as runMacro / the
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
const NOW = () => Math.floor(Date.now() / 1000);
// Reach into STATE to age a pact's arms-at past the 24h guard so a payout can
// fire deterministically in-test (the same trick the sibling test uses).
function armPact(insuredUserId, idx = 0) {
  globalThis._concordSTATE.inheritPacts.pacts.get(insuredUserId)[idx].armsAt = NOW() - 10;
}

before(() => {
  globalThis._concordSaveStateDebounced = () => {};
  registerInsuranceActions(register);
});
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxInsured = { actor: { userId: "ins_alpha" } };
const ctxInsuredB = { actor: { userId: "ins_beta" } };
const ctxA = { actor: { userId: "bene_a" } };
const ctxB = { actor: { userId: "bene_b" } };
const ctxC = { actor: { userId: "bene_c" } };

describe("death-insurance — every lens caller has a real receiver", () => {
  // Exact macro names the page + components/death-insurance/* call.
  const CALLED_BY_LENS = [
    "pact-list", "pact-notifications", "pact-payout-history", // page.tsx
    "pact-write",                                             // PactWriter.tsx
    "pact-respond",                                           // BeneficiaryPactCard.tsx
    "pact-renew", "pact-set-auto-renew", "pact-pay-premium", "pact-revoke", // PactCard.tsx
  ];
  it("registers every macro the death-insurance lens dispatches (no phantoms)", () => {
    for (const m of CALLED_BY_LENS) {
      assert.equal(typeof ACTIONS.get(m), "function", `phantom caller: insurance.${m} not registered`);
    }
  });
});

describe("death-insurance — renewal + auto-renew round-trip", () => {
  it("renews an expired pact back to active and extends the expiry by the real day-math", () => {
    const w = call("pact-write", ctxInsured, {
      beneficiaryUserId: "bene_a", payoutSparks: 600, premiumSparks: 30, durationDays: 7,
      requireHandshake: false,
    });
    assert.equal(w.ok, true);
    const pactId = w.result.pact.id;

    // Force the pact past its expiry so renew takes the "expired" branch.
    const stored = globalThis._concordSTATE.inheritPacts.pacts.get("ins_alpha")[0];
    stored.expiresAt = NOW() - 10;
    assert.equal(call("pact-list", ctxInsured, {}).result.written[0].status, "expired");

    const renew = call("pact-renew", ctxInsured, { pactId, durationDays: 14 });
    assert.equal(renew.ok, true);
    assert.equal(renew.result.pact.status, "active");
    assert.equal(renew.result.pact.renewCount, 1);
    assert.equal(renew.result.pact.durationDays, 14);
    // Expired branch re-bases off now: expiresAt ≈ now + 14 days (PACT_DAY=86400).
    const expectMin = NOW() + 14 * 86400 - 5;
    assert.ok(renew.result.pact.expiresAt >= expectMin, "renewed expiry should be ~now + 14d");
  });

  it("toggles auto-renew on then off via pact-set-auto-renew", () => {
    const w = call("pact-write", ctxInsured, {
      beneficiaryUserId: "bene_a", payoutSparks: 200, premiumSparks: 20, durationDays: 30,
      requireHandshake: false,
    });
    const pactId = w.result.pact.id;
    assert.equal(w.result.pact.autoRenew, false);

    const on = call("pact-set-auto-renew", ctxInsured, { pactId, autoRenew: true });
    assert.equal(on.ok, true);
    assert.equal(on.result.autoRenew, true);
    assert.equal(call("pact-list", ctxInsured, {}).result.written[0].autoRenew, true);

    const off = call("pact-set-auto-renew", ctxInsured, { pactId, autoRenew: false });
    assert.equal(off.result.autoRenew, false);
  });

  it("refuses to renew a revoked pact", () => {
    const w = call("pact-write", ctxInsured, {
      beneficiaryUserId: "bene_a", payoutSparks: 200, premiumSparks: 20, requireHandshake: false,
    });
    call("pact-revoke", ctxInsured, { pactId: w.result.pact.id });
    const r = call("pact-renew", ctxInsured, { pactId: w.result.pact.id, durationDays: 5 });
    assert.equal(r.ok, false);
    assert.match(r.error, /revoked/);
  });
});

describe("death-insurance — recurring premium schedule", () => {
  it("accumulates premium installments and advances the next-due date", () => {
    const w = call("pact-write", ctxInsured, {
      beneficiaryUserId: "bene_a", payoutSparks: 1000, premiumSparks: 25,
      durationDays: 60, premiumFrequency: "weekly", requireHandshake: false,
    });
    assert.equal(w.ok, true);
    // Weekly pact starts with 0 paid (upfront-only pays at write).
    assert.equal(w.result.pact.premiumPaidSparks, 0);
    assert.equal(w.result.pact.premiumFrequency, "weekly");
    const pactId = w.result.pact.id;

    const p1 = call("pact-pay-premium", ctxInsured, { pactId });
    assert.equal(p1.ok, true);
    assert.equal(p1.result.premiumPaidSparks, 25);
    assert.equal(p1.result.installments, 1);
    const due1 = p1.result.nextPremiumDueAt;

    const p2 = call("pact-pay-premium", ctxInsured, { pactId });
    assert.equal(p2.result.premiumPaidSparks, 50); // 25 + 25, real accumulation
    assert.equal(p2.result.installments, 2);
    assert.ok(p2.result.nextPremiumDueAt >= due1, "next-due should advance, not regress");

    const sched = call("pact-premium-schedule", ctxInsured, { pactId });
    assert.equal(sched.ok, true);
    assert.equal(sched.result.premiumFrequency, "weekly");
    assert.equal(sched.result.installmentSparks, 25);
    assert.equal(sched.result.intervalDays, 7);
    assert.equal(sched.result.premiumPaidSparks, 50);
    assert.equal(sched.result.installments.length, 2);
  });

  it("rejects paying a premium on an upfront pact (no recurring schedule)", () => {
    const w = call("pact-write", ctxInsured, {
      beneficiaryUserId: "bene_a", payoutSparks: 500, premiumSparks: 100,
      premiumFrequency: "upfront", requireHandshake: false,
    });
    // upfront pays the premium at write.
    assert.equal(w.result.pact.premiumPaidSparks, 100);
    const r = call("pact-pay-premium", ctxInsured, { pactId: w.result.pact.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /upfront/);
  });
});

describe("death-insurance — money conservation across a 3-way split", () => {
  it("splits the exact payout with no sparks minted or lost (odd division)", () => {
    // 1000 sparks across 33/33/34 — proves the residual-to-last-beneficiary
    // rounding conserves the total exactly.
    const w = call("pact-write", ctxInsured, {
      beneficiaries: [
        { userId: "bene_a", sharePct: 33 },
        { userId: "bene_b", sharePct: 33 },
        { userId: "bene_c", sharePct: 34 },
      ],
      payoutSparks: 1000, premiumSparks: 50, durationDays: 30, requireHandshake: false,
    });
    assert.equal(w.ok, true);
    const pactId = w.result.pact.id;
    armPact("ins_alpha");

    const payout = call("pact-record-payout", ctxInsured, { pactId });
    assert.equal(payout.ok, true);
    assert.equal(payout.result.payout.totalSparks, 1000);
    const splits = payout.result.payout.splits;
    assert.equal(splits.length, 3);
    // CONSERVATION: the splits sum EXACTLY to the declared payout — nothing
    // fabricated, nothing dropped. (This is the staking/bounty 1e308-class bug
    // class: a split that over- or under-mints the total.)
    const sum = splits.reduce((a, s) => a + s.sparks, 0);
    assert.equal(sum, 1000, "splits must conserve the payout exactly");
    // Every split is a finite, non-negative integer ≤ the total.
    for (const s of splits) {
      assert.ok(Number.isFinite(s.sparks) && s.sparks >= 0 && s.sparks <= 1000, `bad split: ${s.sparks}`);
    }

    // Each beneficiary's received total matches their split — cross-checked
    // through the independent payout-history read path.
    for (const [ctx, uid] of [[ctxA, "bene_a"], [ctxB, "bene_b"], [ctxC, "bene_c"]]) {
      const hist = call("pact-payout-history", ctx, {});
      const mine = splits.find((s) => s.userId === uid).sparks;
      assert.equal(hist.result.totalReceivedSparks, mine, `${uid} history must equal split`);
    }
  });
});

describe("death-insurance — multi-pact totals + per-user isolation", () => {
  it("two pacts firing into one writer's history accumulate without cross-user leak", () => {
    const w1 = call("pact-write", ctxInsured, {
      beneficiaryUserId: "bene_a", payoutSparks: 400, premiumSparks: 10, requireHandshake: false,
    });
    const w2 = call("pact-write", ctxInsured, {
      beneficiaryUserId: "bene_b", payoutSparks: 600, premiumSparks: 10, requireHandshake: false,
    });
    armPact("ins_alpha", 0);
    armPact("ins_alpha", 1);
    assert.equal(call("pact-record-payout", ctxInsured, { pactId: w1.result.pact.id }).ok, true);
    assert.equal(call("pact-record-payout", ctxInsured, { pactId: w2.result.pact.id }).ok, true);

    const hist = call("pact-payout-history", ctxInsured, {});
    assert.equal(hist.result.paidOut.length, 2);
    assert.equal(hist.result.totalPaidOutSparks, 1000); // 400 + 600

    // A different insured's history is untouched — STATE keyed by userId.
    call("pact-write", ctxInsuredB, {
      beneficiaryUserId: "bene_c", payoutSparks: 999, premiumSparks: 10, requireHandshake: false,
    });
    assert.equal(call("pact-payout-history", ctxInsuredB, {}).result.paidOut.length, 0);
    assert.equal(call("pact-payout-history", ctxInsuredB, {}).result.totalPaidOutSparks, 0);
  });
});

describe("death-insurance — fail-CLOSED poisoned numerics (assassin V2)", () => {
  it("rejects poisoned durationDays on pact-renew before any write", () => {
    const w = call("pact-write", ctxInsured, {
      beneficiaryUserId: "bene_a", payoutSparks: 100, premiumSparks: 10, requireHandshake: false,
    });
    for (const bad of [NaN, Infinity, -1, 1e308]) {
      const r = call("pact-renew", ctxInsured, { pactId: w.result.pact.id, durationDays: bad });
      assert.equal(r.ok, false, `durationDays=${bad} should fail-closed`);
    }
    assert.equal(
      call("pact-renew", ctxInsured, { pactId: w.result.pact.id, durationDays: 1e308 }).error,
      "invalid_durationDays",
    );
  });

  it("rejects poisoned payout/premium on write and poisoned windowDays on notifications", () => {
    for (const bad of [NaN, Infinity, -5, 1e308]) {
      assert.equal(
        call("pact-write", ctxInsured, { beneficiaryUserId: "bene_a", payoutSparks: bad, premiumSparks: 10 }).ok,
        false, `payoutSparks=${bad} should fail-closed`,
      );
      assert.equal(
        call("pact-write", ctxInsured, { beneficiaryUserId: "bene_a", payoutSparks: 100, premiumSparks: bad }).ok,
        false, `premiumSparks=${bad} should fail-closed`,
      );
    }
    assert.equal(call("pact-notifications", ctxInsured, { windowDays: 1e308 }).error, "invalid_windowDays");
  });

  it("reads return ok:true on empty input — never no_db / no_user", () => {
    assert.equal(call("pact-list", ctxInsured, {}).ok, true);
    assert.equal(call("pact-payout-history", ctxInsured, {}).ok, true);
    assert.equal(call("pact-notifications", ctxInsured, {}).ok, true);
  });
});
