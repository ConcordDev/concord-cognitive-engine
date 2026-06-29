// scripts/autoloop/lib.mjs
// Shared helpers for the autonomous completion loop. No server boot here — these
// are thin, fast utilities the loop scripts compose. The heavy lifting lives in
// the existing rankers (depth-backlog, grade-macro-depth, grade-ux-polish,
// audit-emergent-wiring, …) which these helpers only INVOKE and parse.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BACKLOG_PATH = resolve(REPO, "audit/autoloop/backlog.json");
export const PROGRESS_PATH = resolve(REPO, "audit/autoloop/progress.md");
export const STOP_PATH = resolve(REPO, "AGENT_STOP");
export const STEER_PATH = resolve(REPO, "STEER.md");

/** Run a command from the repo root, return { ok, code, out }. Never throws. */
export function run(cmd, { timeoutMs = 600000, allowFail = true } = {}) {
  try {
    const out = execSync(cmd, { cwd: REPO, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
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
  const tracked = run("git diff --name-only HEAD").out.split("\n");
  const untracked = run("git ls-files --others --exclude-standard").out.split("\n");
  return [...new Set([...tracked, ...untracked].map((s) => s.trim()).filter(Boolean))];
}

/** The unified diff vs HEAD (for inspection by the guard / verifier). */
export function diffVsHead() {
  return run("git diff HEAD").out;
}

export function stopRequested() { return existsSync(STOP_PATH); }
export function steerMessage() {
  if (!existsSync(STEER_PATH)) return null;
  const msg = readFileSync(STEER_PATH, "utf8");
  return msg;
}

export const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", b: "\x1b[34m", dim: "\x1b[2m", rst: "\x1b[0m" };
export const ok = (s) => `${C.g}${s}${C.rst}`;
export const bad = (s) => `${C.r}${s}${C.rst}`;
export const warn = (s) => `${C.y}${s}${C.rst}`;
