// server/lib/world-template-pack.js
//
// World Template Pack — package an EXISTING authored sub-world
// (content/world/<worldId>/) into a versioned, shareable envelope that
// can be re-imported under a different world id.
//
// This is the missing "template PRODUCER" for authored worlds. It is
// deliberately NOT built on top of dtu-portability.js — that module's
// data model is DB-row/DTU-corpus shaped (SELECT out of `dtus` /
// `dtu_citations` / `economy_ledger`), while a sub-world is a static
// content/world/<id>/ directory of JSON files (meta/npcs/factions/lore
// plus optional per-genre enrichment files — calendar.json,
// bestiary.json, industries.json, etc. from world-kit-templates.js, and
// even nested subdirectories like quests/). The two modules imitate the
// SAME envelope pattern (versioned `spec` string, canonicalStringify +
// sha256 integrity hash so tampering is detectable) rather than sharing
// code, because forcing a shared abstraction across "rows from a DB
// query" and "files under a directory" would be the wrong kind of DRY.
//
// Envelope shape:
//   {
//     spec: "concord-world-template-pack/v1",
//     exported_at: <unix>,
//     source_world_id: <the worldId this was packed from>,
//     placeholder_token: "__WORLD_ID__",
//     files: [ { path: <posix-relative-path>, content: <utf8 text> }, ... ],
//     hashes: { files_sha256 },
//     counts: { files: <N> }
//   }
//
// De-identification: every literal occurrence of the source world id
// string is find-replaced with `placeholder_token` across every packed
// file's raw text content (not just the meta.json world_id field — an
// authored world routinely repeats its id inside npc/faction ids like
// `${worldId}_founding_circle`, in nested lore cross-references, etc.).
// On import the placeholder is substituted back to the caller's chosen
// new world id, so the imported copy is self-consistent under its new
// name with no stale self-references to the source id.
//
// Known limitation (accepted, not silently hidden): the substitution is
// a literal substring find-replace, not a schema-aware rewrite. If the
// source world id happens to be a substring of an unrelated word inside
// authored prose (e.g. a 3-letter world id embedded in ordinary text),
// that occurrence is replaced too. This mirrors the tradeoff the task
// asked for explicitly ("find-replace every literal occurrence") — for
// the kebab-case ids Concord's worlds actually use (multi-word,
// hyphenated: "sovereign-ruins", "lattice-crucible", "concord-link-
// frontier") false-positive substring collisions are unlikely in
// practice, and every import re-validates every record through the real
// content-seeder.js validators before anything is trusted, so a
// corrupted field would still be caught structurally where a validator
// exists.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SPEC = "concord-world-template-pack/v1";
const PLACEHOLDER_TOKEN = "__WORLD_ID__";

const WORLD_ID_RE = /^[a-z][a-z0-9-]*$/;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Real repo-relative location of the validators this module defers to on
// import. Resolved from THIS file's own location (server/lib/) so it is
// correct regardless of what `contentRoot` the caller passes for reading/
// writing content — mirrors scripts/scaffold-world.mjs's
// REAL_CONTENT_SEEDER note: the validators are pure functions with no DB/
// STATE dependency, so importing them standalone is safe.
const REAL_CONTENT_SEEDER_PATH = path.join(__dirname, "content-seeder.js");

// ── Canonical stringify + hash (same algorithm as dtu-portability.js) ───────
// Deliberately duplicated rather than imported — this module has no other
// dependency on dtu-portability.js and the algorithm is 4 lines; importing
// across two otherwise-unrelated pack formats for one helper would create
// a coupling neither format needs.

export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Literal (non-regex) global replace — safe for world ids containing
// regex-special characters like "-" or ".".
function replaceAllLiteral(text, search, replacement) {
  if (!search) return text;
  return text.split(search).join(replacement);
}

// ── Directory walk ───────────────────────────────────────────────────────

