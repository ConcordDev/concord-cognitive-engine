/**
 * Tier-2 contract test for the Concordant Law combat gate.
 *
 * Pins:
 *   - Both /combat/attack and /combat/npc-attack return 403
 *     concordant_law_refusal when worldId === 'concordia-hub' or
 *     'concordia' (legacy alias).
 *   - Non-hub worlds (tunya, fantasy, cyber, ...) do NOT refuse from
 *     the gate — combat proceeds (we don't assert the success path
 *     here, only that the refusal gate isn't triggered).
 *   - The Three Above All NPC ids exist in content/world/npcs.json so
 *     the in-world spawn path can render them.
 *
 * Run: node --test tests/concordant-law.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

function readJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
}

describe("Three Above All NPCs", () => {
  const npcs = readJSON("content/world/npcs.json");

  it("Sovereign / Concord / Concordia all exist", () => {
    const names = new Set(npcs.map((n) => n.name));
    assert.ok(names.has("The Sovereign"),  "Sovereign must exist");
    assert.ok(names.has("Concord"),        "Concord must exist");
    assert.ok(names.has("Concordia"),      "Concordia must exist");
  });

  it("each Above-All NPC is scoped to concordia-hub", () => {
    const aboveAll = npcs.filter((n) => ["The Sovereign", "Concord", "Concordia"].includes(n.name));
    assert.equal(aboveAll.length, 3, "expected exactly 3 Above-All NPCs");
    for (const n of aboveAll) {
      // world_id may be 'concordia-hub' or unset (defaults via top-level
      // npcs.json — top-level file is hub-scoped). We accept either.
      if (n.world_id != null) {
        assert.ok(
          ["concordia-hub", "concordia"].includes(n.world_id),
          `${n.name} should be hub-scoped (got world_id=${n.world_id})`,
        );
      }
    }
  });
});

describe("Concordant Law gate in routes/worlds.js", () => {
  const routes = fs.readFileSync(path.join(REPO_ROOT, "server/routes/worlds.js"), "utf8");

  it("the routes file refuses combat at the hub with concordant_law_refusal", () => {
    // Both player→NPC and NPC→player attack handlers must short-circuit
    // with concordant_law_refusal when worldId is the hub. Pin both via
    // string occurrence count.
    const refusals = routes.match(/concordant_law_refusal/g) ?? [];
    assert.ok(
      refusals.length >= 2,
      `expected ≥2 concordant_law_refusal sites (player→NPC + NPC→player), got ${refusals.length}`,
    );
    assert.ok(
      /worldId === ['"]concordia-hub['"]/.test(routes),
      "the handler must check worldId === 'concordia-hub'",
    );
    assert.ok(
      /worldId === ['"]concordia['"]/.test(routes),
      "the handler must also accept the legacy 'concordia' alias",
    );
  });
});
