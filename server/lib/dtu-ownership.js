/**
 * DTU custody: who may edit an ownerless/system DTU, and how boot
 * normalization stamps owner + visibility so the write-through store
 * (memory cache AND `dtu_store`) actually keeps it.
 *
 * The boot loop in server.js used to mutate the cached object in place and
 * call saveStateDebounced(). Once STATE.dtus is the write-through store,
 * snapshots omit DTUs and only store.set() writes `dtu_store`. The mutation
 * evaporated on the next rehydrate — which is why `dtu_oracle_*` rows
 * (type oracle_answer, created with no owner and no visibility) came back
 * ownerless after a restart. Readers that use the SQLite visibility columns
 * (including the DTU sidecar) never saw the in-memory stamp.
 *
 * Public system content is not forced to `internal`: news-feed items, system
 * summaries, and the genesis/seed corpus stay public. An explicit
 * public/marketplace/published visibility is also left alone. Everything
 * else that still has no ownerId — including oracle_answer — becomes
 * system-owned and internal.
 */

import { logAudit } from "./audit-logger.js";
import { ctxMayReadDtu } from "./dtu-read-access.js";

const AUTH_MODE_VALUES = new Set(["public", "apikey", "jwt", "hybrid"]);

/** Platform roles that may edit ownerless/system DTUs and run custody. */
export const DTU_ADMIN_ROLES = new Set(["owner", "admin", "founder", "sovereign"]);

/** ownerId values that mean "the platform", not a user account. */
const SYSTEM_OWNER_IDS = new Set(["system", "concord_system", "oracle_system"]);

const PUBLIC_VISIBILITIES = new Set(["public", "marketplace", "published"]);
const CLOSED_VISIBILITIES = new Set(["private", "internal"]);
const ASSIGNABLE_VISIBILITIES = new Set(["private", "internal", "public", "marketplace"]);

const PUBLIC_SUMMARY_KINDS = new Set([
  "system_summary",
  "public_summary",
  "system_digest",
  "digest",
  "system_briefing",
  "briefing",
]);

/**
 * Same fallback the server uses when AUTH_MODE is unset: legacy
 * AUTH_ENABLED defaults to hybrid, so secured deploys enforce the gate.
 * AUTH_MODE=public is the local-first exception (solo installs).
 */
export function resolveAuthMode(explicit) {
  if (explicit && AUTH_MODE_VALUES.has(explicit)) return explicit;
  const raw = String(process.env.AUTH_MODE || "").toLowerCase().trim();
  if (AUTH_MODE_VALUES.has(raw)) return raw;
  if (raw) return "hybrid";
  const legacy = String(process.env.AUTH_ENABLED || "true").toLowerCase() === "true";
  return legacy ? "hybrid" : "public";
}

export function resolveDtuActor(ctx) {
  const userId = ctx?.actor?.userId || ctx?.actor?.id || ctx?.actor?.odId || null;
  const role = ctx?.actor?.role || "guest";
  const anonymous = userId == null || userId === "" || userId === "anon";
  return {
    userId: anonymous ? null : String(userId),
    role,
    anonymous,
    isAdmin: DTU_ADMIN_ROLES.has(role),
  };
}

/**
 * Same owner order as `privateDtuHiddenFrom` (author, then ownerId). A
 * custody write sets ownerId, which is what an author-less row honors.
 */
export function dtuCustodyOwner(dtu) {
  if (!dtu || typeof dtu !== "object") return null;
  if (typeof dtu.author === "string" && dtu.author) return dtu.author;
  if (typeof dtu.ownerId === "string" && dtu.ownerId) return dtu.ownerId;
  if (typeof dtu.userId === "string" && dtu.userId) return dtu.userId;
  if (typeof dtu.createdBy === "string" && dtu.createdBy) return dtu.createdBy;
  return null;
}

