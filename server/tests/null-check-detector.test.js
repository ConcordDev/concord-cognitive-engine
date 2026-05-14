/**
 * Tier-2 contract tests for NullCheckDetector.
 *
 * Pinned: db.prepare().get() result used without a null-check, findById/
 * findOne ORM helpers, the guard forms that must SUPPRESS a finding
 * (if (!x), if (x), if (x?.y), x && x.z, ternary, optional-chain-
 * anywhere, OR-second-operand), aggregate-SQL skip, arrow-function-RHS
 * skip, inline-consumed-get skip, @null-check-ok annotation opt-out.
 *
 * Run: node --test tests/null-check-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runNullCheckDetector } from "../lib/detectors/null-check-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `null-check-test-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

const findNull = (r) => r.findings.filter(x => x.id === "null_check_missing");

describe("NullCheckDetector — flags the unguarded shape", () => {
  it("flags `const row = db.prepare(...).get(id)` used without a null-check", async () => {
    const dir = withFixture({
      "server/routes/widget.js":
        `export function get(req, res) {\n` +
        `  const row = db.prepare("SELECT * FROM widgets WHERE id = ?").get(req.params.id);\n` +
        `  return res.json({ name: row.name });\n` +
        `}\n`,
    });
    try {
      const r = await runNullCheckDetector({ root: dir });
      const f = findNull(r);
      assert.equal(f.length, 1, "expected exactly one finding");
      assert.equal(f[0].severity, "medium");
      assert.equal(f[0].subject.variable, "row");
      assert.equal(f[0].fixHint, "insert_null_check_404");
    } finally { teardown(dir); }
  });

  it("flags findById result used without a null-check", async () => {
    const dir = withFixture({
      "server/lib/svc.js":
        `export function load(id) {\n` +
        `  const user = repo.findById(id);\n` +
        `  return user.email;\n` +
        `}\n`,
    });
    try {
      const r = await runNullCheckDetector({ root: dir });
      assert.equal(findNull(r).length, 1);
    } finally { teardown(dir); }
  });
});

describe("NullCheckDetector — guard forms suppress the finding", () => {
  const guarded = {
    "if (!row) return": `const row = db.prepare("SELECT * FROM w WHERE id=?").get(id);\nif (!row) return null;\nreturn row.name;`,
    "if (row) {...}": `const row = db.prepare("SELECT * FROM w WHERE id=?").get(id);\nif (row) { return row.name; }\nreturn null;`,
    "if (row?.x)": `const row = db.prepare("SELECT * FROM w WHERE id=?").get(id);\nif (row?.name) return row.name;\nreturn null;`,
    "row && row.x": `const row = db.prepare("SELECT * FROM w WHERE id=?").get(id);\nconst n = row && row.name;\nreturn n;`,
    "ternary": `const row = db.prepare("SELECT * FROM w WHERE id=?").get(id);\nreturn row ? row.name : null;`,
    "optional chain at use": `const row = db.prepare("SELECT * FROM w WHERE id=?").get(id);\nreturn row?.name ?? "unknown";`,
    "OR second operand": `const a = db.prepare("SELECT * FROM w WHERE id=?").get(x);\nconst b = db.prepare("SELECT * FROM w WHERE id=?").get(y);\nif (!a || !b) return null;\nreturn a.name + b.name;`,
    "row == null": `const row = db.prepare("SELECT * FROM w WHERE id=?").get(id);\nif (row == null) return null;\nreturn row.name;`,
  };
  for (const [label, body] of Object.entries(guarded)) {
    it(`does NOT flag — ${label}`, async () => {
      const dir = withFixture({ "server/lib/g.js": `export function f(id, x, y) {\n${body}\n}\n` });
      try {
        const r = await runNullCheckDetector({ root: dir });
        assert.equal(findNull(r).length, 0, `${label} should be treated as guarded`);
      } finally { teardown(dir); }
    });
  }
});

describe("NullCheckDetector — structural skips", () => {
  it("does NOT flag aggregate queries (COUNT/AVG/SUM) — they always return a row", async () => {
    const dir = withFixture({
      "server/lib/stats.js":
        `export function f(id) {\n` +
        `  const stats = db.prepare("SELECT COUNT(*) as c FROM widgets WHERE owner = ?").get(id);\n` +
        `  return stats.c;\n` +
        `}\n`,
    });
    try {
      const r = await runNullCheckDetector({ root: dir });
      assert.equal(findNull(r).length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag when the get-result is consumed inline (.get(...)?.x)", async () => {
    const dir = withFixture({
      "server/lib/inline.js":
        `export function f(id) {\n` +
        `  const name = db.prepare("SELECT name FROM w WHERE id=?").get(id)?.name || "anon";\n` +
        `  return name;\n` +
        `}\n`,
    });
    try {
      const r = await runNullCheckDetector({ root: dir });
      assert.equal(findNull(r).length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag a Map.get / Set.get (no .prepare ahead of it)", async () => {
    const dir = withFixture({
      "server/lib/cache.js":
        `export function f(k) {\n` +
        `  const v = cacheMap.get(k);\n` +
        `  return v.field;\n` +
        `}\n`,
    });
    try {
      const r = await runNullCheckDetector({ root: dir });
      assert.equal(findNull(r).length, 0, "Map.get must not be treated as a DB query");
    } finally { teardown(dir); }
  });

  it("does NOT flag .run() result (a different op than .get())", async () => {
    const dir = withFixture({
      "server/lib/del.js":
        `export function f(id) {\n` +
        `  const r = db.prepare("DELETE FROM w WHERE id=?").run(id);\n` +
        `  const other = db.prepare("SELECT x FROM y WHERE id=?").get(id);\n` +  // a .get exists later in the file
        `  return r.changes;\n` +  // r is a .run result — never null
        `}\n`,
    });
    try {
      const r = await runNullCheckDetector({ root: dir });
      // `r` (the .run result) must NOT be flagged — only the `.get()` chain matters.
      const flagged = findNull(r).find(x => x.subject.variable === "r");
      assert.equal(flagged, undefined, ".run() result must never be flagged as a missing null-check");
    } finally { teardown(dir); }
  });

  it("respects the // @null-check-ok annotation", async () => {
    const dir = withFixture({
      "server/lib/ok.js":
        `export function f(id) {\n` +
        `  // @null-check-ok: singleton row, guaranteed by migration seed\n` +
        `  const row = db.prepare("SELECT * FROM settings WHERE id='singleton'").get();\n` +
        `  return row.value;\n` +
        `}\n`,
    });
    try {
      const r = await runNullCheckDetector({ root: dir });
      assert.equal(findNull(r).length, 0);
    } finally { teardown(dir); }
  });
});

describe("NullCheckDetector — report shape", () => {
  it("returns a normalized report with scanned count", async () => {
    const dir = withFixture({ "server/lib/empty.js": `export const x = 1;\n` });
    try {
      const r = await runNullCheckDetector({ root: dir });
      assert.equal(r.ok, true);
      assert.equal(typeof r.summary.total, "number");
      assert.equal(typeof r.scanned, "number");
      assert.ok(Array.isArray(r.findings));
    } finally { teardown(dir); }
  });
});
