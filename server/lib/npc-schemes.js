// server/lib/npc-schemes.js
//
// Sprint C / Track A4 — NPC schemes / plots.
//
// State machine: planning → recruiting → gathering_evidence → moving →
//   ↘ complete (resolution effect)
//   ↘ exposed (player discovered evidence; opinion deltas + abandon)
//   ↘ abandoned (cooldown, lead exiled, etc.)
//
// proposeScheme: deterministic from plotter stress + opinion + coping
// trait. High-stress (≥60) + hate-target (opinion ≤ -50) + paranoid|cruel
// trait → propose. Otherwise no-op.
//
// advanceScheme: per-pass tick from scheme cycle. Phase transitions
// gated on accomplice_count, evidence_count, success_pct.
//
// Resolution effects fire on `complete`. Each effect routes to an
// existing substrate function (legacy, opinions, secrets, etc).

import crypto from "node:crypto";
import logger from "../logger.js";
import { recordOpinionEvent, getOpinion } from "./npc-opinions.js";
import { getStress, bumpStress } from "./npc-stress.js";
import { insertSyntheticSecret } from "./secrets.js";

const SCHEME_TICK_MIN = 30 * 60;          // 30 min real-time per scheme tick (matches heartbeat freq 30 ≈ 7.5min, dedupe mid-cycle)
const SCHEME_TICK_VAR = 60 * 60;          // up to +1h jitter
const ACCOMPLICE_THRESHOLD = 30;          // opinion ≥ +30 to recruit
const EVIDENCE_PER_GATHER = 1;
const MOVE_REQUIRES_EVIDENCE = 3;
const MOVE_REQUIRES_ACCOMPLICES = 2;

const KIND_REQUIRES_EVIDENCE = new Set(["assassinate", "blackmail", "claim_inheritance"]);

function nextTickAt(now = Math.floor(Date.now() / 1000)) {
  return now + SCHEME_TICK_MIN + Math.floor(Math.random() * SCHEME_TICK_VAR);
}

/**
 * Propose a scheme: deterministic gate based on plotter's stress, opinion
 * of target, and coping trait. Returns { ok, action, schemeId? }.
 */
export function proposeScheme(db, { plotterNpcId, targetKind, targetId, kind = null }) {
  if (!db || !plotterNpcId || !targetKind || !targetId) return { ok: false, reason: "missing_inputs" };

  // Don't propose against yourself.
  if (targetKind === "npc" && targetId === plotterNpcId) return { ok: false, reason: "self_target" };

  const stress = getStress(db, plotterNpcId);
  const op = getOpinion(db, plotterNpcId, targetKind, targetId);
  const opinionScore = op?.score ?? 0;

  // Gate: stress ≥ 60 AND opinion ≤ -50 (or coping trait paranoid/cruel
  // which are wild-card propose triggers).
  const wildCard = stress?.coping_trait === "paranoid" || stress?.coping_trait === "cruel";
  const stressed = (stress?.stress ?? 30) >= 60;
  const hates = opinionScore <= -50;
  if (!wildCard && !(stressed && hates)) {
    return { ok: false, reason: "no_motive" };
  }

  // Don't open a parallel scheme of the same kind on the same target.
  const dup = db.prepare(`
    SELECT id FROM npc_schemes
    WHERE plotter_id = ? AND target_kind = ? AND target_id = ?
      AND phase NOT IN ('complete','abandoned','exposed') LIMIT 1
  `).get(plotterNpcId, targetKind, targetId);
  if (dup) return { ok: false, reason: "duplicate_scheme", schemeId: dup.id };

  // Pick a kind based on traits. assassinate wins on cruel; blackmail on
  // paranoid; seduce on liked-target-but-rejected; default assassinate.
  const pickedKind = kind || pickSchemeKind(stress?.coping_trait, opinionScore);
  const id = `sch_${crypto.randomUUID().slice(0, 16)}`;
  const successBase = pickedKind === "seduce" ? 40 : pickedKind === "blackmail" ? 50 : 30;
  const discoveryBase = pickedKind === "fabricate_secret" ? 25 : 10;

  db.prepare(`
    INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase, success_pct, discovery_pct, next_tick_at)
    VALUES (?, 'npc', ?, ?, ?, ?, 'planning', ?, ?, ?)
  `).run(id, plotterNpcId, targetKind, targetId, pickedKind, successBase, discoveryBase, nextTickAt());

  return { ok: true, action: "proposed", schemeId: id, kind: pickedKind };
}

