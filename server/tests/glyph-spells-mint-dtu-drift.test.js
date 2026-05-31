import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedDefaultGlyphLibrary, listGlyphComponents, mintSpell } from "../lib/glyph-spells.js";

// Schema/query-drift regression — the MINT half. mintSpell's recipe-DTU INSERT
// named dtus columns `kind`/`meta_json` that don't exist (dtus has `type`/`data`).
// It threw at prepare and was SILENTLY swallowed by `catch { /* dtus optional */ }`,
// so minting "worked" (player_glyph_spells row) but the recipe DTU was never
// created — no marketplace/citation/royalty, and the MS-P1 meta_json.motion stamp
// never persisted. This pins that the DTU now persists with the motion descriptor.

test("minting a glyph spell persists a recipe DTU with the motion stamp", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  seedDefaultGlyphLibrary(db);
  const comps = listGlyphComponents(db).slice(0, 2).map((c) => c.id);

  const ret = mintSpell(db, { userId: "u1", worldId: "concordia-hub", componentIds: comps, name: "Test Bolt" });
  assert.equal(ret.ok, true, "mint should succeed");

  // The recipe DTU must now exist (previously swallowed) under the REAL `type` column.
  const dtu = db.prepare("SELECT id, type, title, creator_id, data FROM dtus WHERE type = 'spell_recipe'").get();
  assert.ok(dtu, "recipe DTU must persist (was silently dropped by the kind/meta_json drift)");
  assert.equal(dtu.type, "spell_recipe");
  assert.equal(dtu.creator_id, "u1");

  // The meta blob lives in `data` (what the combat/cast paths read) and carries
  // the MS-P1 motion descriptor + nativeWorld stamp.
  const meta = JSON.parse(dtu.data);
  assert.equal(meta.skill_kind, "spell");
  assert.ok(meta.motion, "meta_json.motion must be stamped (MS-P1)");
  assert.ok(meta.motion.motionArchetype, "motion has an archetype");
  assert.equal(meta.nativeWorld, "concordia-hub", "Pillar-3 nativeWorld stamped");
});
