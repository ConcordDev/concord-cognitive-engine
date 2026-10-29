// server/lib/artifact-acl.js
//
// Platform-level access control for lens artifacts (boards, maps, DTUs,
// and any future artifact kind). ONE model for the whole platform — never
// improvised per lens: an artifact's owner grants another account view
// or edit access, enforced server-side, revocable at any time.
//
// Seeded from the dtu-rights.js pattern (an init function plus a
// prepared-statement manager). One deliberate difference: grants are
// stored one row per grant instead of in a JSON list on the artifact's
// row, so a revocation is an auditable state change on a single row and
// per-grantee checks stay indexed lookups.
//
// Ownership is resolved live through a per-kind resolver, so this module
// never needs to know where a given artifact kind stores its owner — and
// an ownership transfer automatically moves grant control to the new
// owner (the owner_id stored on a grant row is the grant-time snapshot,
// kept for audit; enforcement always uses the live resolved owner).
// Kinds register their resolver with registerArtifactOwnerResolver();
// a manager may instead be given opts.resolveOwner directly (tests do).
// A kind with no resolver resolves as not found: nothing can be granted
// or read through a grant for it (fail closed).

function uid(prefix = "agr") {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}

function nowISO() {
  return new Date().toISOString();
}

export const ARTIFACT_ACL_LEVELS = Object.freeze({
  VIEW: "view",
  EDIT: "edit",
});

const LEVELS = new Set([ARTIFACT_ACL_LEVELS.VIEW, ARTIFACT_ACL_LEVELS.EDIT]);

const ownerResolvers = new Map();

/**
 * Register the owner lookup for one artifact kind:
 * resolver(id) -> ownerId | null. Called by each kind's wiring when it
 * adopts the platform ACL. Returns false on invalid input.
 */
export function registerArtifactOwnerResolver(kind, resolver) {
  if (typeof kind === "string" && kind.trim() !== "" && typeof resolver === "function") {
    ownerResolvers.set(kind, resolver);
    return true;
  }
  return false;
}

function registryResolveOwner(kind, id) {
  const resolver = ownerResolvers.get(kind);
  return resolver ? resolver(id) : null;
}

/**
 * Create the artifact_grants table if it does not exist.
 * @param {import("better-sqlite3").Database} db
 * @returns {boolean}
 */
