#!/usr/bin/env node
// server/scripts/cartographer/novel-files-extract.js
//
// Safer alternative to full-branch merges: extract only files that
// exist on a target branch but NOT on origin/main AND NOT on our HEAD.
// Pure additions, zero conflict risk. Lets us absorb hidden subsystems
// from old branches without clobbering the newer infrastructure those
// branches predate.
//
// For each high-value branch from CROSS_BRANCH.json:
//   1. List `git diff --name-only --diff-filter=A origin/main...origin/<branch>`
//      → files added on that branch
//   2. Filter: keep only files that don't exist on our current HEAD
//      (i.e. files we've never had)
//   3. Report counts per branch, and copy the files in via
//      `git checkout origin/<branch> -- <path>` for each
//
// Default: dry-run (just report). Pass --apply to actually copy files.
// Pass --branch=<name> to extract from a single branch.
//
// Run:
//   node server/scripts/cartographer/novel-files-extract.js              # dry-run all
//   node server/scripts/cartographer/novel-files-extract.js --apply      # apply all
//   node server/scripts/cartographer/novel-files-extract.js --branch=claude/foo --apply

import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");
const OUT_DIR   = path.join(REPO_ROOT, "audit", "cartograph");

const args = process.argv.slice(2);
const APPLY  = args.includes("--apply");
const BRANCH = args.find(a => a.startsWith("--branch="))?.slice("--branch=".length) ?? null;

// Skip these dirs entirely — vendored, generated, or risk-prone.
const SKIP_PATH_PREFIXES = [
  "node_modules/",
  ".next/",
  "dist/",
  "build/",
  ".git/",
  "audit/cartograph/",     // we generate these ourselves
  "package-lock.json",     // never copy lockfiles across branches
];

// Files that should NEVER be cross-branch-imported even if they're
// novel — risk surface too high.
const SKIP_FILE_NAMES = new Set([
  "package.json",
  "tsconfig.json",
  ".eslintrc.json",
  "eslint.config.js",
  ".github/workflows/ci.yml",
  "Dockerfile",
  "docker-compose.yml",
  ".gitignore",
]);

function git(argv, opts = {}) {
  try {
    return execFileSync("git", argv, {
      cwd: REPO_ROOT, encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      ...opts,
    }).trim();
  } catch { return ""; }
}

function listAddedFiles(branch) {
  // Files added (status=A) in branch's commits not on origin/main
  const out = git(["diff", "--name-only", "--diff-filter=A", `origin/main...origin/${branch}`]);
  return out ? out.split("\n").filter(Boolean) : [];
}

async function fileExistsOnHead(p) {
  try { await stat(path.join(REPO_ROOT, p)); return true; }
  catch { return false; }
}

function shouldSkip(p) {
  for (const pre of SKIP_PATH_PREFIXES) if (p.startsWith(pre)) return true;
  if (SKIP_FILE_NAMES.has(p) || SKIP_FILE_NAMES.has(path.basename(p))) return true;
  return false;
}

async function extractNovel(branch) {
  const added = listAddedFiles(branch);
  const novel = [];
  const skipped = { onHead: 0, blacklisted: 0 };
  for (const p of added) {
    if (shouldSkip(p)) { skipped.blacklisted++; continue; }
    if (await fileExistsOnHead(p)) { skipped.onHead++; continue; }
    novel.push(p);
  }
  return { branch, totalAdded: added.length, novel, skipped };
}

