// lock-deadlock-trace.test.js
// FIX-lock-001 (GB-1521 slice B6) — deadlockDetect read only a
// caller-supplied snapshot while every sibling lock analysis reads the
// recorded trace, so the Wait-For Graph reported "no lock data" (or
// missed the cycle) on traces Lock Ordering analysed fine. It now
// derives wait-for rows from the same recorded events: a thread waiting
// on a lock another thread holds, which never acquires it later in the
// trace, contributes an edge.
//
// Run: node --test server/domains/lock-deadlock-trace.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLockActions from "./lock.js";

const actions = new Map();
registerLockActions((domain, action, fn) => actions.set(`${domain}:${action}`, fn));
const rec = actions.get("lock:recordLockEvent");
const dd = actions.get("lock:deadlockDetect");
const as = (u) => ({ actor: { userId: u }, userId: u });

beforeEach(() => { globalThis._concordSTATE = {}; });

describe("lock-001 — deadlockDetect reads the recorded trace", () => {
  it("detects a two-thread L1/L2 cycle from trace events alone", () => {
    const ctx = as("u1");
    const t0 = 1000;
    for (const e of [
      { thread: "T1", lock: "L1", action: "acquire", ts: t0 },
      { thread: "T2", lock: "L2", action: "acquire", ts: t0 + 1 },
      { thread: "T1", lock: "L2", action: "wait", ts: t0 + 2 },
      { thread: "T2", lock: "L1", action: "wait", ts: t0 + 3 },
    ]) rec(ctx, null, e);
    const r = dd(ctx, null, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.deadlocked, true);
    assert.deepEqual(r.result.deadlockedNodes.sort(), ["T1", "T2"]);
  });

  it("a wait that later resolves contributes no edge", () => {
    const ctx = as("u2");
    const t0 = 2000;
    for (const e of [
      { thread: "T1", lock: "L1", action: "acquire", ts: t0 },
      { thread: "T3", lock: "L1", action: "wait", ts: t0 + 1 },
      { thread: "T1", lock: "L1", action: "release", ts: t0 + 2 },
      { thread: "T3", lock: "L1", action: "acquire", ts: t0 + 3 },
    ]) rec(ctx, null, e);
    const r = dd(ctx, null, {});
    assert.equal(r.result.deadlocked, false);
  });

  it("no data at all still answers honestly", () => {
    const r = dd(as("u3"), null, {});
    assert.equal(r.result.deadlocked, false);
    assert.equal(r.result.message, "No lock data provided.");
  });

  it("a supplied snapshot still detects its cycle", () => {
    const r = dd(as("u4"), null, { locks: [{ holder: "L1", waiting: "L2" }, { holder: "L2", waiting: "L1" }] });
    assert.equal(r.result.deadlocked, true);
  });
});
