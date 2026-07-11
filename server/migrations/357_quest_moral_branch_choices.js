// server/migrations/357_quest_moral_branch_choices.js
//
// Wave 4 gap-closure — docs/concordia-specs/quests-dialogue-capability-map.md
// §3/§6#1: `moral_branch`/`reputation_change` are authored across 11 quest
// content files but were read by zero lines of server or frontend code.
//
// This table records which moral_branch option a player chose for a given
// authored quest, so `server/lib/quests/moral-branch.js#applyMoralBranchChoice`
// can apply `reputation_change` to the EXISTING reputation substrate
// (character_opinions / player_faction_reputation_cache — migrations 153/218)
// exactly once per (user, world, quest). Without this idempotency gate a
// retried or duplicated call would double- (or triple-) apply the
// consequence, which is a real gameplay-integrity bug, not just a data
// nicety — reputation deltas must land exactly once, like an economy
// ledger entry.
//
// quest_authored_id is the CONTENT id (e.g. "warden_crackdown" from
// content/quests/main-arc.json), not the in-memory quest-engine's generated
// quest_xxxx id — the authored id is stable across restarts (the in-memory
// engine's ids are not), and it's what the content JSON's moral_branch is
// keyed under.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quest_moral_branch_choices (
      user_id           TEXT NOT NULL,
      world_id          TEXT NOT NULL,
      quest_authored_id TEXT NOT NULL,
      option_id         TEXT NOT NULL,
      chosen_trigger    TEXT,
      applied_json      TEXT NOT NULL DEFAULT '[]',
      chosen_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, world_id, quest_authored_id)
    );
    CREATE INDEX IF NOT EXISTS idx_quest_moral_branch_user
      ON quest_moral_branch_choices(user_id, quest_authored_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_quest_moral_branch_user;
    DROP TABLE IF EXISTS quest_moral_branch_choices;
  `);
}
