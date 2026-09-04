// server/lib/runtime/sister-homes.js
//
// Concord Runtime — resolve the on-disk homes of sister systems that are
// Concord domains (Dila AutoTrader, Zuko, Pentester lab) without copying
// those trees into git. Missing homes are an honest `present:false`, never
// a fabricated healthy trader or lab.
//
// Secrets stay on disk. Callers must strip auth/key material before any
// value leaves an observe adapter (see stripSecrets).

// @sync-fs-ok: sister-system probes are bounded local-home diagnostics and never recurse.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(THIS_DIR, "../../..");

const SECRET_KEY_RE = /^(auth|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|private[_-]?key|credentials|token|key|keys)$/i;

/**
 * @param {object} [overrides]
 * @param {string} [overrides.homedir]
 * @param {string} [overrides.trading]
 * @param {string} [overrides.zuko]
 * @param {string} [overrides.cyberRange]
 * @param {string} [overrides.repoRoot]
 */
export function resolveSisterHomes(overrides = {}) {
  const homedir = overrides.homedir || os.homedir();
  return {
    trading: overrides.trading
      ?? process.env.CONCORD_DILA_TRADING_HOME
      ?? path.join(homedir, ".hermes", "dila-tools", "trading"),
    zuko: overrides.zuko
      ?? process.env.CONCORD_ZUKO_HOME
      ?? path.join(homedir, ".zuko"),
    cyberRange: overrides.cyberRange
      ?? process.env.CONCORD_CYBER_RANGE_HOME
      ?? path.join(homedir, ".hermes", "dila-tools", "cyber-range"),
    repoRoot: overrides.repoRoot
      ?? process.env.CONCORD_REPO_ROOT
      ?? DEFAULT_REPO_ROOT,
  };
}

export function homePresence(dir) {
  if (!dir || typeof dir !== "string") return { present: false, reason: "missing_path" };
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return { present: false, reason: "not_a_directory", path: dir };
    return { present: true, path: dir };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : null;
    return { present: false, reason: code === "ENOENT" ? "not_present" : "unreadable", path: dir };
  }
}

/** Read JSON if present. Never throws. Does not recurse-strip; callers decide. */
export function readJsonIfPresent(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { ok: true, value: JSON.parse(raw), path: filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : null;
    if (code === "ENOENT") return { ok: false, reason: "not_present", path: filePath };
    return { ok: false, reason: "unreadable", path: filePath, detail: err?.message || String(err) };
  }
}

export function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/** Drop auth/key material from a plain object. Arrays/primitives pass through. */
export function stripSecrets(value, depth = 0) {
  if (value == null || typeof value !== "object") return value;
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => stripSecrets(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = stripSecrets(v, depth + 1);
  }
  return out;
}

export function listDirNames(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}
