// server/migrations/344_license_revocation.js
//
// Licensed DTU Vaults — revocation (#37). The creative_usage_licenses table
// (mig 014) already admits status='revoked' in its CHECK, but had no place to
// record WHEN or WHY. This adds the two provenance columns so a creator can
// revoke a usage license (e.g. for ToS breach or a withdrawn grant) with an
// auditable reason, and access checks can honour it. Purely additive — no
// existing marketplace path changes; royalty math is untouched.
//
// Guarded ALTER (the column may already exist on some installs); append-only.

export function up(db) {
  try { db.exec("ALTER TABLE creative_usage_licenses ADD COLUMN revoked_at TEXT"); } catch { /* exists */ }
  try { db.exec("ALTER TABLE creative_usage_licenses ADD COLUMN revoke_reason TEXT"); } catch { /* exists */ }
}
