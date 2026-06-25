// server/lib/license-revocation.js
//
// Licensed DTU Vaults — revocation (#37). Additive layer over the existing
// creative_usage_licenses grants (mig 014 + 344). A creator can revoke a usage
// license they granted (the licensee no longer has the right to use the
// artifact), with an auditable reason; `licenseIsActive` is the access-check
// helper callers consult to honour revocation/expiry. No royalty math is
// touched — revocation withdraws a USAGE RIGHT, it does not claw back a payment
// (refunds, if any, flow through the existing wallet paths). Pure, bounded
// queries; every helper is guarded and returns a plain object.

function nowISO() { return new Date().toISOString(); }

/**
 * Revoke a usage license. Only the artifact's creator may revoke. Idempotent:
 * revoking an already-revoked license returns { ok, alreadyRevoked:true }.
 * @returns {{ok, reason?, alreadyRevoked?}}
 */
export function revokeLicense(db, { licenseId, creatorId, reason = "" } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!licenseId || !creatorId) return { ok: false, reason: "missing_license_or_creator" };
  const lic = db.prepare(`SELECT id, artifact_id, status FROM creative_usage_licenses WHERE id = ?`).get(licenseId);
  if (!lic) return { ok: false, reason: "license_not_found" };
  // Ownership gate — the artifact creator is the only party who may revoke.
  const art = db.prepare(`SELECT creator_id FROM creative_artifacts WHERE id = ?`).get(lic.artifact_id);
  if (!art) return { ok: false, reason: "artifact_not_found" };
  if (String(art.creator_id) !== String(creatorId)) return { ok: false, reason: "not_artifact_owner" };
  if (lic.status === "revoked") return { ok: true, alreadyRevoked: true };

  try {
    db.prepare(`UPDATE creative_usage_licenses SET status = 'revoked', revoked_at = ?, revoke_reason = ? WHERE id = ?`)
      .run(nowISO(), String(reason || "").slice(0, 500), licenseId);
  } catch (e) {
    return { ok: false, reason: "update_failed", error: String(e?.message || e) };
  }
  return { ok: true, licenseId, artifactId: lic.artifact_id };
}

/**
 * Reinstate a previously-revoked license (the creator changed their mind).
 * Only restores to 'active' if not expired. Owner-gated.
 */
export function reinstateLicense(db, { licenseId, creatorId } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const lic = db.prepare(`SELECT id, artifact_id, status, expires_at FROM creative_usage_licenses WHERE id = ?`).get(licenseId);
  if (!lic) return { ok: false, reason: "license_not_found" };
  const art = db.prepare(`SELECT creator_id FROM creative_artifacts WHERE id = ?`).get(lic.artifact_id);
  if (!art || String(art.creator_id) !== String(creatorId)) return { ok: false, reason: "not_artifact_owner" };
  if (lic.status !== "revoked") return { ok: false, reason: "not_revoked" };
  if (lic.expires_at && new Date(lic.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  try {
    db.prepare(`UPDATE creative_usage_licenses SET status = 'active', revoked_at = NULL, revoke_reason = NULL WHERE id = ?`).run(licenseId);
  } catch (e) {
    return { ok: false, reason: "update_failed", error: String(e?.message || e) };
  }
  return { ok: true, licenseId };
}

/**
 * The access-check helper: does this licensee currently hold a USABLE license
 * for the artifact? False when revoked, expired, or absent. Callers gating
 * artifact use should consult this. Optional licenseType narrows the check.
 */
export function licenseIsActive(db, { artifactId, licenseeId, licenseType = null } = {}) {
  if (!db || !artifactId || !licenseeId) return false;
  try {
    const rows = db.prepare(
      `SELECT status, expires_at, license_type FROM creative_usage_licenses WHERE artifact_id = ? AND licensee_id = ?`
    ).all(String(artifactId), String(licenseeId));
    const now = Date.now();
    return rows.some((r) =>
      r.status === "active" &&
      (!r.expires_at || new Date(r.expires_at).getTime() >= now) &&
      (!licenseType || r.license_type === licenseType));
  } catch {
    return false;
  }
}

/** List the licenses a creator could revoke for one of their artifacts. */
export function listRevocableLicenses(db, { artifactId, creatorId } = {}) {
  if (!db || !artifactId || !creatorId) return [];
  try {
    const art = db.prepare(`SELECT creator_id FROM creative_artifacts WHERE id = ?`).get(artifactId);
    if (!art || String(art.creator_id) !== String(creatorId)) return [];
    return db.prepare(
      `SELECT id, licensee_id AS licenseeId, license_type AS licenseType, status, granted_at AS grantedAt, revoked_at AS revokedAt
       FROM creative_usage_licenses WHERE artifact_id = ? ORDER BY granted_at DESC`
    ).all(String(artifactId));
  } catch {
    return [];
  }
}

export default { revokeLicense, reinstateLicense, licenseIsActive, listRevocableLicenses };
