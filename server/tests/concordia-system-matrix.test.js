import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel) {
  return readFileSync(join(root, rel), "utf8");
}

describe("Concordia system matrix — audit pins", () => {
  it("indexes the real stack and refuses a second civilization engine", () => {
    const doc = src("docs/CONCORDIA_SYSTEM_MATRIX.md");
    const resources = src("server/lib/resources.js");
    const inv = src("server/migrations/050_player_inventory.js");
    const economy = src("server/lib/npc-economy.js");
    assert.match(doc, /This is an audit, not a rebuild/);
    assert.match(doc, /WORLD → KINGDOM → REGION → SETTLEMENT → ACTIVITY → ACTOR/);
    assert.match(doc, /persist-sync/);
    assert.match(doc, /PR #954/);
    assert.match(doc, /RESOURCE_CATALOG/);
    assert.match(resources, /export const RESOURCE_CATALOG/);
    assert.match(inv, /player_inventory/);
    assert.match(economy, /npc_inventory/);
    assert.match(doc, /SimLod/);
    assert.match(doc, /KitBag = player_inventory/);
    assert.match(doc, /different trust boundaries/);
    assert.match(doc, /Simulation scale must never equal rendering scale/);
    assert.match(doc, /stream the player's reality/);
    assert.match(doc, /SimLod\.Real/);
    assert.match(doc, /SimLod\.Bulk/);
    assert.match(doc, /SimLod\.Virtual/);
    assert.match(doc, /_validateCombatReach/);
    assert.match(doc, /_validateDamageCap/);
    assert.match(doc, /combat:attack:ack/);
    assert.match(doc, /creature-renderer\.ts/);
    assert.match(doc, /interest-management\.js/);
    assert.match(doc, /physics-world\.ts/);
    assert.match(doc, /quality tiers change presentation only/);
    assert.match(doc, /GPU instancing is client/);
    assert.match(src("server/lib/movement/interest-management.js"), /speedScaledRadius/);
    assert.match(src("server/routes/worlds.js"), /function _validateCombatReach/);
    assert.match(src("server/routes/worlds.js"), /function _validateDamageCap/);
    assert.match(src("concord-frontend/lib/world-lens/creature-renderer.ts"), /pos\.lerp/);
    assert.match(src("concord-frontend/lib/world-lens/physics-world.ts"), /Rapier/);
    assert.doesNotMatch(doc, /LOD0_NEW|LodEnumV2/);
    assert.match(doc, /Sere is not a ninth Refusal gate/);
    assert.match(doc, /persistent universe platform/);
    assert.match(doc, /player is one participant/);
    assert.match(doc, /observe \/ reason \/ remember/);
    assert.match(doc, /Drought→revolt is \*\*not\*\* one closed loop yet/);
    assert.match(doc, /diseases \*\*never cross worlds\*\*/);
    assert.match(doc, /Authored content is the \*\*vocabulary\*\*/);
    assert.match(doc, /Do \*\*not\*\* stand up `ItemGenerator` as a parallel engine/);
    assert.match(doc, /composeSpell/);
    assert.match(doc, /origin_world/);
    assert.match(doc, /World filters \(intent, from Canon staples/);
    assert.match(doc, /simulation platform with a game on top/);
    assert.match(doc, /Vocabulary \/ combinations \/ history \/ interference/);
    assert.match(doc, /It is not one object yet/);
    assert.match(doc, /persistGeneratedNpc/);
    assert.match(src("server/lib/npc-generator.js"), /export function persistGeneratedNpc/);
    assert.match(src("server/lib/craft-resolve.js"), /export function resolveCraft/);
    assert.match(src("server/lib/glyph-spells.js"), /export function composeSpell/);
    assert.match(src("server/lib/craft-chains.js"), /VALID_STEP_KINDS/);
    assert.match(src("server/lib/item-affixes.js"), /RARITY_RULES/);
    assert.match(src("server/lib/world-vehicles.js"), /world.?vehicle|vehicle/i);
    assert.doesNotMatch(doc, /Concord admits he loves her/);
    assert.doesNotMatch(doc, /Aurelia/);
  });
});
