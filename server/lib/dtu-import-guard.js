/**
 * SECURITY (import ownership guard): the import.json / import.markdown
 * macros used to write DTUs with zero ownership semantics — any signed-in
 * member could overwrite ANY existing DTU by id (no ownership check), set
 * tier/visibility from caller input, and every newly imported DTU landed
 * with no ownerId (ownerless rows are later normalized to system/internal).
 *
 * This module keeps the per-DTU decision pure (no store access) so it can be
 * unit-tested without booting the server:
 *   - importAuthDenial: request-level anonymous gate for secured modes.
 *   - dtuImportDecision: per-DTU write/skip/deny + ownership-stamped DTU.
 *   - stampImportedDtu: ownership stamp for markdown-imported DTUs.
 */

import { dtuMutationDenial, resolveDtuActor } from "./dtu-ownership.js";

const AUTH_REQUIRED_DENIAL = Object.freeze({
  status: 401,
  code: "AUTH_REQUIRED",
  error: "Authentication required",
});

/** Ownership-spoofing keys that never survive from caller-supplied meta. */
const META_OWNERSHIP_KEYS = new Set([
  "ownerId",
  "author",
  "authorId",
  "createdBy",
  "createdByUser",
  "userId",
]);

/** Only visibilities a non-admin import may request from input. */
const INPUT_VISIBILITIES = new Set(["private", "public"]);

const _normalizeText = (s = "") => String(s).replace(/\s+/g, " ").trim();
const _nowISO = () => new Date().toISOString();

function stripOwnershipMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (META_OWNERSHIP_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Request-level gate: anonymous callers may not import anything in a
 * secured auth mode. AUTH_MODE=public keeps the local-first exception.
 *
 * @returns {null | { status: number, code: string, error: string }}
 */
export function importAuthDenial(ctx, authMode) {
  if (authMode === "public") return null;
  return resolveDtuActor(ctx).anonymous ? AUTH_REQUIRED_DENIAL : null;
}

/**
 * Pure per-DTU decision for import.json.
 *
 * @param {object|null} existing - the DTU already stored under incoming.id
 * @param {object} incoming - the caller-supplied DTU payload
 * @param {object} ctx - macro ctx (actor)
 * @param {*} overwrite - truthy when the caller asked to overwrite
 * @param {string} authMode - resolved AUTH_MODE
 * @returns {{ action: "write"|"skip"|"deny", dtu: object|null, denial?: object }}
 */
export function dtuImportDecision({
  existing,
  incoming,
  ctx,
  overwrite,
  authMode,
  normalizeText,
  nowISO,
}) {
  if (!incoming || typeof incoming !== "object" || !incoming.id || !incoming.title) {
    return { action: "skip", dtu: null };
  }
  if (existing && !overwrite) return { action: "skip", dtu: null };

  const actor = resolveDtuActor(ctx);
  const secured = authMode !== "public";

  // Defense in depth: the handler rejects anonymous callers up front; if one
  // still reaches here in a secured mode, nothing may be written.
  if (secured && actor.anonymous) {
    return { action: "deny", dtu: null, denial: AUTH_REQUIRED_DENIAL };
  }

  if (existing && overwrite) {
    const denial = dtuMutationDenial(existing, ctx, { authMode, verb: "update" });
    if (denial) return { action: "deny", dtu: null, denial };
  }

  const text = typeof normalizeText === "function" ? normalizeText : _normalizeText;
  const now = typeof nowISO === "function" ? nowISO : _nowISO;

  const normalized = {
    id: incoming.id,
    title: text(incoming.title),
    tier: incoming.tier || "regular",
    tags: Array.isArray(incoming.tags) ? incoming.tags : [],
    human: incoming.human || {},
    core: incoming.core || {},
    machine: incoming.machine || {},
    lineage: incoming.lineage || [],
    source: "import",
    createdAt: incoming.createdAt || now(),
    updatedAt: now(),
    meta: { ...stripOwnershipMeta(incoming.meta), importedAt: now() },
  };

  // Admin callers and AUTH_MODE=public keep the historical behavior; only
  // the meta stripping above applies to everyone.
  if (!secured || actor.isAdmin) return { action: "write", dtu: normalized };

  if (existing) {
    // Overwriting one's own DTU must not re-assign ownership or tier. Carry
    // every ownership field the existing row uses (some rows are owned via
    // author/createdBy, not ownerId) so the overwrite never goes ownerless;
    // dtuMutationDenial above already proved the caller is that owner.
    for (const key of META_OWNERSHIP_KEYS) {
      if (existing[key] != null) normalized[key] = existing[key];
    }
    if (!normalized.ownerId) normalized.ownerId = actor.userId;
    normalized.tier = existing.tier;
    normalized.visibility = INPUT_VISIBILITIES.has(incoming.visibility)
      ? incoming.visibility
      : existing.visibility;
    if (existing.creatorType) normalized.creatorType = existing.creatorType;
  } else {
    // Newly imported DTUs are owned by the importer: server-stamped
    // ownership, private by default, tier never caller-controlled.
    normalized.ownerId = actor.userId;
    normalized.creatorType = "user";
    normalized.visibility = incoming.visibility === "public" ? "public" : "private";
    normalized.tier = "regular";
  }

  return { action: "write", dtu: normalized };
}

/**
 * Stamp ownership on a DTU created by import.markdown (fresh ids, no
 * overwrite path). Non-admins in secured modes get server-stamped
 * ownership; admins and AUTH_MODE=public keep the historical behavior.
 * Mutates and returns `dtu`.
 */
export function stampImportedDtu(dtu, ctx, authMode) {
  const actor = resolveDtuActor(ctx);
  if (authMode === "public" || actor.anonymous || actor.isAdmin) return dtu;
  dtu.ownerId = actor.userId;
  dtu.creatorType = "user";
  dtu.visibility = "private";
  return dtu;
}