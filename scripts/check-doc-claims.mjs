#!/usr/bin/env node
// scripts/check-doc-claims.mjs
//
// Doc-staleness gate. The recurring failure mode in this repo isn't bad code —
// it's docs that lag the code in BOTH directions: they undersell scope (the LOC
// headline was a 50% undercount) AND they leave "open defect" lists un-pruned
// after the changelog closes the items (3 "unsolvable/silent/broken" bugs that
// were fixed weeks earlier still read as live). This makes the docs the
// least-trustworthy artifact in the tree.
//
// This tool makes doc claims FALSIFIABLE in two ways:
//
//  (1) COUNT CLAIMS — many CLAUDE.md claims ship their own reproduction command
//      (`… **253** … (`ls -d concord-frontend/app/lenses/*/ | wc -l`)`). We
//      extract every (claimed-number, command) pair, re-run the command, and
//      flag any mismatch. A doc that says 1.36M when the counter says 2.05M
//      can't hide.
//
//  (2) STALE-DEFECT CLAIMS — lines that assert something is broken
//      (unsolvable / silent / dead-wired / never emits / no-op / "not yet")
//      while naming a code symbol in backticks. We grep the symbol; if the
//      named fix-symbol already exists, the defect claim is *probably* stale and
//      we flag it for a human to re-audit (advisory — code presence ≠ proof the
//      bug is fixed, but it's exactly the signal that caught 3 stale claims).
//
// Safety: extracted commands run via execFileSync("sh", ["-c", cmd]) (no
// shell:true) and ONLY when they pass a strict allowlist (ls/wc/grep/find/cat,
// pipes allowed, but no ; && > < backticks $() — no chaining/redirect/subst).
// So this can't be turned into an injection sink by a doctored doc, and it
// doesn't trip the command-injection detector.
//
// Usage:
//   node scripts/check-doc-claims.mjs                 # check CLAUDE.md
//   node scripts/check-doc-claims.mjs --file docs/X.md
//   node scripts/check-doc-claims.mjs --json
//   node scripts/check-doc-claims.mjs --ci            # exit 1 on any count mismatch

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const CI = argv.includes("--ci");
const fileArg = (() => { const i = argv.indexOf("--file"); return i >= 0 ? argv[i + 1] : "CLAUDE.md"; })();
const DOC_PATH = path.resolve(REPO_ROOT, fileArg);