/** Player-driven scheme path. Plotter is the user_id. */
export function proposePlayerScheme(db, userId, { targetKind, targetId, kind }) {
  if (!db || !userId || !targetKind || !targetId || !kind) return { ok: false, reason: "missing_inputs" };
  const id = `sch_player_${crypto.randomUUID().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase, success_pct, discovery_pct, next_tick_at)
    VALUES (?, 'player', ?, ?, ?, ?, 'planning', 25, 15, ?)
  `).run(id, userId, targetKind, targetId, kind, nextTickAt());
  return { ok: true, schemeId: id, kind };
}

function pickSchemeKind(copingTrait, opinionScore) {
  if (copingTrait === "cruel") return "assassinate";
  if (copingTrait === "paranoid") return "blackmail";
  if (opinionScore >= 30) return "seduce";   // mixed-feelings → seduce
  if (opinionScore <= -75) return "assassinate";
  return "blackmail";
}

/**
 * Advance one scheme by one phase if allowed. Caller (heartbeat) should
 * have filtered to next_tick_at <= now. Returns { ok, transitioned, ... }.
 */
export function advanceScheme(db, schemeId, opts = {}) {
  if (!db || !schemeId) return { ok: false, reason: "missing_inputs" };
  const sch = db.prepare(`SELECT * FROM npc_schemes WHERE id = ?`).get(schemeId);
  if (!sch) return { ok: false, reason: "scheme_not_found" };
  if (["complete", "abandoned", "exposed"].includes(sch.phase)) return { ok: true, action: "noop_terminal" };

  const now = Math.floor(Date.now() / 1000);
  let nextPhase = sch.phase;
  let result = { schemeId, fromPhase: sch.phase, transitioned: false };

  switch (sch.phase) {
    case "planning":
      // Always advance to recruiting after one tick.
      nextPhase = "recruiting";
      break;

    case "recruiting": {
      // Pull candidate NPCs whose opinion of plotter ≥ ACCOMPLICE_THRESHOLD.
      const candidates = db.prepare(`
        SELECT npc_id FROM character_opinions
        WHERE target_kind = 'npc' AND target_id = ? AND score >= ?
          AND npc_id NOT IN (SELECT npc_id FROM npc_scheme_accomplices WHERE scheme_id = ?)
        ORDER BY score DESC LIMIT 3
      `).all(sch.plotter_id, ACCOMPLICE_THRESHOLD, schemeId);
      let added = 0;
      for (const c of candidates) {
        try {
          db.prepare(`INSERT INTO npc_scheme_accomplices (scheme_id, npc_id) VALUES (?, ?)`).run(schemeId, c.npc_id);
          added++;
        } catch { /* already added */ }
      }
      const accCount = sch.accomplice_count + added;
      db.prepare(`UPDATE npc_schemes SET accomplice_count = ? WHERE id = ?`).run(accCount, schemeId);
      // Need at least MOVE_REQUIRES_ACCOMPLICES; otherwise stay in recruiting.
      if (accCount >= MOVE_REQUIRES_ACCOMPLICES) {
        nextPhase = KIND_REQUIRES_EVIDENCE.has(sch.kind) ? "gathering_evidence" : "moving";
      }
      break;
    }

    case "gathering_evidence": {
      // Add an evidence row.
      const evId = `ev_${crypto.randomUUID().slice(0, 12)}`;
      db.prepare(`
        INSERT INTO npc_scheme_evidence (id, scheme_id, evidence_kind, detail)
        VALUES (?, ?, ?, ?)
      `).run(evId, schemeId, sch.kind, `pre-move evidence for ${sch.kind}`);
      const evCount = sch.evidence_count + EVIDENCE_PER_GATHER;
      // Each evidence increases discovery_pct by 5.
      const newDisc = Math.min(100, sch.discovery_pct + 5);
      db.prepare(`UPDATE npc_schemes SET evidence_count = ?, discovery_pct = ? WHERE id = ?`).run(evCount, newDisc, schemeId);
      if (evCount >= MOVE_REQUIRES_EVIDENCE) nextPhase = "moving";
      break;
    }

    case "moving": {
      // Resolve. Roll success.
      const rng = opts?.rng ?? Math.random;
      const succeeded = rng() * 100 < sch.success_pct;
      if (succeeded) {
        try { applyResolution(db, sch, opts); }
        catch (err) { try { logger.warn?.("scheme_resolution_failed", { schemeId, error: err?.message }); } catch { /* noop */ } }
        nextPhase = "complete";
      } else {
        // Failure also exposes the plot.
        nextPhase = "exposed";
        if (sch.plotter_kind === "npc") {
          try { bumpStress(db, sch.plotter_id, "scheme_exposed"); } catch { /* noop */ }
        }
      }
      break;
    }
  }

  if (nextPhase !== sch.phase) {
    result.transitioned = true;
    result.toPhase = nextPhase;
    db.prepare(`
      UPDATE npc_schemes
      SET phase = ?, next_tick_at = ?, resolved_at = CASE WHEN ? IN ('complete','exposed','abandoned') THEN unixepoch() ELSE NULL END
      WHERE id = ?
    `).run(nextPhase, nextTickAt(now), nextPhase, schemeId);

    // Wave B / B2 — schedule a dramatic reveal when a scheme reaches
    // terminal state. The dispatcher fires `scheme:reveal` after a
    // 60–600s delay so the player gets a beat instead of an instant
    // notification. Each reveal also writes a synthetic secret so
    // players who pay attention can stumble onto the conspiracy.
    if (nextPhase === "complete" || nextPhase === "exposed") {
      try {
        void import("./scheduled-consequences.js").then(({ schedule }) => {
          try {
            schedule(db, {
              kind: "scheme:reveal",
              fireInS: 60 + Math.floor(Math.random() * 540),
              source: { kind: "npc_scheme", id: schemeId },
              target: { kind: sch.target_kind, id: sch.target_id },
              worldId: sch.world_id ?? null,
              payload: {
                schemeId,
                plotterKind: sch.plotter_kind,
                plotterId: sch.plotter_id,
                targetKind: sch.target_kind,
                targetId: sch.target_id,
                kind: sch.kind,
                phase: nextPhase,                  // complete | exposed
                accompliceCount: sch.accomplice_count,
                discoveryPct: sch.discovery_pct,
              },
            });
          } catch { /* scheduler optional on minimal builds */ }
        }).catch(() => { /* ok */ });
      } catch { /* ok */ }
    }
  } else {
    db.prepare(`UPDATE npc_schemes SET next_tick_at = ? WHERE id = ?`).run(nextTickAt(now), schemeId);
  }

  return { ok: true, ...result };
}

