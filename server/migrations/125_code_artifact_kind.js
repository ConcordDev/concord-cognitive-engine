// Migration 125 — Phase 7 / T2 — extend dtus.kind to admit 'code_artifact'.
//
// Routes / migrations / modules / macros / economy systems become DTUs
// under kind='code_artifact'. The substrate already supports any string
// for `kind`, but the existing CHECK constraint (added by migration 100)
// enumerates the allowed values. We extend it.
//
// SQLite doesn't support ALTER TABLE … DROP CONSTRAINT, so we follow the
// table-recreate dance: PRAGMA foreign_keys=OFF, copy schema, copy data,
// drop old, rename. better-sqlite3 wraps the whole thing in a transaction.

export function up(db) {
  // Probe current schema; only act if a CHECK exists that doesn't admit code_artifact.
  const tableSql = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='dtus'`,
  ).get()?.sql || "";
  const hasCheck = /CHECK\s*\(\s*kind\s+IN\s*\(/i.test(tableSql);
  const admitsCodeArtifact = /'code_artifact'/.test(tableSql);
  if (!hasCheck || admitsCodeArtifact) {
    return; // nothing to do
  }

  db.pragma("foreign_keys = OFF");
  try {
    const tx = db.transaction(() => {
      // Replace `kind IN (…)` block by appending 'code_artifact' to the list.
      const newSql = tableSql.replace(
        /CHECK\s*\(\s*kind\s+IN\s*\(([^)]+)\)\s*\)/i,
        (_full, inner) => `CHECK (kind IN (${inner.trim()}, 'code_artifact'))`,
      );
      // Rename old, recreate with new schema, copy, drop old.
      db.exec("ALTER TABLE dtus RENAME TO _dtus_old_125");
      db.exec(newSql);
      db.exec("INSERT INTO dtus SELECT * FROM _dtus_old_125");
      db.exec("DROP TABLE _dtus_old_125");
    });
    tx();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export function down(_db) {
  // No-op — we don't reverse the CHECK extension.
}