async function loadAuditedBranches() {
  try {
    const raw = await readFile(path.join(OUT_DIR, "CROSS_BRANCH.json"), "utf-8");
    const j = JSON.parse(raw);
    // Filter to unmerged branches with novel commits AND non-zero file delta
    return j.branches
      .filter(b => !b.mergedIntoMain && b.commitsAheadOfMain > 0 && b.filesVsMain > 0)
      .map(b => b.branch);
  } catch (err) {
    console.error("[novel-files] Failed to read CROSS_BRANCH.json — run cross-branch-audit.js first");
    process.exit(2);
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let branches;
  if (BRANCH) {
    branches = [BRANCH];
  } else {
    branches = await loadAuditedBranches();
    console.log(`[novel-files] Considering ${branches.length} branches from CROSS_BRANCH.json`);
  }

  const reports = [];
  let i = 0;
  for (const branch of branches) {
    i++;
    process.stdout.write(`\r[novel-files] ${i}/${branches.length} ${branch.slice(0, 60).padEnd(62)}`);
    const r = await extractNovel(branch);
    reports.push(r);
  }
  console.log();

  // Detect cross-branch novel-file collisions (same path added by 2+
  // branches → must pick one source)
  const sources = new Map();  // path → [branch...]
  for (const r of reports) {
    for (const p of r.novel) {
      if (!sources.has(p)) sources.set(p, []);
      sources.get(p).push(r.branch);
    }
  }
  const collisions = [];
  for (const [p, owners] of sources) {
    if (owners.length > 1) collisions.push({ path: p, owners });
  }

  // Render summary report
  const lines = [];
  lines.push("# Novel-Files Extraction Report");
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()}.`);
  lines.push(`${BRANCH ? `Single branch mode: ${BRANCH}` : `All ${branches.length} unmerged branches from CROSS_BRANCH.json`}.`);
  lines.push(`Mode: ${APPLY ? "APPLY (files copied to working tree)" : "dry-run (no changes)"}`);
  lines.push("");
  lines.push("## Per-branch novel-file counts");
  lines.push("");
  lines.push("| Branch | Total added | Novel (safe) | On HEAD | Blacklisted |");
  lines.push("|---|--:|--:|--:|--:|");
  for (const r of reports.sort((a, b) => b.novel.length - a.novel.length)) {
    lines.push(`| \`${r.branch}\` | ${r.totalAdded} | **${r.novel.length}** | ${r.skipped.onHead} | ${r.skipped.blacklisted} |`);
  }
  lines.push("");
  lines.push(`## Cross-branch path collisions (${collisions.length})`);
  lines.push("");
  if (collisions.length === 0) {
    lines.push("_None — every novel file is unique to a single branch._");
  } else {
    lines.push("| Path | Owners |");
    lines.push("|---|---|");
    for (const c of collisions.slice(0, 50)) {
      lines.push(`| \`${c.path}\` | ${c.owners.join(", ")} |`);
    }
    lines.push("");
    lines.push(`Resolution: when applying, the LAST branch in the iteration order wins (alphabetical). Override per-collision by using --branch=<name>.`);
  }
  lines.push("");
  lines.push("## Sample of novel files (top 30 across all branches)");
  lines.push("");
  let shown = 0;
  for (const r of reports) {
    for (const p of r.novel) {
      if (shown >= 30) break;
      lines.push(`- \`${p}\` ← \`${r.branch}\``);
      shown++;
    }
    if (shown >= 30) break;
  }
  lines.push("");
  if (APPLY) {
    lines.push("## Apply log");
    lines.push("");
  }

  const totalNovel = reports.reduce((s, r) => s + r.novel.length, 0);
  console.log(`[novel-files] ${totalNovel} total novel files across ${reports.length} branches; ${collisions.length} cross-branch collisions`);

  if (APPLY) {
    let applied = 0, errors = 0;
    // Apply in branch order; later branches' versions of collisions win.
    for (const r of reports) {
      for (const p of r.novel) {
        try {
          execFileSync("git", ["checkout", `origin/${r.branch}`, "--", p], {
            cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"],
          });
          applied++;
          lines.push(`- ✓ \`${p}\` ← \`${r.branch}\``);
        } catch (err) {
          errors++;
          lines.push(`- ✗ \`${p}\` ← \`${r.branch}\`: ${err?.message?.slice(0, 80)}`);
        }
      }
    }
    console.log(`[novel-files] applied ${applied} files; ${errors} errors`);
    lines.push("");
    lines.push(`**Total: ${applied} applied, ${errors} errors.**`);
  }

  const reportPath = path.join(OUT_DIR, "NOVEL_FILES.md");
  await writeFile(reportPath, lines.join("\n"), "utf-8");
  await writeFile(path.join(OUT_DIR, "NOVEL_FILES.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), apply: APPLY, branches: reports, collisions }, null, 2), "utf-8");
  console.log(`[novel-files] wrote ${reportPath}`);
}

main().catch(err => {
  console.error("[novel-files] fatal:", err?.stack || err?.message);
  process.exit(2);
});
