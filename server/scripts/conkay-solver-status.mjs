// server/scripts/conkay-solver-status.mjs
//
// SXC-20 — regenerate docs/conkay/solver-status.md from the live
// registry. Usage (from server/): node scripts/conkay-solver-status.mjs
// The doc's pinned block is compared verbatim by
// server/tests/conkay-solver-status.test.js; run this after any
// solver lands, registers an engine dependency, gains a suite, or
// receives an independent sign-off in docs/conkay/signoffs.json.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import "../lib/conkay/index.js";
import { censusTestedIds, buildStatusRows, renderStatusBlock } from "../lib/conkay/status/solver-status.js";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = join(serverDir, "..");
const docPath = join(repoDir, "docs", "conkay", "solver-status.md");

let head = "unknown";
try {
  head = execSync("git rev-parse --short=9 HEAD", { cwd: repoDir, encoding: "utf8" }).trim();
} catch { /* the sha line is informational; the pin compares rows, not the sha */ }

const signoffs = JSON.parse(readFileSync(join(repoDir, "docs", "conkay", "signoffs.json"), "utf8"));
const { tested, corpusFiles } = censusTestedIds(join(serverDir, "tests"));
const rows = buildStatusRows({ tested, signoffs });
const block = renderStatusBlock(rows);

const doc = `# Solver status — buyer-facing, regenerated (SXC-20)

Generated at branch head \`${head}\` by
\`server/scripts/conkay-solver-status.mjs\` from the live solver
registry. Do not edit the pinned block by hand — regenerate it.
The CI pin (server/tests/conkay-solver-status.test.js) fails if
this block drifts from the registry.

What the columns mean, and where each comes from — no column is
hand-written:

- **tier** — the solver's declared fidelity in the registry.
  Solvers declared as screening fast paths are labelled
  SCREENING beside their tier; a fast path is never dressed as
  top tier.
- **engines** — the solver's engine dependencies, read from its
  registry descriptor. "—" means the solver computes in JS
  alone. An engine-dependent solver whose engine is unavailable
  returns NOT_COMPUTED for that tier rather than a quiet
  downgrade.
- **tested** — a ConKay suite file (server/tests/conkay-*.test.js,
  ${corpusFiles} files at generation) references the solver id.
  Suites outside that glob are not counted; the boundary is
  stated, not implied.
- **signed** — an independent checker agent has re-pulled the
  solver's cited reference and recomputed it (the catalogue's
  signing rule; self-review never counts). Sign-offs are
  recorded in docs/conkay/signoffs.json. UNSIGNED is printed
  where no sign-off is on file — this page never implies a
  signature it does not hold.

<!-- STATUS:BEGIN -->
${block}
<!-- STATUS:END -->
`;

writeFileSync(docPath, doc);
console.log(`wrote ${docPath}: ${rows.length} solvers`);
