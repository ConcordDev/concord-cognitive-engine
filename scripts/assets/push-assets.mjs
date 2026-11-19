#!/usr/bin/env node
// P0-04 asset rail — push.
//
//   node scripts/assets/push-assets.mjs [--store <dir>] [--manifest <path>] [--root <dir>]
//
// Reads the asset manifest and writes every row's content into the
// content-addressed store under its sha256. A local file whose bytes do
// not hash to the manifest's sha256 is REFUSED — the store never holds
// content under a name that lies about it. Objects already in the store
// are left untouched, so a push is idempotent (the P0-04 done-test).
//
// Push is how a regenerated or newly authored set enters the rail; it
// never writes into git and never touches the working tree.

import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_MANIFEST,
  RailError,
  loadManifest,
  objectPath,
  parseArgs,
  resolveStore,
  sha256File,
} from "./asset-manifest.mjs";

async function fileInfo(absPath) {
  try {
    const info = await stat(absPath);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const storeRoot = resolveStore(args.store);
  const manifestPath = path.resolve(args.manifest || DEFAULT_MANIFEST);
  const srcRoot = path.resolve(args.root || ".");
  const manifest = await loadManifest(manifestPath);

  let pushed = 0;
  let present = 0;
  let bytes = 0;
  const failures = [];

  for (const row of manifest.rows) {
    const src = path.join(srcRoot, row.path);
    const info = await fileInfo(src);
    if (!info) {
      failures.push(`${row.path}: local file missing`);
      continue;
    }
    if (info.size !== row.bytes || (await sha256File(src)) !== row.sha256) {
      failures.push(`${row.path}: local bytes do not match manifest sha256 ${row.sha256} — refused`);
      continue;
    }
    const object = objectPath(storeRoot, row.sha256);
    const existing = await fileInfo(object);
    if (existing) {
      if (existing.size === row.bytes && (await sha256File(object)) === row.sha256) {
        present += 1;
        continue;
      }
      failures.push(`${row.path}: store object ${row.sha256} is corrupt — refusing to overwrite silently`);
      continue;
    }
    await mkdir(path.dirname(object), { recursive: true });
    const tmp = `${object}.tmp-${process.pid}`;
    await copyFile(src, tmp);
    await rename(tmp, object);
    pushed += 1;
    bytes += row.bytes;
  }

  console.log(
    `push-assets: ${manifest.rows.length} rows — ${pushed} pushed (${bytes} B), ${present} already in store, ${failures.length} failed`,
  );
  if (failures.length > 0) {
    for (const failure of failures) console.error(`push-assets: FAILED ${failure}`);
    throw new RailError(`P0-04 asset rail: push incomplete — ${failures.length} row(s) failed`, 1);
  }
}

main().catch((err) => {
  if (err instanceof RailError) {
    console.error(err.message);
    process.exit(err.code);
  }
  console.error(`P0-04 asset rail: push crashed: ${err.stack || err.message}`);
  process.exit(2);
});
