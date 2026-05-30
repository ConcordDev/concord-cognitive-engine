// server/lib/ecosystem/material-profiles.js
//
// Living Society — Phase 0.5: the material profile substrate.
//
// Every material KIND (a drop, a herb, a reagent) carries a structured profile:
// effect tags (what a meal/craft made from it does) + Phase-0 resource props
// (potency/affinity/stability/rarity). Authored species get hand profiles; a
// procedural creature derives its profile from its blueprint; crossbreeding
// BLENDS two parent profiles into a coherently-named child profile whose
// inherited+mutated effects stay BOUNDED across generations (gen-decay clamp).
//
// Source of truth is the catalog (pure-callable, no DB). The mig-280
// `material_profiles` table is the persistence/override layer (profileFor:
// DB → catalog → blueprint-derived → safe default).

import crypto from "node:crypto";

const AFFINITIES = ["magic", "tech", "bio", "physical", "chaos"];

// Bounded generational mutation: a hybrid material can't explode in potency.
// Mirrors the evo-asset fusion gen-decay philosophy.
const GEN_DECAY = Number(process.env.CONCORD_FUSION_GEN_DECAY) || 0.85;
const MUTATION_SPAN = Number(process.env.CONCORD_MATERIAL_MUTATION) || 8; // ± potency wobble

// ── Authored catalog (material_id → profile) ────────────────────────────────
// Keyed by canonical drop item id. Effect tags are read by the cooking unifier.
export const MATERIAL_PROFILE_CATALOG = Object.freeze({
  "raw-meat":   { kind: "meat", effect_tags: ["satiation", "stamina_regen"], potency: 18, affinity: "bio", stability: 78, rarity_tier: 1 },
  venison:      { kind: "meat", effect_tags: ["satiation", "stamina_regen", "agility"], potency: 26, affinity: "bio", stability: 80, rarity_tier: 2 },
  "boar-meat":  { kind: "meat", effect_tags: ["satiation", "strength"], potency: 28, affinity: "bio", stability: 82, rarity_tier: 2 },
  "wolf-meat":  { kind: "meat", effect_tags: ["satiation", "ferocity"], potency: 30, affinity: "chaos", stability: 70, rarity_tier: 2 },
  "bear-meat":  { kind: "meat", effect_tags: ["satiation", "strength", "warmth"], potency: 40, affinity: "physical", stability: 80, rarity_tier: 3 },
  pelt:         { kind: "pelt", effect_tags: ["warmth", "armor"], potency: 22, affinity: "physical", stability: 90, rarity_tier: 2 },
  hide:         { kind: "pelt", effect_tags: ["armor"], potency: 14, affinity: "bio", stability: 88, rarity_tier: 1 },
  feather:      { kind: "reagent", effect_tags: ["lightness", "agility"], potency: 16, affinity: "bio", stability: 85, rarity_tier: 1 },
  talon:        { kind: "bone", effect_tags: ["sharpness", "ferocity"], potency: 24, affinity: "physical", stability: 86, rarity_tier: 2 },
  bone:         { kind: "bone", effect_tags: ["sturdiness"], potency: 20, affinity: "physical", stability: 92, rarity_tier: 1 },
  herb:         { kind: "herb", effect_tags: ["healing", "focus"], potency: 18, affinity: "bio", stability: 70, rarity_tier: 1 },
});

const DEFAULT_PROFILE = Object.freeze({
  kind: "reagent", effect_tags: ["satiation"], potency: 12, affinity: "bio", stability: 80, rarity_tier: 1,
});

function clampInt(n, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(n))); }
function seedByte(str) { return crypto.createHash("sha1").update(String(str)).digest()[0]; } // 0..255

/**
 * Resolve a material's profile. Order: DB row → catalog → blueprint-derived →
 * default. `db` + `blueprint` optional so this is pure-callable in tests.
 */
export function profileFor(materialId, { db = null, blueprint = null } = {}) {
  if (db) {
    try {
      const row = db.prepare(`
        SELECT material_id, kind, effect_tags_json, potency, affinity, stability, rarity_tier, source_species
        FROM material_profiles WHERE material_id = ?
      `).get(materialId);
      if (row) {
        let tags = [];
        try { tags = JSON.parse(row.effect_tags_json || "[]"); } catch { tags = []; }
        return { ...DEFAULT_PROFILE, ...row, effect_tags: tags };
      }
    } catch { /* table absent → catalog */ }
  }
  if (MATERIAL_PROFILE_CATALOG[materialId]) {
    return { ...DEFAULT_PROFILE, ...MATERIAL_PROFILE_CATALOG[materialId] };
  }
  if (blueprint) return deriveProfileFromBlueprint(blueprint, materialId);
  return { ...DEFAULT_PROFILE };
}

/**
 * Derive a material profile from a creature blueprint — for procedural/hybrid
 * creatures with no authored profile. Bigger/heavier mass → higher potency;
 * more skills → more effect tags; crossbreed origin shifts affinity toward chaos.
 * Deterministic (seeded by blueprint id).
 */
export function deriveProfileFromBlueprint(blueprint = {}, materialId = "raw-meat") {
  const mass = Number(blueprint.massKg) || 20;
  const skills = Array.isArray(blueprint.skillIds) ? blueprint.skillIds.length : 0;
  const sb = seedByte(`${blueprint.id || materialId}:${mass}`);
  const potency = clampInt(12 + Math.log2(Math.max(1, mass)) * 6 + skills * 1.5 + (sb % 7), 0, 100);
  const isCross = blueprint.origin === "crossbreed" || blueprint.origin === "fusion";
  const affinity = isCross ? "chaos" : "bio";
  const stability = clampInt(isCross ? 60 : 80 - (sb % 10), 0, 100);
  const tags = ["satiation", "stamina_regen"];
  if (mass > 80) tags.push("strength");
  if (skills >= 4) tags.push("ferocity");
  return {
    kind: "meat", effect_tags: tags, potency, affinity, stability,
    rarity_tier: clampInt(1 + Math.floor(mass / 60), 1, 5),
  };
}

