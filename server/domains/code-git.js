// server/domains/code-git.js
//
// Code Sprint A — Item #2: real git macros.
//
// Wraps server/lib/code/git.js with the macro registration surface.
// Real spawn-sync git; never user-shell-interpolated; env-gated by
// CONCORD_GIT_ENABLED=true. Commits mint as kind='code_commit' DTU.
// PR-body composition uses the utility brain to draft from the real
// log + name-status diff between base and head.

import {
  gitEnabled, gitStatus, gitDiff, gitCommit, gitBranch, gitLog,
  gitPush, gitDiffBetween,
} from "../lib/code/git.js";
import { randomUUID } from "node:crypto";

async function _mintCommitDtu(db, userId, result) {
  if (!db || !userId || !result?.sha) return null;
  const id = `code_commit:${randomUUID()}`;
  const meta = {
    sha: result.sha,
    message: result.message,
    files: result.files,
    repoPath: result.repoPath,
  };
  try {
    db.prepare(`
      INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
      VALUES (?, 'code_commit', ?, ?, ?, 1, 0, unixepoch())
    `).run(id, (result.message || "").slice(0, 120), userId, JSON.stringify(meta));
    return id;
  } catch {
    return null;
  }
}

async function _composePrBody({ ctx, base, head, commits, fileChanges }) {
  const llm = ctx?.llm;
  const fallback = () => {
    const summary = `## Changes\n${commits.map((c) => `- ${c.subject}`).join("\n")}\n\n## Files\n${fileChanges.map((f) => `- ${f.status} ${f.path}`).join("\n")}\n\n## Base → Head\n\`${base}\` → \`${head}\``;
    return summary;
  };
  if (!llm?.chat) return fallback();
  try {
    const prompt = `You are writing a clear, terse pull-request body for these commits and file changes.\n\nBase: ${base}\nHead: ${head}\n\nCommits:\n${commits.map((c) => `- ${c.subject}`).join("\n")}\n\nFiles changed:\n${fileChanges.map((f) => `${f.status} ${f.path}`).join("\n")}\n\nWrite a PR body in markdown with a single-sentence summary at the top, then a bulleted "Why" section (max 5 bullets), then a "What changed" section grouping by area. Do NOT pad with citations or fluff. Under 800 words.`;
    const resp = await llm.chat({
      messages: [{ role: "user", content: prompt }],
      slot: "utility",
      temperature: 0.3,
      maxTokens: 800,
    });
    const text = String(resp?.content || resp?.text || "").trim();
    if (text.length < 30) return fallback();
    return text;
  } catch {
    return fallback();
  }
}

export default function registerCodeGitMacros(register) {
  register("code", "git_enabled", async () => {
    return { ok: true, enabled: gitEnabled(), pushEnabled: String(process.env.CONCORD_GIT_PUSH_ENABLED || "").toLowerCase() === "true" };
  }, { note: "Reports git env-gate state for the UI" });

  register("code", "git_status", async (_ctx, input = {}) => {
    return gitStatus({ repoPath: String(input.repoPath || input.repo_path || "") });
  }, { note: "Real `git status --porcelain` parsed into structured rows" });

  register("code", "git_diff", async (_ctx, input = {}) => {
    return gitDiff({
      repoPath: String(input.repoPath || input.repo_path || ""),
      cached: !!input.cached,
      paths: Array.isArray(input.paths) ? input.paths : [],
    });
  }, { note: "Real `git diff` text for the diff viewer" });

  register("code", "git_commit", async (ctx, input = {}) => {
    const result = gitCommit({
      repoPath: String(input.repoPath || input.repo_path || ""),
      message: String(input.message || ""),
      files: Array.isArray(input.files) ? input.files : [],
      allowEmpty: !!input.allowEmpty,
    });
    const userId = ctx?.actor?.userId || ctx?.userId;
    const db = ctx?.db || ctx?.STATE?.db;
    if (result.ok && db && userId) {
      try {
        const id = await _mintCommitDtu(db, userId, result);
        if (id) result.dtuId = id;
      } catch { /* mint best-effort */ }
    }
    return result;
  }, { destructive: true, note: "Stage + commit; mints code_commit DTU on success" });

  register("code", "git_branch", async (_ctx, input = {}) => {
    return gitBranch({
      repoPath: String(input.repoPath || input.repo_path || ""),
      op: String(input.op || "list"),
      name: input.name ? String(input.name) : undefined,
    });
  }, { destructive: true, note: "Branch list / current / create / checkout / delete" });

  register("code", "git_log", async (_ctx, input = {}) => {
    return gitLog({
      repoPath: String(input.repoPath || input.repo_path || ""),
      limit: Number(input.limit) || 20,
    });
  }, { note: "Recent commits (sha / author / subject)" });

  register("code", "git_push", async (_ctx, input = {}) => {
    return gitPush({
      repoPath: String(input.repoPath || input.repo_path || ""),
      remote: String(input.remote || "origin"),
      branch: input.branch ? String(input.branch) : undefined,
    });
  }, { destructive: true, note: "Push to remote; double-gated via CONCORD_GIT_PUSH_ENABLED" });

  register("code", "git_pr_body", async (ctx, input = {}) => {
    const repoPath = String(input.repoPath || input.repo_path || "");
    const base = String(input.base || "main");
    const head = String(input.head || "HEAD");
    const diffResult = gitDiffBetween({ repoPath, base, head });
    if (!diffResult.ok) return diffResult;
    const body = await _composePrBody({
      ctx, base, head,
      commits: diffResult.commits,
      fileChanges: diffResult.fileChanges,
    });
    return { ok: true, base, head, body, commits: diffResult.commits, fileChanges: diffResult.fileChanges };
  }, { requiresLLM: true, note: "Compose a PR body from real git log + diff between base/head; falls back to a deterministic template when LLM unavailable" });
}
