#!/usr/bin/env node
// Build the ConKay results page snapshots (lib/conkay/showcase): run each
// showcase design through its real pipeline once and write
//   lib/conkay/showcase/snapshots/<id>.json
//   lib/conkay/showcase/snapshots/<id>/<drawing / model files>
// The page serves these; nothing is solved on page load.
//
//   node scripts/build-conkay-showcase.mjs            # all designs
//   node scripts/build-conkay-showcase.mjs car sentinel-m1
//
// The car needs the OCC kernel (CONKAY_OCC_PYTHON or the default venv) for its
// CAD body, tub fit and drawing; without it the car is skipped, not faked.

import fs from "node:fs";
import path from "node:path";
import { SHOWCASE, BUILDERS, SNAPSHOT_DIR, finalizeSnapshot } from "../lib/conkay/showcase/index.js";

const want = process.argv.slice(2);
const ids = want.length ? want : SHOWCASE.map((e) => e.id);
fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

for (const id of ids) {
  const entry = SHOWCASE.find((e) => e.id === id);
  if (!entry) { console.error(`unknown design ${id}`); process.exitCode = 1; continue; }
  const t = Date.now();
  let built;
  try {
    built = await BUILDERS[id]();
  } catch (e) {
    console.error(`${id}: not built (${e.message})`);
    process.exitCode = 1;
    continue;
  }
  const dir = path.join(SNAPSHOT_DIR, id);
  fs.rmSync(dir, { recursive: true, force: true });
  if (built.files.length) fs.mkdirSync(dir, { recursive: true });
  for (const f of built.files) {
    if (f.data == null) throw new Error(`${id}: ${f.name} has no content (re-run the drawing)`);
    fs.writeFileSync(path.join(dir, f.name), f.data);
  }
  const snap = finalizeSnapshot(entry, built.snapshot, built.files);
  fs.writeFileSync(path.join(SNAPSHOT_DIR, `${id}.json`), `${JSON.stringify(snap, null, 1)}\n`);
  console.log(`${id}: ${snap.checks.length} checks, ${snap.values.length} values, ${built.files.length} files, ${Date.now() - t} ms`);
}
process.exit(process.exitCode || 0);
