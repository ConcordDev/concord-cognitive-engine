// News full build — server legs (B6, F-B row 9).
//
// S2/F4: narrativeTracking adopts its siblings' honest null. Over a set
// whose articles share a single timestamp (or carry none) there are no
// time windows across which framing could shift, so the engine returns
// the { message } shape instead of verdict-shaped zeros (the walk's
// "Stability 0.000 · VOLATILE · 0 shifts" over a one-batch set). A set
// spread over time still computes, unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";

import registerNewsActions from "../domains/news.js";

const actions = {};
registerNewsActions((domain, name, fn) => { actions[`${domain}.${name}`] = fn; });
const CTX = { userId: "news-build-user", actor: { userId: "news-build-user" } };

const SAME_STAMP = "2026-10-27T05:15:00.000Z";
const walkedSet = [
  { title: "City council approves the new transit budget", date: SAME_STAMP },
  { title: "Stingrays delight fans at the aquarium game", date: SAME_STAMP },
  { title: "Markets steady ahead of the central bank decision", date: SAME_STAMP },
  { title: "Local bakery wins a national award for its sourdough", date: SAME_STAMP },
];
const spreadSet = [
  { title: "City council debates the new transit budget", date: "2026-10-24T09:00:00.000Z" },
  { title: "Transit budget passes after a long council debate", date: "2026-10-25T09:00:00.000Z" },
  { title: "Commuters react to the passed transit budget", date: "2026-10-26T09:00:00.000Z" },
  { title: "Transit budget takes effect for city commuters", date: "2026-10-27T09:00:00.000Z" },
];

test("a single-timestamp set gets the honest null, not 0.000 VOLATILE", () => {
  const out = actions["news.narrativeTracking"](CTX, { data: { articles: walkedSet } }, {});
  assert.equal(out.ok, true);
  assert.match(out.result.message || "", /Not available/);
  assert.match(out.result.message || "", /share a single timestamp/);
  assert.equal(out.result.narrativeStability, undefined);
  assert.equal(out.result.stabilityLevel, undefined);
});

test("a set with no dates at all gets the same honest null", () => {
  const undated = walkedSet.map(({ title }) => ({ title }));
  const out = actions["news.narrativeTracking"](CTX, { data: { articles: undated } }, {});
  assert.equal(out.ok, true);
  assert.match(out.result.message || "", /Not available/);
});

test("a set spread over time still computes stability, windows and shifts", () => {
  const out = actions["news.narrativeTracking"](CTX, { data: { articles: spreadSet } }, {});
  assert.equal(out.ok, true);
  assert.equal(typeof out.result.narrativeStability, "number");
  assert.ok(["stable", "evolving", "volatile"].includes(out.result.stabilityLevel));
  assert.ok(Array.isArray(out.result.windows) && out.result.windows.length >= 1);
  assert.equal(out.result.articlesTracked, 4);
});

test("the standing short-set message is unchanged", () => {
  const out = actions["news.narrativeTracking"](CTX, { data: { articles: [walkedSet[0]] } }, {});
  assert.equal(out.ok, true);
  assert.match(out.result.message || "", /Need at least 2 articles/);
});
