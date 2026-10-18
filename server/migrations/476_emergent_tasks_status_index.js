// Background governor: the creation-admission check counts pending tasks by
// type and the TTL expiry sweep selects old pending rows. emergent_tasks only
// had (emergent_id, status, priority), so both were full scans over ~840k
// rows. Additive index; nothing altered or dropped.

export function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_emergent_tasks_status_type_created
      ON emergent_tasks (status, task_type, created_at);
  `);
}
