// server/migrations/444_lattice_seed.js
//
// RENUMBERED 2026-09-08 from 416_lattice_seed.js — it collided with
// 416_world_consequences.js. The runner records ONE row per version number
// (schema_version.version is the PK), so on every existing DB
// `416_world_consequences` recorded first and this file was then silently
// skipped (`version <= currentVersion`) — it has NEVER applied anywhere, which
// is why server/lib/lattice-seed.js's whole subsystem has been dead
// (`tableExists('lattice_seed_sources')` false → every call returns
// `{ ok:false, reason:'no_table' }`). Renumbering to a free slot lets it apply
// on the next migrate and actually activates that subsystem. Every statement
// is `CREATE TABLE IF NOT EXISTS` with zero overlap with any other migration,
// so applying it late is safe. Same collision-fix pattern as the audited
// 209/213/226 renames (see CLAUDE.md "Migrations are append-only").
//
// Persistent Auto-DTU + ingest-scheduler substrate recovered from an
// older ConcordOS backend (the "Auto-DTUs + Ingest Scheduler" patch
// bundle). Current Concord already has:
//   • planetary ingest-engine (in-memory URL queue, 10/100/500/∞ tiers,
//     SSRF-guarded fetch, council-gated DTU mint)
//   • hypothesis-engine / hypothesis lens (scientific method + stats)
//   • research-jobs.js (in-memory directed investigation pipeline)
//   • dtu.create + dtu_confidence (numeric belief, not a trust ladder)
//
// What this migration adds, that those surfaces do not:
//   1. Labeled ingest *sources* + a durable *page queue* (SQLite, not RAM).
//   2. Daily per-user ingest quota log (10 member / 100 admin-family).
//   3. Generated research-direction hypotheses as first-class rows.
//   4. Persisted research jobs (the in-memory engine is lost on restart).
//   5. Auto-DTUs minted at trust_level='experimental' until a human
//      promotes them to 'trusted' — a ladder dtu_confidence does not have.
//   6. Scoped memory of those operations (ingest / hypothesis / research /
//      auto-dtu), without fabricated embedding vectors.
//
// Multi-tenant: every table is keyed by user_id (the old backend was
// single-user). Table-guarded readers; forward-only. Migrations are
// append-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lattice_seed_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      root_url TEXT,
      label TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lattice_seed_sources_user
      ON lattice_seed_sources(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS lattice_seed_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued','processed','error')),
      content_excerpt TEXT,
      last_processed_at TEXT,
      error_message TEXT,
      FOREIGN KEY (source_id) REFERENCES lattice_seed_sources(id)
    );
    CREATE INDEX IF NOT EXISTS idx_lattice_seed_pages_queue
      ON lattice_seed_pages(user_id, status, id);

    CREATE TABLE IF NOT EXISTS lattice_seed_ingest_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      page_id INTEGER NOT NULL,
      processed_at TEXT NOT NULL,
      bytes_ingested INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (page_id) REFERENCES lattice_seed_pages(id)
    );
    CREATE INDEX IF NOT EXISTS idx_lattice_seed_ingest_log_day
      ON lattice_seed_ingest_log(user_id, processed_at);

    CREATE TABLE IF NOT EXISTS lattice_seed_hypotheses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      source_label TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lattice_seed_hypotheses_user
      ON lattice_seed_hypotheses(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS lattice_seed_research_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      dtu_keys TEXT,
      layer TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','done','error')),
      result_summary TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lattice_seed_jobs_user
      ON lattice_seed_research_jobs(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS lattice_seed_auto_dtus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      dtu_key TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      tags TEXT,
      layer TEXT,
      kind TEXT,
      trust_level TEXT NOT NULL DEFAULT 'experimental'
        CHECK(trust_level IN ('experimental','trusted')),
      minted_dtu_id TEXT,
      source_kind TEXT,
      source_id INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, dtu_key)
    );
    CREATE INDEX IF NOT EXISTS idx_lattice_seed_auto_dtus_user
      ON lattice_seed_auto_dtus(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS lattice_seed_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      dtu_key TEXT,
      text TEXT NOT NULL,
      source TEXT,
      layer TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lattice_seed_memory_user
      ON lattice_seed_memory(user_id, created_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS lattice_seed_memory;
    DROP TABLE IF EXISTS lattice_seed_auto_dtus;
    DROP TABLE IF EXISTS lattice_seed_research_jobs;
    DROP TABLE IF EXISTS lattice_seed_hypotheses;
    DROP TABLE IF EXISTS lattice_seed_ingest_log;
    DROP TABLE IF EXISTS lattice_seed_pages;
    DROP TABLE IF EXISTS lattice_seed_sources;
  `);
}
