// Phase 9a: limits — 5 runs per user per hour and a 200/day global cap by
// default (Ramaj's Oct 27 decisions), both env-tunable. The covered fast
// path is used so the test needs no providers, fetcher or LLM.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { autoSource, _resetAutoSourceForTests } from "../lib/auto-source.js";

const deps = {
  runMacro: async () => ({ ok: true, id: "x" }),
  searchDtus: async () => [{ meta: { kind: "auto-source" }, title: "existing" }],
  fetchPage: async () => null,
  summarize: async () => "",
  providers: [],
};

beforeEach(() => { _resetAutoSourceForTests(); delete process.env.CONCORD_AUTOSOURCE_DAILY_CAP; });
afterEach(() => { delete process.env.CONCORD_AUTOSOURCE_DAILY_CAP; });

test("the 6th run in an hour for one user is a 429; another user is unaffected", async () => {
  for (let i = 0; i < 5; i++) {
    const r = await autoSource({ topic: "topic a", userId: "u-limit-1" }, deps);
    assert.equal(r.ok, true, `run ${i + 1} should pass`);
  }
  const sixth = await autoSource({ topic: "topic a", userId: "u-limit-1" }, deps);
  assert.equal(sixth.ok, false);
  assert.equal(sixth.status, 429);
  assert.equal(sixth.reason, "user_hourly_limit");
  const other = await autoSource({ topic: "topic a", userId: "u-limit-2" }, deps);
  assert.equal(other.ok, true);
});

test("the global daily cap stops everyone once reached", async () => {
  process.env.CONCORD_AUTOSOURCE_DAILY_CAP = "2";
  _resetAutoSourceForTests();
  assert.equal((await autoSource({ topic: "cap topic", userId: "u-cap-1" }, deps)).ok, true);
  assert.equal((await autoSource({ topic: "cap topic", userId: "u-cap-2" }, deps)).ok, true);
  const third = await autoSource({ topic: "cap topic", userId: "u-cap-3" }, deps);
  assert.equal(third.ok, false);
  assert.equal(third.status, 429);
  assert.equal(third.reason, "global_daily_cap");
});
