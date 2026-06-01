// server/migrations/320_power_clusters.js
//
// Power-upgrade collectibles — the Saints Row IV / Crackdown "data-cluster" loop,
// adapted. Nodes scattered across the 3D world; walking into one (per-player
// claim) awards progression toward a traversal/combat power. Two jobs at once:
//   (1) the addictive exploration→power-growth loop, and
//   (2) the "reason to live in the 3D world" pull (you must explore Concordia in
//       3D to upgrade your moves — not grind a menu).
//
// Clusters are SHARED positions but claims are PER-PLAYER (Crackdown orbs): a
// cluster never disappears for everyone when one player grabs it.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS power_clusters (
      id          TEXT PRIMARY KEY,
      world_id    TEXT NOT NULL,
      power_tag   TEXT NOT NULL,        -- which power this node upgrades
      tier        INTEGER NOT NULL DEFAULT 1,
      x           REAL NOT NULL,
      y           REAL NOT NULL DEFAULT 0,
      z           REAL NOT NULL,
      spawned_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_power_clusters_world ON power_clusters(world_id);

    CREATE TABLE IF NOT EXISTS power_cluster_claims (
      cluster_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      world_id    TEXT,
      power_tag   TEXT,
      claimed_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (cluster_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pcc_user ON power_cluster_claims(user_id, world_id);
  `);
}

export function down(_db) { /* forward-only */ }
