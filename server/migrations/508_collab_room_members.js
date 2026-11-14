// FIX-collab-001 C2: a room gains a second person. Membership rows for
// collab_rooms — the row IS the room invite (status pending until the
// invitee responds; accepted makes the membership effective; declined
// grants nothing). tier is the collab domain's own vocabulary
// (view < comment < edit). The restart read-back for the STATE
// roomMembers map, exactly as collab_rooms (463) is for the rooms.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collab_room_members (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'view',
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by TEXT NOT NULL,
      invite_id TEXT,
      created_at TEXT NOT NULL,
      responded_at TEXT,
      PRIMARY KEY (room_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_collab_room_members_user
      ON collab_room_members (user_id, status);
    CREATE INDEX IF NOT EXISTS idx_collab_room_members_room
      ON collab_room_members (room_id);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS collab_room_members");
}