function walkFiles(dir, base = dir) {
  let out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(walkFiles(full, base));
    } else if (entry.isFile()) {
      const rel = path.relative(base, full).split(path.sep).join("/");
      out.push(rel);
    }
  }
  return out;
}

// ── Export ────────────────────────────────────────────────────────────────

/**
 * Pack an existing content/world/<worldId>/ directory into a versioned,
 * de-identified template envelope.
 *
 * @param {string} worldId      the existing sub-world directory name to pack
 * @param {string} contentRoot  repo root — content lives at
 *                              `${contentRoot}/content/world/<worldId>/`
 *                              (same convention as scripts/scaffold-world.mjs's
 *                              --root, so tests can point this at a temp dir)
 * @returns {{ ok: boolean, envelope?: object, reason?: string, error?: string }}
 */
export function exportWorldPack(worldId, contentRoot) {
  if (typeof worldId !== "string" || !worldId) {
    return { ok: false, reason: "missing_world_id", error: "missing_world_id" };
  }
  if (typeof contentRoot !== "string" || !contentRoot) {
    return { ok: false, reason: "missing_content_root", error: "missing_content_root" };
  }

  const worldDir = path.join(contentRoot, "content", "world", worldId);
  let stat;
  try { stat = fs.statSync(worldDir); } catch { stat = null; }
  if (!stat || !stat.isDirectory()) {
    return { ok: false, reason: "world_not_found", error: "world_not_found" };
  }

  const relPaths = walkFiles(worldDir).sort();
  if (relPaths.length === 0) {
    return { ok: false, reason: "empty_world_dir", error: "empty_world_dir" };
  }

  const files = [];
  for (const rel of relPaths) {
    const abs = path.join(worldDir, ...rel.split("/"));
    let raw;
    try { raw = fs.readFileSync(abs, "utf8"); }
    catch (err) { return { ok: false, reason: "read_failed", error: err.message, path: rel }; }
    files.push({ path: rel, content: replaceAllLiteral(raw, worldId, PLACEHOLDER_TOKEN) });
  }

  const files_sha256 = sha256(canonicalStringify(files));

  const envelope = {
    spec: SPEC,
    exported_at: Math.floor(Date.now() / 1000),
    source_world_id: worldId,
    placeholder_token: PLACEHOLDER_TOKEN,
    files,
    hashes: { files_sha256 },
    counts: { files: files.length },
  };

  return { ok: true, envelope };
}

// ── Integrity validation ────────────────────────────────────────────────────

/**
 * Pure integrity check on a world template pack envelope. Does not touch
 * disk, does not run the content-seeder validators (that happens in
 * importWorldPack, after the placeholder substitution, since the real
 * validators need the FINAL world id in place — e.g. meta.json's
 * world_id must equal the target id, not the placeholder).
 */
export function validateWorldPackEnvelope(envelope) {
  if (!envelope || envelope.spec !== SPEC) {
    return { ok: false, reason: "bad_spec", error: "bad_spec" };
  }
  if (typeof envelope.source_world_id !== "string" || !envelope.source_world_id) {
    return { ok: false, reason: "no_source_world_id", error: "no_source_world_id" };
  }
  if (typeof envelope.placeholder_token !== "string" || !envelope.placeholder_token) {
    return { ok: false, reason: "no_placeholder_token", error: "no_placeholder_token" };
  }
  if (!Array.isArray(envelope.files)) {
    return { ok: false, reason: "files_missing", error: "files_missing" };
  }
  const expected = envelope.hashes?.files_sha256;
  if (!expected) {
    return { ok: false, reason: "no_hash", error: "no_hash" };
  }
  const recomputed = sha256(canonicalStringify(envelope.files));
  if (recomputed !== expected) {
    return { ok: false, reason: "files_hash_mismatch", error: "files_hash_mismatch" };
  }
  return { ok: true, fileCount: envelope.files.length };
}