function stringField(v) {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * A real user account stamped on the DTU. System sentinels and "anon" do
 * not count — those rows are still ownerless for the edit gate.
 */
export function concreteUserOwner(dtu) {
  if (!dtu || typeof dtu !== "object") return null;
  const fields = [dtu.ownerId, dtu.createdBy, dtu.createdByUser, dtu.authorId, dtu.author, dtu.userId];
  for (const field of fields) {
    const v = stringField(field);
    if (!v || v === "anon" || SYSTEM_OWNER_IDS.has(v)) continue;
    return v;
  }
  return null;
}

export function isSystemOrOwnerless(dtu) {
  return !concreteUserOwner(dtu);
}

function dtuTypeKind(dtu) {
  return stringField(dtu?.type || dtu?.kind || dtu?.machine?.kind).toLowerCase();
}

function dtuTags(dtu) {
  if (!Array.isArray(dtu?.tags)) return [];
  return dtu.tags.map((t) => String(t).toLowerCase());
}

/** oracle_answer rows are the leak this pass closes. They are never "public system content". */
export function isOracleAnswerDtu(dtu) {
  if (!dtu || typeof dtu !== "object") return false;
  if (dtuTypeKind(dtu) === "oracle_answer") return true;
  if (typeof dtu.id === "string" && dtu.id.startsWith("dtu_oracle_")) return true;
  return dtuTags(dtu).includes("oracle_answer");
}

/**
 * News-feed items, system summaries, and the genesis/seed corpus.
 * Only consulted when visibility was never set. An explicit private or
 * internal stamp is left alone by the caller.
 */
export function isNamedPublicSystemContent(dtu) {
  if (!dtu || typeof dtu !== "object") return false;
  if (isOracleAnswerDtu(dtu)) return false;

  const type = dtuTypeKind(dtu);
  const source = stringField(dtu.source).toLowerCase();
  const tags = dtuTags(dtu);
  const provenance = stringField(dtu.provenance?.source).toLowerCase();

  if (dtu.seedOrigin === true || type === "genesis" || dtu.kind === "genesis") return true;
  if (typeof dtu.id === "string" && (dtu.id.startsWith("genesis_") || dtu.id === "dtu_root_fixed_point")) return true;
  if (source === "concord_brain_index" || source === "seed" || source === "bootstrap_ingestion") return true;
  if (provenance === "bootstrap_ingestion") return true;

  if (type === "news" || type.startsWith("news:") || type === "feed_item" || type === "news_feed" || type === "rss") return true;
  if (source.startsWith("rss:") || source.startsWith("hn:") || source.startsWith("wikipedia:") || source.startsWith("feed:")) return true;
  if (tags.includes("news") || tags.includes("news-feed") || tags.includes("news_feed") || tags.includes("feed_item")) return true;

  if (PUBLIC_SUMMARY_KINDS.has(type) || PUBLIC_SUMMARY_KINDS.has(source)) return true;
  if (tags.includes("system_summary") || tags.includes("system-summary")) return true;
  if (dtu.meta?.systemSummary === true || dtu.meta?.publicSummary === true) return true;

  return false;
}

/**
 * True when boot normalization must not force visibility to internal.
 * Explicit public/marketplace/published wins. Explicit private/internal
 * stays closed. Unset visibility falls through to the named public corpus.
 */
export function isLegitimatePublicSystemDtu(dtu) {
  if (!dtu || typeof dtu !== "object") return false;
  const vis = stringField(dtu.visibility);
  if (PUBLIC_VISIBILITIES.has(vis)) return true;
  if (CLOSED_VISIBILITIES.has(vis)) return false;
  if (isOracleAnswerDtu(dtu)) return false;
  return isNamedPublicSystemContent(dtu);
}

function isLegacyUserContent(dtu) {
  return dtu.creatorType === "user"
    || dtu.creatorType === "user_uploaded_text"
    || dtu.source === "local";
}

/**
 * Stamp one ownerless DTU. Mutates `dtu` when a change is required.
 * Does not persist — callers that need the row to survive a restart must
 * store.set() the result.
 *
 * @returns {{ dtu: object, changed: boolean, disposition: "unchanged"|"user"|"public_system"|"system_internal" }}
 */
export function applyOwnerlessNormalization(dtu) {
  if (!dtu || typeof dtu !== "object") {
    return { dtu, changed: false, disposition: "unchanged" };
  }
  if (dtu.ownerId) {
    return { dtu, changed: false, disposition: "unchanged" };
  }

  if (isLegacyUserContent(dtu)) {
    dtu.ownerId = "founder";
    if (!dtu.visibility) dtu.visibility = "private";
    if (!dtu.creatorType) dtu.creatorType = "user";
    return { dtu, changed: true, disposition: "user" };
  }

  dtu.ownerId = "system";
  if (!dtu.creatorType) dtu.creatorType = "system";

  if (isLegitimatePublicSystemDtu(dtu)) {
    if (!dtu.visibility) dtu.visibility = "public";
    return { dtu, changed: true, disposition: "public_system" };
  }

  dtu.visibility = "internal";
  return { dtu, changed: true, disposition: "system_internal" };
}

/**
 * Walk a Map-like DTU store and persist every stamp through store.set()
 * so write-through SQLite (data JSON + owner_user_id + visibility columns)
 * matches memory. Idempotent: a second pass migrates 0.
 */
export function normalizeOwnerlessDtus(store) {
  const empty = { migrated: 0, publicKept: 0, internalized: 0, userStamped: 0, skipped: 0, errors: 0 };
  if (!store || (typeof store.entries !== "function" && typeof store.values !== "function")) {
    return empty;
  }
  const entries = typeof store.entries === "function"
    ? Array.from(store.entries())
    : Array.from(store.values()).map((dtu) => [dtu?.id, dtu]);

  let migrated = 0;
  let publicKept = 0;
  let internalized = 0;
  let userStamped = 0;
  let skipped = 0;
  let errors = 0;

  for (const [id, dtu] of entries) {
    let result;
    try {
      result = applyOwnerlessNormalization(dtu);
    } catch {
      errors++;
      continue;
    }
    if (!result.changed) {
      skipped++;
      continue;
    }
    const key = id || result.dtu?.id;
    try {
      if (key && typeof store.set === "function") store.set(key, result.dtu);
    } catch {
      errors++;
      continue;
    }
    migrated++;
    if (result.disposition === "public_system") publicKept++;
    else if (result.disposition === "system_internal") internalized++;
    else if (result.disposition === "user") userStamped++;
  }

  return { migrated, publicKept, internalized, userStamped, skipped, errors };
}

/**
 * Secured modes: anonymous → 401, a non-admin on an ownerless/system DTU
 * or on someone else's DTU → 403, the owner or an admin → allowed.
 * AUTH_MODE=public keeps the local-first exception (the solo user is anon
 * and must still be able to edit their own notebook). Production refuses
 * AUTH_MODE=public.
 *
 * @returns {null | { status: number, code: string, error: string }}
 */
export function dtuMutationDenial(dtu, ctx, opts = {}) {
  const authMode = resolveAuthMode(opts.authMode);
  if (authMode === "public") return null;

  const actor = resolveDtuActor(ctx);
  if (actor.anonymous) {
    return { status: 401, code: "AUTH_REQUIRED", error: "Authentication required" };
  }
  if (actor.isAdmin) return null;

  const verb = opts.verb === "delete" ? "delete" : "update";
  if (isSystemOrOwnerless(dtu)) {
    return {
      status: 403,
      code: "FORBIDDEN",
      error: `unauthorized: ownerless and system DTUs can only be ${verb}d by an admin`,
    };
  }
  if (concreteUserOwner(dtu) !== actor.userId) {
    return {
      status: 403,
      code: "FORBIDDEN",
      error: `unauthorized: you can only ${verb} your own DTUs`,
    };
  }
  return null;
}

/**
 * Same predicate as by-id reads. Internal is hidden from HTTP callers.
 * Private and user-scoped rows are visible only to the owner. The
 * anonymous placeholder "anon" is not a viewer.
 */
export function viewerCanReadDtu(dtu, viewerId) {
  const id = !viewerId || viewerId === "anon" ? null : String(viewerId);
  return ctxMayReadDtu(id ? { actor: { id } } : {}, dtu);
}

function normalizeIdList(ids) {
  if (!Array.isArray(ids)) return { error: "ids must be an array" };
  const out = [];
  const seen = new Set();
  for (const raw of ids) {
    if (typeof raw !== "string") return { error: "ids must be strings" };
    const id = raw.trim();
    if (!id || id.length > 200) return { error: "invalid DTU id" };
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length > 200) return { error: "too many ids (max 200)" };
  }
  if (out.length === 0) return { error: "ids required" };
  return { ids: out };
}