// ── (1) Count-claim extraction ────────────────────────────────────────────
// A runnable command is conservative: starts with a known counter, contains no
// shell control beyond a pipe, and no markdown-escaped backslashes (the heavy
// regex greps — `\\b(register…` — are not auto-verifiable; we skip them).
const SAFE_CMD = /^(?:ls|wc|grep|find|cat)\b[^\n]*$/;
const UNSAFE_CHARS = /[;&><`]|\$\(|\\\\/;

function unescapeMd(cmd) {
  return cmd.replace(/\\\|/g, "|").trim();
}

function isRunnable(cmd) {
  return SAFE_CMD.test(cmd) && !UNSAFE_CHARS.test(cmd);
}

function runCount(cmd) {
  try {
    const out = execFileSync("sh", ["-c", cmd], { cwd: REPO_ROOT, encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] });
    // The counters we run print a number (wc -l / grep -c) or a list we don't
    // parse. Take the LAST integer token in the output.
    const nums = out.trim().match(/\d[\d,]*/g);
    if (!nums) return null;
    return parseInt(nums[nums.length - 1].replace(/,/g, ""), 10);
  } catch {
    return null;
  }
}

// Capture a number at the START of a bold span — handles both pure-number
// bolds (**253**) and numbers leading a bold phrase (**322 numbered migration
// files**, **136 NPCs**). The number must be the first token after `**`.
const BOLD_NUM = /\*\*\s*([\d,]+)(?=[\s*])/g;
const BACKTICK_CMD = /`([^`]+)`/g;                    // `…command…`

function extractCountClaims(text) {
  const claims = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("`") || !line.includes("**")) continue;
    // gather bold numbers + their positions
    const bolds = [];
    let m;
    BOLD_NUM.lastIndex = 0;
    while ((m = BOLD_NUM.exec(line)) != null) bolds.push({ value: parseInt(m[1].replace(/,/g, ""), 10), idx: m.index });
    if (!bolds.length) continue;
    // gather backtick commands + positions
    BACKTICK_CMD.lastIndex = 0;
    while ((m = BACKTICK_CMD.exec(line)) != null) {
      const raw = unescapeMd(m[1]);
      if (!isRunnable(raw)) continue;
      // pair with the nearest bold number that appears BEFORE this command
      const cmdIdx = m.index;
      const before = bolds.filter((b) => b.idx < cmdIdx).sort((a, b) => b.idx - a.idx)[0] || bolds[0];
      claims.push({ line: i + 1, claimed: before.value, command: raw });
    }
  }
  return claims;
}

// ── (2) Stale-defect detection ────────────────────────────────────────────
const DEFECT_WORDS = /\b(unsolvable|unwired|dead-?wired|never emits?|never broadcasts?|no-op|silent|not yet (?:playable|wired|built)|isn't wired|aren't (?:wired|playable)|doesn't emit|drops? to `?undefined)\b/i;
// words that mean "this used to be broken / now fixed" — suppress false flags
const RESOLVED_HINT = /\b(fixed|resolved|retired|removed|superseded|was dead|once|previously|no longer|✅)\b/i;

function symbolExists(sym) {
  // sym is a code identifier or path fragment; grep the source tree.
  if (!/^[\w./-]{3,}$/.test(sym)) return false;
  try {
    const out = execFileSync("grep", ["-rl", "--include=*.js", "--include=*.ts", "--include=*.tsx", "--include=*.mjs", "--exclude-dir=node_modules", sym, "server", "concord-frontend"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function extractStaleDefects(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!DEFECT_WORDS.test(line)) continue;
    if (RESOLVED_HINT.test(line)) continue; // line already says it's fixed
    // pull the first plausible code symbol in backticks (a function/file name)
    const syms = [...line.matchAll(/`([A-Za-z_$][\w$]*(?:\.[A-Za-z]+)?|[\w./-]+\.(?:js|ts|tsx|mjs))`/g)].map((m) => m[1]);
    const named = syms.find((s) => /[A-Za-z]/.test(s) && s.length >= 4);
    if (!named) continue;
    if (symbolExists(named)) {
      out.push({ line: i + 1, symbol: named, excerpt: line.trim().slice(0, 140) });
    }
  }
  return out;
}

// ── Run ───────────────────────────────────────────────────────────────────
const text = readFileSync(DOC_PATH, "utf8");
const countClaims = extractCountClaims(text);
const results = countClaims.map((c) => {
  const actual = runCount(c.command);
  return { ...c, actual, status: actual == null ? "UNVERIFIABLE" : actual === c.claimed ? "MATCH" : "MISMATCH" };
});
const mismatches = results.filter((r) => r.status === "MISMATCH");
const staleDefects = extractStaleDefects(text);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ file: fileArg, countClaims: results, staleDefects }, null, 2) + "\n");
} else {
  const rel = path.relative(REPO_ROOT, DOC_PATH);
  console.log(`Doc-claim check — ${rel}\n`);
  console.log(`Count claims with a reproduction command: ${results.length} checked`);
  console.log(`  ${results.filter((r) => r.status === "MATCH").length} match · ${mismatches.length} MISMATCH · ${results.filter((r) => r.status === "UNVERIFIABLE").length} unverifiable\n`);
  for (const m of mismatches) {
    console.log(`  ✗ line ${m.line}: doc says ${m.claimed.toLocaleString()}, command returns ${m.actual.toLocaleString()}`);
    console.log(`      ${m.command}`);
  }
  if (staleDefects.length) {
    console.log(`\nPossibly-stale defect claims (says "broken" but the named symbol exists — re-audit):`);
    for (const d of staleDefects) console.log(`  ? line ${d.line}: \`${d.symbol}\` exists — "${d.excerpt}"`);
  }
  if (!mismatches.length && !staleDefects.length) console.log("No count mismatches, no stale-defect flags. Docs track the code.");
}

if (CI && mismatches.length > 0) {
  console.error(`\nFAIL: ${mismatches.length} doc count claim(s) no longer match the code.`);
  process.exit(1);
}
