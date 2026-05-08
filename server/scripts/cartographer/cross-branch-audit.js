#!/usr/bin/env node
// server/scripts/cartographer/cross-branch-audit.js
//
// Cross-branch cartographer audit. For every Claude branch on origin,
// produces:
//   - migration count + numbers (collision detection)
//   - macro register() callsite count
//   - heartbeat count
//   - lens dir count
//   - file delta vs main
//   - last commit + date
//   - novel substrate score (files in this branch not in main)
//
// Output:
//   audit/cartograph/CROSS_BRANCH.md — sorted matrix with merge-order
//                                       recommendations
//   audit/cartograph/CROSS_BRANCH.json — machine-readable
//
// No git checkout — uses `git show <branch>:<path>` and `git ls-tree`
// to inspect branches in-place. Safe to run from any working state.
//
// Run: node server/scripts/cartographer/cross-branch-audit.js

import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");
const OUT_DIR   = path.join(REPO_ROOT, "audit", "cartograph");

const SKIP_BRANCH_RE = /^(?:HEAD|main|master|dependabot|codex)/i;
const MAX_BRANCHES = Number(process.env.CONCORD_CROSS_BRANCH_MAX) || 100;

function git(args, opts = {}) {
  try {
    // Pass args as an array so we don't go through the shell — avoids
    // `()` in --format being interpreted as a sub-shell.
    const argv = Array.isArray(args) ? args : args.split(/\s+/).filter(Boolean);
    return execFileSync("git", argv, {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      ...opts,
    }).trim();
  } catch (err) {
    return "";
  }
}

