// server/lib/studio/stem-splitter.js
//
// Studio Sprint C Item #4 — audio stem separation via Demucs.
//
// Spawn pattern mirrors voice.transcribe (server.js:11069-11120):
// spawnSync the binary, capture stdout/stderr, surface structured
// errors. Caches per-input SHA so re-running on the same audio
// reads from disk instead of re-spawning Demucs (which is the
// expensive part — 30s+ per 4-minute song on CPU).

import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { MODALITY } from "../modality-config.js";

const STEM_ROLES = ["vocals", "drums", "bass", "other"];

function sha1Hex(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Split a wav/mp3/flac/m4a buffer (or path) into 4 stems.
 *
 * Returns { ok: true, stems: { vocals, drums, bass, other }, cachedSha, fromCache, durationMs }
 * Or     { ok: false, reason: 'demucs_not_installed' | 'spawn_failed' | ... }
 */
export function splitStems({ inputBuffer = null, inputPath = null }) {
  if (!MODALITY.stems?.enabled) {
    return { ok: false, reason: "demucs_not_installed", hint: "Set DEMUCS_BIN env var to the demucs binary." };
  }
  const bin = MODALITY.stems.bin;
  if (!bin) return { ok: false, reason: "no_bin" };
  const cacheDir = MODALITY.stems.cacheDir || "./data/stems-cache";
  ensureDir(cacheDir);
  const timeoutMs = MODALITY.stems.timeoutMs || 180_000;

  let sha;
  if (inputBuffer) {
    sha = sha1Hex(inputBuffer);
  } else if (inputPath) {
    try { sha = sha1Hex(readFileSync(inputPath)); }
    catch (err) { return { ok: false, reason: "input_read_failed", error: err?.message }; }
  } else {
    return { ok: false, reason: "no_input" };
  }

  const outDir = path.join(cacheDir, sha);
  const cacheHit = existsSync(outDir) && stemsPresent(outDir);
  if (cacheHit) {
    MODALITY.stems.stats.calls += 1;
    return { ok: true, fromCache: true, cachedSha: sha, stems: stemPaths(outDir), durationMs: 0 };
  }

  // Need to spawn. If we got a buffer, write to a temp file first.
  let resolvedInputPath = inputPath;
  let tmpPath = null;
  if (!resolvedInputPath && inputBuffer) {
    tmpPath = path.join(cacheDir, `${sha}.input`);
    try { writeFileSync(tmpPath, inputBuffer); }
    catch (err) { return { ok: false, reason: "write_input_failed", error: err?.message }; }
    resolvedInputPath = tmpPath;
  }

  const args = ["-o", outDir, resolvedInputPath];
  const started = Date.now();
  let result;
  try {
    result = spawnSync(bin, args, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    MODALITY.stems.stats.errors += 1;
    MODALITY.stems.stats.lastError = err?.message;
    if (tmpPath) try { unlinkSync(tmpPath); } catch { /* best-effort */ }
    return { ok: false, reason: "spawn_threw", error: err?.message };
  }
  if (tmpPath) try { unlinkSync(tmpPath); } catch { /* best-effort */ }

  const durationMs = Date.now() - started;
  if (result.signal === "SIGTERM") {
    MODALITY.stems.stats.errors += 1;
    return { ok: false, reason: "timeout", durationMs };
  }
  if (result.status !== 0) {
    MODALITY.stems.stats.errors += 1;
    MODALITY.stems.stats.lastError = (result.stderr || "").slice(0, 500);
    return {
      ok: false, reason: "demucs_failed",
      stderr: (result.stderr || "").slice(0, 500), status: result.status, durationMs,
    };
  }
  if (!stemsPresent(outDir)) {
    return { ok: false, reason: "output_missing", durationMs };
  }
  MODALITY.stems.stats.calls += 1;
  return { ok: true, fromCache: false, cachedSha: sha, stems: stemPaths(outDir), durationMs };
}

function stemPaths(outDir) {
  // Demucs writes to outDir/<model_name>/<input-basename>/<stem>.wav
  const out = {};
  walkFind(outDir, (file) => {
    const base = path.basename(file).replace(/\.wav$/i, "");
    if (STEM_ROLES.includes(base)) out[base] = file;
  });
  return out;
}

function stemsPresent(outDir) {
  const paths = stemPaths(outDir);
  return STEM_ROLES.every(r => paths[r]);
}

function walkFind(dir, fn) {
  try {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walkFind(full, fn);
      else fn(full);
    }
  } catch { /* walk best-effort */ }
}

export const _internal = { STEM_ROLES, stemPaths, stemsPresent, sha1Hex };
