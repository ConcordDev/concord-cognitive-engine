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

test("a real source is recorded into reasons for the audit trail, without changing severity", () => {
  const withSource = classify({ source: "econ_anomaly", kind: "wash_trade" });
  assert.ok(withSource.reasons.includes("source:econ_anomaly"));
  assert.equal(withSource.severity, SEVERITY.CRITICAL, "wash_trade is critical regardless of source");

  // Same kind, no source supplied — same severity, no source reason.
  const noSource = classify({ kind: "wash_trade" });
  assert.equal(noSource.severity, withSource.severity);
  assert.ok(!noSource.reasons.some((r) => r.startsWith("source:")));
});

test("regression: a real source alone must NOT force Critical on a non-critical kind", () => {
  // Every real caller (client-error-intake, economy-anomaly-cycle, feedback
  // bug_report) passes a non-"unknown" source on every call. A prior bug
  // computed the hard-escalator flag from `reasons.length > 0` AFTER the
  // source-provenance entry was already pushed into `reasons`, so merely
  // supplying a source silently forced every kind to Critical. Pin the
  // documented contract directly: source changes provenance, never severity.
  const minor = classify({ source: "client_error", kind: "totally_unclassified" });
  assert.equal(minor.severity, SEVERITY.MINOR, "unclassified kind + source must stay Minor");
  assert.equal(minor.route, ROUTE.BOARD);
  assert.ok(minor.reasons.includes("source:client_error"));

  const major = classify({ source: "client_error", kind: "white_screen" });
  assert.equal(major.severity, SEVERITY.MAJOR, "major kind + source, no escalator/blast-radius, must stay Major");
  assert.equal(major.route, ROUTE.BOARD);

  const moderate = classify({ source: "client_error", kind: "slow" });
  assert.equal(moderate.severity, SEVERITY.MODERATE, "moderate kind + source must stay Moderate");

  // Sanity: an actual escalator signal alongside a source still escalates.
  const escalated = classify({ source: "client_error", kind: "slow", signals: { security: true } });
  assert.equal(escalated.severity, SEVERITY.CRITICAL);
});
