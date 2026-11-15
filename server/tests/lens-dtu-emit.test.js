import { test } from "node:test";
import assert from "node:assert/strict";
import { lensExhaustEmitTarget } from "../lib/lens-dtu-emit.js";

test("lens exhaust emits go to the owner room, never the global bus", () => {
  assert.deepEqual(lensExhaustEmitTarget("user_abc"), { userId: "user_abc" });
  assert.equal(lensExhaustEmitTarget("anon"), null);
  assert.equal(lensExhaustEmitTarget("system"), null);
  assert.equal(lensExhaustEmitTarget(""), null);
  assert.equal(lensExhaustEmitTarget(null), null);
});
