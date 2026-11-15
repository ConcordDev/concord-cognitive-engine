#!/usr/bin/env node
/**
 * HV-01 — harvest census at the real #2356 head (Mega Plan v2, Track A).
 *
 * For every PR in the §6 harvest table (plan-table.json), measure what
 * of the PR is NOT yet on the census head:
 *
 *   added file    -> present on head, or MISSING
 *   modified file -> the PR's per-file diff reverse-applies onto head
 *                    (git apply --check -R: APPLIED), else the head file
 *                    is byte-identical to the PR's version
 *                    (APPLIED-IDENTICAL), else the PR's added lines are
 *                    present in the head file as a multiset at >= 90%
 *                    (LANDED-EVOLVED — the squash-batch shape, plan F7),
 *                    else ABSENT (coverage recorded either way)
 *   deleted file  -> absent on head or reverse-applies: APPLIED,
 *                    else ABSENT
 *
 * RESIDUAL = added-MISSING + modified/deleted-ABSENT files.
 *
 * Each PR prints one line: the §6 verdict, its residual files, and
 * AGREE or DIFFERS against the expectation §6 itself states:
 *   SUPERSEDED    residual empty, or confined to the member its own
 *                 row names as held/harvested elsewhere (path hints)
 *   HARVEST-ALL   residual non-empty and carrying the files §6's
 *   HARVEST-PART  evidence names as absent; PART additionally expects
 *                 the files §6 names as present to stay non-residual
 *   DUTCH / DROP  residual non-empty (content not on the branch)
 *   TARGET        the census head itself
 *
 * Read-only: every git call is a read or an apply --check against a
 * throwaway index. Output is deterministic — same head, same bytes.
 *
 * Usage:
 *   node scripts/harvest/residual.mjs --repo <path> --head <ref> \
 *     --main <ref> --table scripts/harvest/plan-table.json \
 *     --pr-prefix refs/pr --out audit/harvest/RESIDUAL-<sha>.md
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

function git(repo, args, opts = {}) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    ...opts,
  });
}
function gitOk(repo, args, opts = {}) {
  try {
    git(repo, args, opts);
    return true;
  } catch {
    return false;
  }
}
function blob(repo, ref, path) {
  try {
    return git(repo, ["show", `${ref}:${path}`]);
  } catch {
    return null;
  }
}

const EVOLVED_THRESHOLD = 0.9;

function addedLineCoverage(diffText, headText) {
  const added = [];
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const t = line.slice(1).replace(/\s+$/, "");
      if (t.trim()) added.push(t);
    }
  }
  if (!added.length) return 1;
  const pool = new Map();
  for (const line of headText.split("\n")) {
    const t = line.replace(/\s+$/, "");
    pool.set(t, (pool.get(t) || 0) + 1);
  }
  let hit = 0;
  for (const t of added) {
    const n = pool.get(t) || 0;
    if (n > 0) {
      hit++;
      pool.set(t, n - 1);
    }
  }
  return hit / added.length;
}

/**
 * Classify every file of one PR against the census head.
 * refs: { pr: <ref>, main: <ref>, head: <ref> } in `repo`.
 * `indexEnv` points GIT_INDEX_FILE at an index pre-loaded with head.
 */
