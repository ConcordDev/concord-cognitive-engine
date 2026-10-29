#!/usr/bin/env node
// scripts/check-security-diff.mjs
//
// The §1.1 SECURITY-diff tripwire (HANDOFF-4 §1.1, mechanized 2026-10-29).
//
// The fleet rule: before a PR opens, `git diff origin/main --
// server/server.js | grep '^-.*SECURITY'` must be empty unless the
// removal is intended and a human has read it. Three server.js copies
// regressed in one night (the #34-era branches, each silently stripping
// SECURITY blocks) — every one caught by a builder's hand downstream of
// the branch. This checker turns that hand-check into a mechanism: it
// reads a unified diff and FAILS (exit 1, offending lines printed) when
// the server/server.js section removes any line containing SECURITY.
// Additions and context lines never block; other files are ignored; an
// empty diff passes. The semantics are deliberately literal — any
// removal blocks the PR from review until a human reads the output.
//
// Usage:
//   git diff origin/main...HEAD | node scripts/check-security-diff.mjs
//   node scripts/check-security-diff.mjs <diff-file>
//   node scripts/check-security-diff.mjs --base origin/main --head HEAD
//   node scripts/check-security-diff.mjs --file server/other.js   (target override)

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DEFAULT_TARGET = "server/server.js";

/**
 * Return the removed SECURITY lines (without the leading '-') that a
 * unified diff removes from the target file.
 */
export function findSecurityRemovals(diffText, targetPath = DEFAULT_TARGET) {
  const removals = [];
  let inTarget = false;
  let inHunk = false;
  for (const line of String(diffText).split("\n")) {
    if (line.startsWith("diff --git ")) {
      inTarget = line.includes(` b/${targetPath}`) || line.includes(` a/${targetPath}`);
      inHunk = false;
      continue;
    }
    if (!inTarget) continue;
    if (line.startsWith("@@")) { inHunk = true; continue; }
    if (!inHunk) continue; // file headers (---, +++, index, rename from/to...)
    if (line.startsWith("-") && line.includes("SECURITY")) {
      removals.push(line.slice(1));
    }
  }
  return removals;
}

function parseArgs(argv) {
  const args = { target: DEFAULT_TARGET, base: null, head: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") args.target = argv[++i];
    else if (a === "--base") args.base = argv[++i];
    else if (a === "--head") args.head = argv[++i];
    else if (!a.startsWith("--")) args.file = a;
  }
  return args;
}

export function runCli(argv, io = {}) {
  const args = parseArgs(argv);
  const readStdin = io.readStdin || (() => readFileSync(0, "utf8"));
  const readFile = io.readFile || ((p) => readFileSync(p, "utf8"));
  const gitDiff = io.gitDiff || ((base, head, target) =>
    execFileSync("git", ["diff", `${base}...${head}`, "--", target], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));

  let diffText;
  if (args.base || args.head) {
    diffText = gitDiff(args.base || "origin/main", args.head || "HEAD", args.target);
  } else if (args.file) {
    diffText = readFile(args.file);
  } else {
    diffText = readStdin();
  }

  const removals = findSecurityRemovals(diffText, args.target);
  if (removals.length > 0) {
    console.error(`SECURITY-DIFF TRIPWIRE: this change removes ${removals.length} SECURITY line(s) from ${args.target}:`);
    for (const l of removals) console.error(`-${l}`);
    console.error("A PR that removes SECURITY lines does not proceed to review until a human reads this output (§1.1). If the removal is intended, say so in the PR body and cite this output.");
    return 1;
  }
  console.log(`security-diff: no SECURITY lines removed from ${args.target} — clear.`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (err) {
    console.error(`security-diff: failed to evaluate the diff: ${err?.message || err}`);
    process.exitCode = 2;
  }
}