function listRemoteBranches() {
  const raw = git(["branch", "-r", "--format=%(refname:short)"]);
  return raw.split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => s.startsWith("origin/"))
    .map(s => s.replace(/^origin\//, ""))
    .filter(b => !SKIP_BRANCH_RE.test(b))
    .slice(0, MAX_BRANCHES);
}

function lastCommit(branch) {
  const out = git(["log", "-1", "--format=%cI%x09%s", `origin/${branch}`]);
  if (!out) return null;
  const [iso, ...subj] = out.split("\t");
  return { iso, subject: subj.join("\t").slice(0, 110) };
}

function ageDays(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function lsTree(branch, glob) {
  const raw = git(["ls-tree", "-r", "--name-only", `origin/${branch}`, "--", glob]);
  return raw.split("\n").map(s => s.trim()).filter(Boolean);
}

function showFile(branch, p) {
  return git(["show", `origin/${branch}:${p}`], { stdio: ["ignore", "pipe", "ignore"] });
}

function changedVsMain(branch) {
  // Files differing in branch's NOVEL commits (not on origin/main)
  const out = git(["diff", "--name-only", `origin/main...origin/${branch}`]);
  return out ? out.split("\n").filter(Boolean) : [];
}

function commitsAheadOfMain(branch) {
  // Number of commits on this branch that are NOT on origin/main
  const out = git(["rev-list", "--count", `origin/main..origin/${branch}`]);
  return parseInt(out, 10) || 0;
}

function migrationsOn(branch) {
  const files = lsTree(branch, "server/migrations/");
  const migs = [];
  for (const f of files) {
    if (!f.endsWith(".js")) continue;
    const base = path.basename(f);
    const m = /^(\d+)_(.+)\.js$/.exec(base);
    if (!m) continue;
    migs.push({ id: parseInt(m[1], 10), name: m[2], file: f });
  }
  return migs.sort((a, b) => a.id - b.id);
}

function macroCallsites(branch) {
  const content = showFile(branch, "server/server.js");
  if (!content) return { count: 0, domains: [] };
  const matches = [...content.matchAll(/\bregister\("([a-z_]+)"\s*,\s*"([a-z_]+)"\s*,/g)];
  const domains = new Set(matches.map(m => m[1]));
  return { count: matches.length, domains: [...domains] };
}

function heartbeatCallsites(branch) {
  const content = showFile(branch, "server/server.js");
  if (!content) return 0;
  return [...content.matchAll(/\bregisterHeartbeat\("[a-z_-]+"\s*,/g)].length;
}

function lensCount(branch) {
  return lsTree(branch, "concord-frontend/app/lenses/")
    .filter(f => f.endsWith("/page.tsx")).length;
}

async function main() {
  console.log("[cross-branch] discovering branches…");
  const branches = listRemoteBranches();
  console.log(`[cross-branch] auditing ${branches.length} branches…`);

  const results = [];
  let i = 0;
  for (const branch of branches) {
    i++;
    process.stdout.write(`\r[cross-branch] ${i}/${branches.length} ${branch.slice(0, 50).padEnd(52)}`);
    const last = lastCommit(branch);
    if (!last) continue;
    const migs = migrationsOn(branch);
    const macros = macroCallsites(branch);
    const heartbeats = heartbeatCallsites(branch);
    const lenses = lensCount(branch);
    const changed = changedVsMain(branch);
    const commitsAhead = commitsAheadOfMain(branch);
    results.push({
      branch,
      ageDays: ageDays(last.iso),
      iso: last.iso,
      subject: last.subject,
      migrations: migs.length,
      migrationIds: migs.map(m => m.id),
      maxMigrationId: migs.length ? migs[migs.length - 1].id : 0,
      macros: macros.count,
      macroDomains: macros.domains.length,
      heartbeats,
      lenses,
      commitsAheadOfMain: commitsAhead,
      filesVsMain: changed.length,
      novelTouches: changed.filter(f => !f.startsWith("dependabot")).length,
      mergedIntoMain: commitsAhead === 0,
    });
  }
  console.log("\n[cross-branch] sorting + computing collisions…");

  // Migration-number collision detection: any pair of branches whose
  // max migration IDs overlap >= 108 (post-PR-301 baseline).
  const POST_MAIN_MIG = 117;
  const collisions = [];
  for (let a = 0; a < results.length; a++) {
    for (let b = a + 1; b < results.length; b++) {
      const A = results[a], B = results[b];
      const aOver = A.migrationIds.filter(id => id > 117);
      const bOver = B.migrationIds.filter(id => id > 117);
      const shared = aOver.filter(id => bOver.includes(id));
      if (shared.length > 0) {
        collisions.push({ a: A.branch, b: B.branch, shared });
      }
    }
  }

  // Markdown-table cell escape: backslash first, then pipe. CodeQL flagged the
  // pipe-only form as incomplete encoding (a subject containing "\|" would
  // produce "\\|", which markdown re-parses as escaped backslash + raw pipe).
  const mdCell = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

  // Sort: branches with novel commits first, then by file delta, then by recency
  results.sort((a, b) => {
    if (a.mergedIntoMain !== b.mergedIntoMain) return a.mergedIntoMain ? 1 : -1;
    if (b.commitsAheadOfMain !== a.commitsAheadOfMain) return b.commitsAheadOfMain - a.commitsAheadOfMain;
    if (b.filesVsMain !== a.filesVsMain) return b.filesVsMain - a.filesVsMain;
    return (a.ageDays ?? 999) - (b.ageDays ?? 999);
  });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "CROSS_BRANCH.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), branches: results, collisions }, null, 2),
    "utf-8");

  // Render markdown
  const lines = [];
  lines.push("# Cross-Branch Cartographer Audit");
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()}. Audited ${results.length} Claude branches against main.`);
  lines.push("");
  const unmerged = results.filter(r => !r.mergedIntoMain);
  const merged = results.filter(r => r.mergedIntoMain);

  lines.push(`## Unmerged branches (${unmerged.length}) — actually have novel commits`);
  lines.push("");
  if (unmerged.length === 0) {
    lines.push("_All audited branches have been fully absorbed into main. There is no unmerged work._");
  } else {
    lines.push("| # | Branch | Age (d) | Commits ahead | Files vs main | Migs | Macros | Hbts | Lenses | Last subject |");
    lines.push("|--:|---|--:|--:|--:|--:|--:|--:|--:|---|");
    for (let n = 0; n < unmerged.length; n++) {
      const r = unmerged[n];
      lines.push(`| ${n + 1} | \`${r.branch}\` | ${r.ageDays ?? "?"} | **${r.commitsAheadOfMain}** | ${r.filesVsMain} | ${r.migrations} (max ${r.maxMigrationId}) | ${r.macros}/${r.macroDomains} | ${r.heartbeats} | ${r.lenses} | ${mdCell(r.subject)} |`);
    }
  }
  lines.push("");
  lines.push(`## Merged-or-absorbed branches (${merged.length}) — historical, no novel commits`);
  lines.push("");
  lines.push("These branches have zero commits not on `origin/main`. They've either merged via PR, been rebased into another branch, or been superseded. Safe to delete or archive.");
  lines.push("");
  lines.push("<details><summary>Click to expand the historical list</summary>");
  lines.push("");
  lines.push("| Branch | Age (d) | Last subject |");
  lines.push("|---|--:|---|");
  for (const r of merged) {
    lines.push(`| \`${r.branch}\` | ${r.ageDays ?? "?"} | ${mdCell(r.subject)} |`);
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");
  lines.push("## Migration-number collisions (any branch pair sharing migration IDs >117)");
  lines.push("");
  if (collisions.length === 0) {
    lines.push("_None — every branch's post-117 migration namespace is unique._");
  } else {
    lines.push("Each row is a pair of branches that BOTH allocated the same migration ID. The second branch to merge needs renumbering.");
    lines.push("");
    lines.push("| Branch A | Branch B | Shared IDs |");
    lines.push("|---|---|---|");
    for (const c of collisions.slice(0, 80)) {
      lines.push(`| \`${c.a}\` | \`${c.b}\` | ${c.shared.join(", ")} |`);
    }
    if (collisions.length > 80) lines.push(`| _+${collisions.length - 80} more_ | | |`);
  }
  lines.push("");
  lines.push("## Top 15 by macro count");
  lines.push("");
  lines.push("| Branch | Macros | Domains | Heartbeats |");
  lines.push("|---|--:|--:|--:|");
  for (const r of [...results].sort((a, b) => b.macros - a.macros).slice(0, 15)) {
    lines.push(`| \`${r.branch}\` | ${r.macros} | ${r.macroDomains} | ${r.heartbeats} |`);
  }
  lines.push("");
  lines.push("## Top 15 by lens count");
  lines.push("");
  lines.push("| Branch | Lenses | Files vs main |");
  lines.push("|---|--:|--:|");
  for (const r of [...results].sort((a, b) => b.lenses - a.lenses).slice(0, 15)) {
    lines.push(`| \`${r.branch}\` | ${r.lenses} | ${r.filesVsMain} |`);
  }
  lines.push("");
  lines.push("## Recommended merge order");
  lines.push("");
  lines.push("Merge highest-novelty + lowest-collision-risk first; lower-novelty branches absorb upstream merges and resolve their own collisions on rebase.");
  lines.push("");
  lines.push("1. Branches that don't add migrations beyond 117 (no collision risk): merge first.");
  lines.push("2. Branches whose max migration ID is highest among collision-free survivors.");
  lines.push("3. Among collisions: prefer the branch with more total files-vs-main (more value), force the other to renumber.");
  lines.push("");

  const mdPath = path.join(OUT_DIR, "CROSS_BRANCH.md");
  await writeFile(mdPath, lines.join("\n"), "utf-8");

  console.log(`[cross-branch] wrote ${mdPath}`);
  console.log(`[cross-branch] wrote audit/cartograph/CROSS_BRANCH.json`);
  console.log(`[cross-branch] DONE — ${results.length} branches, ${collisions.length} migration collisions`);
}

main().catch(err => {
  console.error("[cross-branch] fatal:", err?.stack || err?.message);
  process.exit(2);
});
