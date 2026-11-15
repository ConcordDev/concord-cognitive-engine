// Migration 502 — FIX-mail-014: a COD mail's recipient can DECLINE it.
//
// Until now the only recipient action on a mail carrying attachments or a
// COD charge was Claim — accept and pay. Declining returns the escrowed
// gift CC and the DTU escrow stamps to the sender (the same movements the
// expiry sweep makes) and charges the recipient nothing; it needs a real
// terminal status of its own, so the status CHECK from migration 215
// ('unread','read','claimed','expired') is widened with 'declined' and a
// declined_at stamp is added.
//
// SQLite doesn't support ALTER TABLE … DROP CONSTRAINT, so the CHECK
// widening follows the table-recreate dance of migration 125: probe the
// stored schema, rename, recreate with the widened CHECK, copy, drop,
// recreate the indexes from 215. The column add follows 499's guarded
// ALTER pattern. Both halves are idempotent.

export function up(db) {
  const tableSql = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='player_mail'`,
  ).get()?.sql || "";
  const admitsDeclined = /'declined'/.test(tableSql);
  if (tableSql && !admitsDeclined) {
    db.pragma("foreign_keys = OFF");
    try {
      const tx = db.transaction(() => {
        const newSql = tableSql.replace(
          /CHECK\s*\(\s*status\s+IN\s*\(([^)]+)\)\s*\)/i,
          (_full, inner) => `CHECK (status IN (${inner.trim()}, 'declined'))`,
        );
        db.exec("ALTER TABLE player_mail RENAME TO _player_mail_old_502");
        db.exec(newSql);
        db.exec("INSERT INTO player_mail SELECT * FROM _player_mail_old_502");
        db.exec("DROP TABLE _player_mail_old_502");
        db.exec(`CREATE INDEX IF NOT EXISTS idx_player_mail_inbox
          ON player_mail (to_user_id, status, sent_at DESC)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_player_mail_outbox
          ON player_mail (from_user_id, sent_at DESC)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_player_mail_expiry
          ON player_mail (status, expires_at)`);
      });
      tx();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
  const cols = db.prepare(`PRAGMA table_info(player_mail)`).all().map((c) => c.name);
  if (cols.length && !cols.includes("declined_at")) {
    db.exec(`ALTER TABLE player_mail ADD COLUMN declined_at INTEGER`);
  }
}

export function down(_db) {
  // No-op — the widened CHECK and the extra column are inert when unused
  // (the same posture as migrations 125 and 499).
}
