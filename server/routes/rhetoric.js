// server/routes/rhetoric.js
//
// Wave E / E3a — player rhetoric persuasion. POST /api/rhetoric/persuade
//   { targetNpcId, argument, intent }
//
// Routes the argument through the subconscious brain (default-on per
// the user's scope choice) and returns a JSON verdict:
//   { logicScore, emotionScore, alignmentScore, verdict: persuaded|unmoved|offended }
//
// On success → opinion delta + optional quest fork / faction allegiance flip.
// On offense → opinion penalty + may seed a scheme proposal.
//
// Token budget: ~800 in, ~80 out per attempt; capped at 3 attempts per
// (player, npc, hour) to bound spend. Falls back to deterministic
// scoring if the brain stack is unavailable.

import express from "express";
import crypto from "crypto";

const ARGUMENT_MAX_LEN = 1200;
const ATTEMPTS_PER_HOUR = 3;

export default function createRhetoricRouter({ db, requireAuth }) {
  const router = express.Router();

  router.post("/persuade", requireAuth, async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });

    const { targetNpcId, argument, intent = "general" } = req.body || {};
    if (!targetNpcId) return res.status(400).json({ ok: false, error: "missing_npc_id" });
    if (!argument || typeof argument !== "string") {
      return res.status(400).json({ ok: false, error: "missing_argument" });
    }
    if (argument.length > ARGUMENT_MAX_LEN) {
      return res.status(400).json({ ok: false, error: "argument_too_long" });
    }

    // Rate limit per (player, npc, hour).
    try {
      _ensureAttemptsTable(db);
      const cutoff = Math.floor(Date.now() / 1000) - 3600;
      const recent = db.prepare(`
        SELECT COUNT(*) AS n FROM rhetoric_attempts
        WHERE user_id = ? AND target_npc_id = ? AND attempted_at > ?
      `).get(userId, targetNpcId, cutoff);
      if (recent?.n >= ATTEMPTS_PER_HOUR) {
        return res.status(429).json({ ok: false, error: "rate_limited",
          message: `Max ${ATTEMPTS_PER_HOUR} arguments per NPC per hour.` });
      }
    } catch { /* table optional */ }

    const npc = db.prepare(`SELECT * FROM world_npcs WHERE id = ?`).get(targetNpcId);
    if (!npc) return res.status(404).json({ ok: false, error: "npc_not_found" });

    // Read NPC affect for prompt weighting.
    let affect = null;
    try {
      affect = db.prepare(`SELECT v, a, c, g, t, f FROM affect_state WHERE entity_id = ?`).get(targetNpcId) || null;
    } catch { /* ok */ }

    // Score the argument. LLM is the canonical path; we fall back to
    // deterministic when the brain stack isn't loaded (tests, minimal builds).
    let verdict = await _scoreViaLlm({ argument, intent, npc, affect });
    if (!verdict) verdict = _scoreDeterministic({ argument, intent, npc, affect });

    // Apply consequences.
    let opinionDelta = 0;
    try {
      const { recordOpinionEvent } = await import("../lib/npc-opinions.js");
      if (verdict.verdict === "persuaded") {
        opinionDelta = 15;
        recordOpinionEvent?.(db, { npcId: targetNpcId, targetKind: "user", targetId: userId },
          opinionDelta, `rhetoric:persuaded:${intent}`);
      } else if (verdict.verdict === "offended") {
        opinionDelta = -20;
        recordOpinionEvent?.(db, { npcId: targetNpcId, targetKind: "user", targetId: userId },
          opinionDelta, `rhetoric:offended:${intent}`);
        // Offended NPCs may propose a scheme if they're already hostile.
        try {
          const { proposeScheme } = await import("../lib/npc-schemes.js");
          proposeScheme?.(db, {
            plotterNpcId: targetNpcId,
            targetKind: "user", targetId: userId,
            kind: "fabricate_secret",
          });
        } catch { /* ok */ }
      }
    } catch { /* opinions optional */ }

    // Memory: log this argument as a structured memory.
    try {
      const { recordInteraction } = await import("../lib/npc-player-memory.js");
      recordInteraction(db, {
        npcId: targetNpcId, playerId: userId, worldId: npc.world_id,
        kind: "spoke",
        payload: { topic: `rhetoric:${intent}`, body: argument.slice(0, 600), verdict: verdict.verdict },
        sentimentDelta: opinionDelta / 100, // small sentiment shift
      });
    } catch { /* ok */ }

    // Record the attempt for rate limiting.
    try {
      db.prepare(`
        INSERT INTO rhetoric_attempts (id, user_id, target_npc_id, attempted_at, verdict)
        VALUES (?, ?, ?, unixepoch(), ?)
      `).run(crypto.randomUUID(), userId, targetNpcId, verdict.verdict);
    } catch { /* table optional */ }

    return res.json({
      ok: true,
      verdict: verdict.verdict,
      scores: {
        logic: verdict.logicScore,
        emotion: verdict.emotionScore,
        alignment: verdict.alignmentScore,
      },
      opinionDelta,
      composer: verdict.composer,
    });
  });

  return router;
}

