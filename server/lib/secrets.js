// server/lib/secrets.js
//
// Sprint C / Track A3 — secrets discovery loop.
//
// Authored NPCs carry `narrative_context.secret` strings that are
// queryable from JS but MUST NOT enter LLM prompts (the privacy invariant
// is enforced in narrative-bridge.js via the canary scan). This module
// surfaces them as structured rows and gates per-user discovery + the
// "weaponise" pipeline that records opinion events.
//
// Discovery hooks:
//   - dialogue: stress ≥ 60 OR opinion ≥ +50 → 5% chance per turn
//   - inheritance: heir auto-discovers parent's secrets (post-A1 chain)
//   - surveillance: long-press follow → 1d6 evidence dice per 30min
//   - inventory: tagged item → auto-discovery
//   - quest: explicit reveal beat in quest scripting

import crypto from "node:crypto";
import logger from "../logger.js";
import { recordOpinionEvent } from "./npc-opinions.js";

const KIND_FALLBACK = "grudge_origin";

/** Map authored NPC narrative_context.secret string to a structured kind. */
function inferKindFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/\bchild\b|\bfather\b|\bmother\b|\bparent\b|paternity/.test(t)) return "paternity";
  if (/\bcrime\b|\bmurder\b|\btheft\b|\bsteal\b|\bkill/.test(t)) return "crime";
  if (/\bloved?\b|\baffair\b|\bliaison\b|\blust\b/.test(t)) return "liaison";
  if (/\bdebt\b|\bowes?\b|\bborrow\b/.test(t)) return "debt";
  if (/\bheresy\b|\bbelief\b|\bfaith\b|\bdoctrine\b|\bgod\b/.test(t)) return "heresy";
  if (/\bskill\b|\bmastery\b|\bart\b|\bcraft\b/.test(t)) return "hidden_skill";
  return KIND_FALLBACK;
}

function inferSubject(text) {
  // Best-effort: secret strings reference an NPC ID like "concord_first_thought"
  // or just "the players". Fall back to world-scope if no NPC handle found.
  const m = String(text || "").match(/\b([a-z]+(?:_[a-z]+)+)\b/);
  if (m) return { subject_kind: "npc", subject_id: m[1] };
  return { subject_kind: "world", subject_id: "concordia-hub" };
}

function makeSecretId(holderNpcId, subjectId) {
  const h = crypto.createHash("sha1").update(`${holderNpcId}::${subjectId}`).digest("hex");
  return `sec_${h.slice(0, 16)}`;
}

/**
 * Idempotent: pulls authored NPCs' narrative_context.secret strings and
 * inserts a structured row per (holder, subject). Skips entries already
 * present. Returns { ok, inserted, skipped, errors }.
 *
 * We import the authored NPC registry lazily (content-seeder.js exports
 * getAuthoredNPC) so this module loads without the registry on minimal
 * builds.
 */
