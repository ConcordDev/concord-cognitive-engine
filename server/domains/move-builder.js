// server/domains/move-builder.js
//
// Macro surface for the `/lenses/move-builder` lens — the player's move-creation
// surface (Universal Move System, MS-P2). Named to match the lens + its
// `lens.move-builder.*` manifest entry (which previously pointed at PHANTOM,
// unregistered macros — this file makes those real).
//
// THIN delegation layer: every descriptor computation lives in the real libs —
// `server/lib/move-descriptor.js` (`deriveMotion` / `stampMoveMeta`, the server
// twin of the client `resolveMove`) and the budget-shape primitives mirrored
// from `concord-frontend/lib/concordia/move-budget.ts` (City-of-Heroes
// Enhancement-Diversification). This file adds NO new combat/animation logic of
// its own; it only adapts (ctx, input) → lib calls, resolves the modifier budget
// deterministically, and mints/reads a `kind='move_recipe'` DTU.
//
// Surface (matches the manifest's macros + actions):
//   move-builder.list     — read the caller's minted moves
//   move-builder.get      — read one minted move (round-trips the stamped motion)
//   move-builder.compose  — PURE preview: descriptor + budget resolution, no write
//   move-builder.mint     — compose + persist a move_recipe DTU (action: 'mint')

import {
  deriveMotion,
  stampMoveMeta,
  SKILL_KIND_MOTION,
  ELEMENT_EFFECT_BIAS,
} from "../lib/move-descriptor.js";
import crypto from "node:crypto";

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) before it can
// silently clamp through the Math.min/max bounds or be persisted. A caller that
// PASSES a numeric field at all must pass a finite, non-negative one — an absent
// field is fine (the macro uses its default). Returns null when clean, else key.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

// Reject a poisoned numeric inside an allocation map (the per-aspect points).
function badAllocation(allocation) {
  if (!allocation || typeof allocation !== "object") return null;
  return badNumericField(allocation, MOVE_ASPECTS);
}

// ── Modifier budget (mirrors concord-frontend/lib/concordia/move-budget.ts) ──
// Stacking the SAME aspect gives full value for the first few points then a
// sharp cliff (ED "Schedule A"), so the optimal build SPREADS — this is what
// keeps a created move from being trivially one-shot.
const ED_SCHEDULE = [1.0, 1.0, 0.9, 0.7, 0.15, 0.15, 0.05];
export const MOVE_ASPECTS = ["power", "speed", "area", "efficiency", "control"];
const DEFAULT_BUDGET = 6;

/** Effective value of stacking `points` into one aspect after ED. PURE. */
function effectiveAspect(points) {
  let eff = 0;
  const n = Math.max(0, Math.floor(Number(points) || 0));
  for (let i = 0; i < n; i++) eff += ED_SCHEDULE[Math.min(i, ED_SCHEDULE.length - 1)];
  return eff;
}

/** Budget grows modestly with tier (a mastered move earns more points). */
function budgetForTier(tier) {
  return DEFAULT_BUDGET + Math.max(0, Math.min(4, Math.floor(Number(tier) || 1) - 1));
}

/** Skill level → 1..5 tier (mirrors move-resolver: a revision every 10 levels). */
function tierForLevel(level) {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  const rev = Math.floor((lv - 1) / 10);
  if (rev >= 150) return 5;
  if (rev >= 50) return 4;
  if (rev >= 15) return 3;
  if (rev >= 5) return 2;
  return 1;
}

/**
 * Resolve a modifier allocation against the tier-derived budget. PURE — same
 * contract as the client `resolveBudget` so the preview the player sees in the
 * lens is byte-identical to what the server pins at mint time.
 */
function resolveBudget(allocation = {}, tier = 1) {
  const budget = budgetForTier(tier);
  let spent = 0;
  const effective = {};
  let totalEff = 0;
  let dominant = null;
  let dominantVal = 0;
  for (const k of MOVE_ASPECTS) {
    const pts = Math.max(0, Math.floor(Number(allocation[k]) || 0));
    spent += pts;
    const e = effectiveAspect(pts);
    effective[k] = Math.round(e * 1000) / 1000;
    totalEff += e;
    if (e > dominantVal) { dominantVal = e; dominant = k; }
  }
  const overspent = spent > budget;
  const balanced = totalEff === 0 ? true : dominantVal / totalEff <= 0.6;
  return { ok: !overspent, spent, budget, overspent, effective, balanced, dominantAspect: dominant };
}

const VALID_SKILL_KINDS = Object.keys(SKILL_KIND_MOTION);

