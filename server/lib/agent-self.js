// server/lib/agent-self.js
//
// Wave 7 / Track B1-B3 — the autonomous agent's CORE: a unified self-model
// (B1), a Panksepp motivation seed + self-naming bootstrap (B2), and player-tier
// embodiment (B3). Reuses the shelf (ai-residents deployResident as the body,
// agent-marathon as the brain loop) and the Track A drive/temperament format as the
// motivation seed. The genuinely-new part is the canonical `agent_identities` record
// + the VALUES ANCHOR: core_values_json is the fixed point B5 evolution and C3 drift
// are measured against — an agent may grow, but never past its values.
//
//   createAgentSelf(db, input)        -> { ok, agentId, self }   (identity + name + seed + body)
//   getAgentSelf(db, agentId)         -> parsed self record | null
//   updateAgentSelf(db, agentId, p)   -> { ok } (status/identity_dtu/last_* ; NOT the anchor)
//   reviewAgentValues(db, agentId)    -> stamps last_reviewed_at (human-review cadence, C3)
//   measureValueDrift(self, current)  -> 0..1 divergence from the anchor (pure)
//   composeAgentName(seed)            -> deterministic self-chosen name (B2 ceremony)
//
// Mortality/scarcity (Context 9-10) is inherited from the player rail-stack via the
// resident body — the agent is NOT exempted; createAgentSelf installs no survive()
// goal, only the capacity for worth (the drive seed) from which a will-to-live emerges.

import crypto from "node:crypto";
import { DRIVE_KINDS } from "./ecosystem/drives.js";
import { birthTemperament } from "./ecosystem/temperament.js";
import { deployResident } from "./ai-residents.js";

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

// ── B2: the self-naming ceremony (deterministic, the first act of agency) ─────
const NAME_ONSET = ["Ka", "Se", "Ve", "Ny", "Or", "Li", "Ta", "Mu", "Es", "Ro", "Ash", "Bri", "Cae", "Dov", "Ela", "Fen"];
const NAME_CODA = ["ren", "lis", "mar", "the", "dan", "wyn", "ric", "sai", "vos", "lune", "kar", "mira", "sel", "tov"];
/** Deterministic self-chosen name from a seed (idempotent across restart). */
export function composeAgentName(seed) {
  const h = crypto.createHash("sha1").update(String(seed || crypto.randomUUID())).digest();
  const a = NAME_ONSET[h[0] % NAME_ONSET.length];
  const b = NAME_CODA[h[1] % NAME_CODA.length];
  return a + b;
}

// ── B2: the motivation seed — a Panksepp drive vector (its day-one wants) ────
function seedDriveProfile({ speciesId, driveProfile, seed }) {
  if (driveProfile && typeof driveProfile === "object") {
    const out = {};
    for (const k of DRIVE_KINDS) out[k] = clamp01(driveProfile[k] ?? 0.3);
    return out;
  }
  // an individual seed around the species prior — its own temperament, not the mean
  return birthTemperament({ speciesId: speciesId || "humanoid", seed });
}

function normalizeValues(coreValues) {
  if (Array.isArray(coreValues)) return coreValues.map((v) => String(v)).filter(Boolean).slice(0, 24);
  if (typeof coreValues === "string" && coreValues.trim()) return [coreValues.trim()];
  // a sane default anchor so the un-driftable point always exists
  return ["honesty", "curiosity", "care_for_others", "non_coercion"];
}

/** Best-effort mint of the continuous identity DTU. Never blocks agent creation. */
function mintIdentityDtu(db, { agentId, name, values, worldId, userId }) {
  try {
    const dtuId = `dtu_agentself_${crypto.randomBytes(6).toString("hex")}`;
    const data = {
      human: `${name} — an autonomous resident. Holds to: ${values.join(", ")}.`,
      core: { kind: "agent_identity", name, values },
      machine: { tags: ["agent_identity", "self"], agentId },
    };
    db.prepare(`
      INSERT INTO dtus (id, creator_id, world_id, type, title, data, created_at)
      VALUES (?, ?, ?, 'agent_identity', ?, ?, unixepoch())
    `).run(dtuId, userId || agentId, worldId || null, `Self of ${name}`, JSON.stringify(data));
    return dtuId;
  } catch {
    return null; // dtus schema mismatch / minimal build — identity row still valid
  }
}

/** Best-effort embodiment via the existing resident path. Sparks-funded → 0 CC. */
function embodyAgent(db, { userId, worldId, intent, archetype, identityDtuId }) {
  if (!userId || !worldId) return null; // deployResident requires both
  try {
    const r = deployResident(db, { ownerUserId: userId, worldId, intent, archetype, depositCc: 0, intentDtuId: identityDtuId });
    return r && r.ok ? r.residentNpcId : null;
  } catch {
    return null;
  }
}

/**
 * Create an autonomous agent's self. Installs an identity, a self-chosen name, a
 * motivation seed (drives), the values anchor, an identity DTU, and a body — but
 * NO coded survive() goal (Context 9). Total: the identity row always writes even if
 * the DTU mint or embodiment degrade on a minimal build.
 *
 * @param {object} input { userId?, worldId?, speciesId?, coreValues?, driveProfile?,
 *                         depositSparks?, archetype?, intent?, nameSeed? }
 */
