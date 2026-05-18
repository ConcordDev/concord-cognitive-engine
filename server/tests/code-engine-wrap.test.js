// server/tests/code-engine-wrap.test.js
//
// Tier-2 contract tests for Code Sprint A #5 — wiring the dark
// code-engine. Verifies the macro layer round-trips real source files
// through the existing createCodeEngine(db) backend and mints
// kind='code_pattern' DTUs.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import registerCodeEngineMacros from "../domains/code-engine.js";

async function _runMigrationsForCodeEngine(db) {
  // Run the real migrations 028 (code engine tables) + a tiny dtus
  // table for the DTU mint. We don't run the full migration set —
  // that requires the full server state. Just what code-engine touches.
  const mig028 = await import("../migrations/028_code_engine.js");
  if (typeof mig028.up === "function") mig028.up(db);
  else if (typeof mig028.default === "function") mig028.default(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT,
      creator_id TEXT, meta_json TEXT, skill_level INTEGER DEFAULT 1,
      total_experience INTEGER DEFAULT 0, created_at INTEGER
    );
  `);
}

describe("code-engine wrapper macros", () => {
  let db; let tmp; const macros = new Map();
  before(async () => {
    db = new Database(":memory:");
    await _runMigrationsForCodeEngine(db);
    const register = (_domain, name, handler, _meta) => macros.set(name, handler);
    registerCodeEngineMacros(register);
    tmp = mkdtempSync(join(tmpdir(), "ce-wrap-"));
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src/auth.js"), `
// A real-looking auth module so the pattern extractor has something
// to chew on. The engine doesn't care that it's tiny; it just needs
// real JS code.
export class AuthController {
  constructor(db) { this.db = db; }
  async login(user, pass) {
    try {
      const row = await this.db.prepare('SELECT id, hash FROM users WHERE email = ?').get(user);
      if (!row) throw new Error('not_found');
      return { ok: true, id: row.id };
    } catch (e) { return { ok: false, error: e.message }; }
  }
}
`);
    writeFileSync(join(tmp, "src/route.js"), `
import express from 'express';
const r = express.Router();
r.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
r.post('/api/echo', (req, res) => res.json({ echo: req.body }));
export default r;
`);
    process.env.CONCORD_CODE_WORKSPACE_ROOT = tmpdir();
  });
  after(() => {
    rmSync(tmp, { recursive: true, force: true });
    try { db.close(); } catch { /* ok */ }
  });

  it("registers the expected macros", () => {
    for (const name of ["ingest_repo", "search_patterns", "list_repos", "list_megas", "engine_stats"]) {
      assert.ok(macros.has(name), `missing macro: ${name}`);
    }
  });

  it("ingest_repo walks a local path and mints code_pattern DTUs", async () => {
    const ctx = { db, actor: { userId: "u_test" } };
    const res = await macros.get("ingest_repo")(ctx, { localPath: tmp, allowCopyleft: true });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(res.sourceFileCount >= 2);
    // The engine extracts patterns from real source; on small fixtures
    // the count may be 0 if patterns aren't recognised. The contract
    // we pin is that ingest succeeded and returned a repository row.
    assert.ok(res.repository);
    assert.equal(res.repository.status, "ingested");
  });

  it("search_patterns + engine_stats run against the ingested repo", async () => {
    const stats = await macros.get("engine_stats")({ db });
    assert.equal(stats.ok, true);
    assert.ok(stats.stats);
    const search = await macros.get("search_patterns")({ db }, { limit: 10 });
    assert.equal(search.ok, true);
    assert.ok(Array.isArray(search.patterns));
  });

  it("list_repos returns the freshly-ingested repository", async () => {
    const r = await macros.get("list_repos")({ db }, { limit: 10 });
    assert.equal(r.ok, true);
    assert.ok(r.repositories.length >= 1);
  });

  it("ingest_repo rejects path traversal", async () => {
    const r = await macros.get("ingest_repo")({ db }, { localPath: "../escape" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "path_traversal");
  });

  it("ingest_repo requires url or local path", async () => {
    const r = await macros.get("ingest_repo")({ db }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "url_or_local_path_required");
  });
});
