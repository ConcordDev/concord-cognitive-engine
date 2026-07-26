// server/migrations/377_workspace_rooms.js
//
// V1.2 Wave A (Society & Presence), capability 3 — shared DTU spaces:
// discovery metadata for MU2's Shared Workspace Room.
//
// MU2 (see git log --grep="MU2") already built the real thing: a
// `workspace:room` Yjs CRDT scope (server/lib/yjs-realtime.js) holding a
// live `Y.Array` of DTU references, plus Awareness-based presence, plus
// the `SharedWorkspaceRoom.tsx` component that renders it. That Y.Doc is
// — and remains — the sole content authority for a room: what DTUs are
// in it, who's currently present. This migration does NOT duplicate any
// of that.
//
// What was missing is purely a discovery problem: a room is reachable by
// anyone who has its id (MU2's own documented trust model, "same as a
// Live Share / Collab doc link today"), but there was no way to learn a
// room's id except out-of-band, no room list, and no record that a room
// with a given name/owner/anchor exists at all. This table is exactly
// that — one row per room, metadata only:
//   id           — the room id, i.e. the docId passed to useYjsDoc /
//                  getDoc(scope='workspace:room', docId).
//   name         — human label the creator chose.
//   owner_id     — who created it (first-cut ownership scope for
//                  "list-mine" — see server/lib/workspace-rooms.js).
//   world_id     — required. Every room is created from inside some
//                  world context, even if the room itself has no 3D
//                  presence (MU2 explicitly declined city-presence
//                  spatial anchoring in favor of Yjs's own awareness).
//   district_id  — optional. When set, the room is discoverable via
//                  workspace.list-in-district for that (world, district)
//                  pair, mirroring ambient_chat_messages' scoping shape
//                  (server/migrations/231_ambient_chat.js). A room with
//                  no district anchor is still creatable/joinable by id,
//                  it's simply not surfaced in a district-scoped list.
//
// Deleting a row here never touches the Yjs doc (and never will — this
// table has no foreign key into any Yjs internal state, by design: the
// doc can outlive its metadata row, exactly like a room id shared purely
// out-of-band today).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_rooms (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      owner_id     TEXT NOT NULL,
      world_id     TEXT NOT NULL,
      district_id  TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_rooms_district
      ON workspace_rooms(world_id, district_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workspace_rooms_owner
      ON workspace_rooms(owner_id, created_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_workspace_rooms_owner;
    DROP INDEX IF EXISTS idx_workspace_rooms_district;
    DROP TABLE IF EXISTS workspace_rooms;
  `);
}

export const description = "Discovery metadata for MU2's Shared Workspace Room (workspace:room Yjs scope) — pure metadata, the Y.Doc stays the sole content authority";
