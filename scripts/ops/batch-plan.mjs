#!/usr/bin/env node
// Batch-deploy planner. Builds a safe batch of up to 4 SHIP-verdict PRs and proves it with a trial merge.
//   node scripts/ops/batch-plan.mjs [--prs 1866,1867] [--max 4] [--no-tests] [--json] [--repo ~/concord-wt/prclean]
// Rules (Dutch, 2026-10-29): backend-only, no file overlap inside the batch, no server.js / auth / security /
// migration / package files, verdict head must equal the PR head, at most 4. It never merges to main, pushes or deploys:
// the trial merge happens in a throwaway sparse clone in the OS temp dir (--repo is only read, never modified). The deploy lane does the real merges.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_BATCH = 4;
const EXCLUDE_PATH = [
  [/^server\/server\.js$/, "touches server/server.js (ships alone)"],
  [/^server\/migrations\//, "has a migration (ships alone)"],
  [/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/, "changes dependencies"],
  [/(auth|security|csrf|jwt|permission|rbac|login|session-guard|guard\.mjs|invariant|\.github\/workflows)/i, "touches auth/security/guard code (ships alone)"],
];

/** Parse a review-queue verdict file: {head, verdict, shipBackend, deployed}. */
export function parseVerdict(text) {
  const head = (text.match(/\bHead ([0-9a-f]{7,40})\b/) || [])[1] || null;
  const verdictLines = [...text.matchAll(/^VERDICT:\s*(.+)$/gm)];
  const verdict = verdictLines.length ? verdictLines[verdictLines.length - 1][1].trim() : null;
  const deployed = /^VERDICT result:\s*DEPLOYED/m.test(text);
  const ship = Boolean(verdict && /^SHIP/i.test(verdict));
  const shipBackend = ship && /\bBE\b|backend/i.test(verdict) && !/\bFE\b.*only|frontend only/i.test(verdict);
  return { head, verdict, ship, shipBackend, deployed };
}

/** Why a PR's changed files keep it out of a batch, or null when they are fine. */
export function fileExclusion(files) {
  const nonTest = files.filter((f) => !/(^|\/)tests?\//.test(f) && !/\.test\.[cm]?[jt]sx?$/.test(f));
  const offBackend = nonTest.filter((f) => !f.startsWith("server/") && !f.startsWith("scripts/"));
  if (offBackend.length) return `not backend-only (${offBackend[0]})`;
  for (const f of files) for (const [re, why] of EXCLUDE_PATH) if (re.test(f)) return `${why}: ${f}`;
  return null;
}

/** Greedy pick in the given order: no file overlap, at most max. Returns {picked, skipped:[{n, reason}]}. */
export function selectBatch(prs, max = MAX_BATCH) {
  const picked = []; const skipped = []; const used = new Map();
  for (const p of prs) {
    if (picked.length >= max) { skipped.push({ n: p.n, reason: `batch full (${max})` }); continue; }
    const clash = p.files.find((f) => used.has(f));
    if (clash) { skipped.push({ n: p.n, reason: `file overlap with #${used.get(clash)}: ${clash}` }); continue; }
    picked.push(p);
    for (const f of p.files) used.set(f, p.n);
  }
  return { picked, skipped };
}

const TRIAL_DIRS = ["server", "scripts", "content", "config"];
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gh = (...a) => execFileSync("gh", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function main() {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const flag = (k) => argv.includes(`--${k}`);
  const repo = path.resolve(opt("repo", path.join(os.homedir(), "concord-wt/prclean")));
  const queue = path.resolve(opt("queue", path.join(os.homedir(), ".zuko/quality/opencode-runs/review-queue")));
  const max = Math.min(MAX_BATCH, Number(opt("max", MAX_BATCH)));

  const nums = opt("prs", null)
    ? opt("prs").split(",").map(Number)
    : fs.readdirSync(queue).filter((f) => /^\d+\.md$/.test(f)).map((f) => Number(f.replace(".md", ""))).sort((a, b) => a - b);

  const excluded = []; const candidates = [];
  for (const n of nums) {
    const vf = path.join(queue, `${n}.md`);
    if (!fs.existsSync(vf)) { if (opt("prs", null)) excluded.push({ n, reason: "no verdict file" }); continue; }
    const v = parseVerdict(fs.readFileSync(vf, "utf8"));
    if (v.deployed) continue;
    if (!v.ship) { if (opt("prs", null)) excluded.push({ n, reason: `verdict is ${v.verdict || "missing"}` }); continue; }
    if (!v.shipBackend) { excluded.push({ n, reason: `verdict "${v.verdict}" is not backend-only` }); continue; }
    let info;
    try { info = JSON.parse(gh("pr", "view", String(n), "--json", "state,headRefOid,files,isDraft")); }
    catch (e) { excluded.push({ n, reason: "gh pr view failed" }); continue; }
    if (info.state !== "OPEN") { excluded.push({ n, reason: `PR is ${info.state}` }); continue; }
    if (!v.head || !info.headRefOid.startsWith(v.head)) { excluded.push({ n, reason: `head moved: verdict ${v.head || "?"}, PR ${info.headRefOid.slice(0, 9)}` }); continue; }
    const files = info.files.map((f) => f.path);
    const why = fileExclusion(files);
    if (why) { excluded.push({ n, reason: why }); continue; }
    candidates.push({ n, head: info.headRefOid, files });
  }

  const { picked, skipped } = selectBatch(candidates, max);
  excluded.push(...skipped);

  // Trial merge in a throwaway sparse clone under the OS temp dir. --repo is only READ (its origin URL
  // and server/node_modules); it is never fetched into, checked out or modified, so any worktree or the live
  // tree can be passed and its HEAD is untouched by construction.
  const trial = { merged: [], conflicts: [], tests: null };
  if (picked.length) {
    const origin = git(repo, "remote", "get-url", "origin");
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "batch-plan-"));
    try {
      execFileSync("git", ["clone", "-q", "--filter=blob:none", "--no-checkout", "--branch", "main", origin, work], { stdio: ["ignore", "pipe", "pipe"] });
      git(work, "sparse-checkout", "set", ...TRIAL_DIRS);
      git(work, "checkout", "-q", "-b", "batch-trial", "origin/main");
      git(work, "config", "user.email", "batch-plan@localhost");
      git(work, "config", "user.name", "batch-plan");
      const nm = path.join(repo, "server", "node_modules");
      if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(work, "server", "node_modules"));
      for (const p of picked) {
        try {
          git(work, "fetch", "-q", "origin", `pull/${p.n}/head`);
          git(work, "merge", "--no-ff", "-q", "-m", `trial #${p.n}`, "FETCH_HEAD");
          trial.merged.push(p.n);
        } catch (e) {
          try { git(work, "merge", "--abort"); } catch { /* nothing to abort */ }
          trial.conflicts.push(p.n);
          excluded.push({ n: p.n, reason: "conflicts with main or an earlier batch member" });
        }
      }
      if (!flag("no-tests") && trial.merged.length) {
        const own = picked.filter((p) => trial.merged.includes(p.n)).flatMap((p) => p.files).filter((f) => /^server\/tests\/.*\.test\.js$/.test(f)).map((f) => f.replace(/^server\//, ""));
        const list = [...new Set([...own, "tests/boot.test.js"])];
        const cmd = `~/.zuko/quality/mem-gate.sh batch-plan && cd ${JSON.stringify(path.join(work, "server"))} && NODE_ENV=test node --test --test-timeout=240000 ${list.map((f) => JSON.stringify(f)).join(" ")}`;
        const r = spawnSync("/bin/zsh", ["-c", cmd], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
        const out = `${r.stdout}\n${r.stderr}`;
        trial.tests = { files: list, pass: Number((out.match(/^ℹ pass (\d+)/m) || [])[1] || 0), fail: Number((out.match(/^ℹ fail (\d+)/m) || [])[1] || 0), cancelled: Number((out.match(/^ℹ cancelled (\d+)/m) || [])[1] || 0), exit: r.status, ...(r.status === 0 ? {} : { tail: out.trim().split("\n").slice(-6).join("\n"), error: r.error?.message || null }) };
      }
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  const ready = trial.merged.length && (!trial.tests || (trial.tests.fail === 0 && trial.tests.cancelled === 0 && trial.tests.exit === 0));
  const plan = { generatedAt: new Date().toISOString(), batch: trial.merged, ready: Boolean(ready), trial, excluded };
  if (flag("json")) { console.log(JSON.stringify(plan, null, 2)); return; }
  console.log(`BATCH PLAN ${plan.generatedAt}`);
  if (!trial.merged.length) console.log("No safe batch: nothing eligible after the rules and the trial merge.");
  else {
    console.log(`Deploy together (${trial.merged.length}): ${trial.merged.map((n) => `#${n}`).join(", ")}   ready: ${ready ? "YES" : "NO (see tests)"}`);
    if (trial.tests) console.log(`Trial tests: ${trial.tests.pass} pass, ${trial.tests.fail} fail, ${trial.tests.cancelled} cancelled over ${trial.tests.files.length} files (incl. boot).${trial.tests.tail ? `\n${trial.tests.tail}` : ""}`);
    else console.log("Trial tests: skipped (--no-tests).");
    console.log("One deploy, one /health watch. The deploy lane runs the merges; this script merged nothing to main.");
  }
  for (const e of excluded) console.log(`  excluded #${e.n}: ${e.reason}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
