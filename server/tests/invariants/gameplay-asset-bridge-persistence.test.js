// Invariant: every gameplay-asset-bridge handler that registers an asset
// MUST persist a row to evo_assets when given valid input. Catches the
// schema-mismatch silent-drop class — the bridge wraps every handler in
// _safe() so a registry throw becomes a silent null return. Migration 100
// fixed the CHECK constraint that was rejecting all gameplay kinds; this
// test pins the contract so any future schema drift surfaces immediately.
//
// Each handler is walked here with:
//   1. A migrated :memory: DB.
//   2. Valid required input.
//   3. Assertions:
//      - row appears in evo_assets,
//      - kind matches the expected ASSET_KIND,
//      - source = 'concordia',
//      - source_id is non-null,
//      - the migration 100 CHECK admits the kind (catches if 100 ever
//        gets re-narrowed and any handler stops persisting).
//
// onCombatHit is the one exception: it doesn't register a new asset, it
// records an interaction on the *weapon's existing* asset id. That is
// asserted by interaction count rather than evo_assets row.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import {
  onCreatureSpawned,
  onHybridBirth,
  onPlayerCraft,
  onLootDropped,
  onCombatHit,
  onSkillAuthored,
  onSkillUsed,
} from "../../lib/gameplay-asset-bridge.js";

import { runMigrations } from "../../migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db;

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  const result = await runMigrations(db);
  assert.strictEqual(result.error, undefined, `migrations failed: ${result.error}`);
});

function rowsOfKind(kind) {
  return db.prepare(`SELECT * FROM evo_assets WHERE kind = ?`).all(kind);
}

function interactionCount(assetId) {
  return db.prepare(
    `SELECT COUNT(*) as c FROM evo_asset_interactions WHERE asset_id = ?`,
  ).get(assetId).c;
}

test("onCreatureSpawned persists a 'creature' row + spawn interaction", () => {
  const r = onCreatureSpawned(db, {
    id: "creature-1",
    worldId: "concordia-hub",
    topology: "biped",
    provenance: { baselineId: "baseline-A" },
  });
  assert.ok(r?.id, "handler must return a registered asset id");
  const rows = rowsOfKind("creature");
  assert.strictEqual(rows.length, 1, "exactly one creature row should be persisted");
  assert.strictEqual(rows[0].source, "concordia");
  assert.ok(rows[0].source_id, "source_id must be set");
  assert.strictEqual(interactionCount(r.id), 1, "spawn must record an interaction");
});

test("onHybridBirth persists a 'creature' row for unstable hybrids", () => {
  const r = onHybridBirth(db, {
    hybrid: { id: "hybrid-A" },
    stability: 0.4,
    generation: 1,
    crossWorld: false,
    parents: ["p1", "p2"],
  });
  assert.ok(r?.id);
  const rows = rowsOfKind("creature");
  assert.strictEqual(rows.length, 1);
  assert.ok(rowsOfKind("species").length === 0, "low-stability hybrid must NOT mint species");
});

test("onHybridBirth persists a 'species' row when stability≥0.7 AND generation≥3", () => {
  const r = onHybridBirth(db, {
    hybrid: { id: "hybrid-S" },
    stability: 0.85,
    generation: 4,
    crossWorld: true,
    parents: ["p1", "p2"],
  });
  assert.ok(r?.id);
  assert.strictEqual(rowsOfKind("species").length, 1);
  assert.strictEqual(rowsOfKind("creature").length, 0);
});

test("onPlayerCraft persists a 'craft' row + craft interaction", () => {
  const r = onPlayerCraft(db, {
    userId: "player-1",
    recipeId: "recipe-A",
    itemId: "item-1",
    label: "Iron Sword",
    payload: {},
    quality: 2,
  });
  assert.ok(r?.id);
  const rows = rowsOfKind("craft");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].quality_level, 2);
  assert.strictEqual(interactionCount(r.id), 1);
});

test("onLootDropped persists a 'drop' row + drop interaction", () => {
  const r = onLootDropped(db, {
    lootId: "loot-1",
    killerId: "player-1",
    victimId: "creature-X",
    label: "Golden Antler",
    payload: { rarity: "rare" },
  });
  assert.ok(r?.id);
  const rows = rowsOfKind("drop");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].source, "concordia");
  assert.strictEqual(interactionCount(r.id), 1);
});