/**
 * Blend two parent material profiles into a child profile. Deterministic
 * average + bounded mutation; potency is clamped by a generational decay so it
 * can't run away across breeding generations. Conflicting affinities lower the
 * child's stability (Concordia twist). effect_tags are the union, capped.
 */
export function blendMaterialProfile(a, b, { stability = 0.5, generation = 1, seedKey = null } = {}) {
  const pa = a || DEFAULT_PROFILE;
  const pb = b || DEFAULT_PROFILE;
  const sb = seedByte(seedKey || `${pa.affinity}:${pb.affinity}:${generation}`);
  const mutation = ((sb / 255) * 2 - 1) * MUTATION_SPAN; // ±MUTATION_SPAN
  // Gen-decay clamp: the max achievable potency shrinks as generations stack,
  // so breeding doesn't spiral. genFactor ∈ (0,1].
  const genFactor = Math.pow(GEN_DECAY, Math.max(0, generation - 1));
  const avgPotency = (pa.potency + pb.potency) / 2;
  const potency = clampInt((avgPotency + mutation) * genFactor + avgPotency * (1 - genFactor) * 0.6, 0, 100);
  // Affinity: parent A's affinity dominates unless B's is markedly higher-potency.
  const affinity = pb.potency > pa.potency + 6 ? pb.affinity : pa.affinity;
  const conflict = pa.affinity !== pb.affinity ? 18 : 0;
  const childStability = clampInt(((pa.stability + pb.stability) / 2) - conflict - (1 - stability) * 20, 0, 100);
  const tags = [...new Set([...(pa.effect_tags || []), ...(pb.effect_tags || [])])].slice(0, 6);
  return {
    kind: pa.kind || "meat",
    effect_tags: tags,
    potency,
    affinity: AFFINITIES.includes(affinity) ? affinity : "bio",
    stability: childStability,
    rarity_tier: clampInt(Math.max(pa.rarity_tier || 1, pb.rarity_tier || 1), 1, 5),
  };
}

// ── Coherent material naming (seeded pools — the composeLastWords pattern) ───
const PREFIX_BY_AFFINITY = {
  bio:      ["Verdant", "Wild", "Marrow", "Tender"],
  physical: ["Iron", "Stone", "Rugged", "Dense"],
  magic:    ["Ember", "Arcane", "Glimmer", "Rune"],
  tech:     ["Forged", "Alloyed", "Precision", "Charged"],
  chaos:    ["Twisted", "Feral", "Volatile", "Riven"],
};
const SUFFIX_BY_KIND = {
  meat:    ["Loin", "Cut", "Flank", "Haunch"],
  pelt:    ["Hide", "Pelt", "Fur"],
  bone:    ["Bone", "Spur", "Fang"],
  reagent: ["Essence", "Dust", "Extract"],
  herb:    ["Sprig", "Leaf", "Root"],
};

/**
 * Compose a coherent material name from two parents (e.g. "Ember-Marrow Loin").
 * Deterministic given the seed. Falls back to the hybrid "A × B" description.
 */
export function composeMaterialName(a, b, { seedKey = null, fallback = null } = {}) {
  const pa = a || DEFAULT_PROFILE;
  const pb = b || DEFAULT_PROFILE;
  const sb = seedByte(seedKey || `${pa.affinity}:${pb.affinity}`);
  const prefA = (PREFIX_BY_AFFINITY[pa.affinity] || PREFIX_BY_AFFINITY.bio);
  const prefB = (PREFIX_BY_AFFINITY[pb.affinity] || PREFIX_BY_AFFINITY.bio);
  const sufx = (SUFFIX_BY_KIND[pa.kind] || SUFFIX_BY_KIND.meat);
  const p1 = prefA[sb % prefA.length];
  const p2 = prefB[(sb >> 2) % prefB.length];
  const s = sufx[(sb >> 4) % sufx.length];
  if (p1 === p2) return `${p1} ${s}`;
  return `${p1}-${p2} ${s}`;
}

/** Seed the authored catalog into material_profiles (idempotent upsert). */
export function seedMaterialProfiles(db) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const stmt = db.prepare(`
      INSERT INTO material_profiles (material_id, kind, effect_tags_json, potency, affinity, stability, rarity_tier, source_species)
      VALUES (@material_id, @kind, @effect_tags_json, @potency, @affinity, @stability, @rarity_tier, @source_species)
      ON CONFLICT(material_id) DO UPDATE SET
        kind=excluded.kind, effect_tags_json=excluded.effect_tags_json, potency=excluded.potency,
        affinity=excluded.affinity, stability=excluded.stability, rarity_tier=excluded.rarity_tier,
        updated_at=unixepoch()
    `);
    let n = 0;
    const tx = db.transaction(() => {
      for (const [material_id, p] of Object.entries(MATERIAL_PROFILE_CATALOG)) {
        stmt.run({
          material_id, kind: p.kind, effect_tags_json: JSON.stringify(p.effect_tags || []),
          potency: p.potency, affinity: p.affinity, stability: p.stability,
          rarity_tier: p.rarity_tier, source_species: p.source_species || null,
        });
        n++;
      }
    });
    tx();
    return { ok: true, seeded: n };
  } catch (e) {
    return { ok: false, reason: "schema_unavailable", error: e?.message };
  }
}

export const MATERIAL_CONSTANTS = Object.freeze({ AFFINITIES, GEN_DECAY, MUTATION_SPAN, DEFAULT_PROFILE });
