// server/domains/code-memory.js
//
// Code Sprint B Item #8 — persistent project memory + AGENTS.md.
//
// Backs Cursor's `.cursor/rules/`, Windsurf's Memories, and the
// emerging GitHub Spec Kit AGENTS.md format with a real DB-backed
// substrate that's also publishable as a DTU. When other devs cite
// your published AGENTS.md, royalty cascade pays you forever.

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve as pathResolve, join as pathJoin } from "node:path";
import { scanForSecrets } from "../lib/code/secret-scan.js";

const VALID_KINDS = new Set(["agents_md", "rule", "preference", "naming_convention", "pattern"]);

function _workspaceRoot() {
  return pathResolve(process.env.CONCORD_CODE_WORKSPACE_ROOT || process.cwd());
}

function _normalisedProjectPath(projectPath) {
  if (!projectPath || typeof projectPath !== "string") return null;
  if (projectPath.includes("..")) return null;
  const abs = pathResolve(_workspaceRoot(), projectPath);
  const root = _workspaceRoot();
  if (abs !== root && !abs.startsWith(root + "/")) return null;
  return abs;
}

export default function registerCodeMemoryMacros(register) {
  register("code", "memory_add", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    const projectPath = _normalisedProjectPath(input.projectPath || input.project_path);
    if (!projectPath) return { ok: false, reason: "invalid_project_path" };
    const kind = String(input.kind || "rule");
    if (!VALID_KINDS.has(kind)) return { ok: false, reason: "invalid_kind", validKinds: [...VALID_KINDS] };
    const content = String(input.content || "").trim();
    if (!content) return { ok: false, reason: "content_required" };
    if (content.length > 100_000) return { ok: false, reason: "content_too_long" };
    const pinned = input.pinned ? 1 : 0;
    const source = String(input.source || "user_authored");
    const id = `code_mem:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO code_project_memory (id, user_id, project_path, kind, content, pinned, source)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(user_id, project_path, kind, content) DO UPDATE SET pinned = excluded.pinned
      `).run(id, userId, projectPath, kind, content, pinned, source);
      const row = db.prepare(`SELECT * FROM code_project_memory WHERE user_id = ? AND project_path = ? AND kind = ? AND content = ?`)
        .get(userId, projectPath, kind, content);
      return { ok: true, memory: row };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Add or upsert a project-memory entry" });

  register("code", "memory_list", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    const projectPath = _normalisedProjectPath(input.projectPath || input.project_path);
    if (!projectPath) return { ok: false, reason: "invalid_project_path" };
    const kindFilter = input.kind ? String(input.kind) : null;
    const limit = Math.min(200, Number(input.limit) || 100);
    const rows = kindFilter
      ? db.prepare(`SELECT * FROM code_project_memory WHERE user_id = ? AND project_path = ? AND kind = ? ORDER BY pinned DESC, created_at DESC LIMIT ?`)
          .all(userId, projectPath, kindFilter, limit)
      : db.prepare(`SELECT * FROM code_project_memory WHERE user_id = ? AND project_path = ? ORDER BY pinned DESC, created_at DESC LIMIT ?`)
          .all(userId, projectPath, limit);
    return { ok: true, memories: rows, projectPath };
  }, { note: "List active memories for a project (pinned first)" });

  register("code", "memory_remove", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const r = db.prepare(`DELETE FROM code_project_memory WHERE id = ? AND user_id = ?`).run(id, userId);
    return { ok: true, deleted: r.changes };
  }, { destructive: true, note: "Remove a memory row (owner-only)" });

  register("code", "memory_publish", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT * FROM code_project_memory WHERE id = ? AND user_id = ?`).get(id, userId);
    if (!row) return { ok: false, reason: "not_found" };
    const scan = scanForSecrets(row.content);
    if (!scan.ok) return { ok: false, reason: scan.reason, matches: scan.matches };
    const dtuId = `code_agents_md:${randomUUID()}`;
    const meta = {
      memoryId: row.id, kind: row.kind, project_path: row.project_path,
      source: row.source, visibility: "public",
      consent: { allowCitations: true },
    };
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
        VALUES (?, 'code_agents_md', ?, ?, ?, 1, 0, unixepoch())
      `).run(dtuId, (input.title || `AGENTS.md · ${row.kind}`).slice(0, 200), userId, JSON.stringify(meta));
      db.prepare(`UPDATE code_project_memory SET published_dtu_id = ?, source = 'user_authored' WHERE id = ?`).run(dtuId, id);
      return { ok: true, dtuId, memoryId: id };
    } catch (err) {
      return { ok: false, reason: "publish_failed", error: err?.message };
    }
  }, { destructive: true, note: "Publish a memory as kind='code_agents_md' DTU; secret-scan rejects leaked credentials" });

  register("code", "memory_import_agents_md", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    const projectPath = _normalisedProjectPath(input.projectPath || input.project_path);
    if (!projectPath) return { ok: false, reason: "invalid_project_path" };
    const fileName = String(input.filename || "AGENTS.md");
    if (fileName.includes("..") || fileName.startsWith("/")) return { ok: false, reason: "invalid_filename" };
    const filePath = pathJoin(projectPath, fileName);
    if (!existsSync(filePath)) return { ok: false, reason: "file_not_found", filePath };
    let content;
    try { content = readFileSync(filePath, "utf-8"); }
    catch (err) { return { ok: false, reason: "read_failed", error: err?.message }; }
    if (content.length > 200_000) return { ok: false, reason: "file_too_large" };
    const id = `code_mem:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO code_project_memory (id, user_id, project_path, kind, content, pinned, source)
        VALUES (?,?,?,'agents_md',?,1,'imported_agents_md')
        ON CONFLICT(user_id, project_path, kind, content) DO UPDATE SET pinned = 1
      `).run(id, userId, projectPath, content);
      return { ok: true, memoryId: id, fileName, bytes: content.length };
    } catch (err) {
      return { ok: false, reason: "import_failed", error: err?.message };
    }
  }, { destructive: true, note: "Read AGENTS.md from disk into project-memory; secret content stays local until memory_publish runs" });

  register("code", "memory_export_agents_md", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    const projectPath = _normalisedProjectPath(input.projectPath || input.project_path);
    if (!projectPath) return { ok: false, reason: "invalid_project_path" };
    const rows = db.prepare(`
      SELECT kind, content FROM code_project_memory
      WHERE user_id = ? AND project_path = ?
      ORDER BY pinned DESC, kind ASC, created_at ASC
    `).all(userId, projectPath);
    if (rows.length === 0) return { ok: false, reason: "no_memories" };
    const sections = { agents_md: [], rule: [], preference: [], naming_convention: [], pattern: [] };
    for (const r of rows) sections[r.kind].push(r.content);
    const md = [
      "# AGENTS.md",
      "",
      "Concord-managed project memory. Each section is composed from",
      "individual memory rows authored or imported through the code lens.",
      "",
      ...(sections.agents_md.length ? ["## Imported AGENTS.md content", "", ...sections.agents_md, ""] : []),
      ...(sections.rule.length ? ["## Rules", "", ...sections.rule.map((c) => `- ${c}`), ""] : []),
      ...(sections.preference.length ? ["## Preferences", "", ...sections.preference.map((c) => `- ${c}`), ""] : []),
      ...(sections.naming_convention.length ? ["## Naming conventions", "", ...sections.naming_convention.map((c) => `- ${c}`), ""] : []),
      ...(sections.pattern.length ? ["## Patterns", "", ...sections.pattern.map((c) => `- ${c}`), ""] : []),
    ].join("\n");
    const fileName = String(input.filename || "AGENTS.md");
    if (fileName.includes("..") || fileName.startsWith("/")) return { ok: false, reason: "invalid_filename" };
    const filePath = pathJoin(projectPath, fileName);
    try {
      writeFileSync(filePath, md, "utf-8");
      return { ok: true, filePath, bytes: md.length, sectionsWritten: Object.entries(sections).filter(([, v]) => v.length).map(([k]) => k) };
    } catch (err) {
      return { ok: false, reason: "write_failed", error: err?.message };
    }
  }, { destructive: true, note: "Write current project memory back out to AGENTS.md on disk" });

  register("code", "memory_active_prompt", async (ctx, input = {}) => {
    // Surface pinned memories as a system-prompt-ready string. The
    // agent-loop and multi-file-plan paths prepend this so rules
    // shape every brain call.
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db || !userId) return { ok: true, prompt: "" };
    const projectPath = _normalisedProjectPath(input.projectPath || input.project_path);
    if (!projectPath) return { ok: true, prompt: "" };
    const rows = db.prepare(`
      SELECT kind, content FROM code_project_memory
      WHERE user_id = ? AND project_path = ? AND (pinned = 1 OR kind = 'agents_md')
      ORDER BY pinned DESC, kind ASC, created_at ASC
      LIMIT 50
    `).all(userId, projectPath);
    if (rows.length === 0) return { ok: true, prompt: "" };
    const grouped = rows.reduce((acc, r) => {
      (acc[r.kind] = acc[r.kind] || []).push(r.content);
      return acc;
    }, {});
    const parts = [];
    if (grouped.agents_md?.length) parts.push("Project AGENTS.md content:\n" + grouped.agents_md.join("\n"));
    if (grouped.rule?.length) parts.push("Active rules:\n" + grouped.rule.map((c) => `- ${c}`).join("\n"));
    if (grouped.preference?.length) parts.push("Preferences:\n" + grouped.preference.map((c) => `- ${c}`).join("\n"));
    if (grouped.naming_convention?.length) parts.push("Naming conventions:\n" + grouped.naming_convention.map((c) => `- ${c}`).join("\n"));
    if (grouped.pattern?.length) parts.push("Patterns to follow:\n" + grouped.pattern.map((c) => `- ${c}`).join("\n"));
    return { ok: true, prompt: parts.join("\n\n"), pinnedCount: rows.length };
  }, { note: "Compose the active memory bundle as a system-prompt-ready string" });
}
