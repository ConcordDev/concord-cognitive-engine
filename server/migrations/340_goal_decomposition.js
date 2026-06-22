// server/migrations/340_goal_decomposition.js
//
// Persistent Goal Decomposition (#10) — a real subgoal TREE that survives across
// sessions, distinct from the agent_marathon_sessions state blob (mig 171) and
// the OKR/initiative `goals` domain. A root goal mints a DTU; each subgoal is a
// node in the tree that can itself be decomposed. Status rolls UP: when every
// child of a node is done, the node completes. This is the durable scaffold the
// R&D engine (#21) and long-horizon planner (#14) hang plans on.
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS goal_trees (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT,
      root_dtu_id TEXT,                              -- the DTU minted for the root goal
      status      TEXT NOT NULL DEFAULT 'active',    -- active | done | abandoned
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_goaltree_user ON goal_trees(user_id, status)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS goal_nodes (
      id          TEXT PRIMARY KEY,
      tree_id     TEXT NOT NULL,
      parent_id   TEXT,                              -- NULL for the root node
      title       TEXT NOT NULL,
      detail      TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',   -- pending | active | done | blocked | abandoned
      depth       INTEGER NOT NULL DEFAULT 0,
      ordinal     INTEGER NOT NULL DEFAULT 0,        -- sibling order
      dtu_id      TEXT,                              -- optional DTU minted for this subgoal
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_goalnode_tree ON goal_nodes(tree_id, parent_id, ordinal)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_goalnode_status ON goal_nodes(tree_id, status)`);
}
