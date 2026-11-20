#!/usr/bin/env node
// P0-04 asset rail — pull.
//
//   node scripts/assets/pull-assets.mjs [--store <dir>] [--manifest <path>] [--dest <dir>]
//
// Reads the asset manifest and materialises every row from the
// content-addressed store into the working tree, verifying sha256 and
// byte length per row. Rows already present with the right hash are
// skipped, so a pull is idempotent. Any row that cannot be produced
// exactly as the manifest states fails the run BY NAME — CI (P0-18
// step 1) invokes this with no arguments and depends on that: tests
// without the rail's assets would test a different project.
//
// Done-test of record (CONCORDIA_PLAN.md, P0-04): pull into an empty
// dir reproduces sha256 for 100% of rows.

import { copyFile, mkdir, stat } from "node:fs/promises";
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
  const destRoot = path.resolve(args.dest || ".");
  const manifest = await loadManifest(manifestPath);

  let pulled = 0;
  let present = 0;
  let bytes = 0;
  const failures = [];

  for (const row of manifest.rows) {
    const dest = path.join(destRoot, row.path);
    const existing = await fileInfo(dest);
    if (existing && existing.size === row.bytes && (await sha256File(dest)) === row.sha256) {
      present += 1;
      continue;
    }
    const object = objectPath(storeRoot, row.sha256);
    if (!(await fileInfo(object))) {
      failures.push(`${row.path}: object ${row.sha256} missing from store`);
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(object, dest);
    const written = await fileInfo(dest);
    if (!written || written.size !== row.bytes || (await sha256File(dest)) !== row.sha256) {
      failures.push(`${row.path}: pulled bytes do not match manifest sha256 ${row.sha256}`);
      continue;
    }
    pulled += 1;
    bytes += row.bytes;
  }

  console.log(
    `pull-assets: ${manifest.rows.length} rows — ${pulled} pulled (${bytes} B), ${present} already present, ${failures.length} failed`,
  );
  if (failures.length > 0) {
    for (const failure of failures) console.error(`pull-assets: FAILED ${failure}`);
    throw new RailError(`P0-04 asset rail: pull incomplete — ${failures.length} row(s) failed`, 1);
  }
}

main().catch((err) => {
  if (err instanceof RailError) {
    console.error(err.message);
    process.exit(err.code);
  }
  console.error(`P0-04 asset rail: pull crashed: ${err.stack || err.message}`);
  process.exit(2);
});
