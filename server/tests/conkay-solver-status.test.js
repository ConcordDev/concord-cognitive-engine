// server/tests/conkay-solver-status.test.js
//
// SXC-20 — buyer-facing status pin. docs/conkay/solver-status.md
// is generated from the live registry by
// server/scripts/conkay-solver-status.mjs; this pin regenerates
// the pinned block in-test and fails on any drift — a status page
// that disagrees with the registry is worse than none. The
// generation sha in the doc's prose header is informational and
// NOT compared (it changes every commit by design); the compared
// block is the counts + the full per-solver table.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "../lib/conkay/index.js";
import { censusTestedIds, buildStatusRows, renderStatusBlock } from "../lib/conkay/status/solver-status.js";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = join(serverDir, "..");

function docBlock() {
  const doc = readFileSync(join(repoDir, "docs", "conkay", "solver-status.md"), "utf8");
  const m = doc.match(/<!-- STATUS:BEGIN -->\n([\s\S]*?)\n<!-- STATUS:END -->/);
  assert.ok(m, "solver-status.md carries no STATUS block — regenerate it with server/scripts/conkay-solver-status.mjs");
  return m[1];
}

describe("SXC-20 — solver status pin", () => {
  it("the doc's pinned block equals a fresh regeneration from the live registry", () => {
    const signoffs = JSON.parse(readFileSync(join(repoDir, "docs", "conkay", "signoffs.json"), "utf8"));
    const { tested } = censusTestedIds(join(serverDir, "tests"));
    const rows = buildStatusRows({ tested, signoffs });
    assert.ok(rows.length >= 100, `registry census suspiciously small: ${rows.length}`);
    assert.equal(docBlock(), renderStatusBlock(rows), "solver-status.md has drifted from the registry — regenerate with server/scripts/conkay-solver-status.mjs");
  });

  it("the signed column never overclaims: every signed row traces to signoffs.json", () => {
    const signoffs = JSON.parse(readFileSync(join(repoDir, "docs", "conkay", "signoffs.json"), "utf8"));
    const block = docBlock();
    for (const line of block.split("\n")) {
      const m = line.match(/^\| (\S+) \|.*\| yes \(([^)]+)\) \|$/);
      if (m) assert.ok(signoffs[m[1]] && signoffs[m[1]].by === m[2], `row ${m[1]} claims signer ${m[2]} with no signoffs.json entry`);
    }
  });
});
