// server/lib/quests/moral-branch.js
//
// Wave 4 gap-closure — docs/concordia-specs/quests-dialogue-capability-map.md
// §3/§6#1: `moral_branch` / `reputation_change` are authored across 11 quest
// content files (main-arc, onboarding, sealed-record, faction-quests,
// brackish-trust, plus the sub-world chains seraphine-heir,
// iron-hex-redemption, silver-identity, ghost-7-trace, dahlia-ledger,
// southern-arc-mystery) and were read by zero lines of server or frontend
// code. `server/lib/content-seeder.js#seedQuestFile` retains the raw JSON
// (including moral_branch) in `_authoredQuests.get(id).raw`, so the content
// was never actually lost — it just had no runtime that read it.
//
// This module is the "did the number move" half of the fix: given a chosen
// moral_branch option, it applies `reputation_change` to the EXISTING
// reputation substrate — character_opinions (migration 153) for personal
// NPC standing, and player_faction_reputation_cache (migration 218, via
// faction-reputation.js) for faction standing — instead of inventing a
// parallel reputation system.
//
// What this module does NOT do (see CLAUDE.md's "closing the hard 20%"
// invariant + the capability-map audit's finding #1/#6): present
// moral_branch.options as a choice to the player in the UI, or record a
// choice from a real gameplay action. That is genuinely missing frontend +
// route work, scoped out of this unit — see the module-level macro
// `quest.resolve_moral_branch` docstring in server.js for the honest
// boundary of what's wired vs. still missing.

import { recordOpinionEvent } from "../npc-opinions.js";
import { refreshOneFactionReputation } from "../faction-reputation.js";
import { _authoredQuests } from "../content-seeder.js";

const DEFAULT_WORLD = "concordia-hub";
// Authored factions run to dozens of members, not thousands — this bound
// exists only to keep a single branch resolution from doing unbounded work
// if a faction ever grows very large; it is not expected to ever clip.
const MAX_FACTION_NPCS = 200;

/**
 * Read the raw moral_branch payload authored for a quest, keyed by the
 * CONTENT-authored id (e.g. "warden_crackdown"), not the in-memory
 * quest-engine's generated `quest_xxxx` id.
 *
 * @param {string} questAuthoredId
 * @returns {{description:string, options:Array<{id:string,trigger?:string,consequence?:string,reputation_change?:object}>}|null}
 */
export function getMoralBranch(questAuthoredId) {
  const entry = _authoredQuests.get(questAuthoredId);
  const branch = entry?.raw?.moral_branch;
  return (branch && typeof branch === "object") ? branch : null;
}

/**
 * Resolve a reputation_change key to either a specific NPC or a faction.
 * Keys observed across the 11 authored files take three shapes:
 *   - "<npc_id>_personal"  → personal opinion (main-arc, onboarding, faction-quests)
 *   - "<npc_id>"           → personal opinion, no suffix (sealed-record, brackish-trust, southern-arc-mystery)
 *   - "<faction_id>"       → faction-wide reputation (all files)
 *
 * Resolution never guesses at authorial intent from the key's shape alone —
 * it checks the key (and, if it ends with "_personal", the stripped form)
 * against real world_npcs rows first, then against factions that have at
 * least one live NPC member. A key that matches neither is reported back as
 * `unresolved` rather than silently dropped or misapplied.
 */
export function resolveReputationTarget(db, key, worldId) {
  if (!db || !key) return null;
  const wid = worldId || null;

  const npcExists = (id) => {
    try {
      return wid
        ? !!db.prepare(`SELECT 1 FROM world_npcs WHERE id = ? AND world_id = ?`).get(id, wid)
        : !!db.prepare(`SELECT 1 FROM world_npcs WHERE id = ?`).get(id);
    } catch { return false; }
  };

  if (npcExists(key)) return { kind: "npc", id: key };

  if (key.endsWith("_personal")) {
    const stripped = key.slice(0, -"_personal".length);
    if (stripped && npcExists(stripped)) return { kind: "npc", id: stripped };
  }

  try {
    const hasMember = wid
      ? db.prepare(`SELECT 1 FROM world_npcs WHERE faction = ? AND world_id = ? LIMIT 1`).get(key, wid)
      : db.prepare(`SELECT 1 FROM world_npcs WHERE faction = ? LIMIT 1`).get(key);
    if (hasMember) return { kind: "faction", id: key };
  } catch { /* fall through to unresolved */ }

  return null;
}

