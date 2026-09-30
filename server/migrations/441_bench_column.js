// server/migrations/441_bench_column.js
//
// 2026-09-06: renumbered from 999_bench_column.js (previously misnumbered,
// see below) and made idempotent.
//
// This migration is the literal generated artifact of a PCE self-benchmark
// test case (the fixture string `ALTER TABLE users ADD COLUMN bench_flag
// INTEGER DEFAULT 0` appears verbatim in server/lib/pce/concord-bench-cases.js
// and concord-bench-patterns.js as an example "write a migration" task) that
// escaped into the real server/migrations/ directory instead of staying
// confined to the benchmark's own sandbox. `bench_flag` has no real
// application usage anywhere in server/ outside those two benchmark-fixture
// files — it is not a real product column. Left in place rather than
// dropped: it's already applied on at least one real database (see below),
// dropping a column is a destructive operation this pass doesn't need to
// take, and the column is harmless (unused, nullable, defaults to 0).
//
// THE NUMBERING BUG THIS FIXES: filed as "999_bench_column.js", it ran on
// 2026-09-01 and got recorded in schema_version as version=999 — the
// highest version number the runner had ever seen. Because
// server/migrate.js's apply loop is `if (version <= currentVersion) continue`
// against a single MAX(version) snapshot, EVERY migration numbered below 999
// looked "already past" from that point on. Migrations 438
// (provider_billing_telemetry), 439 (cognitive_compiler_v2), and 440
// (dtu_cognitive_schema) — all written and numbered correctly, all real
// schema — were silently, permanently skipped on any database that had
// already run 999. Confirmed live: schema_version jumped straight from 437
// to 999 with no 438/439/440 in between, and 5 of the 7 tables those three
// migrations create were genuinely missing (2 of 7 existed anyway, created
// ad-hoc by boot-time application code independent of the migration system).
// Fixed in the same pass as this rename: the affected database's stray
// (999, 'bench_column') schema_version row was deleted (restoring
// MAX(version) to 437) and migrations 438-441 were then run in order for
// real. A fresh install was never affected — this only bit databases that
// had already applied the file under its old, out-of-sequence number.
//
// Idempotent for the same reason 421_entity_id_columns.js's ALTER TABLE
// calls are: the column already exists on any database that ran the old
// 999-numbered file, so a bare ALTER TABLE would throw "duplicate column
// name" here specifically (this is the one migration in this batch that
// ISN'T a pure CREATE-IF-NOT-EXISTS, since ALTER TABLE ADD COLUMN has no
// IF NOT EXISTS form in SQLite).
export function up(db) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN bench_flag INTEGER DEFAULT 0`);
  } catch (e) {
    if (!e?.message?.includes("duplicate column")) throw e;
  }
}
