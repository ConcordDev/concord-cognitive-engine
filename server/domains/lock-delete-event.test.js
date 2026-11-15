// FIX-lock-004: per-event delete for the lock trace. The trace had
// only a bulk Clear; deleteLockEvent removes one event from the
// CALLER'S OWN trace, refuses unknown ids by name, and cannot reach
// another user's events (the store is per-user by construction).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLockActions from "./lock.js";

const actions = new Map();
registerLockActions((domain, name, fn) => actions.set(name, fn));
const call = (name, ctx, params = {}) =>
  actions.get(name)(ctx, { id: null, domain: "lock", type: "domain_action", data: params, meta: {} }, params);
const U1 = { actor: { userId: "u1" } };
const U2 = { actor: { userId: "u2" } };

beforeEach(() => { globalThis._concordSTATE = {}; });

function record(ctx, thread) {
  const r = call("recordLockEvent", ctx, { thread, lock: "accounts", action: "acquire" });
  assert.equal(r.ok, true);
  return r.result.recorded.id;
}

test("deletes one event from the caller's trace and reports the remainder", () => {
  const a = record(U1, "worker-1");
  const b = record(U1, "worker-2");
  const r = call("deleteLockEvent", U1, { id: a });
  assert.equal(r.ok, true);
  assert.equal(r.result.deleted, a);
  assert.equal(r.result.totalEvents, 1);
  // The other event is untouched: it still deletes cleanly.
  assert.equal(call("deleteLockEvent", U1, { id: b }).ok, true);
});

test("refuses an unknown id by name, and a missing id outright", () => {
  record(U1, "worker-1");
  const r = call("deleteLockEvent", U1, { id: "lt_nope" });
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/);
  assert.equal(call("deleteLockEvent", U1, {}).ok, false);
  // Deleting the same event twice: the second is a refusal, not a crash.
  const id = record(U1, "worker-9");
  assert.equal(call("deleteLockEvent", U1, { id }).ok, true);
  assert.equal(call("deleteLockEvent", U1, { id }).ok, false);
});

test("cannot delete another user's event", () => {
  const a = record(U1, "worker-1");
  const r = call("deleteLockEvent", U2, { id: a });
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/);
  // And it is still there for its owner.
  assert.equal(call("deleteLockEvent", U1, { id: a }).ok, true);
});
