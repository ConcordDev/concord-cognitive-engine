// server/migrations/215_world_doors.js
//
// Wave G6 — door open/close animations.
//
// Each `world_buildings` row gets one front door at migration time. The
// hinge is offset from the building center along the front edge,
// derived from (rotation, width, depth). Bulk backfill is idempotent —
// running twice produces no duplicate rows.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_doors (
      id              TEXT    PRIMARY KEY,
      world_id        TEXT    NOT NULL,
      building_id     TEXT    NOT NULL,
      hinge_x         REAL    NOT NULL,
      hinge_z         REAL    NOT NULL,
      normal_x        REAL    NOT NULL DEFAULT 0,
      normal_z        REAL    NOT NULL DEFAULT 1,
      state           TEXT    NOT NULL DEFAULT 'closed'
                              CHECK (state IN ('closed','opening','open','closing')),
      last_opened_at  INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_world_doors_world
      ON world_doors(world_id, state);
    CREATE INDEX IF NOT EXISTS idx_world_doors_building
      ON world_doors(building_id);
  `);

  // Bulk-backfill one front door per existing building.
  // We compute hinge_x/z by walking width/2 along the building's front
  // (the +z face after rotation). The normal points outward from the
  // building face for door swing direction.
  try {
    const buildings = db.prepare(`
      SELECT b.id, b.world_id, b.x, b.z, b.rotation, b.width, b.depth
      FROM world_buildings b
      LEFT JOIN world_doors d ON d.building_id = b.id
      WHERE d.id IS NULL
    `).all();

    const insert = db.prepare(`
      INSERT INTO world_doors (id, world_id, building_id, hinge_x, hinge_z, normal_x, normal_z)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of buildings) {
      const rot = b.rotation || 0;
      // Front face is at (0, depth/2) in local space → rotate by `rot`.
      const localZ = (b.depth || 10) / 2;
      const hingeX = b.x + Math.sin(rot) * localZ;
      const hingeZ = b.z + Math.cos(rot) * localZ;
      const nx = Math.sin(rot);
      const nz = Math.cos(rot);
      const id = `door_${b.id.slice(0, 10)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
      try { insert.run(id, b.world_id, b.id, hingeX, hingeZ, nx, nz); }
      catch { /* skip duplicates */ }
    }
  } catch { /* world_buildings may not exist in some test envs */ }
}

export function down(_db) { /* sqlite — keep on rollback */ }
