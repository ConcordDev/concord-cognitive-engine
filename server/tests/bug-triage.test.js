/**
 * E3 — severity-triage router.
 *
 * Pins the Critical/Major/Moderate/Minor taxonomy + the page-vs-board routing that the
 * client-error intake, the economy-anomaly cycle, and the feedback bug_report path all share.
 *
 * Run: node --test tests/bug-triage.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, shouldPage, SEVERITY, ROUTE } from "../lib/bug-triage.js";

test("data-loss / exploit / security kinds are Critical → page", () => {
  for (const kind of ["data_loss", "exploit", "wash_trade", "secret_leak", "negative_balance"]) {
    const r = classify({ kind });
    assert.equal(r.severity, SEVERITY.CRITICAL, kind);
    assert.equal(r.route, ROUTE.PAGE, kind);
  }
});

test("a security/dataLoss/moneyMoved signal forces Critical regardless of kind", () => {
  assert.equal(classify({ kind: "slow", signals: { security: true } }).severity, SEVERITY.CRITICAL);
  assert.equal(classify({ kind: "visual_glitch", signals: { dataLoss: true } }).severity, SEVERITY.CRITICAL);
  assert.equal(classify({ kind: "console_error", signals: { moneyMoved: true } }).severity, SEVERITY.CRITICAL);
});

test("broken-feature kinds are Major → board", () => {
  const r = classify({ kind: "white_screen" });
  assert.equal(r.severity, SEVERITY.MAJOR);
  assert.equal(r.route, ROUTE.BOARD);
});

test("a Major affecting >=25 users escalates to Critical (blast radius)", () => {
  const r = classify({ kind: "soft_lock", signals: { affectedUsers: 40 } });
  assert.equal(r.severity, SEVERITY.CRITICAL);
  assert.equal(r.route, ROUTE.PAGE);
  assert.ok(r.reasons.some((x) => x.startsWith("blast_radius")));
});

test("degraded-but-usable kinds are Moderate; unknown is Minor", () => {
  assert.equal(classify({ kind: "slow" }).severity, SEVERITY.MODERATE);
  assert.equal(classify({ kind: "perf" }).severity, SEVERITY.MODERATE);
  assert.equal(classify({ kind: "something_new" }).severity, SEVERITY.MINOR);
  assert.equal(classify({}).severity, SEVERITY.MINOR);
});

test("shouldPage is true only for Critical", () => {
  assert.equal(shouldPage({ kind: "exploit" }), true);
  assert.equal(shouldPage({ kind: "white_screen" }), false);
  assert.equal(shouldPage({ kind: "slow" }), false);
});

test("reasons always explain the verdict", () => {
  const r = classify({ kind: "dupe" });
  assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0);
});