/**
 * Admin-only custody write. Sets visibility and/or ownerId on existing DTUs
 * and persists each one through `opts.persist` (the normal DTU write path —
 * upsertDTU → STATE.dtus.set → dtu_store). dryRun reports the diff and
 * does not call persist. Authorized calls are audit-logged, including dry runs.
 */
export function assignDtuCustody(store, input = {}, ctx, opts = {}) {
  const actor = resolveDtuActor(ctx);
  if (actor.anonymous) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Authentication required" };
  }
  if (!actor.isAdmin) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "Insufficient permissions" };
  }
  if (!store || typeof store.get !== "function") {
    return { ok: false, status: 500, code: "NO_STORE", error: "DTU store unavailable" };
  }

  const idCheck = normalizeIdList(input.ids);
  if (idCheck.error) {
    return { ok: false, status: 400, code: "VALIDATION_ERROR", error: idCheck.error };
  }

  const dryRun = input.dryRun === true || input.dryRun === "true" || input.dryRun === 1;
  const hasVisibility = input.visibility !== undefined && input.visibility !== null;
  const hasOwner = input.owner !== undefined && input.owner !== null;
  if (!hasVisibility && !hasOwner) {
    return { ok: false, status: 400, code: "VALIDATION_ERROR", error: "visibility or owner required" };
  }

  let visibility = null;
  if (hasVisibility) {
    visibility = String(input.visibility);
    if (!ASSIGNABLE_VISIBILITIES.has(visibility)) {
      return { ok: false, status: 400, code: "VALIDATION_ERROR", error: "invalid visibility" };
    }
  }

  let owner = null;
  if (hasOwner) {
    owner = String(input.owner).trim();
    if (!owner || owner.length > 200 || owner === "anon") {
      return { ok: false, status: 400, code: "VALIDATION_ERROR", error: "invalid owner" };
    }
  }

  const persist = typeof opts.persist === "function" ? opts.persist : null;
  const results = [];
  const now = new Date().toISOString();

  for (const id of idCheck.ids) {
    const existing = store.get(id);
    if (!existing) {
      results.push({ id, ok: false, error: "not_found" });
      continue;
    }
    const before = { ownerId: existing.ownerId || null, visibility: existing.visibility || null };
    const after = {
      ownerId: owner || existing.ownerId || null,
      visibility: visibility || existing.visibility || null,
    };
    if (dryRun) {
      results.push({ id, ok: true, dryRun: true, before, after });
      continue;
    }
    const updated = { ...existing, updatedAt: now };
    if (owner) updated.ownerId = owner;
    if (visibility) updated.visibility = visibility;
    if (persist) persist(updated);
    else if (typeof store.set === "function") store.set(id, updated);
    results.push({ id, ok: true, before, after });
  }

  const action = dryRun ? "dtu.assignCustody.dry_run" : "dtu.assignCustody";
  try {
    logAudit(actor.userId, action, idCheck.ids.join(","), {
      visibility,
      owner,
      dryRun,
      count: idCheck.ids.length,
      updated: results.filter((r) => r.ok).length,
    });
  } catch { /* audit must not fail the custody write */ }

  return {
    ok: true,
    dryRun,
    visibility,
    owner,
    results,
    updated: results.filter((r) => r.ok).length,
  };
}