function _ensureAttemptsTable(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rhetoric_attempts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        target_npc_id TEXT NOT NULL,
        attempted_at INTEGER NOT NULL,
        verdict TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ra_user_npc
        ON rhetoric_attempts(user_id, target_npc_id, attempted_at);
    `);
  } catch { /* idempotent */ }
}

async function _scoreViaLlm({ argument, intent, npc, affect: _affect }) {
  try {
    const router = await import("../lib/brain-router.js");
    const callBrain = router?.default?.callBrain || router?.callBrain;
    if (!callBrain) return null;
    const system = `You are a rhetoric judge. Score the player's argument for persuading an NPC.
Output ONLY valid JSON: {"logicScore":0-100,"emotionScore":0-100,"alignmentScore":0-100,"verdict":"persuaded"|"unmoved"|"offended"}.
- logicScore: how well-reasoned is the argument?
- emotionScore: how emotionally resonant?
- alignmentScore: how well does it align with the NPC's stated values + current mood?
- verdict: combine the three. Total > 200 = persuaded. < 90 OR if it insults = offended. Else unmoved.`;
    const user = [
      `NPC: ${npc.name || npc.archetype} (archetype: ${npc.archetype}, faction: ${npc.faction || "none"})`,
      `NPC current emotional state: ${_describeAffect(npc, _affect)}`,
      `Player's intent: ${intent}`,
      `Argument:`,
      argument,
    ].join("\n");
    const out = await callBrain({ brain: "subconscious", system, user, maxTokens: 120, timeoutMs: 8000 });
    const text = typeof out === "string" ? out : (out?.text || "");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (!["persuaded", "unmoved", "offended"].includes(parsed.verdict)) return null;
    return {
      logicScore:     Number(parsed.logicScore)     || 0,
      emotionScore:   Number(parsed.emotionScore)   || 0,
      alignmentScore: Number(parsed.alignmentScore) || 0,
      verdict: parsed.verdict,
      composer: "subconscious",
    };
  } catch {
    return null;
  }
}

function _scoreDeterministic({ argument, npc, affect: _affect }) {
  // Crude fallback for tests + no-LLM environments. Length and
  // sentiment-keyword heuristics; verdict tilts toward 'unmoved'.
  const wordCount = argument.split(/\s+/).filter(Boolean).length;
  const lower = argument.toLowerCase();
  let logic = Math.min(100, wordCount * 2);
  let emotion = /please|hope|feel|love|fear|hurt|share|together/.test(lower) ? 60 : 30;
  let alignment = npc.faction ? 50 : 40;
  // Insult detection: rough heuristic.
  const insults = /fool|coward|liar|scum|dog|wretch|trash|worthless/.test(lower);
  let verdict = "unmoved";
  if (insults) verdict = "offended";
  else if ((logic + emotion + alignment) > 200) verdict = "persuaded";
  return {
    logicScore: logic, emotionScore: emotion, alignmentScore: alignment, verdict,
    composer: "deterministic-fallback",
  };
}

function _describeAffect(npc, affect) {
  if (!affect) return `mood ${npc.mood || "neutral"}`;
  if (affect.v <= -0.4) return "grieving / suspicious";
  if (affect.v <= -0.2) return "guarded";
  if (affect.v >= 0.5) return "warm / open";
  if (affect.v >= 0.2) return "polite";
  return "neutral";
}
