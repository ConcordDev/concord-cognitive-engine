// server/migrations/378_projects.js
//
// V1.2 Wave B (Deep ConKay Agency) — the "project" linking layer.
//
// A grounding audit found three real, tested, but disconnected subsystems:
//   - server/lib/goal-decomposition.js  (mig 340 goal_trees/goal_nodes) — a
//     durable subgoal TREE.
//   - server/lib/agent-marathon.js     (mig 171 agent_marathon_sessions) — a
//     persistent long-running-task state machine.
//   - server/lib/conversation-memory.js — real conversation_memory DTUs that
//     survive across sessions (write-through into the STATE.dtus map; SQLite
//     is the source of truth per server/lib/dtu-store.js).
//
// Nothing tied these into ONE addressable, named thing a user could reopen
// across separate logins. This migration adds exactly that — a thin
// metadata layer, no duplicated logic:
//
//   projects              — one row per named project. `goal_tree_id` points
//                            at a `goal_trees.id` (mig 340) but, matching this
//                            codebase's convention (see e.g. 377_workspace_rooms
//                            .js's `owner_id`, 340's own `root_dtu_id`), it is
//                            plain TEXT with NO real FOREIGN KEY constraint —
//                            this repo does not enforce cross-table FKs, it
//                            checks referential validity in the lib layer
//                            (see lib/project-thread.js#getProject, which
//                            reports a dangling goal_tree_id honestly rather
//                            than fabricating a tree).
//   project_marathon_links — a project can accumulate multiple marathon
//                            sessions over its life (paused/resumed/re-started
//                            ones all count), so this is a real join table,
//                            not a single column on `projects`.
//
// Conversation memory deliberately gets NO join table: `conversation-memory.js`
// writes DTUs into an in-memory STATE.dtus map (SQLite persistence is a
// separate concern per its own header), so there is nothing here to declare a
// durable FK against yet, and server/domains/conkay.js's memory_list/pin/
// forget macros already establish the working pattern of scoping that store
// by (kind, machine.userId) at read time. lib/project-thread.js#getProject
// follows that exact pattern, scored by simple keyword overlap against the
// project's own name/goal text — no new substrate, no duplicated retrieval
// logic.
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      name            TEXT NOT NULL,
      goal_tree_id    TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      last_opened_at  INTEGER
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_goal_tree ON projects(goal_tree_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_marathon_links (
      project_id           TEXT NOT NULL,
      marathon_session_id  TEXT NOT NULL,
      linked_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (project_id, marathon_session_id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_project_marathon_links_project ON project_marathon_links(project_id, linked_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_project_marathon_links_session ON project_marathon_links(marathon_session_id)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_project_marathon_links_session`);
  db.exec(`DROP INDEX IF EXISTS idx_project_marathon_links_project`);
  db.exec(`DROP TABLE IF EXISTS project_marathon_links`);
  db.exec(`DROP INDEX IF EXISTS idx_projects_goal_tree`);
  db.exec(`DROP INDEX IF EXISTS idx_projects_user`);
  db.exec(`DROP TABLE IF EXISTS projects`);
}

export const description = "Projects: a thin linking layer tying a goal_tree + its marathon sessions + relevance-scoped conversation memory into one addressable, resumable unit";
