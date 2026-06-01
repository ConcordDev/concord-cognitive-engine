// server/tests/client-error-intake.test.js
//
// E4 contract — the client-error intake funnel. Pins: sanitise/truncate,
// the bug-triage severity funnel (critical → page, minor → board), counter
// shape, DTU mint shape, blast-radius escalation, kill-switch, never-throw.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestClientError } from "../lib/client-error-intake.js";

function harness(overrides = {}) {
  const calls = { counter: [], dtu: [], alert: [] };
  const deps = {
    incCounter: (kind, severity) => calls.counter.push({ kind, severity }),
    mintDtu: async (record) => { calls.dtu.push(record); return { dtu: { id: "dtu_test_1" } }; },
    alert: async (payload) => { calls.alert.push(payload); },
    ...overrides,
  };
  return { calls, deps };
}

test("critical kind (security) → page + counter + DTU + critical severity", async () => {
  const { calls, deps } = harness();
  const r = await ingestClientError({ body: { kind: "security", message: "leaked token" }, ...deps });
  assert.equal(r.ok, true);
  assert.equal(r.severity, "critical");
  assert.equal(r.route, "page");
  assert.equal(r.paged, true);
  assert.equal(calls.counter.length, 1);
  assert.deepEqual(calls.counter[0], { kind: "security", severity: "critical" });
  assert.equal(calls.dtu.length, 1);
  assert.equal(calls.dtu[0].machine.kind, "client_error");
  assert.equal(calls.alert.length, 1);
  assert.equal(r.dtuId, "dtu_test_1");
});

test("minor/unclassified kind → board, no page, still counted + minted", async () => {
  const { calls, deps } = harness();
  const r = await ingestClientError({ body: { kind: "wobble", message: "x" }, ...deps });
  assert.equal(r.severity, "minor");
  assert.equal(r.route, "board");
  assert.equal(r.paged, false);
  assert.equal(calls.alert.length, 0, "minor must not page");
  assert.equal(calls.counter.length, 1);
  assert.equal(calls.dtu.length, 1);
});

test("major kind (white_screen) with affectedUsers>=25 escalates to critical → page", async () => {
  const { calls, deps } = harness();
  const r = await ingestClientError({ body: { kind: "white_screen", signals: { affectedUsers: 40 } }, ...deps });
  assert.equal(r.severity, "critical");
  assert.equal(r.paged, true);
  assert.equal(calls.alert.length, 1);
});

test("major kind alone (white_screen, few users) → board, no page", async () => {
  const { calls, deps } = harness();
  const r = await ingestClientError({ body: { kind: "white_screen" }, ...deps });
  assert.equal(r.severity, "major");
  assert.equal(r.route, "board");
  assert.equal(calls.alert.length, 0);
});

test("sanitises + truncates oversized fields and clamps breadcrumbs to 20", async () => {
  const { calls, deps } = harness();
  await ingestClientError({
    body: {
      kind: "X".repeat(200),
      message: "m".repeat(5000),
      stack: "s".repeat(9000),
      componentStack: "c".repeat(9000),
      breadcrumbs: Array.from({ length: 100 }, (_, i) => `crumb-${i}`),
      signals: { affectedUsers: "not-a-number" },
    },
    ...deps,
  });
  const m = calls.dtu[0].machine;
  assert.ok(m.clientKind.length <= 64, "kind clamped");
  assert.ok(calls.dtu[0].human.summary.length <= 1000, "message clamped");
  assert.ok(m.stack.length <= 4000, "stack clamped");
  assert.ok(m.componentStack.length <= 2000, "componentStack clamped");
  assert.equal(m.breadcrumbs.length, 20, "breadcrumbs keep only the last 20");
  assert.equal(m.breadcrumbs[19], "crumb-99", "keeps the most recent");
});

test("defaults missing kind to uncaught_throw and lensId to unknown", async () => {
  const { calls, deps } = harness();
  const r = await ingestClientError({ body: { message: "boom" }, ...deps });
  assert.equal(r.kind, "uncaught_throw");
  assert.equal(calls.dtu[0].machine.lensId, "unknown");
});

test("kill-switch CONCORD_CLIENT_ERROR_INTAKE=0 short-circuits with no I/O", async () => {
  const prev = process.env.CONCORD_CLIENT_ERROR_INTAKE;
  process.env.CONCORD_CLIENT_ERROR_INTAKE = "0";
  try {
    const { calls, deps } = harness();
    const r = await ingestClientError({ body: { kind: "security" }, ...deps });
    assert.equal(r.disabled, true);
    assert.equal(calls.counter.length, 0);
    assert.equal(calls.dtu.length, 0);
    assert.equal(calls.alert.length, 0);
  } finally {
    if (prev === undefined) delete process.env.CONCORD_CLIENT_ERROR_INTAKE;
    else process.env.CONCORD_CLIENT_ERROR_INTAKE = prev;
  }
});

test("never throws when DTU mint + alert + counter all fail", async () => {
  const r = await ingestClientError({
    body: { kind: "security", message: "x" },
    incCounter: () => { throw new Error("counter down"); },
    mintDtu: async () => { throw new Error("db down"); },
    alert: async () => { throw new Error("webhook down"); },
  });
  assert.equal(r.ok, true, "intake survives total I/O failure");
  assert.equal(r.severity, "critical");
  assert.equal(r.dtuId, null, "dtuId null when mint failed");
});

test("ignores body.userId spoofing path — userId is stamped into the DTU as provided server-side", async () => {
  // The route attaches req.user?.id; the lib just forwards whatever userId it's
  // given. This pins that the lib reads body.userId (server-attached) into machine.userId.
  const { calls, deps } = harness();
  await ingestClientError({ body: { kind: "wobble", userId: "u_123" }, ...deps });
  assert.equal(calls.dtu[0].machine.userId, "u_123");
});
