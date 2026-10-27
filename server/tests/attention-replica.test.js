// INC-150: the attention allocator's 15-min cycle must not run on a read replica.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { init, stop, getStatus } from "../emergent/attention-allocator.js";

const prev = process.env.CONCORD_READ_REPLICA;
after(() => { stop(); if (prev === undefined) delete process.env.CONCORD_READ_REPLICA; else process.env.CONCORD_READ_REPLICA = prev; });

test("replica skips the attention timer; primary arms it", () => {
  process.env.CONCORD_READ_REPLICA = "1";
  assert.equal(init({}).skipped, "read_replica");
  assert.equal(getStatus().running, false);
  delete process.env.CONCORD_READ_REPLICA;
  const r = init({});
  assert.equal(r.skipped, undefined);
  assert.equal(getStatus().running, true);
  stop();
});