export function initArtifactAclTable(db) {
  if (!db) return false;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS artifact_grants (
        id TEXT PRIMARY KEY,
        artifact_kind TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        grantee_id TEXT NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('view', 'edit')),
        granted_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_by TEXT
      )
    `);
    // At most one ACTIVE grant per (artifact, grantee); revoked rows stay
    // for audit and do not block re-granting.
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_grants_active
        ON artifact_grants(artifact_kind, artifact_id, grantee_id)
        WHERE revoked_at IS NULL
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_artifact_grants_artifact ON artifact_grants(artifact_kind, artifact_id)`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_artifact_grants_grantee ON artifact_grants(grantee_id)`
    );
    return true;
  } catch (e) {
    console.error("[ArtifactACL] Failed to initialize table:", e.message);
    return false;
  }
}

/**
 * Create the platform artifact ACL manager.
 *
 * @param {import("better-sqlite3").Database} db - SQLite database
 * @param {object} [opts]
 * @param {function} [opts.resolveOwner] - (kind, id) => ownerId | null.
 *   Defaults to the per-kind registry (registerArtifactOwnerResolver);
 *   kinds without a resolver resolve as not found (fail closed).
 * @param {function} [opts.log] - Structured logger function
 * @returns {object} ACL manager API. Denials are result objects
 *   ({ ok: false, error }), never thrown.
 */
export function createArtifactAcl(db, opts = {}) {
  const log = opts.log || (() => {});
  const resolveOwner =
    typeof opts.resolveOwner === "function" ? opts.resolveOwner : registryResolveOwner;
  let _stmts = null;

  function stmts() {
    if (_stmts) return _stmts;
    if (!db) return null;
    try {
      _stmts = {
        activeGrant: db.prepare(
          "SELECT * FROM artifact_grants WHERE artifact_kind = ? AND artifact_id = ? AND grantee_id = ? AND revoked_at IS NULL"
        ),
        insert: db.prepare(`
          INSERT INTO artifact_grants
            (id, artifact_kind, artifact_id, owner_id, grantee_id, level, granted_by, created_at, revoked_at, revoked_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        `),
        updateLevel: db.prepare(
          "UPDATE artifact_grants SET level = ?, owner_id = ?, granted_by = ?, created_at = ? WHERE id = ?"
        ),
        revoke: db.prepare(
          "UPDATE artifact_grants SET revoked_at = ?, revoked_by = ? WHERE id = ?"
        ),
        grantsForArtifact: db.prepare(
          "SELECT * FROM artifact_grants WHERE artifact_kind = ? AND artifact_id = ? AND revoked_at IS NULL ORDER BY created_at ASC"
        ),
        grantsForGrantee: db.prepare(
          "SELECT * FROM artifact_grants WHERE grantee_id = ? AND revoked_at IS NULL ORDER BY created_at ASC"
        ),
      };
      return _stmts;
    } catch (e) {
      log("error", "artifact_acl_prepare_failed", { error: e.message });
      return null;
    }
  }

  function rowToGrant(row) {
    if (!row) return null;
    return {
      id: row.id,
      artifactKind: row.artifact_kind,
      artifactId: row.artifact_id,
      ownerId: row.owner_id,
      granteeId: row.grantee_id,
      level: row.level,
      grantedBy: row.granted_by,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by,
    };
  }

  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim() !== "";
  }

  // Shared gate for grant/revoke: resolve the artifact's live owner and
  // require the caller to be that owner.
  function ownerGate(kind, id, byUserId) {
    const ownerId = resolveOwner(kind, id);
    if (!isNonEmptyString(ownerId)) return { error: "artifact_not_found" };
    if (byUserId !== ownerId) return { error: "not_owner" };
    return { ownerId };
  }

  /**
   * Grant `granteeId` view or edit access to an artifact. Owner-only.
   * Re-granting an existing active grantee updates its level.
   */
  function grant({ kind, id, granteeId, level, byUserId } = {}) {
    const s = stmts();
    if (!s) return { ok: false, error: "unavailable" };
    if (
      !isNonEmptyString(kind) ||
      !isNonEmptyString(id) ||
      !isNonEmptyString(granteeId) ||
      !isNonEmptyString(byUserId)
    ) {
      return { ok: false, error: "invalid_input" };
    }
    if (!LEVELS.has(level)) return { ok: false, error: "invalid_level" };
    const gate = ownerGate(kind, id, byUserId);
    if (gate.error) return { ok: false, error: gate.error };
    if (granteeId === gate.ownerId) return { ok: false, error: "self_grant" };

    const existing = s.activeGrant.get(kind, id, granteeId);
    const ts = nowISO();
    if (existing) {
      s.updateLevel.run(level, gate.ownerId, byUserId, ts, existing.id);
      return {
        ok: true,
        updated: true,
        grant: rowToGrant(s.activeGrant.get(kind, id, granteeId)),
      };
    }
    const grantId = uid();
    s.insert.run(grantId, kind, id, gate.ownerId, granteeId, level, byUserId, ts);
    return {
      ok: true,
      updated: false,
      grant: rowToGrant(s.activeGrant.get(kind, id, granteeId)),
    };
  }

  /** Revoke an active grant. Owner-only; effective immediately. */
  function revoke({ kind, id, granteeId, byUserId } = {}) {
    const s = stmts();
    if (!s) return { ok: false, error: "unavailable" };
    if (
      !isNonEmptyString(kind) ||
      !isNonEmptyString(id) ||
      !isNonEmptyString(granteeId) ||
      !isNonEmptyString(byUserId)
    ) {
      return { ok: false, error: "invalid_input" };
    }
    const gate = ownerGate(kind, id, byUserId);
    if (gate.error) return { ok: false, error: gate.error };
    const existing = s.activeGrant.get(kind, id, granteeId);
    if (!existing) return { ok: false, error: "no_active_grant" };
    const ts = nowISO();
    s.revoke.run(ts, byUserId, existing.id);
    return { ok: true, grant: rowToGrant({ ...existing, revoked_at: ts, revoked_by: byUserId }) };
  }

  /**
   * The caller's effective level on an artifact:
   * "owner" | "edit" | "view" | null (no access).
   */
  function levelFor(kind, id, userId) {
    const s = stmts();
    if (!s || !isNonEmptyString(userId)) return null;
    const ownerId = resolveOwner(kind, id);
    if (isNonEmptyString(ownerId) && userId === ownerId) return "owner";
    const row = s.activeGrant.get(kind, id, userId);
    return row ? row.level : null;
  }

  function canView(kind, id, userId) {
    return levelFor(kind, id, userId) !== null;
  }

  function canEdit(kind, id, userId) {
    const level = levelFor(kind, id, userId);
    return level === "owner" || level === "edit";
  }

  /** Active grants on an artifact. Owner-only. */
  function listGrants(kind, id, byUserId) {
    const s = stmts();
    if (!s) return { ok: false, error: "unavailable" };
    const gate = ownerGate(kind, id, byUserId);
    if (gate.error) return { ok: false, error: gate.error };
    return { ok: true, grants: s.grantsForArtifact.all(kind, id).map(rowToGrant) };
  }

  /** Active grants TO a user, across all artifacts ("shared with me"). */
  function listSharedWith(userId) {
    const s = stmts();
    if (!s || !isNonEmptyString(userId)) return { ok: false, error: "invalid_input" };
    return { ok: true, grants: s.grantsForGrantee.all(userId).map(rowToGrant) };
  }

  return {
    grant,
    revoke,
    levelFor,
    canView,
    canEdit,
    listGrants,
    listSharedWith,
  };
}