/**
 * Apply every reputation_change entry in a chosen moral_branch option to the
 * real reputation substrate:
 *   - personal targets write directly to character_opinions via recordOpinionEvent
 *   - faction targets write the SAME delta to every live member NPC's opinion
 *     row. computeFactionReputation aggregates a faction's reputation as the
 *     AVERAGE of its members' opinion scores of the player, so applying a
 *     uniform delta to every member shifts that average by exactly the
 *     authored delta (bounded by each row's individual [-100,100] clamp).
 *     The (user, world, faction) cache row is then recomputed immediately
 *     via refreshOneFactionReputation, so the change is visible right away
 *     instead of waiting on the ~15-min faction-rep-cache-refresh heartbeat.
 *
 * Idempotent per (userId, worldId, questAuthoredId) via
 * quest_moral_branch_choices (migration 357) — a retried or duplicated call
 * never double-applies the consequence. Reputation deltas are a one-time
 * consequence of a story choice, not an incremental action a player repeats.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} [opts.worldId]
 * @param {string} opts.questAuthoredId
 * @param {string} opts.optionId          matches moral_branch.options[].id OR .trigger
 * @returns {{ok:true, questAuthoredId, optionId, trigger, consequence, applied:object[], unresolved:string[]}
 *          | {ok:false, reason:string, [existingOptionId]:string}}
 */
export function applyMoralBranchChoice(db, { userId, worldId, questAuthoredId, optionId } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId || !questAuthoredId || !optionId) {
    return { ok: false, reason: "missing_inputs" };
  }
  const wid = worldId || DEFAULT_WORLD;

  const branch = getMoralBranch(questAuthoredId);
  if (!branch || !Array.isArray(branch.options)) {
    return { ok: false, reason: "no_moral_branch", questAuthoredId };
  }
  const option = branch.options.find((o) => o.id === optionId || o.trigger === optionId);
  if (!option) {
    return { ok: false, reason: "option_not_found", questAuthoredId, optionId };
  }

  // Idempotency gate — a chosen branch applies exactly once.
  let existing = null;
  try {
    existing = db.prepare(`
      SELECT option_id FROM quest_moral_branch_choices
      WHERE user_id = ? AND world_id = ? AND quest_authored_id = ?
    `).get(userId, wid, questAuthoredId);
  } catch { /* table missing on a minimal build — proceed uncached, best-effort */ }
  if (existing) {
    return { ok: false, reason: "already_chosen", existingOptionId: existing.option_id };
  }

  const changes = (option.reputation_change && typeof option.reputation_change === "object")
    ? option.reputation_change
    : {};

  const applied = [];
  const unresolved = [];

  for (const [key, rawDelta] of Object.entries(changes)) {
    const delta = Number(rawDelta);
    if (!Number.isFinite(delta) || delta === 0) continue;

    const target = resolveReputationTarget(db, key, wid);
    if (!target) {
      unresolved.push(key);
      continue;
    }

    const reason = `moral_branch:${questAuthoredId}:${option.id || optionId}`;

    if (target.kind === "npc") {
      const r = recordOpinionEvent(
        db,
        { npcId: target.id, targetKind: "player", targetId: userId },
        delta,
        reason,
      );
      applied.push({ key, kind: "npc", npcId: target.id, delta, score: r?.score ?? null });
    } else {
      let members = [];
      try {
        members = db.prepare(`
          SELECT id FROM world_npcs
          WHERE faction = ? AND world_id = ? AND COALESCE(is_dead, 0) = 0
          LIMIT ?
        `).all(target.id, wid, MAX_FACTION_NPCS);
      } catch { members = []; }

      let touched = 0;
      for (const m of members) {
        recordOpinionEvent(
          db,
          { npcId: m.id, targetKind: "player", targetId: userId },
          delta,
          reason,
        );
        touched++;
      }
      const rep = refreshOneFactionReputation(db, userId, target.id, wid);
      applied.push({
        key, kind: "faction", factionId: target.id, delta, npcsTouched: touched,
        score: rep?.score ?? null, tier: rep?.tier ?? null,
      });
    }
  }

  try {
    db.prepare(`
      INSERT INTO quest_moral_branch_choices
        (user_id, world_id, quest_authored_id, option_id, chosen_trigger, applied_json, chosen_at)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(user_id, world_id, quest_authored_id) DO NOTHING
    `).run(userId, wid, questAuthoredId, option.id || optionId, option.trigger || null, JSON.stringify(applied));
  } catch { /* best-effort — the reputation writes above already landed */ }

  return {
    ok: true,
    questAuthoredId,
    optionId: option.id || optionId,
    trigger: option.trigger || null,
    consequence: option.consequence || null,
    applied,
    unresolved,
  };
}