test("onCombatHit records an interaction on the existing weapon asset", () => {
  // First seed a weapon asset; combat hits accumulate interactions on it.
  const seed = onPlayerCraft(db, {
    userId: "player-1",
    recipeId: "weapon-recipe",
    itemId: "sword-A",
    label: "Iron Sword",
    quality: 1,
  });
  assert.ok(seed?.id);
  const beforeCount = interactionCount(seed.id);
  onCombatHit(db, {
    attackerId: "player-1",
    victimId: "creature-X",
    weapon: { id: seed.id },
    damage: 50,
    isCrit: true,
  });
  assert.strictEqual(
    interactionCount(seed.id),
    beforeCount + 1,
    "onCombatHit must add exactly one interaction to the weapon asset",
  );
});

test("onSkillAuthored persists a 'skill' row + authored interaction", () => {
  const r = onSkillAuthored(db, {
    skill: { id: "skill-flame", provenance: { parentId: null, origin: "emergent" } },
    origin: "emergent",
  });
  assert.ok(r?.id);
  const rows = rowsOfKind("skill");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(interactionCount(r.id), 1);
});

test("onSkillUsed auto-registers a 'skill' row when the skill was never authored", () => {
  // Use without prior authoring — bridge auto-registers so the use still counts.
  onSkillUsed(db, { skillId: "skill-untracked", actorId: "player-1", isHit: true });
  const rows = rowsOfKind("skill");
  assert.strictEqual(rows.length, 1, "use must auto-register the skill asset");
  assert.strictEqual(rows[0].source, "concordia");
  assert.strictEqual(rows[0].source_id, "skill:skill-untracked");
});

test("onSkillUsed records an interaction on a previously-authored skill", () => {
  const seed = onSkillAuthored(db, { skill: { id: "skill-shadow" }, origin: "emergent" });
  const beforeCount = interactionCount(seed.id);
  onSkillUsed(db, { skillId: "skill-shadow", actorId: "player-1", isHit: true });
  // onSkillUsed adds a 'use' interaction for hits, plus a +1 for actor mastery.
  // The minimum invariant is "more interactions after than before."
  assert.ok(
    interactionCount(seed.id) > beforeCount,
    "onSkillUsed must add at least one interaction to the existing skill asset",
  );
});

test("migration 100 CHECK admits every gameplay ASSET_KIND value", () => {
  // Regression test: pre-100 the CHECK rejected creature/item/skill/drop/
  // craft/species and every handler silently dropped via _safe(). Walk all
  // bridge-emitted kinds against a row insert to prove the CHECK admits
  // them. If migration 100 ever gets re-narrowed, this test pinpoints
  // exactly which kind broke.
  const kinds = ["creature", "item", "skill", "drop", "craft", "species"];
  const stmt = db.prepare(
    `INSERT INTO evo_assets (id, kind, source, source_id, local_path) VALUES (?, ?, 'concordia', ?, ?)`,
  );
  for (const k of kinds) {
    assert.doesNotThrow(
      () => stmt.run(`probe-${k}`, k, `probe:${k}`, `gameplay://${k}/probe`),
      `migration 100 must admit kind='${k}' — CHECK rejected it`,
    );
  }
});

test("walk-all: every bridge handler with valid input increases evo_assets row count", () => {
  // Coarse cross-handler invariant: walk all asset-registering handlers
  // and confirm each one adds a row. Catches the case where a single
  // handler silently drops while neighbors keep working (the bug pattern
  // that bit migration 100 — every kind dropped at once, but a partial
  // regression looks the same locally).
  const inputs = [
    () => onCreatureSpawned(db, { id: "c1", worldId: "w", topology: "biped", provenance: {} }),
    () => onHybridBirth(db, { hybrid: { id: "h1" }, stability: 0.3, generation: 1, parents: [] }),
    () => onPlayerCraft(db, { userId: "u", recipeId: "r", itemId: "i1", quality: 0 }),
    () => onLootDropped(db, { lootId: "l1", killerId: "k", victimId: "v" }),
    () => onSkillAuthored(db, { skill: { id: "s1" }, origin: "test" }),
  ];
  let prev = db.prepare(`SELECT COUNT(*) as c FROM evo_assets`).get().c;
  for (const fn of inputs) {
    const r = fn();
    assert.ok(r?.id, "handler must return non-null when given valid input");
    const next = db.prepare(`SELECT COUNT(*) as c FROM evo_assets`).get().c;
    assert.strictEqual(
      next,
      prev + 1,
      `handler must add exactly one row (prev=${prev}, next=${next})`,
    );
    prev = next;
  }
});
