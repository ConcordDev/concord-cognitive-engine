// INC-100 — mission-runtime-cycle event-loop stall.
//
// The heartbeat calls ensureRepoIndexFresh() without a repoRoot, which used
// process.cwd() (the server/ directory) for the freshness check while the
// indexer stores rows under the workspace root. That mismatch forced a full
// re-index of runtime_repo_symbols every ~2 minutes, blocking the event loop
// for 4–7 s.
//
// The code fix resolves the root through allowedRepoRoot(). This migration adds
// an additive covering index so the combined freshness query
// (repo_root + MAX(indexed_at)) stays fast as the repo graph grows.

export function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_runtime_repo_symbols_root_indexed_at
      ON runtime_repo_symbols (repo_root, indexed_at);
  `);
}
