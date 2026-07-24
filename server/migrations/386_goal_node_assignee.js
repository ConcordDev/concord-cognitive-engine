// server/migrations/386_goal_node_assignee.js
//
// Grounding-audit gap closure: `server/lib/workspace-rooms.js`'s "team mode"
// (Wave B, mig 380) lets multiple humans co-edit a shared objective + a
// linked goal tree (`server/lib/goal-decomposition.js`, mig 340), but no
// subgoal node carries who — of those real humans — actually owns getting
// it done. The tree was a shared READ-ONLY progress display, not something
// individual participants could claim pieces of.
//
// Single additive column on the existing normalized `goal_nodes` table (the
// tree is stored as real rows, one per node — see mig 340 — not a JSON
// blob), so this is a plain nullable-column widening, not a schema
// redesign:
//
//   goal_nodes.assigned_to_user_id  TEXT nullable — NULL means unassigned
//     (every pre-existing node, and the default for every new node). No
//     FOREIGN KEY, same convention as `goal_trees.user_id` and every other
//     plain-TEXT user reference in this codebase (referential + membership
//     validity is enforced in the lib layer — see
//     lib/workspace-rooms.js#assignSubgoal, which validates the assignee
//     against the room's REAL current participant set before writing here,
//     never accepting an arbitrary string).
//
// Idempotent + guarded: no-op if the table is absent (minimal build) or the
// column already exists (re-run safety), matching the idiom in migrations
// 358/359/366/375/376/380.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!tableExists(db, "goal_nodes")) return; // minimal build without the goal-decomposition tables

  if (!columnExists(db, "goal_nodes", "assigned_to_user_id")) {
    db.exec(`ALTER TABLE goal_nodes ADD COLUMN assigned_to_user_id TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_goalnode_assignee ON goal_nodes(tree_id, assigned_to_user_id)`);
}

export function down(db) {
  // Forward-only column add (same rationale as 359/376/380's ADD COLUMNs) —
  // additive + nullable + harmless to leave behind. The index is safe to drop.
  db.exec(`DROP INDEX IF EXISTS idx_goalnode_assignee`);
}

export const description = "goal_nodes gains a nullable assigned_to_user_id column so an individual subgoal can be claimed by a real participant (workspace-rooms team mode + single-owner projects)";
