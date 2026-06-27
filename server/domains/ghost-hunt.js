// server/domains/ghost-hunt.js — Phase V ghost-tracker surface for the
// ghost-hunt game-mode lens.
//
// Macros:
//   ghost-hunt.residues   — list spectral drift_alerts in the player's world
//   ghost-hunt.detail     — full residue context + investigation hints + map placement
//   ghost-hunt.confront   — resolve a hunt stage / extinguish a residue; logs outcome
//   ghost-hunt.history    — confront outcome history (wins/losses, rewards)
//   ghost-hunt.progress   — multi-stage hunt progression (track → investigate → confront)
//   ghost-hunt.advance    — advance the current hunt stage for a residue
//   ghost-hunt.leaderboard — hunter ranks across confronted hauntings
//
// Persistent per-user data lives in globalThis._concordSTATE Maps keyed
// by userId. drift_alerts are append-only in the DB; hunt state is the
// player's progress overlay on top of them.

import crypto from "node:crypto";

const RESIDUE_DRIFT_TYPES = ["spectral", "echo_chamber", "self_reference", "memetic_drift"];

// Ordered hunt stages — a residue is tracked, then investigated, then confronted.
const HUNT_STAGES = ["track", "investigate", "confront", "extinguished"];

// Deterministic reward table per drift type — confront outcome credits.
const REWARD_TABLE = {
  spectral: { xp: 120, essence: 8, title: "Veil-Walker" },
  echo_chamber: { xp: 95, essence: 6, title: "Echo-Breaker" },
  self_reference: { xp: 140, essence: 10, title: "Loop-Severer" },
  memetic_drift: { xp: 80, essence: 5, title: "Drift-Warden" },
};

// Severity → confront difficulty / win-chance seed.
const SEVERITY_WEIGHT = { low: 1, medium: 2, high: 3, critical: 4 };

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || null;
}

// Fail-CLOSED numeric guard (mirrors server/domains/literary.js). Returns the
// first offending key, or null when every supplied numeric field is a finite
// non-negative number within range. The macro-assassin's V2 vector probes
// NaN / Infinity / huge values here, so reject rather than coerce.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

function state() {
  const g = globalThis;
  if (!g._concordSTATE) g._concordSTATE = {};
  const S = g._concordSTATE;
  if (!(S.ghostHunts instanceof Map)) S.ghostHunts = new Map();        // userId -> Map(residueId -> hunt)
  if (!(S.ghostHistory instanceof Map)) S.ghostHistory = new Map();     // userId -> [outcome]
  if (!(S.ghostRank instanceof Map)) S.ghostRank = new Map();           // userId -> { wins, losses, xp, essence }
  return S;
}

function userHunts(userId) {
  const S = state();
  if (!S.ghostHunts.has(userId)) S.ghostHunts.set(userId, new Map());
  return S.ghostHunts.get(userId);
}

function userHistory(userId) {
  const S = state();
  if (!S.ghostHistory.has(userId)) S.ghostHistory.set(userId, []);
  return S.ghostHistory.get(userId);
}

function userRank(userId) {
  const S = state();
  if (!S.ghostRank.has(userId)) {
    S.ghostRank.set(userId, { wins: 0, losses: 0, xp: 0, essence: 0, confronts: 0 });
  }
  return S.ghostRank.get(userId);
}

