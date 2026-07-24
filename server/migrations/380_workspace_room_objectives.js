// server/migrations/380_workspace_room_objectives.js
//
// V1.2 Wave B (Deep ConKay Agency) — "team mode": let a Shared Workspace
// Room (server/lib/workspace-rooms.js, mig 377) carry a shared OBJECTIVE
// and have ConKay actually participate in working on it, alongside the
// human co-editors already served by the room's `workspace:room` Yjs doc.
//
// Two additive pieces, following the exact pattern migration 378 used for
// the single-user "project" linking layer:
//
//   workspace_rooms.objective       TEXT nullable — the human-readable
//     shared goal for the room, set via workspace.set-objective. NULL
//     means "no objective yet" (every pre-existing room, and any new room
//     that never sets one — a room remains fully usable with no objective,
//     exactly as it was before this migration).
//   workspace_rooms.goal_tree_id    TEXT nullable — points at a real
//     goal_trees.id (server/lib/goal-decomposition.js, mig 340), same
//     convention as `projects.goal_tree_id` (mig 378): plain TEXT, no real
//     FOREIGN KEY (this codebase checks referential validity in the lib
//     layer, not the schema — see lib/workspace-rooms.js#getObjective,
//     which reports a dangling tree honestly rather than fabricating one).
//
//   workspace_room_marathon_links   — a room can accumulate multiple
//     ConKay work sessions over its life (paused/resumed/re-started ones
//     all count), mirroring `project_marathon_links` (mig 378) exactly,
//     just keyed by room_id instead of project_id. This is what lets
//     workspace.conkay-assist find "the session already working on this
//     room" instead of starting a duplicate one every time it's called.
//
// Append-only; guarded so a re-run (or a fresh install that already has
// these columns) is a clean no-op, matching the idiom in migrations
// 358/359/366/375/376.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (tableExists(db, "workspace_rooms")) {
    if (!columnExists(db, "workspace_rooms", "objective")) {
      db.exec(`ALTER TABLE workspace_rooms ADD COLUMN objective TEXT`);
    }
    if (!columnExists(db, "workspace_rooms", "goal_tree_id")) {
      db.exec(`ALTER TABLE workspace_rooms ADD COLUMN goal_tree_id TEXT`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_room_marathon_links (
      room_id              TEXT NOT NULL,
      marathon_session_id  TEXT NOT NULL,
      linked_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (room_id, marathon_session_id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_workspace_room_marathon_links_room ON workspace_room_marathon_links(room_id, linked_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_workspace_room_marathon_links_session ON workspace_room_marathon_links(marathon_session_id)`);
}

export function down(db) {
  // The two ADD COLUMNs are forward-only (same rationale as migrations
  // 359/376: additive + nullable + harmless to leave behind). The join
  // table is safe to drop cleanly.
  db.exec(`DROP INDEX IF EXISTS idx_workspace_room_marathon_links_session`);
  db.exec(`DROP INDEX IF EXISTS idx_workspace_room_marathon_links_room`);
  db.exec(`DROP TABLE IF EXISTS workspace_room_marathon_links`);
}

export const description = "Workspace rooms gain a shared objective + linked goal_tree_id, and a room<->marathon-session link table so ConKay can join a room's work as a scoped, resumable participant";
