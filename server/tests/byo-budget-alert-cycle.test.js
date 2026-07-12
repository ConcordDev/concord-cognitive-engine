// server/tests/byo-budget-alert-cycle.test.js
//
// Tier-2 contract tests for the BYO-keys proactive spend-alert gap
// closure (docs/lens-specs/byo-keys-capability-map.md item #10).
//
// Two units under test:
//   - server/domains/byo-keys.js#checkSpendAlerts — pure sweep +
//     once-per-crossing dedupe bookkeeping.
//   - server/emergent/byo-budget-alert-cycle.js#runByoBudgetAlertCycle
//     — the heartbeat handler that dispatches a real notification for
//     each newly-crossed alert via social-layer's createNotification.
//
// Pins: correct threshold detection, no re-fire until reset/increase,
// no fire under threshold, multi-user isolation, real notification
// delivery into the social-layer substrate, and the never-throw
// heartbeat invariant (CLAUDE.md: "Heartbeat modules must never
// throw").

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerByoKeysMacros, { checkSpendAlerts, SPEND_ALERT_THRESHOLDS } from "../domains/byo-keys.js";
import { runByoBudgetAlertCycle } from "../emergent/byo-budget-alert-cycle.js";
import { getNotifications } from "../emergent/social-layer.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`byo_keys.${name}`);
  if (!fn) throw new Error(`byo_keys.${name} not registered`);
  return fn(ctx, input);
}

registerByoKeysMacros(register);

function ctxFor(userId) {
  return { actor: { userId }, userId };
}

beforeEach(() => {
  // Fresh STATE per test — stateRoot()/getSocialState() both lazily
  // attach their substrate onto whatever object globalThis._concordSTATE
  // points at, so a brand-new object is full isolation.
  globalThis._concordSTATE = {};
});

