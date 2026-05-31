import { test } from "node:test";
import assert from "node:assert/strict";
import { npcNameFromRow } from "../lib/npc-name.js";

// Schema/query-drift fix — world_npcs has NO `name` column; the name lives in the
// `state` JSON (npc-spawning writes {name,...}). 6 sites did `SELECT name FROM
// world_npcs` (throws at prepare). This pins the canonical derivation they now use.

test("derives name from state JSON", () => {
  assert.equal(npcNameFromRow({ state: JSON.stringify({ name: "Iyatte" }), archetype: "warrior" }), "Iyatte");
});
test("falls back to archetype when state has no name", () => {
  assert.equal(npcNameFromRow({ state: "{}", archetype: "scholar", npc_type: "elder" }), "scholar");
});
test("falls back to a typed short-id label when nothing else", () => {
  assert.equal(npcNameFromRow({ id: "abcd1234efgh", npc_type: "guard" }), "guard-abcd");
});
test("malformed state never throws", () => {
  assert.equal(npcNameFromRow({ state: "{not json", archetype: "healer" }), "healer");
});
test("null row → null", () => {
  assert.equal(npcNameFromRow(null), null);
});
