// server/domains/code-engine.js
//
// Code Sprint A — Item #5: wire the dark code-engine.
//
// `server/lib/code-engine.js` is 1,786 LOC of unused production code
// (audit-verified). It already does AST pattern extraction across 8
// categories (architectural / error_handling / security / performance /
// testing / data_modeling / api_design / concurrency), CRETI scoring,
// and Mega DTU compression. Five migrations (028 / 125 / 164) already
// create `code_repositories` / `code_patterns` / `code_megas` /
// `lens_generations` / `code_errors`. We add the missing macro surface
// + UI hook so the engine becomes user-facing.
//
// Mints `kind='code_pattern'` DTUs per extracted pattern so the cascade
// pays the author when others cite the pattern in their builds.

import { createCodeEngine } from "../lib/code-engine.js";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { resolve as pathResolve, relative as pathRelative, extname } from "node:path";
import { randomUUID } from "node:crypto";

const ENGINE_CACHE = new WeakMap();

function getEngine(db) {
  if (!db) return null;
  let engine = ENGINE_CACHE.get(db);
  if (!engine) {
    engine = createCodeEngine(db);
    ENGINE_CACHE.set(db, engine);
  }
  return engine;
}

const SOURCE_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".swift", ".c", ".cc", ".cpp", ".h", ".hpp",
  ".cs", ".php", ".scala", ".elm", ".clj",
]);

// Walk a directory and read every file with a known source extension.
// Caps at MAX_FILES + MAX_BYTES_PER_FILE to keep an ingest tractable.
function _collectSourceFiles(root, { maxFiles = 2000, maxBytesPerFile = 256 * 1024, ignoreDirs = new Set(["node_modules", ".git", "dist", "build", ".next", "target", "venv", "__pycache__"]) } = {}) {
  const files = [];
  function walk(dir) {
    if (files.length >= maxFiles) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (files.length >= maxFiles) return;
      if (ignoreDirs.has(ent.name)) continue;
      const abs = pathResolve(dir, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (!ent.isFile()) continue;
      const ext = extname(ent.name).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;
      let st; try { st = statSync(abs); } catch { continue; }
      if (st.size > maxBytesPerFile) continue;
      let content; try { content = readFileSync(abs, "utf-8"); } catch { continue; }
      files.push({ path: pathRelative(root, abs), content });
    }
  }
  walk(root);
  return files;
}

async function _mintPatternDtus(db, userId, patterns, repoUrl) {
  if (!db || !userId) return 0;
  let minted = 0;
  for (const p of patterns) {
    try {
      const id = `code_pattern:${randomUUID()}`;
      const meta = {
        category: p.category,
        name: p.name,
        file_path: p.file_path,
        creti: p.creti_score ?? p.creti ?? null,
        repo_url: repoUrl,
      };
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
        VALUES (?, 'code_pattern', ?, ?, ?, 1, 0, unixepoch())
      `).run(id, String(p.name || "Pattern").slice(0, 120), userId, JSON.stringify(meta));
      minted++;
    } catch { /* per-pattern best-effort */ }
  }
  return minted;
}

export default function registerCodeEngineMacros(register) {
  register("code", "ingest_repo", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const engine = getEngine(db);
    if (!engine) return { ok: false, reason: "engine_unavailable" };

    const url = String(input.url || input.repo_url || "").trim();
    const localPath = String(input.localPath || input.local_path || "").trim();
    const allowCopyleft = !!input.allowCopyleft;

    let sourceFiles = [];
    let repoUrl = url;
    if (localPath) {
      const root = pathResolve(process.env.CONCORD_CODE_WORKSPACE_ROOT || process.cwd(), localPath);
      if (localPath.includes("..")) return { ok: false, reason: "path_traversal" };
      try { statSync(root); } catch { return { ok: false, reason: "path_not_found" }; }
      sourceFiles = _collectSourceFiles(root, {
        maxFiles: Number(input.maxFiles) || 2000,
        maxBytesPerFile: Number(input.maxBytesPerFile) || 256 * 1024,
      });
      if (!repoUrl) {
        // code-engine._parseRepoUrl requires owner/name; synthesise a
        // stable URL keyed by the absolute path so repeat ingests are
        // recognised as the same repo (UNIQUE constraint on url).
        const safeOwner = "local";
        const safeName = root.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-80) || "workspace";
        repoUrl = `${safeOwner}/${safeName}`;
      }
    } else if (Array.isArray(input.sourceFiles)) {
      sourceFiles = input.sourceFiles.filter((f) => f && typeof f.path === "string" && typeof f.content === "string");
    }

    if (!repoUrl) return { ok: false, reason: "url_or_local_path_required" };
    if (sourceFiles.length === 0) return { ok: false, reason: "no_source_files", hint: "Pass localPath or sourceFiles[]" };

    try {
      const result = engine.ingestRepository(repoUrl, {
        sourceFiles, allowCopyleft,
        license: input.license, stars: input.stars, language: input.language,
      });
      const userId = ctx?.actor?.userId || ctx?.userId;
      const minted = userId ? await _mintPatternDtus(db, userId, result.patterns || [], repoUrl) : 0;
      return {
        ok: true,
        repository: result.repository,
        patternsExtracted: result.patternsExtracted,
        patternsPreview: result.patterns,
        dtusMinted: minted,
        sourceFileCount: sourceFiles.length,
      };
    } catch (err) {
      return { ok: false, reason: err?.code || "ingest_failed", error: String(err?.message || err) };
    }
  }, { destructive: true, note: "Ingest a repo (URL or local path) into code-engine; mints kind='code_pattern' DTUs per pattern" });

  register("code", "search_patterns", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const engine = getEngine(db);
    if (!engine) return { ok: false, reason: "engine_unavailable" };
    try {
      const result = engine.searchPatterns({
        category: input.category,
        name: input.name,
        minCreti: Number(input.minCreti) || undefined,
        language: input.language,
        repositoryId: input.repositoryId,
        limit: Math.min(200, Number(input.limit) || 50),
        offset: Math.max(0, Number(input.offset) || 0),
      });
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, reason: "search_failed", error: String(err?.message || err) };
    }
  }, { note: "Search code-engine patterns by category / name / creti / language" });

  register("code", "list_repos", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const engine = getEngine(db);
    if (!engine) return { ok: false, reason: "engine_unavailable" };
    try {
      const r = engine.listRepositories({
        limit: Math.min(200, Number(input.limit) || 50),
        offset: Math.max(0, Number(input.offset) || 0),
        status: input.status,
      });
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, reason: "list_failed", error: String(err?.message || err) };
    }
  }, { note: "List ingested repositories" });

  register("code", "list_megas", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const engine = getEngine(db);
    if (!engine) return { ok: false, reason: "engine_unavailable" };
    try {
      const r = engine.listMegas({
        limit: Math.min(200, Number(input.limit) || 50),
        offset: Math.max(0, Number(input.offset) || 0),
      });
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, reason: "list_failed", error: String(err?.message || err) };
    }
  }, { note: "List MEGA-compressed pattern clusters" });

  register("code", "engine_stats", async (ctx) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const engine = getEngine(db);
    if (!engine) return { ok: false, reason: "engine_unavailable" };
    try {
      return { ok: true, stats: engine.getStats() };
    } catch (err) {
      return { ok: false, reason: "stats_failed", error: String(err?.message || err) };
    }
  }, { note: "Top-level engine stats for the RepoIndexPanel header" });
}
