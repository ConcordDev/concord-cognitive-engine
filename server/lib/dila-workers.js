// server/lib/dila-workers.js
//
// Fleet roster for dila_workers.
//
// The previous implementation kept a hardcoded subset in mcp-tools.js and
// forked `ps aux | grep` once per name. That silently dropped every worker
// not on the list (wr-kimi-k2.5, wr-gemini-*, wr-groq-*, oc-embed, …) and
// false-positived prefixes ("wr-grok" matching "wr-grok-4.6").
//
// Contract:
//   1. Seed list covers workers that may not have a /tmp dir yet.
//   2. /tmp/llm-workers/<cc|oc|wr>-* dirs are discovered and merged.
//   3. test-* / junk dirs are ignored.
//   4. Alive-check is one `ps aux` snapshot, matched with a token boundary
//      so "name wr-grok" does not match "name wr-grok-4.6".
//   5. Status logs are read with async fs, in parallel.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export const DEFAULT_WORKERS_ROOT = "/tmp/llm-workers";

/** Workers that must appear even if their runtime dir has not been created. */
export const SEEDED_WORKERS = Object.freeze({
  claude: Object.freeze(["cc-haiku", "cc-be"]),
  opencode: Object.freeze([
    "oc-pickle", "oc-data", "oc-frontend", "oc-qa",
    "oc-ops", "oc-lightning", "oc-vision", "oc-embed",
  ]),
  wr: Object.freeze([
    "wr-mistral-1", "wr-mistral-2", "wr-mistral-3", "wr-mistral-4",
    "wr-pickle", "wr-frontend", "wr-ops", "wr-qa",
    "wr-data", "wr-embed", "wr-lightning", "wr-vision",
    "wr-distill", "wr-summary", "wr-task",
    "wr-grok", "wr-grok-reasoning", "wr-grok-4.6", "wr-grok-code",
    "wr-kimi-k2.5",
    "wr-gemini-1", "wr-gemini-2", "wr-gemini-3", "wr-gemini-4",
    "wr-gemini-5", "wr-gemini-6", "wr-gemini-7", "wr-gemini-8",
    "wr-groq", "wr-groq-1", "wr-groq-2", "wr-groq-3",
    "wr-cerebras-1", "wr-cerebras-2", "wr-cerebras-3",
    "wr-aiml", "wr-venice",
  ]),
});

const FLEET_NAME_RE = /^(cc|oc|wr)-[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function familyOf(name) {
  const n = String(name || "");
  if (n.startsWith("cc-")) return "claude";
  if (n.startsWith("oc-")) return "opencode";
  if (n.startsWith("wr-")) return "wr";
  return "other";
}

export function isFleetWorker(name) {
  return FLEET_NAME_RE.test(String(name || ""));
}

export function mergeRoster({ seed = SEEDED_WORKERS, discovered = [] } = {}) {
  const byName = new Map();
  for (const [family, names] of Object.entries(seed || {})) {
    for (const name of names || []) {
      if (!name) continue;
      byName.set(name, { name, family, source: "seed" });
    }
  }
  for (const raw of discovered || []) {
    const name = String(raw || "").trim();
    if (!isFleetWorker(name)) continue;
    if (byName.has(name)) continue;
    byName.set(name, { name, family: familyOf(name), source: "discovered" });
  }
  return [...byName.values()].sort((a, b) => {
    const fam = a.family.localeCompare(b.family);
    return fam !== 0 ? fam : a.name.localeCompare(b.name);
  });
}

export async function discoverWorkerDirs(root = DEFAULT_WORKERS_ROOT) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && isFleetWorker(e.name))
      .map((e) => e.name);
  } catch {
    // observed: /tmp/llm-workers may be absent in CI / restricted envs
    return [];
  }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `ps aux` text contains a launch token for this worker.
 * Requires a trailing boundary so "wr-grok" does not match "wr-grok-4.6".
 */
export function parseAliveFromPs(psText, workerName) {
  if (!psText || !workerName) return false;
  // Match `name wr-kimi-k2.5` / `--name wr-kimi-k2.5` but not `name wr-grok`
  // inside `name wr-grok-4.6`. Name chars are [A-Za-z0-9._-].
  const re = new RegExp(`name\\s+${escapeRegExp(workerName)}(?![A-Za-z0-9._-])`);
  return re.test(String(psText));
}

export async function snapshotProcesses() {
  try {
    const { stdout } = await execFileAsync("ps", ["aux"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout || "";
  } catch {
    // observed: ps may fail in restricted envs
    return "";
  }
}

export async function readLastStatus(root, name) {
  try {
    const text = await readFile(join(root, name, "status.log"), "utf8");
    const lines = text.trim().split("\n").filter(Boolean);
    if (!lines.length) return null;
    return lines[lines.length - 1].replace(/\s+/g, " ").slice(0, 140);
  } catch {
    // observed: status.log may be absent
    return null;
  }
}

export async function listDilaWorkers({
  family = "all",
  limit = 100,
  root = DEFAULT_WORKERS_ROOT,
  psText = null,
} = {}) {
  const familyFilter = family || "all";
  const cap = Math.min(200, Math.max(1, Number(limit) || 100));
  const discovered = await discoverWorkerDirs(root);
  let roster = mergeRoster({ discovered });
  if (familyFilter !== "all") {
    roster = roster.filter((w) => w.family === familyFilter);
  }
  const truncated = roster.length > cap;
  roster = roster.slice(0, cap);

  const ps = psText == null ? await snapshotProcesses() : String(psText);
  const workers = await Promise.all(roster.map(async (w) => ({
    name: w.name,
    family: w.family,
    source: w.source,
    alive: parseAliveFromPs(ps, w.name),
    last_status: await readLastStatus(root, w.name),
  })));

  return {
    ok: true,
    family: familyFilter,
    total: workers.length,
    alive: workers.filter((w) => w.alive).length,
    truncated,
    workers,
    ts: new Date().toISOString(),
  };
}

/**
 * Roster shape for org sync + model routing — array of { name, family, alive, last_status }.
 */
export async function getWorkerRoster(opts = {}) {
  const result = await listDilaWorkers(opts);
  return (result.workers || []).map((w) => ({
    name: w.name,
    family: w.family,
    alive: w.alive,
    last_status: w.last_status,
    source: w.source,
  }));
}