export async function seedFromAuthored(db) {
  if (!db) return { ok: false, reason: "no_db" };
  let getAllAuthoredNPCs;
  try {
    const cs = await import("./content-seeder.js");
    getAllAuthoredNPCs = cs.getAllAuthoredNPCs || null;
  } catch { /* registry absent on minimal builds */ }
  if (typeof getAllAuthoredNPCs !== "function") {
    // Fallback: return success with 0 inserts so callers don't block.
    return { ok: true, inserted: 0, skipped: 0, fallback: true };
  }
  const npcs = getAllAuthoredNPCs();
  let inserted = 0, skipped = 0, errors = 0;
  for (const npc of npcs) {
    const txt = npc?.narrative_context?.secret;
    if (!txt || typeof txt !== "string" || txt.length < 5) continue;
    const subj = inferSubject(txt);
    const kind = inferKindFromText(txt);
    const id = makeSecretId(npc.id, subj.subject_id);
    try {
      const r = db.prepare(`
        INSERT INTO secrets (id, holder_npc_id, subject_kind, subject_id, kind, body, discovery_difficulty)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(id, npc.id, subj.subject_kind, subj.subject_id, kind, txt, 5);
      if (r.changes > 0) inserted++; else skipped++;
    } catch (err) {
      errors++;
      try { logger.debug?.("secrets_seed_failed", { npcId: npc.id, error: err?.message }); } catch { /* noop */ }
    }
  }
  return { ok: true, inserted, skipped, errors };
}

/**
 * D4 #5 — seed ONE structured secret from a single NPC's
 * narrative_context.secret. Used for procedural NPCs at spawn so a fraction of
 * the generated population carries discoverable, quest-gating leverage (not just
 * the authored cast). Deterministic id (idempotent on replay); returns
 * { ok, action, secretId } or { ok:false, reason }. `discoveryDifficulty`
 * defaults higher for procedural secrets so they read as harder-won.
 */
export function seedSecretForNpc(db, npc, { discoveryDifficulty = 6 } = {}) {
  if (!db || !npc?.id) return { ok: false, reason: "missing_inputs" };
  const txt = npc?.narrative_context?.secret;
  if (!txt || typeof txt !== "string" || txt.length < 5) return { ok: false, reason: "no_secret" };
  const subj = inferSubject(txt);
  // A self-referencing procedural secret (subject == holder) is fine and common
  // ("X secretly chafes against orders") — it still gates dialogue/quests.
  const kind = inferKindFromText(txt);
  const id = makeSecretId(npc.id, subj.subject_id);
  try {
    const r = db.prepare(`
      INSERT INTO secrets (id, holder_npc_id, subject_kind, subject_id, kind, body, discovery_difficulty)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(id, npc.id, subj.subject_kind, subj.subject_id, kind, txt,
           Math.max(1, Math.min(10, Math.floor(discoveryDifficulty))));
    return { ok: true, action: r.changes > 0 ? "seeded" : "exists", secretId: id };
  } catch (err) {
    return { ok: false, reason: "schema_unavailable", error: err?.message };
  }
}

/**
 * Mark a secret as discovered by `userId` via `via`. Idempotent on
 * (user_id, secret_id). Returns { ok, secret? }.
 */
export function discoverSecret(db, userId, secretId, via = "dialogue") {
  if (!db || !userId || !secretId) return { ok: false, reason: "missing_inputs" };
  const exists = db.prepare(`SELECT id, holder_npc_id, subject_kind, subject_id, kind FROM secrets WHERE id = ?`).get(secretId);
  if (!exists) return { ok: false, reason: "secret_not_found" };
  const r = db.prepare(`
    INSERT INTO secret_discoveries (user_id, secret_id, via)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, secret_id) DO NOTHING
  `).run(userId, secretId, via);
  // First-time discovery → mark secret revealed_at if still null.
  if (r.changes > 0) {
    try {
      db.prepare(`UPDATE secrets SET revealed_at = COALESCE(revealed_at, unixepoch()) WHERE id = ?`).run(secretId);
    } catch { /* ignore */ }
  }
  return { ok: true, action: r.changes > 0 ? "discovered" : "already_known", secret: exists };
}

/**
 * Player weaponises a discovered secret against an NPC: records opinion
 * events on holder (-30 betrayal) and subject (-50 exposure), and emits a
 * caller-observable result. Caller is expected to fan a `secret:weaponised`
 * socket event to the world room.
 */
export function weaponiseSecret(db, userId, secretId, againstNpcId) {
  if (!db || !userId || !secretId) return { ok: false, reason: "missing_inputs" };
  const disc = db.prepare(`
    SELECT user_id, secret_id, weaponised_at FROM secret_discoveries
    WHERE user_id = ? AND secret_id = ?
  `).get(userId, secretId);
  if (!disc) return { ok: false, reason: "not_discovered" };
  if (disc.weaponised_at) return { ok: false, reason: "already_weaponised" };

  const sec = db.prepare(`
    SELECT id, holder_npc_id, subject_kind, subject_id, kind FROM secrets WHERE id = ?
  `).get(secretId);
  if (!sec) return { ok: false, reason: "secret_not_found" };

  // Holder feels betrayed.
  recordOpinionEvent(db, { npcId: sec.holder_npc_id, targetKind: "player", targetId: userId },
    -30, `you weaponised what they trusted you with`);
  // Subject loses face / dignity.
  if (sec.subject_kind === "npc" && sec.subject_id) {
    recordOpinionEvent(db, { npcId: sec.subject_id, targetKind: "player", targetId: userId },
      -50, `you exposed their secret`);
  }

  db.prepare(`
    UPDATE secret_discoveries SET weaponised_at = unixepoch(), weaponised_against = ?
    WHERE user_id = ? AND secret_id = ?
  `).run(againstNpcId || sec.subject_id, userId, secretId);

  return {
    ok: true, action: "weaponised",
    holder: sec.holder_npc_id,
    subject_kind: sec.subject_kind,
    subject_id: sec.subject_id,
    kind: sec.kind,
  };
}

/** List secrets discovered by a user (for the SecretsCodex HUD). */
export function listDiscoveredForUser(db, userId, { includeBody = false, limit = 50 } = {}) {
  if (!db || !userId) return [];
  const rows = db.prepare(`
    SELECT s.id, s.holder_npc_id, s.subject_kind, s.subject_id, s.kind,
           ${includeBody ? "s.body," : ""}
           d.discovered_at, d.via, d.weaponised_at, d.weaponised_against
    FROM secret_discoveries d JOIN secrets s ON s.id = d.secret_id
    WHERE d.user_id = ?
    ORDER BY d.discovered_at DESC LIMIT ?
  `).all(userId, limit);
  return rows;
}

/**
 * Surveillance roll — long-press follow yields 1d6 evidence dice. We
 * accumulate per-NPC into a per-user counter (in_memory ok for now;
 * persistent counter would need a dedicated table). Caller passes
 * targetNpcId; if the cumulative dice cross the secret's
 * discovery_difficulty, that secret auto-discovers.
 */
const _surveillanceDice = new Map(); // key=`${userId}:${npcId}` → cumulative
export function rollSurveillance(db, userId, targetNpcId, rngFn = Math.random) {
  if (!db || !userId || !targetNpcId) return { ok: false, reason: "missing_inputs" };
  const dice = 1 + Math.floor(rngFn() * 6);
  const key = `${userId}:${targetNpcId}`;
  const cur = _surveillanceDice.get(key) || 0;
  const next = cur + dice;
  _surveillanceDice.set(key, next);

  // Find the lowest-difficulty unrevealed-to-this-user secret on the target.
  const candidate = db.prepare(`
    SELECT id, discovery_difficulty FROM secrets
    WHERE holder_npc_id = ?
      AND id NOT IN (SELECT secret_id FROM secret_discoveries WHERE user_id = ?)
    ORDER BY discovery_difficulty ASC LIMIT 1
  `).get(targetNpcId, userId);

  if (candidate && next >= candidate.discovery_difficulty * 3) {
    _surveillanceDice.delete(key);
    discoverSecret(db, userId, candidate.id, "surveillance");
    return { ok: true, action: "discovered", secretId: candidate.id, dice, cumulative: next };
  }
  return { ok: true, action: "rolled", dice, cumulative: next };
}

/**
 * Inheritance auto-discovery — when an heir inherits a parent who held a
 * secret, the heir gets the secret automatically. Idempotent.
 */
export function inheritSecretsForHeir(db, deceasedNpcId, heirNpcId) {
  if (!db || !deceasedNpcId || !heirNpcId) return { ok: false, reason: "missing_inputs" };
  const secretsHeld = db.prepare(`SELECT id FROM secrets WHERE holder_npc_id = ?`).all(deceasedNpcId);
  let copied = 0;
  for (const s of secretsHeld) {
    const r = db.prepare(`
      INSERT INTO secrets (id, holder_npc_id, subject_kind, subject_id, kind, body, discovery_difficulty, synthetic)
      SELECT ?, ?, subject_kind, subject_id, kind, body, discovery_difficulty, synthetic
      FROM secrets WHERE id = ?
      ON CONFLICT(id) DO NOTHING
    `).run(`${s.id}_h_${heirNpcId.slice(0, 8)}`, heirNpcId, s.id);
    if (r.changes > 0) copied++;
  }
  return { ok: true, copied };
}

/**
 * Insert a synthetic (fabricated) secret — used by Track A4 schemes
 * (kind=fabricate_secret). Marked synthetic=1 so SecretsCodex can
 * label it as "disputed" or similar.
 */
export function insertSyntheticSecret(db, holderNpcId, subjectKind, subjectId, body, difficulty = 7) {
  const id = `sec_synth_${crypto.randomUUID().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO secrets (id, holder_npc_id, subject_kind, subject_id, kind, body, discovery_difficulty, synthetic)
    VALUES (?, ?, ?, ?, 'fabricated', ?, ?, 1)
  `).run(id, holderNpcId, subjectKind, subjectId, body, difficulty);
  return { ok: true, id };
}

/**
 * T2.1 — NPC-autonomous secret weaponisation.
 *
 * Until now `weaponiseSecret` was player-only (you burn a secret you discovered)
 * and `weaponised_at` on the holder side was dead storage. This pass lets a
 * holder NPC act on a secret it holds against an NPC subject: it opens a
 * `blackmail` scheme along the secret-edge (the secret IS the motive, so the
 * disposition gate is bypassed via proposeScheme's motive:'secret'), stamps the
 * once-marker, and emits `secret:weaponised`. "Fires once" is enforced by the
 * secrets.weaponised_holder_at column + proposeScheme's duplicate-scheme guard.
 *
 * Disposition still shapes WHO acts: only holders that are stressed/paranoid/
 * cruel OR already dislike the subject reach for the knife — a calm holder sits
 * on the secret. `findEligible` returns those holders.
 *
 * @returns { ok, weaponised: [{ secretId, holderNpcId, subjectId, schemeId }] }
 */
export function weaponiseHeldSecrets(db, { proposeScheme, io = null, worldId = null, maxPerPass = 20 } = {}) {
  if (!db || typeof proposeScheme !== "function") return { ok: false, reason: "missing_inputs" };
  // Holder NPCs with a secret against a live NPC subject, not yet weaponised by
  // the holder, where the holder has a hostile disposition toward the subject
  // (paranoid/cruel coping OR stress≥55 OR an opinion edge ≤ -40). World-scoped
  // when worldId is given.
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT s.id AS secret_id, s.holder_npc_id, s.subject_id, s.kind,
             COALESCE(st.stress, 30) AS stress, st.coping_trait,
             COALESCE(o.score, 0) AS opinion
      FROM secrets s
      JOIN world_npcs h ON h.id = s.holder_npc_id ${worldId ? "AND h.world_id = ?" : ""}
      JOIN world_npcs subj ON subj.id = s.subject_id AND COALESCE(subj.is_dead,0) = 0
      LEFT JOIN npc_stress st ON st.npc_id = s.holder_npc_id
      LEFT JOIN character_opinions o
        ON o.npc_id = s.holder_npc_id AND o.target_kind = 'npc' AND o.target_id = s.subject_id
      WHERE s.subject_kind = 'npc'
        AND s.holder_npc_id <> s.subject_id
        AND COALESCE(s.weaponised_holder_at, 0) = 0
        AND ( st.coping_trait IN ('paranoid','cruel')
              OR COALESCE(st.stress,30) >= 55
              OR COALESCE(o.score,0) <= -40 )
      LIMIT ?
    `).all(...(worldId ? [worldId, maxPerPass] : [maxPerPass]));
  } catch {
    return { ok: true, weaponised: [], reason: "schema_unavailable" };
  }

  const weaponised = [];
  for (const r of rows) {
    let schemeId = null;
    try {
      const res = proposeScheme(db, {
        plotterNpcId: r.holder_npc_id,
        targetKind: "npc",
        targetId: r.subject_id,
        kind: "blackmail",
        motive: "secret",
      });
      if (!res?.ok && res?.reason !== "duplicate_scheme") continue;
      schemeId = res.schemeId || null;
    } catch { continue; }

    try {
      db.prepare(`UPDATE secrets SET weaponised_holder_at = unixepoch() WHERE id = ?`).run(r.secret_id);
    } catch { /* column may be absent on a pre-migration build; scheme still opened */ }

    try {
      io?.to?.(worldId ? `world:${worldId}` : undefined)?.emit?.("secret:weaponised", {
        holder: r.holder_npc_id, subject_kind: "npc", subject_id: r.subject_id,
        kind: r.kind, schemeId, byNpc: true, ts: Math.floor(Date.now() / 1000),
      });
    } catch { /* socket optional */ }

    weaponised.push({ secretId: r.secret_id, holderNpcId: r.holder_npc_id, subjectId: r.subject_id, schemeId });
  }
  return { ok: true, weaponised };
}

export const SECRETS_CONSTANTS = Object.freeze({ inferKindFromText, inferSubject });
