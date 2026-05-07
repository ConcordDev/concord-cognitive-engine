// server/migrations/085_plugin_gallery.js
// Plugin signing trusted-key registry + plugin gallery (browseable
// distribution surface backed by signed packages).
//
// NOTE (Phase 3.5.5 archival, May 2026):
//   `plugin_installs` has zero SELECT references — plugin install
//   tracking now flows through the apps/app-maker substrate.
//   Idempotent CREATE preserved.
//   REPLACED_BY: apps domain (app-maker) + plugin loader runtime state

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_trusted_keys (
        author_id        TEXT PRIMARY KEY,
        public_key_pem   TEXT NOT NULL,
        registered_at    INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
  } catch (e) { if (!e?.message?.includes("already exists")) throw e; }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_gallery (
        plugin_id        TEXT PRIMARY KEY,
        author_id        TEXT NOT NULL,
        name             TEXT NOT NULL,
        description      TEXT,
        version          TEXT NOT NULL,
        source           TEXT NOT NULL,
        signature        TEXT,
        hash             TEXT NOT NULL,
        trusted          INTEGER NOT NULL DEFAULT 0,
        installs         INTEGER NOT NULL DEFAULT 0,
        upvotes          INTEGER NOT NULL DEFAULT 0,
        downvotes        INTEGER NOT NULL DEFAULT 0,
        published_at     TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_gallery_author ON plugin_gallery(author_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_gallery_trusted ON plugin_gallery(trusted, installs DESC)`);
  } catch (e) { if (!e?.message?.includes("already exists")) throw e; }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_installs (
        plugin_id    TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        installed_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (plugin_id, user_id)
      )
    `);
  } catch (e) { if (!e?.message?.includes("already exists")) throw e; }
}

export function down(_db) { /* SQLite — leave tables in place */ }
