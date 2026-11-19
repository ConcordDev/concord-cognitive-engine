// P0-04 asset rail — shared manifest + store machinery.
//
// The rail moves binary asset sets (Mixamo clips, model packs, HubKit)
// between a content-addressed store and the working tree, driven by
// unity-client/ASSET_MANIFEST.json. The store is addressed by sha256:
// <store>/objects/<sha256>. The store root is configuration, not code —
// a local directory today (the R2 home is parked, Q2), an S3-compatible
// bucket behind the same layout when the office un-parks one.
//
// Manifest row schema (CONCORDIA_PLAN.md §2.2):
//   path          repo-relative path of the file in the working tree
//   sha256        lowercase hex sha256 of the file's bytes
//   bytes         byte length
//   family        asset family (e.g. "animations/mixamo")
//   source        where the set came from (e.g. "backup/aura-wt-20261103")
//   license_class tradeable | in_game_only | blocked_pending
//   lod_tier      LOD tier string, or null when the family has none

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const LICENSE_CLASSES = new Set(["tradeable", "in_game_only", "blocked_pending"]);
const SHA256_RE = /^[0-9a-f]{64}$/;

export class RailError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.name = "RailError";
    this.code = code; // 2 = configuration/usage, 1 = row failures
  }
}

export function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256File(absPath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absPath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function validateManifest(manifest, label = "manifest") {
  const fail = (msg) => {
    throw new RailError(`P0-04 asset rail: invalid ${label}: ${msg}`);
  };
  if (!manifest || typeof manifest !== "object") fail("not an object");
  if (manifest.version !== 1) fail(`version must be 1, got ${JSON.stringify(manifest.version)}`);
  if (!Array.isArray(manifest.rows)) fail("rows must be an array");
  const seen = new Set();
  manifest.rows.forEach((row, i) => {
    const at = `rows[${i}]`;
    if (!row || typeof row !== "object") fail(`${at} is not an object`);
    if (typeof row.path !== "string" || row.path.length === 0) fail(`${at}.path missing`);
    if (row.path.startsWith("/") || row.path.split("/").includes("..")) {
      fail(`${at}.path must be a clean relative path, got ${JSON.stringify(row.path)}`);
    }
    if (seen.has(row.path)) fail(`duplicate path ${JSON.stringify(row.path)}`);
    seen.add(row.path);
    if (typeof row.sha256 !== "string" || !SHA256_RE.test(row.sha256)) {
      fail(`${at}.sha256 must be 64 lowercase hex chars`);
    }
    if (!Number.isInteger(row.bytes) || row.bytes < 0) fail(`${at}.bytes must be a non-negative integer`);
    if (typeof row.family !== "string" || row.family.length === 0) fail(`${at}.family missing`);
    if (typeof row.source !== "string" || row.source.length === 0) fail(`${at}.source missing`);
    if (!LICENSE_CLASSES.has(row.license_class)) {
      fail(`${at}.license_class must be one of ${[...LICENSE_CLASSES].join(" | ")}, got ${JSON.stringify(row.license_class)}`);
    }
    if (row.lod_tier !== null && typeof row.lod_tier !== "string") fail(`${at}.lod_tier must be a string or null`);
  });
  return manifest;
}

export async function loadManifest(manifestPath) {
  let text;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch {
    throw new RailError(`P0-04 asset rail: manifest not found at ${manifestPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new RailError(`P0-04 asset rail: manifest at ${manifestPath} is not valid JSON: ${err.message}`);
  }
  return validateManifest(parsed, `manifest at ${manifestPath}`);
}

// The store root comes from --store or $CONCORDIA_ASSET_STORE. Absence is
// a named failure, never a silent skip: CI (P0-18 step 1) depends on the
// pull failing loudly when the rail has no home configured.
export function resolveStore(flagValue) {
  const store = flagValue || process.env.CONCORDIA_ASSET_STORE || "";
  if (!store) {
    throw new RailError(
      "P0-04 asset rail: no asset store configured — set CONCORDIA_ASSET_STORE or pass --store <dir>",
    );
  }
  return path.resolve(store);
}

export function objectPath(storeRoot, sha256) {
  return path.join(storeRoot, "objects", sha256);
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new RailError(`P0-04 asset rail: unexpected argument ${JSON.stringify(token)}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new RailError(`P0-04 asset rail: --${key} needs a value`);
    args[key] = value;
    i += 1;
  }
  return args;
}

export const DEFAULT_MANIFEST = "apps/concordia-living-world/unity-client/ASSET_MANIFEST.json";