function applyResolution(db, sch, opts = {}) {
  switch (sch.kind) {
    case "assassinate": {
      // Best-effort: kill the target NPC, fire onNpcDeath chain.
      if (sch.target_kind === "npc") {
        try {
          db.prepare(`UPDATE world_npcs SET is_dead = 1 WHERE id = ?`).run(sch.target_id);
        } catch { /* world_npcs may be absent */ }
        try {
          const dec = db.prepare(`SELECT id, name, faction, archetype FROM world_npcs WHERE id = ?`).get(sch.target_id);
          if (dec) {
            // Lazy import to avoid a circular load chain at module init.
            // Fire-and-forget by design — the resolution path doesn't need
            // to await the legacy cascade to consider the scheme complete.
            void import("./npc-legacy.js").then(({ onNpcDeath }) => {
              try { onNpcDeath(db, dec, { cause: "assassinated", killerId: sch.plotter_id }); }
              catch { /* legacy chain optional */ }
            });
          }
        } catch { /* noop */ }
      } else if (sch.target_kind === "player") {
        // Sprint C decision (locked): respawn + lose kingdom only.
        // Caller (combat path or heartbeat) is expected to enforce respawn;
        // here we just record the assassin grudge and a kingdom transition
        // hook (Track D will read this on rebellion path).
        if (opts?.io) {
          try { opts.io.emit?.("scheme:player_assassinated", { plotterId: sch.plotter_id, targetUserId: sch.target_id }); } catch { /* noop */ }
        }
      }
      break;
    }
    case "seduce":
      if (sch.target_kind === "npc") {
        recordOpinionEvent(db,
          { npcId: sch.target_id, targetKind: "npc", targetId: sch.plotter_id },
          60, "seduced");
      }
      break;
    case "fabricate_secret":
      if (sch.target_kind === "npc") {
        try {
          insertSyntheticSecret(db, sch.plotter_id, "npc", sch.target_id,
            `fabricated claim against ${sch.target_id}`, 7);
        } catch { /* secrets table optional */ }
      }
      break;
    case "claim_inheritance":
      // Add a faux inheritance link.
      try {
        db.prepare(`
          INSERT INTO npc_inheritance_links (id, deceased_npc_id, heir_npc_id, inherited_kind)
          VALUES (?, ?, ?, 'wealth')
        `).run(`il_${crypto.randomUUID().slice(0, 12)}`, sch.target_id, sch.plotter_id);
      } catch { /* npc_inheritance_links optional */ }
      break;
    case "blackmail":
      if (sch.target_kind === "npc") {
        recordOpinionEvent(db,
          { npcId: sch.target_id, targetKind: "npc", targetId: sch.plotter_id },
          40, "blackmailed");
      }
      break;
    case "sabotage_decree":
      // Track D dependency — sabotage flips effect_state.
      try {
        db.prepare(`UPDATE realm_decrees SET effect_state = 'sabotaged' WHERE id = ?`).run(sch.target_id);
      } catch { /* kingdoms not seeded yet */ }
      break;
  }
}