// ── Import ───────────────────────────────────────────────────────────────

/**
 * Import a world template pack under a NEW world id.
 *
 * Contract: nothing is written to disk unless (a) the envelope's
 * integrity hash verifies, AND (b) every record that has a real
 * content-seeder.js validator (npcs.json / npcs-extra.json → validateNpc,
 * factions.json / factions-extra.json → validateFaction, lore.json's
 * history[] → validateLoreEvent, anything under a quests/ directory →
 * validateQuest) passes it, AND (c) meta.json (if present) carries a
 * non-empty world_id equal to newWorldId and a non-empty universe_type
 * (the same double-gate assertion scripts/scaffold-world.mjs makes at
 * generation time). Any failure aborts BEFORE any file is written —
 * validation runs entirely in-memory first.
 *
 * @param {object} envelope     a world template pack envelope (see exportWorldPack)
 * @param {string} newWorldId   kebab-case id for the imported copy
 * @param {string} contentRoot  repo root to write into
 * @param {object} [opts]
 * @param {boolean} [opts.force]   overwrite an existing content/world/<newWorldId>/ dir
 * @param {boolean} [opts.dryRun]  validate only; write nothing
 * @returns {Promise<{ ok: boolean, imported?: object, worldId?: string, dir?: string, reason?: string, problems?: string[] }>}
 */
