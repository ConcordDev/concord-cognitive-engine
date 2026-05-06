/**
 * Content schema validation contract tests.
 *
 * The seeder MUST tolerate malformed authored JSON without crashing AND
 * MUST surface a structured warn so the operator knows something was
 * skipped. Pre-fix, content-seeder.js did `JSON.parse` and passed raw
 * objects to the seeders — a typo'd factions.json could silently corrupt
 * the in-memory NPC registry by leaving fields undefined.
 *
 * Run: node --test tests/content-seeder-validation.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateFaction,
  validateNpc,
  validateQuest,
  validateLoreEvent,
} from "../lib/content-seeder.js";

describe("validateFaction", () => {
  it("accepts a minimal valid faction", () => {
    const r = validateFaction({ id: "f1", name: "Faction One" });
    assert.equal(r.ok, true);
  });

  it("rejects null/undefined/non-object", () => {
    assert.equal(validateFaction(null).ok, false);
    assert.equal(validateFaction(undefined).ok, false);
    assert.equal(validateFaction("string").ok, false);
    assert.equal(validateFaction(42).ok, false);
    assert.equal(validateFaction([]).ok, false);
  });

  it("rejects missing or empty id", () => {
    assert.equal(validateFaction({ name: "no id" }).ok, false);
    assert.equal(validateFaction({ id: "", name: "empty id" }).ok, false);
    assert.equal(validateFaction({ id: 42, name: "wrong type" }).ok, false);
  });

  it("rejects missing or empty name", () => {
    assert.equal(validateFaction({ id: "f1" }).ok, false);
    assert.equal(validateFaction({ id: "f1", name: "" }).ok, false);
    assert.equal(validateFaction({ id: "f1", name: 42 }).ok, false);
  });
});

describe("validateNpc", () => {
  it("accepts a minimal valid NPC", () => {
    assert.equal(validateNpc({ id: "n1", name: "NPC One" }).ok, true);
  });

  it("accepts an NPC with full optional fields", () => {
    assert.equal(
      validateNpc({
        id: "n1",
        name: "NPC One",
        faction_id: "f1",
        narrative_context: { current_goal: "x", fear: "y" },
        archetype: "guard",
        schedule: { dawn: "patrol" },
      }).ok,
      true,
    );
  });

  it("rejects null/non-object inputs", () => {
    assert.equal(validateNpc(null).ok, false);
    assert.equal(validateNpc([]).ok, false);
    assert.equal(validateNpc("string").ok, false);
  });

  it("rejects missing id or name", () => {
    assert.equal(validateNpc({ name: "no id" }).ok, false);
    assert.equal(validateNpc({ id: "n1" }).ok, false);
  });

  it("rejects faction_id that is not a string", () => {
    const r = validateNpc({ id: "n1", name: "x", faction_id: 42 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_faction_id");
  });

  it("accepts faction_id null/undefined (optional)", () => {
    assert.equal(validateNpc({ id: "n1", name: "x", faction_id: null }).ok, true);
    assert.equal(validateNpc({ id: "n1", name: "x" }).ok, true);
  });

  it("rejects narrative_context that is not an object", () => {
    const r = validateNpc({ id: "n1", name: "x", narrative_context: "bad" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_narrative_context");
  });
});

describe("validateQuest", () => {
  it("accepts a minimal valid quest (no objectives)", () => {
    assert.equal(validateQuest({ id: "q1", title: "Quest One" }).ok, true);
  });

  it("accepts a quest with well-formed objectives", () => {
    assert.equal(
      validateQuest({
        id: "q1",
        title: "Quest One",
        objectives: [
          { id: "o1", type: "reach_location", target: "x" },
          { id: "o2", type: "gather", target: "y" },
        ],
      }).ok,
      true,
    );
  });

  it("rejects missing id or title", () => {
    assert.equal(validateQuest({ title: "no id" }).ok, false);
    assert.equal(validateQuest({ id: "q1" }).ok, false);
  });

  it("rejects objectives that is not an array", () => {
    const r = validateQuest({ id: "q1", title: "t", objectives: { not: "array" } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "objectives_not_array");
  });

  it("rejects objective missing id", () => {
    const r = validateQuest({
      id: "q1", title: "t",
      objectives: [{ type: "gather" }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "objective_missing_id");
  });

  it("rejects objective missing type", () => {
    const r = validateQuest({
      id: "q1", title: "t",
      objectives: [{ id: "o1" }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "objective_missing_type");
  });
});

describe("validateLoreEvent", () => {
  it("accepts a minimal valid lore event", () => {
    assert.equal(validateLoreEvent({ id: "l1", title: "Event One" }).ok, true);
  });

  it("rejects missing id or title", () => {
    assert.equal(validateLoreEvent({ title: "no id" }).ok, false);
    assert.equal(validateLoreEvent({ id: "l1" }).ok, false);
  });

  it("rejects null or non-object", () => {
    assert.equal(validateLoreEvent(null).ok, false);
    assert.equal(validateLoreEvent("not object").ok, false);
    assert.equal(validateLoreEvent([]).ok, false);
  });
});

describe("authored content sanity — every shipped record must validate", () => {
  // Boots the actual file-system seeder against the live content/ tree
  // and asserts every record passes its own validator. Catches a
  // dropped-during-edit field, a JSON typo, or a schema drift in
  // authored content before deploy.
  it("content/world/factions.json — all entries valid", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url  = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const file = path.resolve(here, "../../content/world/factions.json");
    const json = JSON.parse(await fs.readFile(file, "utf-8"));
    assert.ok(Array.isArray(json), "factions.json must be an array");
    for (const f of json) {
      const r = validateFaction(f);
      assert.ok(r.ok, `faction "${f?.id ?? "<unknown>"}" failed: ${r.reason}`);
    }
  });

  it("content/world/npcs.json — all entries valid", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url  = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const file = path.resolve(here, "../../content/world/npcs.json");
    const json = JSON.parse(await fs.readFile(file, "utf-8"));
    assert.ok(Array.isArray(json), "npcs.json must be an array");
    for (const n of json) {
      const r = validateNpc(n);
      assert.ok(r.ok, `npc "${n?.id ?? "<unknown>"}" failed: ${r.reason}`);
    }
  });

  it("content/quests/onboarding.json — all entries valid", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url  = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const file = path.resolve(here, "../../content/quests/onboarding.json");
    const json = JSON.parse(await fs.readFile(file, "utf-8"));
    assert.ok(Array.isArray(json), "onboarding.json must be an array");
    for (const q of json) {
      const r = validateQuest(q);
      assert.ok(r.ok, `quest "${q?.id ?? "<unknown>"}" failed: ${r.reason}`);
    }
  });
});
