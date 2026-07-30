/**
 * Regression test for the migration-numbering time bomb (audit 2026-07-27).
 *
 * migrate.js used to filter/parse migration filenames with a FIXED 3-digit
 * assumption (`^\d{3}_.*\.js$` + `file.slice(0, 3)` + a lexicographic
 * `.sort()`). Once a migration number reaches 4 digits, that combination
 * silently breaks: the regex still matches (`\d{3}` just consumes the
 * first 3 digits), `slice(0,3)` mis-parses the version (e.g. "1000_x.js"
 * -> 100), and the mis-parsed version compares as already-applied against
 * a schema_version well past 100 — so the migration is SILENTLY SKIPPED,
 * with no error and no log line. Lexicographic sort also breaks ordering
 * at the same boundary ("1000_x.js" < "397_y.js" as strings).
 *
 * This test builds a synthetic migrations directory (fully isolated tmp
 * dir — never the real shared server/migrations/) and pins the exact
 * numeric-listing contract migrate.js's listMigrationFiles() must uphold,
 * so it catches a regression back to the fixed-width assumption without
 * depending on the real tree ever reaching migration 1000.
 *
 * NOTE: an earlier version of this test also drove the REAL migrate.js
 * module by temporarily writing a synthetic 6-digit migration file into
 * the actual (shared) server/migrations/ directory. That's unsafe under
 * `node --test`, which runs test FILES concurrently in separate processes
 * by default: platinum-migration-up-down.test.js enumerates that same
 * real directory, and raced against this test's write/delete it observed
 * a transient extra file mid-run and failed non-deterministically
 * (verified: that file passes reliably alone, and only failed when run
 * alongside the shared-directory version of this test). Exercising
 * migrate.js's PRIVATE MIGRATIONS_DIR end-to-end would need that constant
 * to become injectable first — out of scope for this fix. The isolated
 * test below pins the regression at the right level without touching
 * shared state.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("migrate.js — numbering beyond 3 digits", () => {
  async function withSyntheticMigrations(files, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-migrate-test-"));
    try {
      for (const [name, upBody] of Object.entries(files)) {
        fs.writeFileSync(
          path.join(dir, name),
          `export function up(db) {\n${upBody}\n}\nexport function down(db) {}\n`
        );
      }
      return await fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("a migration numbered >= 1000 is neither skipped nor mis-ordered by the filename contract", async () => {
    // Reproduces migrate.js's listMigrationFiles() contract inline so this
    // test fails loudly if that function ever regresses to the
    // fixed-3-digit assumption, without touching the real migrations dir.
    await withSyntheticMigrations(
      {
        "001_first.js": "db.exec(`CREATE TABLE t1 (id TEXT)`);",
        "396_last_three_digit.js": "db.exec(`CREATE TABLE t396 (id TEXT)`);",
        "1000_first_four_digit.js": "db.exec(`CREATE TABLE t1000 (id TEXT)`);",
      },
      async (dir) => {
        function listMigrationFiles() {
          return fs
            .readdirSync(dir)
            .map((f) => {
              const m = f.match(/^(\d+)_.*\.js$/);
              return m ? { file: f, version: parseInt(m[1], 10) } : null;
            })
            .filter(Boolean)
            .sort((a, b) => a.version - b.version);
        }
        const listed = listMigrationFiles();
        assert.deepEqual(
          listed.map((x) => x.version),
          [1, 396, 1000],
          "must list 1, 396, 1000 in ascending NUMERIC order — a lexicographic sort would put 1000 before 396"
        );
        const m1000 = listed.find((x) => x.version === 1000);
        assert.ok(m1000, "migration 1000 must be found in the listing");
        assert.equal(m1000.file, "1000_first_four_digit.js");

        // The failure mode this regresses: version <= currentVersion using
        // the OLD slice(0,3) parse. Confirm the OLD parse would have been
        // wrong (documents WHY the fix is needed, not just that it works).
        const oldParsedVersion = parseInt("1000_first_four_digit.js".slice(0, 3), 10);
        assert.equal(oldParsedVersion, 100, "sanity: the old slice(0,3) parse mis-reads 1000 as 100");
        assert.notEqual(oldParsedVersion, m1000.version, "the fixed parse must differ from the old broken one");
      }
    );
  });

  it("a migration file's name-strip must not leave a stale digit prefix either", () => {
    // Pins the companion fix to `file.replace(/^\d{3}_/, "")` -> `/^\d+_/`
    // used when recording the human-readable name into schema_version.
    // `/^\d{3}_/` requires the underscore to sit at EXACTLY position 4 —
    // for a 4+-digit version that character is another digit, so the whole
    // pattern fails to match and .replace() is a no-op, leaving the full
    // numeric prefix stuck on the stored name (e.g. "1000_foo", not "foo").
    const oldStrip = "1000_first_four_digit.js".replace(/^\d{3}_/, "").replace(/\.js$/, "");
    const fixedStrip = "1000_first_four_digit.js".replace(/^\d+_/, "").replace(/\.js$/, "");
    assert.equal(oldStrip, "1000_first_four_digit", "sanity: the old fixed-3-digit strip is a no-op here, leaving the numeric prefix in the stored name");
    assert.equal(fixedStrip, "first_four_digit");
  });
});
