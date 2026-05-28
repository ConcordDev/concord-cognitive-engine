// server/lib/combat/flow-engine.js
//
// Procedural combo evolution. Reads a fighter's recent combat_flows and,
// when reinforcement thresholds are met, emits a new combat_combos row that
// becomes available in their hotbar.
//
// Key idea: combos are NOT picked from a developer-authored list. They are
// emergent from what the fighter actually does. If a player keeps chaining
// "gravity-spell → punch → punch → uppercut" in aerial context and that
// chain lands more often than the baseline, the engine names it, persists
// it, and surfaces it as a "Chain: Gravity Pull → Uppercut → Dive Slam"
// suggestion the next time they enter that context.
//
// NPC fighters use the exact same code path with fighterKind='npc'. An NPC
// that has fought a specific player N times will start surfacing combos
// that counter that player's most-used chains.
//
// Thresholds (tuned for "you'll see your first evolved combo around fight
// 5-10" per the spec):
//   MIN_CHAIN_OCCURRENCES = 4    // a chain must appear at least 4× to count
//   MIN_CHAIN_HITRATE     = 0.55 // and connect on average > 55% of the time
//   MIN_CHAIN_LENGTH      = 2    // at least 2 actions
//   MAX_CHAIN_LENGTH      = 5
//
// The flow engine is a pure derivation over recent flows + persisted combos.
// It can be re-run any time without breaking state — re-deriving the same
// chain hits the UNIQUE(fighter_id, name) constraint and updates the
// existing combo's success_rate / uses / mastery_xp instead of duplicating.

import crypto from "node:crypto";
import logger from "../../logger.js";
import { getRecentFlows } from "./flow-recorder.js";

const MIN_CHAIN_OCCURRENCES = 4;
const MIN_CHAIN_HITRATE     = 0.55;
const MIN_CHAIN_LENGTH      = 2;
const MAX_CHAIN_LENGTH      = 5;
const CHAIN_LOOKBACK        = 200;   // most recent N flows scanned per evolve call
const CHAIN_GAP_MS          = 4000;  // gap > 4s breaks a chain

/* ── Chain reconstruction ──────────────────────────────────────────────── */

function reconstructChains(flows) {
  // Split flows into two buckets: explicit chains (chain_id set) reconstruct
  // by chain_id + step_index, and auto-chains (no chain_id) reconstruct by
  // temporal proximity in oldest-first order.
  const byChainId = new Map();
  const autoCandidates = [];
  for (const f of flows) {
    if (f.chain_id) {
      if (!byChainId.has(f.chain_id)) {
        byChainId.set(f.chain_id, { chainKey: f.chain_id, context: f.context, style: f.style, steps: [] });
      }
      byChainId.get(f.chain_id).steps.push(f);
    } else {
      autoCandidates.push(f);
    }
  }

  // Order steps inside each explicit chain by step_index then ts
  const explicitChains = [];
  for (const c of byChainId.values()) {
    c.steps.sort((a, b) => (a.step_index ?? 0) - (b.step_index ?? 0) || (a.ts ?? 0) - (b.ts ?? 0));
    explicitChains.push(c);
  }

  // Auto-chains from the no-chain-id stream (oldest-first via reverse since
  // flows arrive newest-first from the recorder)
  const autoOrdered = autoCandidates.slice().reverse();
  const autoChains = [];
  let current = null;
  for (const f of autoOrdered) {
    const tsMs = (f.ts ?? 0) * 1000;
    if (current && tsMs - (current.lastTsMs ?? tsMs) > CHAIN_GAP_MS) {
      autoChains.push(current);
      current = null;
    }
    if (!current) {
      current = { chainKey: `auto:${f.id}`, context: f.context, style: f.style, steps: [] };
    }
    current.steps.push(f);
    current.lastTsMs = tsMs;
  }
  if (current) autoChains.push(current);

  return [...explicitChains, ...autoChains]
    .map((c) => ({ ...c, steps: c.steps.slice(0, MAX_CHAIN_LENGTH) }))
    .filter((c) => c.steps.length >= MIN_CHAIN_LENGTH);
}

/* ── Chain signatures ──────────────────────────────────────────────────── */

// Two different attempts at the same chain should aggregate. We canonicalize
// by the (action, weapon-or-spell) tuple per step. Damage / hit are summary
// fields, not signature fields.

