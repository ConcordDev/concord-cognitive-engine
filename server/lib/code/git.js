// server/lib/code/git.js
//
// Code Sprint A — Item #2: real git wrappers.
//
// concord's SourceControlPanel.tsx was a UI mock (zero git ops). Rivals
// (Cursor / Windsurf / Copilot Workspace / Claude Code / Aider / Zed /
// Codex) all ship real git. We add a spawn-sync wrapper around the
// `git` binary, env-gated by CONCORD_GIT_ENABLED=true, with strict
// arg validation: no shell interpolation, ever; no flag values that
// look like options.

import { spawnSync } from "node:child_process";
import { resolve as pathResolve, normalize as pathNormalize } from "node:path";
import { existsSync, statSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 60_000;

export function gitEnabled() {
  return String(process.env.CONCORD_GIT_ENABLED || "").toLowerCase() === "true"
      || process.env.CONCORD_GIT_ENABLED === "1";
}

export function workspaceRoot() {
  const root = process.env.CONCORD_CODE_WORKSPACE_ROOT || process.cwd();
  return pathResolve(root);
}

export function isInsideWorkspace(p) {
  if (!p || typeof p !== "string") return false;
  if (p.includes("..")) return false;
  const root = workspaceRoot();
  const abs = pathResolve(root, p);
  const normalized = pathNormalize(abs);
  return normalized === root || normalized.startsWith(root + "/");
}

// Validate args: must be strings, must not start with `-` unless allow-listed.
// Some git args legitimately start with `-` (e.g. `-m`, `--no-edit`); we
// allow specific ones per command rather than letting callers pass any flag.
const ALLOWED_FLAGS = new Set([
  "-m", "--message",
  "--allow-empty",
  "--porcelain", "--porcelain=v1",
  "-b", "-B",
  "-d", "-D",
  "--no-edit",
  "--soft", "--mixed", "--hard",
  "--cached",
  "--name-only", "--name-status",
  "-1", "-5", "-10", "-20", "-50",
  "--pretty=oneline", "--pretty=short", "--pretty=format:%H%x09%an%x09%s",
  "--oneline",
  "HEAD",
]);

function validateArgs(args) {
  if (!Array.isArray(args)) return { ok: false, reason: "args_must_be_array" };
  for (const a of args) {
    if (typeof a !== "string") return { ok: false, reason: "args_must_be_strings" };
    if (a.length > 1024) return { ok: false, reason: "arg_too_long" };
    if (a.startsWith("-") && !ALLOWED_FLAGS.has(a) && !a.startsWith("HEAD~")) {
      return { ok: false, reason: "flag_not_allowed", flag: a };
    }
  }
  return { ok: true };
}

function gitSpawn(repoPath, args, { timeoutMs = DEFAULT_TIMEOUT_MS, stdin } = {}) {
  const abs = pathResolve(workspaceRoot(), repoPath);
  if (!existsSync(abs)) return { ok: false, reason: "path_not_found" };
  if (!statSync(abs).isDirectory()) return { ok: false, reason: "path_not_directory" };
  const p = spawnSync("git", args, {
    cwd: abs,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    input: stdin,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
  if (p.error) {
    return { ok: false, reason: p.error.code === "ENOENT" ? "git_not_found" : "spawn_error", error: String(p.error.message || p.error) };
  }
  if (p.signal === "SIGTERM" || p.status === null) {
    return { ok: false, reason: "timeout", timeoutMs };
  }
  return {
    ok: true,
    exitCode: typeof p.status === "number" ? p.status : -1,
    stdout: String(p.stdout || ""),
    stderr: String(p.stderr || ""),
  };
}

function preflight(repoPath) {
  if (!gitEnabled()) return { ok: false, reason: "git_disabled", hint: "Set CONCORD_GIT_ENABLED=true" };
  if (!repoPath || typeof repoPath !== "string") return { ok: false, reason: "repo_path_required" };
  if (!isInsideWorkspace(repoPath)) return { ok: false, reason: "path_outside_workspace" };
  return { ok: true };
}

/**
 * git status --porcelain — structured list of changed files.
 */
export function gitStatus({ repoPath } = {}) {
  const pre = preflight(repoPath); if (!pre.ok) return pre;
  const r = gitSpawn(repoPath, ["status", "--porcelain"]);
  if (!r.ok) return r;
  if (r.exitCode !== 0) return { ok: false, reason: "not_a_repo", stderr: r.stderr };
  const files = r.stdout.split("\n").filter(Boolean).map((line) => {
    const x = line[0];
    const y = line[1];
    const path = line.slice(3);
    return {
      path,
      indexStatus: x === " " ? null : x,
      worktreeStatus: y === " " ? null : y,
      staged: x !== " " && x !== "?",
      modified: y !== " ",
      untracked: x === "?",
    };
  });
  return { ok: true, repoPath, files, clean: files.length === 0 };
}

/**
 * git diff [--cached] [paths...] — unified diff text.
 */
export function gitDiff({ repoPath, cached = false, paths = [] } = {}) {
  const pre = preflight(repoPath); if (!pre.ok) return pre;
  const v = validateArgs(paths); if (!v.ok) return v;
  for (const p of paths) {
    if (p.startsWith("-")) return { ok: false, reason: "path_looks_like_flag", path: p };
  }
  const args = ["diff", ...(cached ? ["--cached"] : []), "--", ...paths];
  const r = gitSpawn(repoPath, args);
  if (!r.ok) return r;
  return { ok: true, diff: r.stdout, exitCode: r.exitCode };
}

/**
 * git add <files> + git commit -m <message> — atomic stage + commit.
 *
 * `files` MUST be a non-empty array of relative paths; passing []
 * commits nothing and returns a structured error.
 */
export function gitCommit({ repoPath, message, files, allowEmpty = false } = {}) {
  const pre = preflight(repoPath); if (!pre.ok) return pre;
  if (!message || typeof message !== "string") return { ok: false, reason: "message_required" };
  if (message.length > 4000) return { ok: false, reason: "message_too_long" };
  if (!Array.isArray(files) || files.length === 0) return { ok: false, reason: "files_required" };
  for (const f of files) {
    if (typeof f !== "string" || f.startsWith("-")) return { ok: false, reason: "invalid_file", file: f };
    if (f.includes("..")) return { ok: false, reason: "path_traversal", file: f };
  }
  const add = gitSpawn(repoPath, ["add", "--", ...files]);
  if (!add.ok) return add;
  if (add.exitCode !== 0) return { ok: false, reason: "stage_failed", stderr: add.stderr };
  const commitArgs = ["commit", "-m", message];
  if (allowEmpty) commitArgs.push("--allow-empty");
  const r = gitSpawn(repoPath, commitArgs);
  if (!r.ok) return r;
  if (r.exitCode !== 0) {
    return { ok: false, reason: "commit_failed", exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
  }
  // Capture SHA for the commit we just made.
  const sha = gitSpawn(repoPath, ["rev-parse", "HEAD"]);
  return {
    ok: true,
    repoPath,
    message,
    files,
    sha: sha.ok ? sha.stdout.trim() : null,
    stdout: r.stdout,
  };
}

/**
 * git branch operations: list / create / checkout / delete.
 *   op = 'list' | 'current' | 'create' | 'checkout' | 'delete'
 */
export function gitBranch({ repoPath, op = "list", name } = {}) {
  const pre = preflight(repoPath); if (!pre.ok) return pre;
  if (op === "list") {
    const r = gitSpawn(repoPath, ["branch", "--list"]);
    if (!r.ok) return r;
    const branches = r.stdout.split("\n").filter(Boolean).map((l) => ({
      name: l.replace(/^\*?\s+/, ""),
      current: l.startsWith("*"),
    }));
    return { ok: true, branches };
  }
  if (op === "current") {
    const r = gitSpawn(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!r.ok) return r;
    return { ok: true, branch: r.stdout.trim() };
  }
  if (!name || typeof name !== "string" || name.startsWith("-") || /\s/.test(name) || name.length > 200) {
    return { ok: false, reason: "invalid_branch_name" };
  }
  if (op === "create") {
    const r = gitSpawn(repoPath, ["checkout", "-b", name]);
    if (!r.ok) return r;
    if (r.exitCode !== 0) return { ok: false, reason: "create_failed", stderr: r.stderr };
    return { ok: true, branch: name, created: true };
  }
  if (op === "checkout") {
    const r = gitSpawn(repoPath, ["checkout", name]);
    if (!r.ok) return r;
    if (r.exitCode !== 0) return { ok: false, reason: "checkout_failed", stderr: r.stderr };
    return { ok: true, branch: name };
  }
  if (op === "delete") {
    const r = gitSpawn(repoPath, ["branch", "-d", name]);
    if (!r.ok) return r;
    if (r.exitCode !== 0) return { ok: false, reason: "delete_failed", stderr: r.stderr };
    return { ok: true, branch: name, deleted: true };
  }
  return { ok: false, reason: "unknown_op", op };
}

/**
 * git log limited shape — recent commits with sha / author / subject.
 */
export function gitLog({ repoPath, limit = 20 } = {}) {
  const pre = preflight(repoPath); if (!pre.ok) return pre;
  const n = Math.min(200, Math.max(1, Number(limit) || 20));
  const r = gitSpawn(repoPath, ["log", `-${n}`, "--pretty=format:%H%x09%an%x09%s"]);
  if (!r.ok) return r;
  const commits = r.stdout.split("\n").filter(Boolean).map((line) => {
    const [sha, author, ...rest] = line.split("\t");
    return { sha, author, subject: rest.join("\t") };
  });
  return { ok: true, commits };
}

/**
 * git push — env-gated stricter (CONCORD_GIT_PUSH_ENABLED=true)
 * because it touches a remote; off by default.
 */
export function gitPush({ repoPath, remote = "origin", branch } = {}) {
  const pre = preflight(repoPath); if (!pre.ok) return pre;
  if (String(process.env.CONCORD_GIT_PUSH_ENABLED || "").toLowerCase() !== "true"
      && process.env.CONCORD_GIT_PUSH_ENABLED !== "1") {
    return { ok: false, reason: "push_disabled", hint: "Set CONCORD_GIT_PUSH_ENABLED=true" };
  }
  if (typeof remote !== "string" || remote.startsWith("-") || /\s/.test(remote)) {
    return { ok: false, reason: "invalid_remote" };
  }
  if (branch && (typeof branch !== "string" || branch.startsWith("-") || /\s/.test(branch))) {
    return { ok: false, reason: "invalid_branch" };
  }
  const args = ["push", remote, ...(branch ? [branch] : [])];
  const r = gitSpawn(repoPath, args);
  if (!r.ok) return r;
  if (r.exitCode !== 0) return { ok: false, reason: "push_failed", stderr: r.stderr };
  return { ok: true, remote, branch, stdout: r.stdout };
}

/**
 * git diff <base>...<head> — for PR body composition.
 */
export function gitDiffBetween({ repoPath, base, head } = {}) {
  const pre = preflight(repoPath); if (!pre.ok) return pre;
  if (!base || !head) return { ok: false, reason: "base_and_head_required" };
  for (const ref of [base, head]) {
    if (typeof ref !== "string" || ref.startsWith("-") || /\s/.test(ref) || ref.length > 200) {
      return { ok: false, reason: "invalid_ref", ref };
    }
  }
  const r = gitSpawn(repoPath, ["diff", `${base}...${head}`, "--name-status"]);
  if (!r.ok) return r;
  const fileChanges = r.stdout.split("\n").filter(Boolean).map((line) => {
    const [status, ...rest] = line.split("\t");
    return { status, path: rest.join("\t") };
  });
  const logR = gitSpawn(repoPath, ["log", `${base}..${head}`, "--pretty=format:%H%x09%s"]);
  const commits = logR.ok
    ? logR.stdout.split("\n").filter(Boolean).map((l) => {
        const [sha, ...rest] = l.split("\t");
        return { sha, subject: rest.join("\t") };
      })
    : [];
  return { ok: true, fileChanges, commits };
}
