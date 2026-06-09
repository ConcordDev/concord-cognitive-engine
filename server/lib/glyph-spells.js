// server/lib/glyph-spells.js
//
// Phase 5d — Magic Glyph Composition.
//
// Players compose new spells from glyph components. The composer uses
// the same base-6 glyph algebra as the Refusal Field — glyphAdd folds
// the component chain into a single composed glyph signature; the
// numeric attrs (damage / range / costs) sum with element-weighted
// modifiers; the result is minted as a kind='spell_recipe' DTU.
//
// The same DTU then plugs into Phase 1 (skill evolution at every 10
// levels), Phase 1.5 (marketplace listings + mentorship + demonstration),
// and the broader royalty cascade. A great spell propagates.

import crypto from "node:crypto";
import { add as glyphAdd, computeBase6Layer } from "./refusal-algebra/operations.js";
import { resolveCraft } from "./craft-resolve.js";
import { stampMoveMeta } from "./move-descriptor.js";

const MIN_COMPONENTS = 2;
const MAX_COMPONENTS = 5;

// Living Society P0 — optional power-source FUEL for spell minting. Consuming
// high-potency magical resources (soul gems / mana crystals / aether / essence)
// amplifies the composed spell's damage + range: the "Fireball I → Fireball V"
// gradient. Fuel only ever strengthens (floored at 1.0×) — a spell minted
// without fuel is byte-identical to the pre-P0 behaviour.
const MAX_FUEL_ITEMS = 4;
// Fuel amplification is potency-proportional (deterministic, no backfire roll):
// mult = 1 + (resolvedPotency/100) × FUEL_BOOST. So tier-5 fuel (grand/black
// gems, aether) pushes a spell far past tier-1 reagents — the power gradient.
const FUEL_BOOST = Number(process.env.CONCORD_SPELL_FUEL_BOOST) || 1.0;

// Default seed library — the migration writes these on first compose if
// no rows exist. Tests + content-seeder can override.
// Glyph chars are the base-6 algebra's symbols (see lib/refusal-algebra/glyphs.js):
// ⟐=0 (Refusal), ⟲=1 (Pivot), ⊚=2 (Bridge), and composites for 3/4/5.
const DEFAULT_GLYPH_LIBRARY = [
  { id: "g_flame_seed",    glyph: "⟲",   label: "flame seed",    element: "fire",      damage: 8,  range_m: 0,   stamina_cost: 1,   mana_cost: 2, cooldown_s: 0.5, narrative: "the spark before the chant" },
  { id: "g_ember_breath",  glyph: "⊚",   label: "ember breath",  element: "fire",      damage: 5,  range_m: 4,   stamina_cost: 0.5, mana_cost: 1, cooldown_s: 0.5, narrative: "warm air from the lung" },
  { id: "g_stone_anchor",  glyph: "⟐⟲",  label: "stone anchor",  element: "physical",  damage: 6,  range_m: 0,   stamina_cost: 2,   mana_cost: 0, cooldown_s: 1,   narrative: "weight on weight" },
  { id: "g_river_step",    glyph: "⊚⟲",  label: "river step",    element: "water",     damage: 3,  range_m: 6,   stamina_cost: 1,   mana_cost: 1, cooldown_s: 0.5, narrative: "what the stream takes, the stream gives" },
  { id: "g_frost_seal",    glyph: "⟐⊚",  label: "frost seal",    element: "ice",       damage: 7,  range_m: 3,   stamina_cost: 1.5, mana_cost: 2, cooldown_s: 1,   narrative: "the stop the cold puts in motion" },
  { id: "g_lightning_arc", glyph: "⟲⟐",  label: "lightning arc", element: "lightning", damage: 12, range_m: 8,   stamina_cost: 2,   mana_cost: 4, cooldown_s: 2,   narrative: "the line that cannot be redrawn" },
  { id: "g_loam_breath",   glyph: "⟲⊚",  label: "loam breath",   element: "bio",       damage: 2,  range_m: 4,   stamina_cost: 0.5, mana_cost: 2, cooldown_s: 1,   narrative: "what wakes under the leaf" },
  { id: "g_focus_lens",    glyph: "⊚⟐",  label: "focus lens",    element: "energy",    damage: 4,  range_m: 12,  stamina_cost: 0.5, mana_cost: 2, cooldown_s: 0.5, narrative: "more straight than light wants to be" },
  { id: "g_silent_step",   glyph: "⟐⟲⊚", label: "silent step",   element: "psychic",   damage: 0,  range_m: 0,   stamina_cost: 1,   mana_cost: 3, cooldown_s: 3,   narrative: "the moment between intention and act" },
  { id: "g_refusal_mark",  glyph: "⟐",   label: "refusal mark",  element: "refusal",   damage: 0,  range_m: 0,   stamina_cost: 1,   mana_cost: 4, cooldown_s: 5,   narrative: "what the dome remembers" },
];

