/**
 * Tier-2 contract test — every path rule in the autoloop guard resolves.
 *
 * `scripts/autoloop/guard.mjs` is the anti-gaming gate: it blocks commits
 * that edit a grader/harness/baseline (PROTECTED) or a money/auth invariant
 * file (INVARIANT). Both lists are arrays of regexes matched against
 * `git diff --name-only` output.
 *
 * A rule that matches nothing is a gate that silently stopped existing. On
 * 2026-07-25 an audit found exactly that, on the worst possible entry: the
 * INVARIANT list named `server/lib/coin-service.js`, but the coin-MINTING
 * file has always lived at `server/economy/coin-service.js`. The rule had
 * never matched a single file, so `mintCoins`/`burnCoins` — the functions
 * that create and destroy Concord Coin against the 1:1 USD peg — were not
 * covered by the human-escalation gate the list exists to enforce. It was
 * confirmed empirically: commit 7cfefba0 edits that exact file and the guard
 * reported "clean".
 *
 * This test generalizes that audit so the class can't recur: EVERY pattern in
 * BOTH lists must match at least one real tracked path. It is deliberately
 * not a check of the one known-bad entry — a test that only pins the bug you
 * already found doesn't stop the next one.
 *
 * Run: node --test tests/autoloop-guard-invariant-paths.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const GUARD = path.join(REPO, "scripts", "autoloop", "guard.mjs");

/**
 * Pull the regex literals out of a named `const NAME = [ ... ];` array in the
 * guard's source.
 *
 * Read from source rather than importing: guard.mjs runs its check at module
 * scope and calls process.exit(), so importing it would terminate the test
 * runner. Source-parsing is the honest way in, and it keeps the guard itself
 * unmodified (it is PROTECTED — adding an export just to make it testable
 * would be a change to the thing under test).
 */
function extractPatterns(src, name) {
  const start = src.indexOf(`const ${name} = [`);
  assert.ok(start > -1, `${name} array not found in guard.mjs`);
  const open = src.indexOf("[", start);
  const close = src.indexOf("];", open);
  assert.ok(close > open, `${name} array not terminated`);
  const body = src.slice(open + 1, close);

  const out = [];
  // Match /.../ regex literals at the start of a line (skipping // comments).
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    const m = trimmed.match(/^\/(.+)\/([gimsuy]*),?$/);
    if (m) out.push({ raw: `/${m[1]}/${m[2]}`, re: new RegExp(m[1], m[2]) });
  }
  return out;
}

/** All repo-relative file paths, excluding the heavy/irrelevant trees. */
function walk(dir, base, acc) {
  const SKIP = new Set([
    "node_modules", ".git", ".next", "dist", "build", "coverage",
    ".turbo", ".cache", "pw-browsers",
  ]);
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    const rel = path.relative(base, full);
    if (st.isDirectory()) {
      // Directory-prefix rules (e.g. /^scripts\/autoloop\//) match paths that
      // start with the directory, so record it with a trailing slash too.
      acc.push(rel + "/");
      walk(full, base, acc);
    } else {
      acc.push(rel);
    }
  }
  return acc;
}

let guardSrc;
let allPaths;

before(() => {
  assert.ok(existsSync(GUARD), `guard.mjs not found at ${GUARD}`);
  guardSrc = readFileSync(GUARD, "utf8");
  allPaths = walk(REPO, REPO, []);
  assert.ok(allPaths.length > 1000, `repo walk found only ${allPaths.length} paths — walk is broken`);
});

describe("autoloop guard — every rule matches something real", () => {
  for (const listName of ["PROTECTED", "INVARIANT"]) {
    it(`${listName}: every pattern matches at least one real path`, () => {
      const patterns = extractPatterns(guardSrc, listName);
      assert.ok(patterns.length > 0, `${listName} yielded no patterns — the parser is broken`);

      const dead = [];
      for (const { raw, re } of patterns) {
        if (!allPaths.some((p) => re.test(p))) dead.push(raw);
      }

      assert.deepEqual(
        dead,
        [],
        `${listName} contains rule(s) that match NO file in the repo — ` +
          `each is a silently-disarmed gate:\n  ${dead.join("\n  ")}`,
      );
    });
  }

  it("the money/auth gate actually covers the coin-minting file", () => {
    // The specific regression. Stated as a behavioral claim about the real
    // file rather than a string match on the list, so moving the file without
    // updating the guard fails here too.
    const coinService = "server/economy/coin-service.js";
    assert.ok(
      existsSync(path.join(REPO, coinService)),
      `${coinService} not found — if mintCoins moved, the guard must move with it`,
    );
    const invariants = extractPatterns(guardSrc, "INVARIANT");
    assert.ok(
      invariants.some(({ re }) => re.test(coinService)),
      "mintCoins/burnCoins live in coin-service.js and MUST require human " +
        "escalation — no INVARIANT rule currently matches that path",
    );
  });

  it("the guard's own scripts stay self-protected", () => {
    // guard.mjs must block edits to itself, or an agent can disarm the gate
    // in the same commit that games a metric.
    const protectedRules = extractPatterns(guardSrc, "PROTECTED");
    assert.ok(
      protectedRules.some(({ re }) => re.test("scripts/autoloop/guard.mjs")),
      "guard.mjs is not covered by its own PROTECTED list",
    );
  });

  it("does not over-match: an ordinary source file is neither protected nor invariant", () => {
    // The negative direction. Without this, a rule broadened to /.*/ would
    // satisfy every assertion above while blocking all work.
    const ordinary = "server/lib/districts.js";
    assert.ok(existsSync(path.join(REPO, ordinary)), `${ordinary} should exist`);
    for (const listName of ["PROTECTED", "INVARIANT"]) {
      const hit = extractPatterns(guardSrc, listName).find(({ re }) => re.test(ordinary));
      assert.equal(
        hit,
        undefined,
        `${listName} rule ${hit?.raw} matches ordinary file ${ordinary} — over-broad`,
      );
    }
  });
});