function chainSignature(chain) {
  // Loadout-aware: hand + weapon_class become part of the canonical
  // signature so the same key inputs with different gear produce
  // distinct combos. sword-right + pistol-left → "swordR + pistolL"
  // builds a different combo than dual-daggers even when both reach
  // the same action sequence.
  const sig = chain.steps.map((s) => {
    const meta = s.action_meta || {};
    const cls  = meta.weaponClass ? `cls:${meta.weaponClass}` : null;
    const hand = meta.hand ? `h:${meta.hand[0]}` : null;
    const slot = meta.spell_id ? `spell:${meta.spell_id}`
      : meta.combo_id ? `combo:${meta.combo_id}`
      : (cls && hand) ? `${cls}/${hand}`
      : meta.weapon ? `wep:${meta.weapon}`
      : "";
    const finisher = meta.finisher ? "*F" : "";
    return `${s.action}${slot ? `[${slot}]` : ""}${finisher}`;
  }).join("→");
  return `${chain.context}|${chain.style ?? "mixed"}|${sig}`;
}

/* ── Combo naming ──────────────────────────────────────────────────────── */

const STEP_NAME = {
  "attack-light":  ["Strike", "Jab", "Quick", "Snap"],
  "attack-heavy":  ["Hammer", "Crush", "Slam", "Heavy"],
  "parry":         ["Parry", "Deflect"],
  "block":         ["Block", "Brace"],
  "dodge":         ["Dodge", "Slip"],
  "spell":         ["Cast", "Conjure", "Pulse"],
  "ranged":        ["Shot", "Burst", "Volley"],
  "throw":         ["Throw", "Hurl"],
  "grapple":       ["Grapple", "Hold"],
  "combo-step":    ["Flow", "Chain"],
};

const CONTEXT_FLAVOR = {
  ground:     ["Earthbound", "Footwork", "Brawler"],
  aerial:     ["Skybound", "Aerial", "Glide"],
  vehicle:    ["Riderborne", "Roadborne", "Mounted"],
  hacker:     ["Breach", "ICE", "Glitchwalker"],
  underwater: ["Tidebound", "Drift", "Current"],
  mixed:      ["Adaptive", "Crosswind", "Multilane"],
};

function pickName(chain, fighterId) {
  // Deterministic pick from the fighter id so the same chain on different
  // fighters can get different flavor words.
  let h = 0;
  for (const c of fighterId) h = (h * 31 + c.charCodeAt(0)) | 0;
  const flavor = CONTEXT_FLAVOR[chain.context] || CONTEXT_FLAVOR.ground;
  const flavorWord = flavor[Math.abs(h) % flavor.length];
  const stepNames = chain.steps.map((s, i) => {
    const pool = STEP_NAME[s.action] || ["Move"];
    return pool[Math.abs(h + i * 7) % pool.length];
  });
  return `${flavorWord}: ${stepNames.join(" → ")}`;
}

/* ── Evolve ────────────────────────────────────────────────────────────── */

/**
 * Run the combo evolution pass for a fighter. Reads recent flows, finds
 * recurring chains that meet the thresholds, persists each as a combat_combos
 * row (or updates an existing one), and returns a summary.
 */
export function evolveFighterCombos(db, fighterId, fighterKind = "player") {
  if (!db || !fighterId) return { ok: false, error: "missing_args" };

  const flows = getRecentFlows(db, fighterId, { limit: CHAIN_LOOKBACK });
  if (flows.length < MIN_CHAIN_OCCURRENCES * MIN_CHAIN_LENGTH) {
    return { ok: true, evolved: [], reason: "insufficient_data", scanned: flows.length };
  }

  const chains = reconstructChains(flows);
  if (chains.length === 0) {
    return { ok: true, evolved: [], reason: "no_chains" };
  }

  // Aggregate by signature
  const bySig = new Map();
  for (const c of chains) {
    const sig = chainSignature(c);
    if (!bySig.has(sig)) {
      bySig.set(sig, {
        signature: sig,
        context: c.context,
        style: c.style,
        steps: c.steps,
        occurrences: 0,
        hits: 0,
        attempts: 0,
        totalDamage: 0,
      });
    }
    const agg = bySig.get(sig);
    agg.occurrences++;
    for (const s of c.steps) {
      agg.attempts++;
      if (s.hit) agg.hits++;
      agg.totalDamage += Number(s.damage || 0);
    }
  }

  const evolved = [];
  for (const agg of bySig.values()) {
    const hitRate = agg.attempts > 0 ? agg.hits / agg.attempts : 0;
    if (agg.occurrences < MIN_CHAIN_OCCURRENCES) continue;
    if (hitRate < MIN_CHAIN_HITRATE) continue;

    const name = pickName(agg, fighterId);
    const stepsCanonical = agg.steps.map((s) => ({
      action: s.action,
      action_meta: s.action_meta,
      timing_ms: 350,            // baseline; tightened per-tier
    }));
    const stepsJson = JSON.stringify(stepsCanonical);
    const id = crypto.randomUUID();
    // SHA-256 (not SHA-1) — vfxSeed is a deterministic-but-unique
    // 12-char hash used to seed visual presets per combo. SHA-1 is
    // CodeQL-flagged as weak even for non-security contexts; SHA-256
    // is essentially the same speed on modern CPUs.
    const vfxSeed = crypto.createHash("sha256").update(agg.signature + fighterId).digest("hex").slice(0, 12);

    try {
      const existing = db.prepare(
        `SELECT id, uses, mastery_xp, tier, success_rate FROM combat_combos
         WHERE fighter_id = ? AND name = ?`
      ).get(fighterId, name);

      if (existing) {
        // Update — running average of success_rate + 1 use credit
        const newUses     = existing.uses + 1;
        const blended     = (existing.success_rate * existing.uses + hitRate) / newUses;
        const xpGain      = Math.round(agg.totalDamage * 0.5 + agg.hits * 5);
        const newMastery  = (existing.mastery_xp || 0) + xpGain;
        const newTier     = Math.min(5, Math.max(1, Math.floor(newMastery / 250) + 1));
        db.prepare(`
          UPDATE combat_combos
          SET success_rate = ?, uses = ?, mastery_xp = ?, tier = ?, last_used_at = unixepoch()
          WHERE id = ?
        `).run(blended, newUses, newMastery, newTier, existing.id);
        evolved.push({
          id: existing.id, name, context: agg.context,
          tier: newTier, uses: newUses, successRate: blended, evolvedNow: false,
        });
      } else {
        db.prepare(`
          INSERT INTO combat_combos
            (id, fighter_id, fighter_kind, context, style, name, steps_json,
             success_rate, uses, mastery_xp, tier, vfx_seed, last_used_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, unixepoch())
        `).run(
          id, fighterId, fighterKind, agg.context, agg.style ?? null,
          name, stepsJson, hitRate, Math.round(agg.totalDamage * 0.5 + agg.hits * 5),
          vfxSeed,
        );
        evolved.push({
          id, name, context: agg.context, tier: 1, uses: 1, successRate: hitRate,
          evolvedNow: true,
        });
      }
    } catch (err) {
      logger.warn?.("combat_flow", "combo_persist_failed", { err: err.message, name, fighterId });
    }
  }

  return { ok: true, evolved, scanned: flows.length, chains: chains.length };
}

