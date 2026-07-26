// server/migrations/381_creative_license_org_scope.js
//
// Institutional (org-scoped) licensing — minimal version, per owner decision.
//
// Grounding: `creative_usage_licenses` (migration 014) was single-user only
// (`licensee_id TEXT NOT NULL`), and `server/lib/world-organizations.js` is a
// pure in-memory social/governance graph with zero economic dimension. The
// owner was asked whether to build a minimal org-scoped licensing model or
// hold it entirely, and chose to build it, described as: "an officer's
// personal wallet pays for a purchase, but the license grant attaches to the
// org so every member gets real access — same purchase flow, wider grant...
// no new billing/subscription system invented; honestly labeled as
// 'purchased by X on behalf of the org,' not a fake org wallet."
//
// This migration ONLY widens the license row's shape:
//   - licensee_type ('user' | 'org') — defaults 'user' so every existing row
//     is correctly backward-compatible with zero data migration: an existing
//     row's licensee_id already holds the purchasing user's id, which is
//     exactly what licensee_type='user' means.
//   - licensee_org_id (nullable TEXT) — the org id the license is scoped to
//     when licensee_type='org'. NULL for every pre-existing (and every
//     future per-user) row.
//
// The purchase flow itself (server/economy/creative-marketplace.js
// purchaseArtifact) is UNCHANGED for the money side: the buyer's own real
// wallet is debited exactly as before, fees/royalty math is untouched. Only
// the resulting license row's shape widens, and only when the caller
// explicitly opts into { licenseeType: 'org', licenseeOrgId }.
//
// Guarded ALTER (columns may already exist on some installs — same pattern
// as migration 344_license_revocation.js); append-only, forward-only.

export function up(db) {
  try {
    db.exec(
      "ALTER TABLE creative_usage_licenses ADD COLUMN licensee_type TEXT NOT NULL DEFAULT 'user' CHECK (licensee_type IN ('user','org'))"
    );
  } catch { /* column already exists on some installs */ }
  try {
    db.exec("ALTER TABLE creative_usage_licenses ADD COLUMN licensee_org_id TEXT");
  } catch { /* column already exists on some installs */ }

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_creative_licenses_org
        ON creative_usage_licenses(licensee_org_id)
        WHERE licensee_org_id IS NOT NULL;
    `);
  } catch { /* index creation is best-effort */ }
}