describe("checkSpendAlerts — threshold detection + dedupe", () => {
  it("SPEND_ALERT_THRESHOLDS is checked highest-first", () => {
    assert.deepEqual(SPEND_ALERT_THRESHOLDS, [1.0, 0.8]);
  });

  it("fires nothing when no budgets are set", async () => {
    const r = checkSpendAlerts();
    assert.equal(r.ok, true);
    assert.deepEqual(r.fired, []);
  });

  it("fires nothing when spend is under the lowest threshold", async () => {
    await call("set_budget", ctxFor("user_a"), { slot: "conscious", monthlyUsdCap: 10 });
    // $3 of $10 = 30% — well under the 80% floor.
    await call("record_usage", ctxFor("user_a"), { slot: "conscious", provider: "anthropic", tokensIn: 1_000_000, tokensOut: 0 });
    const r = checkSpendAlerts();
    assert.equal(r.ok, true);
    assert.deepEqual(r.fired, []);
  });

  it("fires a 0.8 alert exactly once when spend crosses 80%", async () => {
    await call("set_budget", ctxFor("user_a"), { slot: "conscious", monthlyUsdCap: 3.75 });
    // anthropic input is $3.00/M tokens -> 1M tokens = $3.00 = 80% of $3.75.
    await call("record_usage", ctxFor("user_a"), { slot: "conscious", provider: "anthropic", tokensIn: 1_000_000, tokensOut: 0 });

    const first = checkSpendAlerts();
    assert.equal(first.ok, true);
    assert.equal(first.fired.length, 1);
    assert.equal(first.fired[0].userId, "user_a");
    assert.equal(first.fired[0].slot, "conscious");
    assert.equal(first.fired[0].threshold, 0.8);
    assert.equal(first.fired[0].usdPct, 0.8);

    // Same tick conditions again — must NOT re-fire.
    const second = checkSpendAlerts();
    assert.equal(second.ok, true);
    assert.deepEqual(second.fired, []);
  });

  it("escalates to a 1.0 alert when spend increases past the cap (threshold increase re-fires)", async () => {
    await call("set_budget", ctxFor("user_a"), { slot: "conscious", monthlyUsdCap: 3 });
    await call("record_usage", ctxFor("user_a"), { slot: "conscious", provider: "anthropic", tokensIn: 900_000, tokensOut: 0 }); // 90%
    const first = checkSpendAlerts();
    assert.equal(first.fired.length, 1);
    assert.equal(first.fired[0].threshold, 0.8);

    // Push past 100%.
    await call("record_usage", ctxFor("user_a"), { slot: "conscious", provider: "anthropic", tokensIn: 200_000, tokensOut: 0 }); // +$0.60 -> $3.30 of $3
    const second = checkSpendAlerts();
    assert.equal(second.fired.length, 1);
    assert.equal(second.fired[0].threshold, 1.0);
    assert.equal(second.fired[0].usdPct >= 1, true);

    // Still over 100% on the next sweep with no new spend — must NOT re-fire again.
    const third = checkSpendAlerts();
    assert.deepEqual(third.fired, []);
  });

  it("re-fires after a month rollover even at the same spend level", async () => {
    await call("set_budget", ctxFor("user_a"), { slot: "utility", monthlyUsdCap: 1 });
    await call("record_usage", ctxFor("user_a"), { slot: "utility", provider: "google", tokensIn: 1_000_000, tokensOut: 0 }); // $1.25 -> over cap
    const first = checkSpendAlerts();
    assert.equal(first.fired.length, 1);

    // Simulate a month having rolled over by rewriting the dedupe
    // entry's stored month to something stale — this is the same
    // effect real time-passage would have without needing a fake
    // clock, and it exercises exactly the field checkSpendAlerts
    // compares against.
    const root = globalThis._concordSTATE.byoKeysLens;
    const alertEntry = root.alerts.get("user_a").get("utility");
    alertEntry.month = "2000-01";

    const second = checkSpendAlerts();
    assert.equal(second.fired.length, 1);
    assert.equal(second.fired[0].slot, "utility");
  });

  it("isolates alerts per user — only the crossing user fires", async () => {
    await call("set_budget", ctxFor("user_a"), { slot: "conscious", monthlyUsdCap: 1 });
    await call("set_budget", ctxFor("user_b"), { slot: "conscious", monthlyUsdCap: 1000 });
    await call("record_usage", ctxFor("user_a"), { slot: "conscious", provider: "anthropic", tokensIn: 1_000_000, tokensOut: 0 }); // $3 of $1 cap -> way over
    await call("record_usage", ctxFor("user_b"), { slot: "conscious", provider: "anthropic", tokensIn: 1_000_000, tokensOut: 0 }); // $3 of $1000 cap -> 0.3%

    const r = checkSpendAlerts();
    assert.equal(r.fired.length, 1);
    assert.equal(r.fired[0].userId, "user_a");
  });

  it("token-cap crossings are detected the same way as USD-cap crossings", async () => {
    await call("set_budget", ctxFor("user_a"), { slot: "repair", monthlyTokenCap: 1_000_000 });
    await call("record_usage", ctxFor("user_a"), { slot: "repair", provider: "openai", tokensIn: 850_000, tokensOut: 0 }); // 85% of token cap
    const r = checkSpendAlerts();
    assert.equal(r.fired.length, 1);
    assert.equal(r.fired[0].threshold, 0.8);
    assert.equal(r.fired[0].tokenPct, 0.85);
    assert.equal(r.fired[0].usdPct, null); // no USD cap set on this slot
  });
});

