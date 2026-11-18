#!/usr/bin/env node
// server/scripts/conkay-replay.mjs
//
// SXC-23 — run the walker replay harness over docs/conkay/solvers/
// and print the report. The walker runs this post-fix against the
// deployed tree; CI runs the same module through
// tests/conkay-replay-harness.test.js.
// Usage (from server/): node scripts/conkay-replay.mjs [docsDir]
// Exit code 1 when any replay fails.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAll } from "../lib/conkay/replay/harness.js";
import "../lib/conkay/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = process.argv[2] ?? join(here, "..", "..", "docs", "conkay", "solvers");

const rows = runAll(docsDir);
let failures = 0;
for (const row of rows) {
  const failed = row.checks.filter((c) => !c.ok);
  failures += failed.length > 0 ? 1 : 0;
  console.log(`${row.status}  ${row.solver}  [${row.form}]  ${row.checks.filter((c) => c.ok).length}/${row.checks.length} checks`);
  for (const c of failed) console.log(`      FAIL ${c.kind}: ${c.detail}`);
  for (const k of row.notEchoed ?? []) console.log(`      NOT-ECHOED (declared contract, pinned): inputs.${k}`);
  for (const u of row.unreduced) console.log(`      UNREDUCED (walker reads): ${u}`);
}
console.log(`\n${rows.length} replays, ${rows.filter((r) => r.status === "PASS").length} passing, ${rows.reduce((s, r) => s + r.unreduced.length, 0)} unreduced fragments`);
process.exit(failures > 0 ? 1 : 0);
