import test from "node:test";
import assert from "node:assert/strict";
import { acceptSceneLocation, acceptTournamentTitle } from "../lib/bounded-text.js";

test("scene location over 120 is refused and does not return a sliced value", () => {
  const r = acceptSceneLocation("L".repeat(121));
  assert.equal(r.ok, false);
  assert.match(r.error, /120/);
  assert.equal(r.location, undefined);
  assert.equal(acceptSceneLocation("  Stage 4  ").location, "Stage 4");
});

test("tournament title over 120 is refused", () => {
  const r = acceptTournamentTitle("T".repeat(200));
  assert.equal(r.ok, false);
  assert.match(r.error, /120/);
  assert.equal(acceptTournamentTitle("  Cup  ").title, "Cup");
});
