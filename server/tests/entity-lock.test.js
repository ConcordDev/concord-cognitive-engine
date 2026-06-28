/**
 * Adversarial-hardening — per-entity TOCTOU mutex contract test.
 *
 * Pins: two concurrent withEntityLock calls on the SAME key serialize (no
 * interleave — the second observes the first's committed state); different keys
 * run in parallel; the lock auto-releases on settle (success OR throw) and the
 * internal Map drains so it can't grow unbounded; `mode:'reject'` fast-rejects
 * a contended key.
 *
 * Run: node --test tests/entity-lock.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withEntityLock, _lockCount, _isLocked, EntityBusyError } from "../lib/entity-lock.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("withEntityLock", () => {
  it("serializes same-key async fns with no interleave (double-spend guard)", async () => {
    // Shared mutable balance — the classic read-await-write double-spend.
    let balance = 1;
    const order = [];

    async function spend(tag) {
      return withEntityLock("item:1", async () => {
        order.push(`${tag}:read`);
        const have = balance;          // READ
        await tick();                  // the TOCTOU window
        if (have >= 1) {
          balance = have - 1;          // WRITE
          order.push(`${tag}:spent`);
          return true;
        }
        order.push(`${tag}:declined`);
        return false;
      });
    }

    const [a, b] = await Promise.all([spend("A"), spend("B")]);
    // Exactly one spend succeeds; balance can't go negative.
    assert.equal(balance, 0);
    assert.equal([a, b].filter(Boolean).length, 1);
    // No interleave: the first holder fully completes before the second reads.
    const firstRead = order[0];
    const firstTag = firstRead.split(":")[0];
    assert.equal(order[1], `${firstTag}:spent`);
  });

  it("runs different keys in parallel", async () => {
    const marks = [];
    const slow = (key, ms) => withEntityLock(key, async () => {
      marks.push(`${key}:start`);
      await new Promise((r) => setTimeout(r, ms));
      marks.push(`${key}:end`);
    });
    await Promise.all([slow("node:1", 20), slow("node:2", 1)]);
    // node:2 (fast) should finish before node:1 (slow) — proves parallelism.
    assert.ok(marks.indexOf("node:2:end") < marks.indexOf("node:1:end"));
  });

  it("releases the lock after the fn throws", async () => {
    await assert.rejects(
      withEntityLock("trade:x", async () => { throw new Error("boom"); }),
      /boom/,
    );
    // Lock must be free again — a subsequent call runs.
    const r = await withEntityLock("trade:x", async () => "ok");
    assert.equal(r, "ok");
  });

  it("drains the internal map (no unbounded growth)", async () => {
    const before = _lockCount();
    await withEntityLock("ephemeral:1", async () => 1);
    await tick();
    assert.equal(_lockCount(), before, "map should drain back to baseline");
    assert.equal(_isLocked("ephemeral:1"), false);
  });

  it("propagates the fn's return value and rejection to the caller", async () => {
    assert.equal(await withEntityLock("k", () => 7), 7);
    await assert.rejects(withEntityLock("k", () => { throw new Error("nope"); }), /nope/);
  });

  it("mode:'reject' fast-rejects a contended key but queues are default", async () => {
    let release;
    const held = withEntityLock("busy:1", () => new Promise((r) => { release = r; }));
    // While held, a reject-mode attempt bounces immediately.
    await assert.rejects(
      withEntityLock("busy:1", async () => "should not run", { mode: "reject" }),
      (e) => e instanceof EntityBusyError && e.code === "busy",
    );
    release();
    await held;
    // After release, reject-mode succeeds again.
    assert.equal(await withEntityLock("busy:1", async () => "free", { mode: "reject" }), "free");
  });

  it("preserves FIFO order for queued same-key calls", async () => {
    const seen = [];
    await Promise.all([1, 2, 3].map((n) =>
      withEntityLock("queue:1", async () => { await tick(); seen.push(n); }),
    ));
    assert.deepEqual(seen, [1, 2, 3]);
  });
});
