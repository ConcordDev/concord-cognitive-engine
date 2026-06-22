// server/migrations/336_org_chat.js
//
// Firm/org chat — messages scoped to an organization. Backs the "Firm" channel
// in the world-lens ChatSystem. Posting is gated by org membership
// (world-organizations#getOrgsForUser / getOrgMembers); reads are org-scoped.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_chat_messages (
      id         TEXT PRIMARY KEY,
      org_id     TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_org_chat_org ON org_chat_messages(org_id, created_at DESC)`);
}