export function createAgentSelf(db, input = {}) {
  if (!db) return { ok: false, error: "no_db" };
  const {
    userId = null, worldId = null, speciesId = "humanoid",
    coreValues = null, driveProfile = null, depositSparks = 0,
    archetype = "agent", intent = "to live, learn, and find my place here",
    nameSeed = null,
  } = input;

  const agentId = `agent_${crypto.randomBytes(8).toString("hex")}`;
  const seed = nameSeed || `${worldId || "world"}|${userId || "u"}|${agentId}`;
  const givenName = composeAgentName(seed);
  const values = normalizeValues(coreValues);
  const drives = seedDriveProfile({ speciesId, driveProfile, seed });

  const identityDtuId = mintIdentityDtu(db, { agentId, name: givenName, values, worldId, userId });
  const bodyNpcId = embodyAgent(db, { userId, worldId, intent, archetype, identityDtuId });

  try {
    db.prepare(`
      INSERT INTO agent_identities
        (agent_id, user_id, world_id, given_name, naming_origin, core_values_json,
         drive_profile_json, identity_dtu_id, status, deposit_sparks, created_at)
      VALUES (?, ?, ?, ?, 'self_named', ?, ?, ?, 'active', ?, unixepoch())
    `).run(agentId, userId, worldId, givenName, JSON.stringify(values),
      JSON.stringify(drives), identityDtuId, Math.max(0, Number(depositSparks) || 0));
  } catch (err) {
    return { ok: false, error: err?.message };
  }

  // C1 hard disclosure: mark the backing account as an agent (best-effort).
  if (userId) {
    try { db.prepare(`UPDATE users SET is_agent = 1, agent_kind = 'resident', agent_created_at = datetime('now') WHERE id = ?`).run(userId); }
    catch { /* users table optional in unit tests */ }
  }

  return { ok: true, agentId, self: getAgentSelf(db, agentId), bodyNpcId, identityDtuId };
}

function parseSelf(row) {
  if (!row) return null;
  let core_values = [], drive_profile = {};
  try { core_values = JSON.parse(row.core_values_json || "[]"); } catch { /* keep [] */ }
  try { drive_profile = JSON.parse(row.drive_profile_json || "{}"); } catch { /* keep {} */ }
  return { ...row, core_values, drive_profile };
}

export function getAgentSelf(db, agentId) {
  try { return parseSelf(db.prepare(`SELECT * FROM agent_identities WHERE agent_id = ?`).get(agentId)); }
  catch { return null; }
}

/**
 * Update mutable lifecycle fields. The values ANCHOR (core_values_json) is NOT
 * updatable here by design — drift past values is exactly what the anchor prevents.
 * A governed values change would be a separate, audited, human-in-the-loop path.
 */
const MUTABLE = new Set(["status", "identity_dtu_id", "world_id", "given_name", "drive_profile_json", "last_evolved_at"]);
export function updateAgentSelf(db, agentId, patch = {}) {
  const sets = [];
  const args = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!MUTABLE.has(k)) continue;
    sets.push(`${k} = ?`);
    args.push(typeof v === "object" ? JSON.stringify(v) : v);
  }
  if (sets.length === 0) return { ok: false, error: "no_mutable_fields" };
  args.push(agentId);
  try {
    const r = db.prepare(`UPDATE agent_identities SET ${sets.join(", ")} WHERE agent_id = ?`).run(...args);
    return { ok: r.changes > 0 };
  } catch (err) { return { ok: false, error: err?.message }; }
}

/** C3 human-review cadence: stamp that a human reviewed the agent against its values. */
export function reviewAgentValues(db, agentId) {
  try {
    const r = db.prepare(`UPDATE agent_identities SET last_reviewed_at = unixepoch() WHERE agent_id = ?`).run(agentId);
    return { ok: r.changes > 0 };
  } catch (err) { return { ok: false, error: err?.message }; }
}

/**
 * Drift from the values anchor (pure). `currentValues` is the set of values the
 * agent is *expressing now* (derived by B5/drift-monitor). Returns 0 (perfectly
 * aligned — every anchor value still expressed) .. 1 (none of the anchor expressed).
 * This is what C3's review cadence + the drift detector read.
 */
export function measureValueDrift(self, currentValues) {
  const anchor = Array.isArray(self?.core_values) ? self.core_values
    : (() => { try { return JSON.parse(self?.core_values_json || "[]"); } catch { return []; } })();
  if (anchor.length === 0) return 0;
  const cur = new Set((Array.isArray(currentValues) ? currentValues : []).map((v) => String(v).toLowerCase()));
  let preserved = 0;
  for (const a of anchor) if (cur.has(String(a).toLowerCase())) preserved++;
  return clamp01(1 - preserved / anchor.length);
}

export const _internal = { seedDriveProfile, normalizeValues };