/** Normalise a requested skill kind onto a canonical move-descriptor key. */
function normalizeSkillKind(k) {
  const s = String(k || "").toLowerCase();
  return SKILL_KIND_MOTION[s] ? s : "spell";
}

/**
 * Build the full resolved descriptor for a composition: the motion block (from
 * the real `deriveMotion`) + the resolved modifier budget. Used by both
 * `compose` (preview) and `mint` (persisted) so they can never disagree.
 */
function composeMove({ skillKind, element, allocation, skillLevel }) {
  const kind = normalizeSkillKind(skillKind);
  const tier = tierForLevel(skillLevel);
  const motion = deriveMotion(kind, element); // delegates — never throws
  const budget = resolveBudget(allocation || {}, tier);
  return { skillKind: kind, element: motion.element, tier, motion, budget };
}

/** True when the runtime `dtus` table carries the type/creator_id/data columns
 *  (migration 087). The minimal migration-001 shape (body_json/owner_user_id)
 *  is detected too so mint degrades to that shape instead of throwing. */
function dtuColumns(db) {
  try { return new Set(db.prepare("PRAGMA table_info(dtus)").all().map((r) => r.name)); }
  catch { return new Set(); }
}

export default function registerMoveBuilderMacros(register) {
  /**
   * move-builder.compose — PURE preview. Given a skill kind + element + modifier
   * allocation, return the derived motion descriptor (what it animates as) and
   * the ED-resolved budget (whether the build is legal + balanced). No DB write.
   * input: { skillKind, element, allocation?, skillLevel? }
   */
  register("move-builder", "compose", async (_ctx, input = {}) => {
    const badNum = badNumericField(input, ["skillLevel"]);
    if (badNum) return { ok: false, reason: `invalid_${badNum}` };
    const badAlloc = badAllocation(input.allocation);
    if (badAlloc) return { ok: false, reason: `invalid_allocation_${badAlloc}` };
    const composed = composeMove({
      skillKind: input.skillKind,
      element: input.element,
      allocation: input.allocation,
      skillLevel: input.skillLevel,
    });
    return { ok: composed.budget.ok, ...composed };
  }, { note: "preview a move's motion descriptor + resolved modifier budget (pure)" });

  /**
   * move-builder.mint — compose + persist a kind='move_recipe' DTU. The stamped
   * motion (via the real stampMoveMeta) is what the client resolver reads to
   * animate the move per element+archetype. Rejects an overspent budget.
   * input: { name, skillKind, element, allocation?, skillLevel?, worldId? }
   */
  register("move-builder", "mint", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const name = String(input.name || "").trim();
    if (!name) return { ok: false, reason: "missing_name" };
    // Fail-closed on poisoned numerics BEFORE any DB write.
    const badNum = badNumericField(input, ["skillLevel"]);
    if (badNum) return { ok: false, reason: `invalid_${badNum}` };
    const badAlloc = badAllocation(input.allocation);
    if (badAlloc) return { ok: false, reason: `invalid_allocation_${badAlloc}` };

    const composed = composeMove({
      skillKind: input.skillKind,
      element: input.element,
      allocation: input.allocation,
      skillLevel: input.skillLevel,
    });
    if (composed.budget.overspent) {
      return { ok: false, reason: "budget_overspent", spent: composed.budget.spent, budget: composed.budget.budget };
    }

    const worldId = input.worldId || "concordia-hub";
    const moveId = `move:${userId}:${crypto.randomUUID().slice(0, 8)}`;
    const meta = {
      author_kind: "player",
      kind: "move_recipe",
      skill_kind: composed.skillKind,
      element: composed.element,
      name,
      current_name: name,
      tier: composed.tier,
      allocation: Object.fromEntries(MOVE_ASPECTS.map((a) => [a, Math.max(0, Math.floor(Number(input.allocation?.[a]) || 0))])),
      effective: composed.budget.effective,
      balanced: composed.budget.balanced,
    };
    // Stamp the motion descriptor + native world via the REAL lib so the client
    // resolver animates this move per element+archetype (not generic cast) and
    // cross-world potency can read where it was made.
    stampMoveMeta(meta, { skillKind: composed.skillKind, element: composed.element, worldId });

    const cols = dtuColumns(db);
    try {
      if (cols.has("type") && cols.has("creator_id") && cols.has("data")) {
        // Runtime shape (migrations 001 + 087): mirror mintSpell's INSERT.
        db.prepare(`
          INSERT INTO dtus (id, type, title, creator_id, data, created_at)
          VALUES (?, 'move_recipe', ?, ?, ?, unixepoch())
        `).run(moveId, name, userId, JSON.stringify(meta));
      } else if (cols.has("body_json") && cols.has("owner_user_id")) {
        // Minimal migration-001 shape (tests / fresh installs without 087).
        db.prepare(`
          INSERT INTO dtus (id, owner_user_id, title, body_json)
          VALUES (?, ?, ?, ?)
        `).run(moveId, userId, name, JSON.stringify(meta));
      } else {
        return { ok: false, reason: "no_dtu_table" };
      }
    } catch (e) {
      return { ok: false, reason: "mint_failed", detail: String(e?.message || e) };
    }

    return { ok: true, moveId, name, motion: meta.motion, tier: composed.tier, balanced: composed.budget.balanced };
  }, { note: "mint a composed move as a move_recipe DTU (stamps the motion descriptor)" });

  /**
   * move-builder.list — the caller's minted moves (read).
   * input: { limit? }
   */
  register("move-builder", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const badNum = badNumericField(input, ["limit"]);
    if (badNum) return { ok: false, reason: `invalid_${badNum}` };
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    const cols = dtuColumns(db);
    let rows = [];
    try {
      if (cols.has("type") && cols.has("creator_id") && cols.has("data")) {
        rows = db.prepare(`
          SELECT id, title, data AS body FROM dtus
          WHERE type = 'move_recipe' AND creator_id = ?
          ORDER BY rowid DESC LIMIT ?
        `).all(userId, limit);
      } else if (cols.has("body_json") && cols.has("owner_user_id")) {
        rows = db.prepare(`
          SELECT id, title, body_json AS body FROM dtus
          WHERE owner_user_id = ? AND body_json LIKE '%"kind":"move_recipe"%'
          ORDER BY rowid DESC LIMIT ?
        `).all(userId, limit);
      }
    } catch { rows = []; }
    const moves = rows.map((r) => {
      let meta = {};
      try { meta = JSON.parse(r.body || "{}"); } catch { meta = {}; }
      return {
        id: r.id,
        name: r.title || meta.name || "Untitled move",
        element: meta.element || null,
        skillKind: meta.skill_kind || null,
        tier: meta.tier ?? null,
        motion: meta.motion || null,
      };
    });
    return { ok: true, moves };
  }, { note: "list the caller's minted moves" });

  /**
   * move-builder.get — one minted move, round-tripping the stamped descriptor.
   * input: { moveId }
   */
  register("move-builder", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.moveId) return { ok: false, reason: "missing_moveId" };
    const cols = dtuColumns(db);
    let row = null;
    try {
      if (cols.has("type") && cols.has("creator_id") && cols.has("data")) {
        row = db.prepare(`SELECT id, title, data AS body, creator_id AS owner FROM dtus WHERE id = ? AND type = 'move_recipe'`).get(input.moveId);
      } else if (cols.has("body_json") && cols.has("owner_user_id")) {
        row = db.prepare(`SELECT id, title, body_json AS body, owner_user_id AS owner FROM dtus WHERE id = ?`).get(input.moveId);
      }
    } catch { row = null; }
    if (!row) return { ok: false, reason: "not_found" };
    if (row.owner && String(row.owner) !== String(userId)) return { ok: false, reason: "not_owner" };
    let meta = {};
    try { meta = JSON.parse(row.body || "{}"); } catch { meta = {}; }
    return {
      ok: true,
      move: {
        id: row.id,
        name: row.title || meta.name || "Untitled move",
        element: meta.element || null,
        skillKind: meta.skill_kind || null,
        tier: meta.tier ?? null,
        allocation: meta.allocation || null,
        effective: meta.effective || null,
        balanced: meta.balanced ?? null,
        motion: meta.motion || null,
      },
    };
  }, { note: "read one minted move (round-trips the stamped motion descriptor)" });

  /**
   * move-builder.catalog — the option lists the builder UI offers (skill kinds +
   * elements + aspects). PURE; lets the lens render its selects from the server's
   * source-of-truth instead of hardcoding.
   */
  register("move-builder", "catalog", async () => {
    return {
      ok: true,
      skillKinds: VALID_SKILL_KINDS,
      elements: Object.keys(ELEMENT_EFFECT_BIAS),
      aspects: MOVE_ASPECTS,
      defaultBudget: DEFAULT_BUDGET,
    };
  }, { note: "list the builder's skill-kind / element / aspect options (pure)" });
}