/**
 * Player discovers evidence on a scheme. Cascades opinion + may transition
 * scheme to exposed. Returns { ok, exposed }.
 */
export function discoverScheme(db, userId, schemeId, evidenceKind = "observed") {
  if (!db || !userId || !schemeId) return { ok: false, reason: "missing_inputs" };
  const sch = db.prepare(`SELECT id, plotter_id, target_kind, target_id, phase FROM npc_schemes WHERE id = ?`).get(schemeId);
  if (!sch) return { ok: false, reason: "scheme_not_found" };

  // Mark evidence rows discovered_by_user.
  const r = db.prepare(`
    UPDATE npc_scheme_evidence
    SET discovered_by_user = ?, discovered_at = unixepoch()
    WHERE scheme_id = ? AND discovered_at IS NULL
  `).run(userId, schemeId);

  // If 50%+ of evidence discovered, transition to exposed.
  const counts = db.prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN discovered_by_user IS NOT NULL THEN 1 ELSE 0 END) AS discovered
    FROM npc_scheme_evidence WHERE scheme_id = ?
  `).get(schemeId);
  let exposed = false;
  if (counts.total > 0 && counts.discovered / counts.total >= 0.5) {
    db.prepare(`
      UPDATE npc_schemes SET phase = 'exposed', resolved_at = unixepoch() WHERE id = ?
    `).run(schemeId);
    exposed = true;
    // Plotter takes opinion hit from exposed scheme (target gets a strong negative).
    if (sch.target_kind === "player") {
      // Plotter NPC's opinion of the player-victim gets a fearful spike as the plot is named.
      recordOpinionEvent(db,
        { npcId: sch.plotter_id, targetKind: "player", targetId: userId },
        -25, "scheme exposed");
    }
    if (sch.plotter_id) {
      try { bumpStress(db, sch.plotter_id, "scheme_exposed"); } catch { /* noop */ }
    }
  }
  return { ok: true, evidenceMarked: r.changes, exposed, evidenceKind };
}

/** List active schemes a user is suspected of being targeted by. */
export function listSchemesAgainstUser(db, userId) {
  if (!db || !userId) return [];
  return db.prepare(`
    SELECT id, plotter_kind, plotter_id, kind, phase, success_pct, discovery_pct, evidence_count, accomplice_count
    FROM npc_schemes
    WHERE target_kind = 'player' AND target_id = ?
      AND phase NOT IN ('complete','abandoned')
    ORDER BY discovery_pct DESC, created_at DESC LIMIT 20
  `).all(userId);
}

/** List a user's own active schemes (player-driven). */
export function listSchemesForUser(db, userId) {
  if (!db || !userId) return [];
  return db.prepare(`
    SELECT id, target_kind, target_id, kind, phase, success_pct, discovery_pct, evidence_count, accomplice_count
    FROM npc_schemes
    WHERE plotter_kind = 'player' AND plotter_id = ?
    ORDER BY created_at DESC LIMIT 20
  `).all(userId);
}

export const SCHEME_CONSTANTS = Object.freeze({
  ACCOMPLICE_THRESHOLD,
  MOVE_REQUIRES_EVIDENCE,
  MOVE_REQUIRES_ACCOMPLICES,
});
