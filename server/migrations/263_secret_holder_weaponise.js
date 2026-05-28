// server/migrations/263_secret_holder_weaponise.js
//
// T2.1 (plan) — NPC-autonomous secret weaponisation once-marker.
//
// `secret_discoveries.weaponised_at` tracks PLAYER weaponisation. The holder
// (NPC) side had no marker, so an NPC acting on a secret it holds couldn't be
// fired-once. Add `secrets.weaponised_holder_at` so weaponiseHeldSecrets stamps
// it and never re-opens the same blackmail along that secret-edge.

export function up(db) {
  // SQLite: ADD COLUMN is safe + append-only. Guard against re-run.
  const cols = db.prepare(`PRAGMA table_info(secrets)`).all();
  if (!cols.some((c) => c.name === "weaponised_holder_at")) {
    db.exec(`ALTER TABLE secrets ADD COLUMN weaponised_holder_at INTEGER`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_secrets_unweaponised
           ON secrets(holder_npc_id) WHERE weaponised_holder_at IS NULL`);
}

export function down(_db) { /* forward-only (SQLite can't DROP COLUMN pre-3.35 cleanly) */ }