/* ── Suggest next action ────────────────────────────────────────────────── */

/**
 * Suggest the next action for a fighter mid-combo. Reads their existing
 * combos for the current context, picks the highest-tier match for the
 * current chain prefix, returns the next step or null.
 */
export function suggestNextAction(db, fighterId, currentChain, context) {
  if (!db || !fighterId || !context) return null;
  const combos = db.prepare(`
    SELECT * FROM combat_combos
    WHERE fighter_id = ? AND context = ?
    ORDER BY tier DESC, success_rate DESC, uses DESC
    LIMIT 20
  `).all(fighterId, context);

  if (!combos.length) return null;

  const prefix = (currentChain || []).map((s) => s.action || s).join("→");
  for (const c of combos) {
    let steps; try { steps = JSON.parse(c.steps_json); } catch { continue; }
    if (!Array.isArray(steps) || steps.length <= prefix.split("→").length) continue;
    const stepsPrefix = steps.slice(0, (prefix ? prefix.split("→").length : 0)).map((s) => s.action).join("→");
    if (stepsPrefix === prefix) {
      const nextIdx = prefix ? prefix.split("→").length : 0;
      const next = steps[nextIdx];
      if (next) {
        return {
          comboId: c.id,
          comboName: c.name,
          tier: c.tier,
          successRate: c.success_rate,
          nextStep: next,
          remainingSteps: steps.slice(nextIdx + 1),
        };
      }
    }
  }
  return null;
}

/**
 * List all combos available to a fighter, sorted by relevance for a given
 * context. Used by the contextual hotbar to populate slots.
 */
export function listFighterCombos(db, fighterId, context = null) {
  if (!db || !fighterId) return [];
  const rows = context
    ? db.prepare(`
        SELECT * FROM combat_combos
        WHERE fighter_id = ?
        ORDER BY (CASE WHEN context = ? THEN 0 ELSE 1 END), tier DESC, uses DESC
        LIMIT 50
      `).all(fighterId, context)
    : db.prepare(`
        SELECT * FROM combat_combos
        WHERE fighter_id = ?
        ORDER BY tier DESC, uses DESC LIMIT 50
      `).all(fighterId);
  return rows.map((r) => {
    let steps = [];
    try { steps = JSON.parse(r.steps_json); } catch { steps = []; }
    return {
      id: r.id,
      name: r.name,
      context: r.context,
      style: r.style,
      tier: r.tier,
      uses: r.uses,
      masteryXP: r.mastery_xp,
      successRate: r.success_rate,
      steps,
      vfxSeed: r.vfx_seed,
    };
  });
}

export const _internal = {
  MIN_CHAIN_OCCURRENCES, MIN_CHAIN_HITRATE, MIN_CHAIN_LENGTH, MAX_CHAIN_LENGTH,
  reconstructChains, chainSignature, pickName,
};