// Stable pseudo-random 0..1 from a string (seeded by residue + user + nonce).
function seededUnit(seed) {
  const h = crypto.createHash("sha256").update(String(seed)).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

// Deterministic map coordinates for a residue, derived from its signature.
function residueCoords(signature) {
  const h = crypto.createHash("sha256").update(String(signature || "x")).digest();
  // Map into a -512..512 world-grid plane.
  const gx = (h.readUInt16BE(0) / 65535) * 1024 - 512;
  const gz = (h.readUInt16BE(2) / 65535) * 1024 - 512;
  return { x: Math.round(gx), z: Math.round(gz) };
}

// Investigation hints scale with drift type + severity.
function investigationHints(driftType, severity) {
  const base = {
    spectral: [
      "Trace the residue to its emission cell — the signature head encodes the origin lattice.",
      "Spectral drift fades in daylight; confront after dusk for a cleaner read.",
    ],
    echo_chamber: [
      "Echo residues self-amplify — confront the loudest reflection first.",
      "Look for a recurring phrase in the context payload; that is the echo seed.",
    ],
    self_reference: [
      "A self-referential loop names itself in its own context — find the cycle anchor.",
      "Severing the loop requires confronting it at its narrowest stage, not its widest.",
    ],
    memetic_drift: [
      "Memetic drift spreads between adjacent cells — confront before it forks.",
      "The drift signature mutates each tick; act while the signature still matches.",
    ],
  };
  const hints = (base[driftType] || ["Approach the residue and confront it to extinguish the drift."]).slice();
  if (SEVERITY_WEIGHT[severity] >= 3) {
    hints.push("Severity is elevated — bring a party or confront in stages to avoid a loss.");
  }
  return hints;
}

function parseContext(row) {
  try { return JSON.parse(row?.context_json || "{}") || {}; }
  catch { return {}; }
}

function loadResidueRow(db, residueId) {
  try {
    return db.prepare(`
      SELECT id, drift_type, severity, signature, context_json, detected_at
        FROM drift_alerts WHERE id = ?
    `).get(residueId) || null;
  } catch { return null; }
}

export default function registerGhostHuntMacros(register) {
  // ── residues — list + filter + sort ─────────────────────────────────
  register("ghost-hunt", "residues", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    const {
      worldId,
      limit = 30,
      severity = null,          // 'low' | 'medium' | 'high' | 'critical'
      driftType = null,         // one of RESIDUE_DRIFT_TYPES
      sort = "recent",          // 'recent' | 'severity' | 'type'
    } = input || {};
    const badNum = badNumericField(input, ["limit"]);
    if (badNum) return { ok: false, reason: "invalid_numeric_field", field: badNum };
    try {
      const rows = db.prepare(`
        SELECT id, drift_type, severity, signature, context_json, detected_at
          FROM drift_alerts
         WHERE drift_type IN ('spectral', 'echo_chamber', 'self_reference', 'memetic_drift')
         ORDER BY detected_at DESC
         LIMIT ?
      `).all(Math.min(200, Math.max(1, Number(limit) || 30)));

      let residues = worldId
        ? rows.filter(r => parseContext(r).worldId === worldId)
        : rows;
      if (severity) residues = residues.filter(r => r.severity === severity);
      if (driftType) residues = residues.filter(r => r.drift_type === driftType);

      // Attach hunt-stage overlay for the calling user.
      const hunts = userId ? userHunts(userId) : null;
      residues = residues.map(r => {
        const hunt = hunts?.get(r.id);
        return {
          ...r,
          stage: hunt?.stage || "track",
          coords: residueCoords(r.signature),
          confronted: hunt?.stage === "extinguished",
        };
      });

      if (sort === "severity") {
        residues.sort((a, b) => (SEVERITY_WEIGHT[b.severity] || 0) - (SEVERITY_WEIGHT[a.severity] || 0));
      } else if (sort === "type") {
        residues.sort((a, b) => String(a.drift_type).localeCompare(String(b.drift_type)));
      }

      return {
        ok: true,
        residues,
        count: residues.length,
        driftTypes: RESIDUE_DRIFT_TYPES,
        severities: Object.keys(SEVERITY_WEIGHT),
      };
    } catch (err) {
      return { ok: false, reason: "query_failed", err: String(err?.message || err) };
    }
  }, { note: "List + filter + sort spectral drift residues for the ghost-tracker lens." });

  // ── detail — full context + investigation hints + map placement ─────
  register("ghost-hunt", "detail", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { residueId } = input || {};
    if (!residueId) return { ok: false, reason: "missing_residue_id" };
    try {
      const row = loadResidueRow(db, residueId);
      if (!row) return { ok: false, reason: "residue_not_found" };
      const context = parseContext(row);
      const userId = actorId(ctx);
      const hunt = userId ? userHunts(userId).get(residueId) : null;
      const coords = residueCoords(row.signature);
      const reward = REWARD_TABLE[row.drift_type] || REWARD_TABLE.memetic_drift;
      const sevW = SEVERITY_WEIGHT[row.severity] || 1;
      return {
        ok: true,
        residue: {
          id: row.id,
          drift_type: row.drift_type,
          severity: row.severity,
          signature: row.signature,
          detected_at: row.detected_at,
          context,
          coords,
          worldId: context.worldId || null,
        },
        hints: investigationHints(row.drift_type, row.severity),
        difficulty: sevW,
        potentialReward: reward,
        stage: hunt?.stage || "track",
        stageIndex: HUNT_STAGES.indexOf(hunt?.stage || "track"),
        stages: HUNT_STAGES,
      };
    } catch (err) {
      return { ok: false, reason: "detail_failed", err: String(err?.message || err) };
    }
  }, { note: "Full residue detail — context, investigation hints, map placement." });

  // ── progress — multi-stage hunt progression for a residue ───────────
  register("ghost-hunt", "progress", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const { residueId } = input || {};
    try {
      if (residueId) {
        const hunt = userHunts(userId).get(residueId);
        const stage = hunt?.stage || "track";
        return {
          ok: true,
          residueId,
          stage,
          stageIndex: HUNT_STAGES.indexOf(stage),
          stages: HUNT_STAGES,
          startedAt: hunt?.startedAt || null,
          log: hunt?.log || [],
        };
      }
      // No residueId — return all active hunts for this user.
      const hunts = [...userHunts(userId).entries()].map(([id, h]) => ({
        residueId: id,
        stage: h.stage,
        stageIndex: HUNT_STAGES.indexOf(h.stage),
        startedAt: h.startedAt,
      }));
      return { ok: true, hunts, count: hunts.length, stages: HUNT_STAGES };
    } catch (err) {
      return { ok: false, reason: "progress_failed", err: String(err?.message || err) };
    }
  }, { note: "Multi-stage hunt progression — current stage for a residue or all hunts." });

  // ── advance — move a hunt forward (track → investigate → confront) ──
  register("ghost-hunt", "advance", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const db = ctx?.db;
    const { residueId } = input || {};
    if (!residueId) return { ok: false, reason: "missing_residue_id" };
    try {
      if (db && !loadResidueRow(db, residueId)) {
        return { ok: false, reason: "residue_not_found" };
      }
      const hunts = userHunts(userId);
      const hunt = hunts.get(residueId) || {
        stage: "track", startedAt: Date.now(), log: [],
      };
      const idx = HUNT_STAGES.indexOf(hunt.stage);
      if (hunt.stage === "extinguished") {
        return { ok: false, reason: "already_extinguished", stage: hunt.stage };
      }
      if (hunt.stage === "confront") {
        return { ok: false, reason: "use_confront_macro", stage: hunt.stage };
      }
      const nextStage = HUNT_STAGES[idx + 1];
      hunt.stage = nextStage;
      hunt.log = [...(hunt.log || []), { stage: nextStage, at: Date.now() }];
      hunts.set(residueId, hunt);
      return {
        ok: true,
        residueId,
        stage: nextStage,
        stageIndex: HUNT_STAGES.indexOf(nextStage),
        stages: HUNT_STAGES,
      };
    } catch (err) {
      return { ok: false, reason: "advance_failed", err: String(err?.message || err) };
    }
  }, { note: "Advance a hunt stage — track → investigate → confront." });

  // ── confront — resolve the hunt, win/loss, reward, history ──────────
  register("ghost-hunt", "confront", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = actorId(ctx);
    if (!db || !userId) return { ok: false, reason: "no_db_or_actor" };
    const { residueId, worldId } = input || {};
    if (!residueId) return { ok: false, reason: "missing_residue_id" };
    try {
      const row = loadResidueRow(db, residueId);
      if (!row) return { ok: false, reason: "residue_not_found" };

      const hunts = userHunts(residueId ? userId : userId);
      const hunt = hunts.get(residueId) || { stage: "track", startedAt: Date.now(), log: [] };
      if (hunt.stage === "extinguished") {
        return { ok: false, reason: "already_extinguished" };
      }

      // Win-chance: higher when the player has investigated first, lower
      // with severity. Deterministic per (residue, user, attempt#).
      const rank = userRank(userId);
      const attemptSeed = `${residueId}:${userId}:${rank.confronts}`;
      const roll = seededUnit(attemptSeed);
      const sevW = SEVERITY_WEIGHT[row.severity] || 1;
      const investigated = HUNT_STAGES.indexOf(hunt.stage) >= HUNT_STAGES.indexOf("confront");
      const trackedInvestigate = HUNT_STAGES.indexOf(hunt.stage) >= HUNT_STAGES.indexOf("investigate");
      // Base 0.55, +0.2 if reached confront stage, +0.1 if at least investigated, − severity penalty.
      let winChance = 0.55 + (investigated ? 0.2 : 0) + (trackedInvestigate ? 0.1 : 0) - (sevW - 1) * 0.12;
      winChance = Math.max(0.1, Math.min(0.95, winChance));
      const won = roll <= winChance;

      const reward = REWARD_TABLE[row.drift_type] || REWARD_TABLE.memetic_drift;
      const earned = won
        ? { xp: reward.xp, essence: reward.essence, title: reward.title }
        : { xp: Math.round(reward.xp * 0.15), essence: 0, title: null };

      // Update rank.
      rank.confronts += 1;
      if (won) { rank.wins += 1; rank.xp += earned.xp; rank.essence += earned.essence; }
      else { rank.losses += 1; rank.xp += earned.xp; }

      // Update hunt stage.
      if (won) {
        hunt.stage = "extinguished";
      } else if (hunt.stage !== "confront") {
        hunt.stage = "confront";
      }
      hunt.log = [...(hunt.log || []), { stage: hunt.stage, at: Date.now(), result: won ? "win" : "loss" }];
      hunts.set(residueId, hunt);

      // Append outcome to history.
      const outcome = {
        id: `gho_${crypto.randomUUID()}`,
        residueId,
        worldId: worldId || parseContext(row).worldId || null,
        drift_type: row.drift_type,
        severity: row.severity,
        result: won ? "win" : "loss",
        winChance: Number(winChance.toFixed(3)),
        roll: Number(roll.toFixed(3)),
        reward: earned,
        at: Date.now(),
      };
      const hist = userHistory(userId);
      hist.unshift(outcome);
      if (hist.length > 200) hist.length = 200;

      // Audit trail — best-effort, never blocks.
      try {
        db.prepare(`
          INSERT INTO npc_ambition_log (id, npc_id, move_kind, target_kind, target_id, world_id, outcome)
          VALUES (?, ?, 'confront', 'ghost_residue', ?, ?, ?)
        `).run(`ambm_${crypto.randomUUID()}`, userId, residueId, worldId ?? null,
               won ? "player_confront_win" : "player_confront_loss");
      } catch { /* table optional on minimal builds */ }

      try {
        if (globalThis?.__CONCORD_REALTIME__?.io) {
          globalThis.__CONCORD_REALTIME__.io.emit("ghost-hunt:residue-confronted", {
            residueId, userId, worldId, result: outcome.result,
          });
        }
      } catch { /* sockets optional */ }

      return {
        ok: true,
        residueId,
        result: outcome.result,
        won,
        winChance: outcome.winChance,
        reward: earned,
        stage: hunt.stage,
        rank: { wins: rank.wins, losses: rank.losses, xp: rank.xp, essence: rank.essence },
      };
    } catch (err) {
      return { ok: false, reason: "confront_failed", err: String(err?.message || err) };
    }
  }, { note: "Confront a residue — resolves win/loss, awards rewards, records outcome." });

  // ── history — confront outcome history for the calling user ─────────
  register("ghost-hunt", "history", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const { limit = 50 } = input || {};
    const badNum = badNumericField(input, ["limit"]);
    if (badNum) return { ok: false, reason: "invalid_numeric_field", field: badNum };
    try {
      const hist = userHistory(userId).slice(0, Math.min(200, Math.max(1, Number(limit) || 50)));
      const rank = userRank(userId);
      const wins = hist.filter(h => h.result === "win").length;
      const losses = hist.filter(h => h.result === "loss").length;
      const totalXp = hist.reduce((a, h) => a + (h.reward?.xp || 0), 0);
      const totalEssence = hist.reduce((a, h) => a + (h.reward?.essence || 0), 0);
      const winRate = hist.length ? Number((wins / hist.length).toFixed(3)) : 0;
      return {
        ok: true,
        history: hist,
        count: hist.length,
        summary: {
          wins, losses, winRate,
          totalXp, totalEssence,
          lifetime: { wins: rank.wins, losses: rank.losses, xp: rank.xp, essence: rank.essence },
        },
      };
    } catch (err) {
      return { ok: false, reason: "history_failed", err: String(err?.message || err) };
    }
  }, { note: "Confront outcome history — wins/losses, rewards earned." });

  // ── leaderboard — hunter ranks across all confronting users ─────────
  register("ghost-hunt", "leaderboard", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    const { limit = 20 } = input || {};
    const badNum = badNumericField(input, ["limit"]);
    if (badNum) return { ok: false, reason: "invalid_numeric_field", field: badNum };
    try {
      const S = state();
      const entries = [...S.ghostRank.entries()].map(([uid, r]) => {
        const total = r.wins + r.losses;
        return {
          userId: uid,
          wins: r.wins,
          losses: r.losses,
          confronts: r.confronts || total,
          xp: r.xp,
          essence: r.essence,
          winRate: total ? Number((r.wins / total).toFixed(3)) : 0,
        };
      });
      // Rank by xp, then wins.
      entries.sort((a, b) => (b.xp - a.xp) || (b.wins - a.wins));
      const ranked = entries.map((e, i) => ({ ...e, rank: i + 1 }));
      const top = ranked.slice(0, Math.min(100, Math.max(1, Number(limit) || 20)));
      const me = userId ? (ranked.find(e => e.userId === userId) || null) : null;
      return {
        ok: true,
        leaderboard: top,
        count: top.length,
        you: me,
        totalHunters: ranked.length,
      };
    } catch (err) {
      return { ok: false, reason: "leaderboard_failed", err: String(err?.message || err) };
    }
  }, { note: "Hunter leaderboard — ranks by confront XP across all players." });

  // ── create — mint a Spectral Dossier DTU from a confronted residue ──
  // The lens's persistent artifact: a player-authored case file recording a
  // hunt outcome. Writes a real `dtus` row (kind 'ghost_residue') so the
  // dossier is citable + exportable like any other DTU. This is the dtu-exhaust
  // path for the ghost-tracker lens.
  register("ghost-hunt", "create", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = actorId(ctx);
    if (!db || !userId) return { ok: false, reason: "no_db_or_actor" };
    const { residueId, title, notes, visibility = "private" } = input || {};
    if (!residueId) return { ok: false, reason: "missing_residue_id" };
    if (notes !== undefined && notes !== null && typeof notes !== "string") {
      return { ok: false, reason: "invalid_notes" };
    }
    const VIS = new Set(["private", "internal", "public", "marketplace"]);
    if (!VIS.has(visibility)) return { ok: false, reason: "invalid_visibility" };
    try {
      const row = loadResidueRow(db, residueId);
      if (!row) return { ok: false, reason: "residue_not_found" };

      const hunt = userHunts(userId).get(residueId) || null;
      const context = parseContext(row);
      const coords = residueCoords(row.signature);
      const reward = REWARD_TABLE[row.drift_type] || REWARD_TABLE.memetic_drift;
      const lastOutcome = (userHistory(userId).find((h) => h.residueId === residueId)) || null;

      const dtuId = `dtu_gho_${crypto.randomUUID()}`;
      const dossierTitle =
        (typeof title === "string" && title.trim().slice(0, 200)) ||
        `Spectral Dossier — ${row.drift_type} (${row.severity})`;

      const body = {
        kind: "ghost_residue",
        residueId,
        drift_type: row.drift_type,
        severity: row.severity,
        signature: row.signature,
        worldId: context.worldId || null,
        coords,
        stage: hunt?.stage || "track",
        outcome: lastOutcome ? lastOutcome.result : null,
        reward: lastOutcome?.reward || reward,
        notes: typeof notes === "string" ? notes.slice(0, 4000) : "",
        authoredAt: Date.now(),
      };
      const tags = ["ghost-tracker", "ghost_residue", row.drift_type, row.severity];

      db.prepare(`
        INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier)
        VALUES (?, ?, ?, ?, ?, ?, 'regular')
      `).run(dtuId, userId, dossierTitle, JSON.stringify(body), JSON.stringify(tags), visibility);

      return {
        ok: true,
        dtuId,
        title: dossierTitle,
        visibility,
        residueId,
        dossier: body,
      };
    } catch (err) {
      return { ok: false, reason: "create_failed", err: String(err?.message || err) };
    }
  }, { note: "Mint a Spectral Dossier DTU from a confronted residue — the lens's persistent artifact." });
}