export function classifyPr(repo, { pr, main, head }, indexEnv) {
  const base = git(repo, ["merge-base", main, pr]).trim();
  const nameStatus = git(repo, ["diff", "--name-status", "-M", `${base}..${pr}`]);
  const files = [];
  const scratch = mkdtempSync(join(tmpdir(), "hv01-"));
  try {
    for (const raw of nameStatus.split("\n")) {
      if (!raw.trim()) continue;
      const parts = raw.split("\t");
      const code = parts[0];
      const path = parts[parts.length - 1];
      if (code.startsWith("A")) {
        const present = gitOk(repo, ["cat-file", "-e", `${head}:${path}`]);
        files.push({ path, change: "A", class: present ? "PRESENT" : "MISSING" });
      } else if (code.startsWith("D")) {
        const present = gitOk(repo, ["cat-file", "-e", `${head}:${path}`]);
        if (!present) {
          files.push({ path, change: "D", class: "APPLIED" });
          continue;
        }
        const patch = git(repo, ["diff", base, pr, "--", path]);
        const pf = join(scratch, "p.patch");
        writeFileSync(pf, patch);
        const applied = gitOk(repo, ["apply", "--check", "--cached", "-R", pf], { env: { ...process.env, ...indexEnv } });
        files.push({ path, change: "D", class: applied ? "APPLIED" : "ABSENT", coverage: 0 });
      } else {
        // M or R (rename target path): hunk-level classification.
        const patch = git(repo, ["diff", base, pr, "--", path]);
        const pf = join(scratch, "p.patch");
        writeFileSync(pf, patch);
        const applied = gitOk(repo, ["apply", "--check", "--cached", "-R", pf], { env: { ...process.env, ...indexEnv } });
        if (applied) {
          files.push({ path, change: "M", class: "APPLIED" });
          continue;
        }
        const headBlob = blob(repo, head, path);
        const prBlob = blob(repo, pr, path);
        if (headBlob !== null && prBlob !== null && headBlob === prBlob) {
          files.push({ path, change: "M", class: "APPLIED-IDENTICAL" });
          continue;
        }
        const coverage = headBlob === null ? 0 : addedLineCoverage(patch, headBlob);
        files.push({
          path,
          change: "M",
          class: coverage >= EVOLVED_THRESHOLD ? "LANDED-EVOLVED" : "ABSENT",
          coverage: Math.round(coverage * 1000) / 1000,
        });
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const residual = files
    .filter((f) => f.class === "MISSING" || f.class === "ABSENT")
    .map((f) => f.path);
  return { base, files, residual };
}

// §6 expectations beyond the bare verdict word, read from the table's
// own evidence text (file names as §6 names them; basename matching
// where §6 gives no full path).
const HELD_PATH_HINTS = {
  2151: ["bounties"],
  2143: ["automotive"],
  2202: ["geology"],
};
const EXPECT_RESIDUAL_INCLUDES = {
  2349: ["chrome-fix-a6.test.tsx"],
  2348: ["formatter-throws-p1.test.mjs"],
  2347: ["hr-retain-label.test.js"],
  2346: ["bounty-proposal.js"],
  2208: ["legal-coverage.test.tsx"],
  2136: ["bounties-build.test.js"],
  2103: ["event-when.ts"],
  2099: ["operations-store.ts", "OperationsStorePanel.tsx"],
  2046: ["canonical-result.js"],
  2047: ["db-dial.js"],
  2045: ["db-dial.js"],
  1779: ["B3-2-DOSSIER-2026-10-28.md"],
};
const EXPECT_PRESENT_INCLUDES = {
  2345: ["498_commonsense_check_provenance.js", "commonsense-checks-build.test.js"],
  2054: ["cross-model-dtu.js"],
};

export function agreeCheck(row, residual) {
  const residualBase = new Set(residual.map((p) => basename(p)));
  const includesOk = (EXPECT_RESIDUAL_INCLUDES[row.pr] || []).every((f) => residualBase.has(f));
  const presentOk = (EXPECT_PRESENT_INCLUDES[row.pr] || []).every((f) => !residualBase.has(f));
  switch (row.verdict) {
    case "TARGET":
      return { agree: true, why: "the census head itself" };
    case "SUPERSEDED": {
      const hints = HELD_PATH_HINTS[row.pr] || [];
      const stray = residual.filter((p) => !hints.some((h) => p.toLowerCase().includes(h)));
      return stray.length === 0
        ? { agree: true, why: residual.length ? "residual confined to the member its row names" : "residual empty" }
        : { agree: false, why: `residual beyond the named member: ${stray.join(", ")}` };
    }
    case "HARVEST-ALL":
    case "HARVEST-PART":
      if (!residual.length) return { agree: false, why: "§6 expects a harvest but the residual is empty" };
      if (!includesOk) return { agree: false, why: "a file §6 names as absent is not in the residual" };
      if (!presentOk) return { agree: false, why: "a file §6 names as present is in the residual" };
      return { agree: true, why: "residual is the harvest §6 names" };
    case "DUTCH":
    case "DROP":
      if (!residual.length) return { agree: false, why: "§6 expects the content off the branch but the residual is empty" };
      if (!includesOk) return { agree: false, why: "a file §6 names as absent is not in the residual" };
      return { agree: true, why: "content off the branch, as §6 states" };
    default:
      return { agree: false, why: `unhandled verdict ${row.verdict}` };
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
}

export function runCensus({ repo, head, main, tablePath, prPrefix }) {
  const headSha = git(repo, ["rev-parse", head]).trim();
  const mainSha = git(repo, ["rev-parse", main]).trim();
  const table = JSON.parse(readFileSync(tablePath, "utf8"));
  const scratch = mkdtempSync(join(tmpdir(), "hv01-index-"));
  const indexFile = join(scratch, "index");
  const indexEnv = { GIT_INDEX_FILE: indexFile };
  git(repo, ["read-tree", head], { env: { ...process.env, ...indexEnv } });
  const lines = [];
  const details = [];
  let differs = 0;
  try {
    for (const row of table) {
      const prRef = `${prPrefix}/${row.pr}`;
      const prSha = git(repo, ["rev-parse", prRef]).trim();
      if (row.pr === 2356) {
        lines.push(`| #${row.pr} | ${row.verdict} | — | — | AGREE |`);
        continue;
      }
      const { files, residual } = classifyPr(repo, { pr: prRef, main, head }, indexEnv);
      const { agree, why } = agreeCheck(row, residual);
      if (!agree) differs++;
      const headNote = prSha.startsWith(row.planHead) ? "" : ` (head moved: ${prSha.slice(0, 9)})`;
      lines.push(
        `| #${row.pr} | ${row.verdict} | ${residual.length ? residual.join(", ") : "—"} | ${agree ? "AGREE" : "DIFFERS"} |`,
      );
      details.push(
        `### #${row.pr} — ${row.verdictText} → ${row.ticket}${headNote}\n` +
          `plan head ${row.planHead} · measured head ${prSha.slice(0, 9)} · census: ${agree ? "AGREE" : "DIFFERS"} (${why})\n` +
          files
            .map((f) => `- ${f.class}${f.coverage !== undefined && f.class !== "APPLIED" ? ` (added-line coverage ${f.coverage})` : ""} — ${f.path}`)
            .join("\n"),
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const md =
    `# HV-01 harvest census — RESIDUAL\n\n` +
    `Census head (fix/audit-sweep-20261110): ${headSha}\n` +
    `Main: ${mainSha}\n` +
    `Table: §6 of MEGA_PLAN.md (${table.length} PRs, extract scripts/harvest/plan-table.json)\n` +
    `Tool: scripts/harvest/residual.mjs — added: present/MISSING · modified: APPLIED / APPLIED-IDENTICAL / LANDED-EVOLVED (>= 0.9 added-line coverage) / ABSENT · residual = MISSING + ABSENT\n` +
    `DIFFERS rows: ${differs} (each returns to the office before its HV ticket starts)\n\n` +
    `| PR | §6 verdict | residual files | census |\n|---|---|---|---|\n` +
    lines.join("\n") +
    `\n\n## Per-file detail\n\n` +
    details.join("\n\n") +
    `\n`;
  return { md, headSha, differs };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv);
  const repo = args.repo || ".";
  const head = args.head || "origin/fix/audit-sweep-20261110";
  const main = args.main || "origin/main";
  const tablePath = args.table || "scripts/harvest/plan-table.json";
  const prPrefix = args["pr-prefix"] || "refs/pr";
  const { md, headSha, differs } = runCensus({ repo, head, main, tablePath, prPrefix });
  const out = args.out || `audit/harvest/RESIDUAL-${headSha.slice(0, 9)}.md`;
  writeFileSync(out, md);
  console.log(`wrote ${out} — head ${headSha.slice(0, 9)}, DIFFERS rows: ${differs}`);
}