describe("runByoBudgetAlertCycle — heartbeat dispatch", () => {
  it("dispatches a real social-layer notification for a newly-crossed alert", async () => {
    await call("set_budget", ctxFor("user_a"), { slot: "conscious", monthlyUsdCap: 3 });
    await call("record_usage", ctxFor("user_a"), { slot: "conscious", provider: "anthropic", tokensIn: 1_000_000, tokensOut: 0 }); // exactly 100%

    const STATE = globalThis._concordSTATE;
    const result = await runByoBudgetAlertCycle({ state: STATE, db: null, tickCount: 20, reason: "heartbeat" });

    assert.equal(result.ok, true);
    assert.equal(result.fired, 1);
    assert.equal(result.notified, 1);

    const notifs = getNotifications(STATE, "user_a", {});
    assert.equal(notifs.ok, true);
    assert.equal(notifs.notifications.length, 1);
    assert.equal(notifs.notifications[0].type, "budget_alert");
    assert.match(notifs.notifications[0].content, /Conscious/);
    assert.match(notifs.notifications[0].content, /cap/);
  });

  it("is a no-op (fired: 0) when nobody has crossed a threshold", async () => {
    await call("set_budget", ctxFor("user_a"), { slot: "conscious", monthlyUsdCap: 1000 });
    await call("record_usage", ctxFor("user_a"), { slot: "conscious", provider: "anthropic", tokensIn: 1000, tokensOut: 0 });

    const STATE = globalThis._concordSTATE;
    const result = await runByoBudgetAlertCycle({ state: STATE, db: null, tickCount: 20, reason: "heartbeat" });
    assert.equal(result.ok, true);
    assert.equal(result.fired, 0);
    assert.equal(result.notified, 0);
    assert.equal(getNotifications(STATE, "user_a", {}).notifications.length, 0);
  });

  it("does not re-dispatch on a second tick with no new spend", async () => {
    await call("set_budget", ctxFor("user_a"), { slot: "conscious", monthlyUsdCap: 3 });
    await call("record_usage", ctxFor("user_a"), { slot: "conscious", provider: "anthropic", tokensIn: 1_000_000, tokensOut: 0 });

    const STATE = globalThis._concordSTATE;
    await runByoBudgetAlertCycle({ state: STATE, db: null, tickCount: 20, reason: "heartbeat" });
    const second = await runByoBudgetAlertCycle({ state: STATE, db: null, tickCount: 40, reason: "heartbeat" });

    assert.equal(second.fired, 0);
    assert.equal(getNotifications(STATE, "user_a", {}).notifications.length, 1); // still just the one
  });

  it("respects the CONCORD_BYO_BUDGET_ALERTS=0 kill-switch", async () => {
    await call("set_budget", ctxFor("user_a"), { slot: "conscious", monthlyUsdCap: 1 });
    await call("record_usage", ctxFor("user_a"), { slot: "conscious", provider: "anthropic", tokensIn: 1_000_000, tokensOut: 0 });

    process.env.CONCORD_BYO_BUDGET_ALERTS = "0";
    try {
      const STATE = globalThis._concordSTATE;
      const result = await runByoBudgetAlertCycle({ state: STATE, db: null, tickCount: 20, reason: "heartbeat" });
      assert.equal(result.ok, true);
      assert.equal(result.skipped, "disabled");
      assert.equal(getNotifications(STATE, "user_a", {}).notifications.length, 0);
    } finally {
      delete process.env.CONCORD_BYO_BUDGET_ALERTS;
    }
  });

  it("INVARIANT: never throws, even when the underlying state is malformed", async () => {
    await call("set_budget", ctxFor("user_a"), { slot: "conscious", monthlyUsdCap: 1 });
    await call("record_usage", ctxFor("user_a"), { slot: "conscious", provider: "anthropic", tokensIn: 1_000_000, tokensOut: 0 });

    // Corrupt the substrate after it's been lazily created so checkSpendAlerts
    // throws internally (root.budgets.entries() on a non-Map).
    globalThis._concordSTATE.byoKeysLens.budgets = null;

    let threw = false;
    let result;
    try {
      result = await runByoBudgetAlertCycle({ state: globalThis._concordSTATE, db: null, tickCount: 20, reason: "heartbeat" });
    } catch (_e) {
      threw = true;
    }
    assert.equal(threw, false, "heartbeat handler must never throw");
    assert.equal(result.ok, false);
    assert.ok(typeof result.error === "string" && result.error.length > 0);
  });

  it("INVARIANT: never throws when ctx.state is omitted (falls back to globalThis._concordSTATE)", async () => {
    let threw = false;
    let result;
    try {
      result = await runByoBudgetAlertCycle({});
    } catch (_e) {
      threw = true;
    }
    assert.equal(threw, false, "heartbeat handler must never throw");
    assert.equal(result.ok, true); // no budgets set on the fresh beforeEach STATE -> a harmless no-op
  });
});
