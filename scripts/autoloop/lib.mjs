// scripts/autoloop/lib.mjs
// Shared helpers for the autonomous completion loop. No server boot here — these
// are thin, fast utilities the loop scripts compose. The heavy lifting lives in
// the existing rankers (depth-backlog, grade-macro-depth, grade-ux-polish,
// audit-emergent-wiring, …) which these helpers only INVOKE and parse.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BACKLOG_PATH = resolve(REPO, "audit/autoloop/backlog.json");
export const PROGRESS_PATH = resolve(REPO, "audit/autoloop/progress.md");
export const STOP_PATH = resolve(REPO, "AGENT_STOP");
export const STEER_PATH = resolve(REPO, "STEER.md");

/**
 * Run a command WITHOUT a shell — argv form, so no interpolation can ever
 * reach a shell parser. This is the ONLY process-spawn primitive in the
 * autoloop now (2026-07-25, authorized edit to a PROTECTED path): the prior
 * `run(cmd)` helper passed a STRING to `execSync`, i.e. through a shell, which
 * is a command-injection sink shape regardless of whether today's callers
 * happen to pass only literals — the moment any future caller threads a
 * computed value through it, it's exploitable. Every call site in
 * scripts/autoloop/*.mjs (this file included) has been migrated to call
 * `runArgv` directly, or to do the shell-only part (globs, pipes) in Node
 * first. See scripts/autoloop/verify.mjs and status.mjs for the two cases
 * that needed real Node reimplementation (a glob and a grep-pipe) rather
 * than a 1:1 argv translation.
 */
export function runArgv(file, args = [], { timeoutMs = 600000, allowFail = true, cwd = REPO } = {}) {
  try {
    const out = execFileSync(file, args, {
      cwd, encoding: "utf8", timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, code: 0, out };
  } catch (e) {
    if (!allowFail) throw e;
    return { ok: false, code: e.status ?? 1, out: String(e.stdout || "") + String(e.stderr || "") };
  }
}

/** Read + parse a JSON file; return fallback on any error. */
export function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

export function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

export function loadBacklog() {
  return readJson(BACKLOG_PATH, { generatedAt: null, units: [] });
}
export function saveBacklog(b) { writeJson(BACKLOG_PATH, b); }

/** Append a timestamped line to the progress journal. */
export function journal(line) {
  mkdirSync(dirname(PROGRESS_PATH), { recursive: true });
  const stamp = new Date().toISOString();
  const prefix = existsSync(PROGRESS_PATH) ? "" : "# Autonomous loop — progress journal\n\n";
  writeFileSync(PROGRESS_PATH, prefix, { flag: existsSync(PROGRESS_PATH) ? "a" : "w" });
  writeFileSync(PROGRESS_PATH, `- \`${stamp}\` ${line}\n`, { flag: "a" });
}

/** The list of files changed vs HEAD (staged + unstaged + untracked). */
export function changedFiles() {
  const tracked = runArgv("git", ["diff", "--name-only", "HEAD"]).out.split("\n");
  const untracked = runArgv("git", ["ls-files", "--others", "--exclude-standard"]).out.split("\n");
  return [...new Set([...tracked, ...untracked].map((s) => s.trim()).filter(Boolean))];
}

/** The unified diff vs HEAD (for inspection by the guard / verifier). */
export function diffVsHead() {
  return runArgv("git", ["diff", "HEAD"]).out;
}

export function stopRequested() { return existsSync(STOP_PATH); }
export function steerMessage() {
  if (!existsSync(STEER_PATH)) return null;
  const msg = readFileSync(STEER_PATH, "utf8");
  return msg;
}

/**
 * @deprecated Inert compatibility stub — DO NOT call. Removed for real
 * 2026-07-25 (command-injection fix, authorized edit to a PROTECTED path):
 * this used to run a command STRING through `execSync` (a shell), the exact
 * sink shape the `command-injection` detector flags at
 * `server/lib/detectors/command-injection-detector.js`. Every real caller in
 * scripts/autoloop/*.mjs is migrated to `runArgv` (argv form, no shell) or a
 * small Node reimplementation of the one or two calls that needed genuine
 * shell features — see the `runArgv` doc comment above for the ledger.
 *
 * The name stays exported, as a throwing stub rather than deleted outright,
 * because `scripts/autoloop/guard.mjs` — PROTECTED, and this task is
 * explicitly NOT authorized to edit it — still has a dead
 * `import { run } from "./lib.mjs"` left over from an earlier pass; it never
 * calls `run()`, but ESM raises a hard link-time
 * "does not provide an export named 'run'" error the instant the name
 * disappears, which would crash the anti-gaming gate on every commit. That
 * would be strictly worse than an unused, throwing export. Whoever next
 * cleans up guard.mjs's dead import should delete this stub in the same
 * commit.
 */
export function run() {
  throw new Error(
    "lib.mjs#run() was removed 2026-07-25 (command-injection fix) — use runArgv(file, args) instead. " +
    "If you hit this, a caller was not migrated; do not resurrect a shell-string helper to fix it."
  );
}

export const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", b: "\x1b[34m", dim: "\x1b[2m", rst: "\x1b[0m" };
export const ok = (s) => `${C.g}${s}${C.rst}`;
export const bad = (s) => `${C.r}${s}${C.rst}`;
export const warn = (s) => `${C.y}${s}${C.rst}`;
