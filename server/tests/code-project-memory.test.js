// server/tests/code-project-memory.test.js
//
// Tier-2 contract tests for Code Sprint B #8 — persistent project
// memory. Real migration 206, real INSERT/SELECT/DELETE, real
// AGENTS.md disk round-trip, real secret-scan rejection.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import registerCodeMemoryMacros from "../domains/code-memory.js";
import { scanForSecrets } from "../lib/code/secret-scan.js";

let workspaceRoot;

describe("code-memory: migration + CRUD", () => {
  let db; const macros = new Map();
  before(async () => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT,
      creator_id TEXT, meta_json TEXT, skill_level INTEGER DEFAULT 1,
      total_experience INTEGER DEFAULT 0, created_at INTEGER
    )`);
    const mig = await import("../migrations/206_code_project_memory.js");
    mig.up(db);
    const register = (_d, n, h) => macros.set(n, h);
    registerCodeMemoryMacros(register);
    workspaceRoot = mkdtempSync(join(tmpdir(), "cmem-"));
    process.env.CONCORD_CODE_WORKSPACE_ROOT = workspaceRoot;
  });
  after(() => {
    try { db.close(); } catch { /* ok */ }
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("memory_add inserts and returns the row", async () => {
    const r = await macros.get("memory_add")({ db, actor: { userId: "u1" } }, {
      projectPath: workspaceRoot, kind: "rule", content: "always use Tailwind", pinned: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.memory.user_id, "u1");
    assert.equal(r.memory.pinned, 1);
  });

  it("memory_add rejects path traversal", async () => {
    const r = await macros.get("memory_add")({ db, actor: { userId: "u1" } }, {
      projectPath: "../escape", kind: "rule", content: "x",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_project_path");
  });

  it("memory_add rejects invalid kind", async () => {
    const r = await macros.get("memory_add")({ db, actor: { userId: "u1" } }, {
      projectPath: workspaceRoot, kind: "nonsense", content: "x",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_kind");
  });

  it("memory_list returns pinned first", async () => {
    await macros.get("memory_add")({ db, actor: { userId: "u1" } }, {
      projectPath: workspaceRoot, kind: "preference", content: "use eslint", pinned: false,
    });
    const r = await macros.get("memory_list")({ db, actor: { userId: "u1" } }, { projectPath: workspaceRoot });
    assert.equal(r.ok, true);
    assert.ok(r.memories.length >= 2);
    // First row should be the pinned rule
    assert.equal(r.memories[0].pinned, 1);
  });

  it("memory_active_prompt composes a grouped system-prompt-ready string", async () => {
    const r = await macros.get("memory_active_prompt")({ db, actor: { userId: "u1" } }, { projectPath: workspaceRoot });
    assert.equal(r.ok, true);
    assert.ok(r.prompt.includes("Active rules:"));
    assert.ok(r.prompt.includes("Tailwind"));
  });

  it("memory_publish mints a kind='code_agents_md' DTU", async () => {
    const list = await macros.get("memory_list")({ db, actor: { userId: "u1" } }, { projectPath: workspaceRoot });
    const firstId = list.memories[0].id;
    const r = await macros.get("memory_publish")({ db, actor: { userId: "u1" } }, { id: firstId });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId.startsWith("code_agents_md:"));
    const dtu = db.prepare("SELECT * FROM dtus WHERE id = ?").get(r.dtuId);
    assert.equal(dtu.kind, "code_agents_md");
    assert.equal(dtu.creator_id, "u1");
  });

  it("memory_publish rejects content with leaked secrets", async () => {
    const add = await macros.get("memory_add")({ db, actor: { userId: "u1" } }, {
      projectPath: workspaceRoot, kind: "rule",
      content: 'My OpenAI key is sk-abcdefghijklmnopqrstuvwxyz1234567890',
    });
    assert.equal(add.ok, true);
    const r = await macros.get("memory_publish")({ db, actor: { userId: "u1" } }, { id: add.memory.id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "secret_in_memory");
    assert.ok(r.matches.find((m) => m.name === "openai_key"));
  });

  it("memory_remove deletes a memory", async () => {
    const list = await macros.get("memory_list")({ db, actor: { userId: "u1" } }, { projectPath: workspaceRoot });
    const id = list.memories[0].id;
    const r = await macros.get("memory_remove")({ db, actor: { userId: "u1" } }, { id });
    assert.equal(r.ok, true);
    assert.equal(r.deleted, 1);
  });

  it("memory_import + export AGENTS.md disk round-trip", async () => {
    const fileBody = "# AGENTS.md\n\nProject convention: use snake_case in Python, camelCase in JS.\n";
    writeFileSync(join(workspaceRoot, "AGENTS.md"), fileBody);
    const imp = await macros.get("memory_import_agents_md")({ db, actor: { userId: "u2" } }, {
      projectPath: workspaceRoot,
    });
    assert.equal(imp.ok, true);
    assert.ok(imp.bytes > 0);

    await macros.get("memory_add")({ db, actor: { userId: "u2" } }, {
      projectPath: workspaceRoot, kind: "rule", content: "prefer functional components", pinned: true,
    });
    const exp = await macros.get("memory_export_agents_md")({ db, actor: { userId: "u2" } }, {
      projectPath: workspaceRoot, filename: "AGENTS_OUT.md",
    });
    assert.equal(exp.ok, true);
    const out = readFileSync(join(workspaceRoot, "AGENTS_OUT.md"), "utf-8");
    assert.ok(out.includes("Imported AGENTS.md"));
    assert.ok(out.includes("prefer functional components"));
  });
});

describe("secret-scan: detection", () => {
  it("flags an OpenAI key", () => {
    const r = scanForSecrets("api_key=sk-abcdefghijklmnopqrstuvwxyz1234567890");
    assert.equal(r.ok, false);
    assert.ok(r.matches.find((m) => m.name === "openai_key"));
  });

  it("flags a GitHub PAT", () => {
    const r = scanForSecrets("token=ghp_" + "X".repeat(36));
    assert.equal(r.ok, false);
    assert.ok(r.matches.find((m) => m.name === "github_pat"));
  });

  it("flags Stripe live keys", () => {
    const r = scanForSecrets("export STRIPE=sk_live_" + "X".repeat(24));
    assert.equal(r.ok, false);
    assert.ok(r.matches.find((m) => m.name === "stripe_secret" || m.name === "stripe_live"));
  });

  it("flags AWS access keys", () => {
    const r = scanForSecrets("AWS=AKIA1234567890123456 next");
    assert.equal(r.ok, false);
    assert.ok(r.matches.find((m) => m.name === "aws_access_key"));
  });

  it("flags RSA private keys", () => {
    const r = scanForSecrets("-----BEGIN RSA PRIVATE KEY-----\nABCDEF\n-----END RSA PRIVATE KEY-----");
    assert.equal(r.ok, false);
    assert.ok(r.matches.find((m) => m.name === "rsa_private"));
  });

  it("passes clean text", () => {
    const r = scanForSecrets("This is normal AGENTS.md content with no secrets.");
    assert.equal(r.ok, true);
  });

  it("never echoes the full secret in sample", () => {
    const k = "sk-" + "Q".repeat(40);
    const r = scanForSecrets(`key=${k}`);
    assert.equal(r.ok, false);
    const sample = r.matches[0].sample;
    assert.ok(!sample.includes(k), "sample should not echo full secret");
    assert.ok(/\d+ chars/.test(sample), "sample should report length");
  });
});
