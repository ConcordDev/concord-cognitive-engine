// server/migrations/233_cosmetic_overrides.js
//
// Phase BA3 — dye / tint cosmetic overlay.
//
// Today wardrobe writes directly to users.appearance_json (replaces it).
// This migration adds an OVERLAY layer keyed by (user, avatar, slot,
// channel) so dyes layer on top of the base appearance without
// destroying it.
//
// Channel ∈ primary | secondary | trim | glow. Four channels per slot
// is the standard fashion-MMO shape (WoW transmog tints, FFXIV glamour).
//
// Storage: per-row, not per-blob, so partial reads + idempotent
// upserts are cheap.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cosmetic_overrides (
      user_id     TEXT NOT NULL,
      avatar_id   TEXT NOT NULL DEFAULT 'default',
      slot        TEXT NOT NULL,
      channel     TEXT NOT NULL CHECK (channel IN ('primary','secondary','trim','glow')),
      color_hex   TEXT NOT NULL,
      applied_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, avatar_id, slot, channel)
    );
    CREATE INDEX IF NOT EXISTS idx_cosmetic_overrides_user
      ON cosmetic_overrides(user_id, avatar_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_cosmetic_overrides_user;
    DROP TABLE IF EXISTS cosmetic_overrides;
  `);
}