export async function importWorldPack(envelope, newWorldId, contentRoot, opts = {}) {
  if (typeof newWorldId !== "string" || !WORLD_ID_RE.test(newWorldId)) {
    return { ok: false, reason: "invalid_world_id", error: "invalid_world_id" };
  }
  if (typeof contentRoot !== "string" || !contentRoot) {
    return { ok: false, reason: "missing_content_root", error: "missing_content_root" };
  }

  const integrity = validateWorldPackEnvelope(envelope);
  if (!integrity.ok) return integrity;

  const targetDir = path.join(contentRoot, "content", "world", newWorldId);
  if (fs.existsSync(targetDir) && !opts.force) {
    return { ok: false, reason: "world_dir_exists", error: "world_dir_exists" };
  }

  const token = envelope.placeholder_token;
  const substitutedFiles = envelope.files.map(f => ({
    path: f.path,
    content: replaceAllLiteral(f.content, token, newWorldId),
  }));

  // Load the REAL, unmodified validators — same pattern as
  // scripts/scaffold-world.mjs's selfCheck(): dynamic import, read-only,
  // no DB/STATE dependency.
  let validators;
  try {
    const mod = await import(pathToFileURL(REAL_CONTENT_SEEDER_PATH).href);
    validators = {
      validateNpc: mod.validateNpc,
      validateFaction: mod.validateFaction,
      validateLoreEvent: mod.validateLoreEvent,
      validateQuest: mod.validateQuest,
    };
  } catch (err) {
    return { ok: false, reason: "validators_unavailable", error: err.message };
  }
  for (const [name, fn] of Object.entries(validators)) {
    if (typeof fn !== "function") {
      return { ok: false, reason: `validator_missing_${name}`, error: `validator_missing_${name}` };
    }
  }

  const problems = [];
  const counts = { npcs: 0, factions: 0, loreEvents: 0, quests: 0, other: 0 };

  for (const f of substitutedFiles) {
    let parsed;
    try { parsed = JSON.parse(f.content); }
    catch (err) {
      // Non-JSON files are never emitted by exportWorldPack against the
      // real content/world/ tree (every file there is JSON today), but a
      // hand-crafted envelope could carry one — reject loudly rather than
      // silently skip.
      problems.push(`${f.path}: invalid JSON after placeholder substitution (${err.message})`);
      continue;
    }

    const base = path.posix.basename(f.path);
    const dirParts = path.posix.dirname(f.path).split("/");

    if (base === "meta.json") {
      if (typeof parsed.world_id !== "string" || !parsed.world_id) {
        problems.push(`${f.path}: world_id is missing/empty after substitution — content-seeder's discoverSubWorlds loop will never call upsertWorldRow for this world`);
      } else if (parsed.world_id !== newWorldId) {
        problems.push(`${f.path}: world_id "${parsed.world_id}" does not match target world id "${newWorldId}" after substitution`);
      }
      if (typeof parsed.universe_type !== "string" || !parsed.universe_type) {
        problems.push(`${f.path}: universe_type is missing/empty — upsertWorldRow's inner gate will silently no-op even though world_id passed the outer gate`);
      }
    } else if (base === "npcs.json" || base === "npcs-extra.json") {
      if (!Array.isArray(parsed)) {
        problems.push(`${f.path}: expected an array of NPC records`);
      } else {
        parsed.forEach((npc, i) => {
          const r = validators.validateNpc(npc);
          if (!r.ok) problems.push(`${f.path}[${i}]: failed validateNpc (${r.reason})`);
          else counts.npcs++;
        });
      }
    } else if (base === "factions.json" || base === "factions-extra.json") {
      if (!Array.isArray(parsed)) {
        problems.push(`${f.path}: expected an array of faction records`);
      } else {
        parsed.forEach((faction, i) => {
          const r = validators.validateFaction(faction);
          if (!r.ok) problems.push(`${f.path}[${i}]: failed validateFaction (${r.reason})`);
          else counts.factions++;
        });
      }
    } else if (base === "lore.json") {
      const history = Array.isArray(parsed?.history) ? parsed.history : [];
      history.forEach((ev, i) => {
        const r = validators.validateLoreEvent(ev);
        if (!r.ok) problems.push(`${f.path}.history[${i}]: failed validateLoreEvent (${r.reason})`);
        else counts.loreEvents++;
      });
    } else if (dirParts.includes("quests")) {
      // Files under quests/ are authored as EITHER a single quest object
      // or an array of quest-chain steps (verified against the real
      // content/world/tunya/quests/*.json on disk — each file there is
      // an array of 1+ chain-step quest records). Handle both shapes.
      const records = Array.isArray(parsed) ? parsed : [parsed];
      records.forEach((rec, i) => {
        const r = validators.validateQuest(rec);
        const label = Array.isArray(parsed) ? `${f.path}[${i}]` : f.path;
        if (!r.ok) problems.push(`${label}: failed validateQuest (${r.reason})`);
        else counts.quests++;
      });
    } else {
      // Enrichment files (calendar.json, bestiary.json, industries.json,
      // apparel.json, etc. from world-kit-templates.js and others) have no
      // dedicated content-seeder.js validator today. Valid, substituted
      // JSON is the honest bar for these — same as scaffold-world.mjs's
      // writeJsonChecked() round-trip check.
      counts.other++;
    }
  }

  if (problems.length > 0) {
    return { ok: false, reason: "validation_failed", error: "validation_failed", problems };
  }

  if (opts.dryRun) {
    return { ok: true, dryRun: true, imported: { files: substitutedFiles.length, ...counts }, worldId: newWorldId };
  }

  // All records validated — nothing written until this point. Write now;
  // best-effort cleanup of partially-written files if disk I/O fails
  // mid-loop (rare, but keeps a failed import from leaving a half-written
  // world directory behind).
  const written = [];
  try {
    for (const f of substitutedFiles) {
      const abs = path.join(targetDir, ...f.path.split("/"));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content, "utf8");
      written.push(abs);
    }
  } catch (err) {
    for (const abs of written) {
      try { fs.unlinkSync(abs); } catch { /* best-effort cleanup */ }
    }
    return { ok: false, reason: "write_failed", error: err.message };
  }

  return {
    ok: true,
    imported: { files: substitutedFiles.length, ...counts },
    worldId: newWorldId,
    dir: targetDir,
  };
}

export { SPEC, PLACEHOLDER_TOKEN };