/** Idempotent seed of the default library. Caller can call from migration
 *  hooks or content-seeder. */
export function seedDefaultGlyphLibrary(db) {
  if (!db) return { ok: false, reason: "no_db" };
  let seeded = 0;
  for (const g of DEFAULT_GLYPH_LIBRARY) {
    try {
      db.prepare(`
        INSERT INTO glyph_components
          (id, glyph, label, element, damage, range_m,
           stamina_cost, mana_cost, cooldown_s, narrative)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(g.id, g.glyph, g.label, g.element, g.damage, g.range_m,
             g.stamina_cost, g.mana_cost, g.cooldown_s, g.narrative);
      seeded++;
    } catch { /* per-row skip */ }
  }
  return { ok: true, seeded };
}

export function listGlyphComponents(db) {
  if (!db) return [];
  try {
    // @select-star-ok: glyph_components — 10-entry seed library
    return db.prepare(`SELECT * FROM glyph_components ORDER BY element, glyph`).all();
  } catch { return []; }
}

/**
 * Compose a spell from a chain of glyph component IDs.
 *
 * Pure math + DB read. Returns:
 *   { ok, composed_glyph, element, max_damage, range_m, costs, narrative }
 *   { ok: false, reason }
 *
 * Persistence is a separate call (mintSpell) so the UI can preview without
 * minting a DTU on every keystroke.
 */
export function composeSpell(db, componentIds) {
  if (!db || !Array.isArray(componentIds)) return { ok: false, reason: "missing_inputs" };
  if (componentIds.length < MIN_COMPONENTS) return { ok: false, reason: "too_few_components", min: MIN_COMPONENTS };
  if (componentIds.length > MAX_COMPONENTS) return { ok: false, reason: "too_many_components", max: MAX_COMPONENTS };

  const placeholders = componentIds.map(() => "?").join(",");
  let rows = [];
  try {
    rows = db.prepare(`SELECT * FROM glyph_components WHERE id IN (${placeholders})`).all(...componentIds);
  } catch { return { ok: false, reason: "lookup_failed" }; }

  if (rows.length !== componentIds.length) return { ok: false, reason: "unknown_component" };

  // Order rows in the chain order requested.
  const byId = new Map(rows.map(r => [r.id, r]));
  const chain = componentIds.map(id => byId.get(id));

  // Glyph composition: fold via glyphAdd. glyphAdd returns
  // { numerical (glyph string), decimal, semantic }; we keep the
  // glyph string between folds and the final decimal as the spell's
  // numeric signature.
  let composedGlyph = chain[0].glyph;
  let composedDecimal = 0;
  for (let i = 1; i < chain.length; i++) {
    const r = glyphAdd(composedGlyph, chain[i].glyph);
    composedGlyph = r.numerical;
    composedDecimal = r.decimal;
  }
  if (chain.length === 1) {
    // single-glyph case is rejected upstream by MIN_COMPONENTS, but be safe
    composedDecimal = 0;
  }
  // Add a layer-stamp from the chain length so longer chains have a
  // distinct trailing identity (Phase 5d signature, not a fold).
  const layerSig = computeBase6Layer(chain.length);

  // Numeric folding: sum components, scale by chain-length harmonic
  // (longer chains amplify damage but also costs).
  let totalDamage = 0, totalRange = 0;
  let totalStamina = 0, totalMana = 0, maxCooldown = 0;
  const elementTallies = {};
  for (const c of chain) {
    totalDamage  += c.damage;
    totalRange   += c.range_m;
    totalStamina += c.stamina_cost;
    totalMana    += c.mana_cost;
    if (c.cooldown_s > maxCooldown) maxCooldown = c.cooldown_s;
    elementTallies[c.element] = (elementTallies[c.element] || 0) + 1;
  }
  const harmonic = 1 + Math.log10(chain.length);
  totalDamage = Math.round(totalDamage * harmonic * 10) / 10;
  totalRange = Math.max(0, Math.round(totalRange));

  // Dominant element wins the spell's element. Tie-break by chain order.
  let dominantElement = chain[0].element;
  let bestCount = 0;
  for (const c of chain) {
    const n = elementTallies[c.element];
    if (n > bestCount) { dominantElement = c.element; bestCount = n; }
  }

  return {
    ok: true,
    composed_glyph: composedGlyph,
    layer_signature: layerSig,
    element: dominantElement,
    max_damage: totalDamage,
    range_m: totalRange,
    costs: {
      stamina: Math.round(totalStamina * 10) / 10,
      mana:    Math.round(totalMana    * 10) / 10,
      cooldown_s: Math.round(maxCooldown * 10) / 10,
    },
    chain: chain.map(c => ({ id: c.id, glyph: c.glyph, label: c.label })),
    narrative: chain.map(c => c.narrative).filter(Boolean).join(" / "),
  };
}

/**
 * Mint the composed spell as a kind='spell_recipe' DTU + insert a
 * player_glyph_spells row. Returns { ok, recipeId, spellId }.
 *
 * Wired so the resulting recipe enters Phase 1 (evolution) + 1.5
 * (marketplace + mentorship + demonstration) like any other recipe.
 */
export function mintSpell(db, { userId, worldId, componentIds, name, fuelItemIds = [] }) {
  if (!db || !userId || !worldId) return { ok: false, reason: "missing_inputs" };
  const composed = composeSpell(db, componentIds);
  if (!composed.ok) return composed;

  // ── Optional power-source fuel (Living Society P0) ──────────────────────
  // Verify the fuel is owned (world-scoped), resolve a potency-driven boost via
  // the single craft-resolve layer, scale the spell's damage/range, and queue
  // the fuel for consumption inside the mint transaction. Guarded + soft: any
  // failure (missing fuel, absent inventory table, kill-switch) leaves the
  // spell un-boosted rather than blocking the mint.
  let fuel = null;
  const fuelIds = Array.isArray(fuelItemIds)
    ? fuelItemIds.filter(Boolean).slice(0, MAX_FUEL_ITEMS)
    : [];
  if (fuelIds.length > 0 && process.env.CONCORD_CRAFT_RESOLVE !== "0") {
    try {
      const owned = [];
      for (const itemId of fuelIds) {
        const row = db.prepare(`
          SELECT COALESCE(SUM(quantity), 0) AS qty
          FROM player_inventory WHERE user_id = ? AND item_id = ?
        `).get(userId, itemId);
        if ((row?.qty ?? 0) >= 1) owned.push(itemId);
      }
      if (owned.length > 0) {
        const resolved = resolveCraft({
          inputs: owned.map((itemId) => ({ itemId, qty: 1 })),
          playerSkill: 0,
          stationQuality: 0,
          db,
        });
        if (resolved?.ok) {
          // Potency-proportional, deterministic (the item-craft backfire roll
          // does not gate opt-in fuel) and floored at 1.0× so fuel only ever
          // strengthens.
          const mult = Math.max(1.0, 1 + (resolved.outputPotency / 100) * FUEL_BOOST);
          fuel = {
            items: owned,
            multiplier: Math.round(mult * 1000) / 1000,
            affinity: resolved.outputAffinity,
            potency: resolved.outputPotency,
          };
          composed.max_damage = Math.round(composed.max_damage * mult * 10) / 10;
          composed.range_m = Math.max(0, Math.round(composed.range_m * mult));
        }
      }
    } catch { fuel = null; }
  }

  const recipeId = `spell:${userId}:${crypto.randomUUID().slice(0, 8)}`;
  const spellName = (name && String(name).trim()) || `glyph_spell_${composed.composed_glyph}`;
  const meta = {
    author_kind: "player",
    skill_kind: "spell",
    element: composed.element,
    name: spellName,
    current_name: spellName,
    revision_num: 0,
    revision_history: [],
    max_damage: composed.max_damage,
    range_m: composed.range_m,
    costs: composed.costs,
    composed_glyph: composed.composed_glyph,
    layer_signature: composed.layer_signature,
    glyph_chain: composed.chain.map(c => c.id),
  };
  if (fuel) {
    meta.fuel = { items: fuel.items, multiplier: fuel.multiplier, affinity: fuel.affinity };
  }
  // Universal Move System P1 — stamp the motion descriptor + native world so the
  // client resolver animates this spell per element+archetype (not generic cast)
  // and cross-world potency can read where it was made. Kill-switch CONCORD_MOVE_RESOLVER=0.
  stampMoveMeta(meta, { skillKind: "spell", element: composed.element, worldId });

  const tx = db.transaction(() => {
    // Consume one of each owned fuel item (FIFO, world-scoped). Guarded — the
    // ownership was verified above; this only debits.
    if (fuel) {
      const selFuelSlot = db.prepare(`
          SELECT id, quantity FROM player_inventory
          WHERE user_id = ? AND world_id = ? AND item_id = ? AND quantity > 0
          ORDER BY acquired_at ASC LIMIT 1
        `);
      const decFuelSlot = db.prepare(`UPDATE player_inventory SET quantity = quantity - 1 WHERE id = ?`);
      const delFuelSlot = db.prepare(`DELETE FROM player_inventory WHERE id = ?`);
      for (const itemId of fuel.items) {
        const slot = selFuelSlot.get(userId, worldId, itemId);
        if (!slot) continue;
        if (slot.quantity > 1) {
          decFuelSlot.run(slot.id);
        } else {
          delFuelSlot.run(slot.id);
        }
      }
    }
    // Schema/query-drift fix (runtime-confirmed): dtus has `type` + `data`, NOT
    // `kind`/`meta_json`. The old INSERT named non-existent columns, threw at
    // prepare, and was SILENTLY swallowed by the catch — so minting "worked" but
    // the recipe DTU was never created (no marketplace listing / citation /
    // royalty, and the stamped meta_json.motion never persisted). Map to the real
    // columns the combat+cast paths already read (`data` = the JSON meta blob).
    try {
      db.prepare(`
        INSERT INTO dtus (id, type, title, creator_id, data, skill_level, total_experience, created_at)
        VALUES (?, 'spell_recipe', ?, ?, ?, 1, 0, unixepoch())
      `).run(recipeId, spellName, userId, JSON.stringify(meta));
    } catch { /* dtus optional */ }

    const spellId = `pgs_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO player_glyph_spells
        (id, user_id, world_id, recipe_dtu_id, composed_glyph,
         component_chain, element, max_damage, range_m,
         stamina_cost, mana_cost, cooldown_s, composed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(spellId, userId, worldId, recipeId, composed.composed_glyph,
           JSON.stringify(componentIds), composed.element,
           composed.max_damage, composed.range_m,
           composed.costs.stamina, composed.costs.mana, composed.costs.cooldown_s);

    return spellId;
  });
  let spellId = null;
  try { spellId = tx(); }
  catch (err) { return { ok: false, reason: "tx_failed", error: err?.message }; }

  return { ok: true, recipeId, spellId, composed, fuel };
}

/** List spells composed by user. */
export function listSpellsForUser(db, userId, limit = 50) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT * FROM player_glyph_spells WHERE user_id = ?
      ORDER BY composed_at DESC LIMIT ?
    `).all(userId, limit);
  } catch { return []; }
}

export const _internal = {
  MIN_COMPONENTS, MAX_COMPONENTS, DEFAULT_GLYPH_LIBRARY,
};
