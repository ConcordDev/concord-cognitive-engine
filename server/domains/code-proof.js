/**
 * Proof — the evidence ledger behind the Code lens.
 *
 * Every change a member makes to a project carries a proof: a short list of
 * checks, each one either proved by something that actually ran or left
 * open with a plain reason. Push to GitHub is only offered when every check
 * that applies to the change is proved.
 *
 *   types   — the TypeScript language service (server) over each changed
 *             TS/JS file, plus a JSON parse for changed .json files.
 *   lint    — the lens's static rules over each changed file. Errors and
 *             warnings fail; informational notes never block.
 *   tests   — the project's own test files, run by the in-browser test
 *             runner and reported back here. Bound to a fingerprint of the
 *             project's code, so any code edit makes the result stale.
 *   run     — one real run of a changed runnable file in the browser
 *             sandbox, exit code 0, no timeout. Same fingerprint rule.
 *   review  — the member read each changed file's diff. Bound to that
 *             file's content hash, so editing a file re-opens its review.
 *
 * Honesty rules this module keeps:
 *  - Types and lint are recomputed on every read, so they can never be stale.
 *  - Tests and run are reported by the member's own browser (host JS
 *    execution on the server was retired, INC-145). The ledger says so
 *    ("ran in your browser"); it never presents them as server-run.
 *  - A report for code that has since changed is refused, never recorded.
 *  - "No tests" is an open check, not a pass.
 *  - The change being proved is the change that would be pushed: the
 *    project's files against the content GitHub had when the project was
 *    pulled (or against the last local commit for a local-only project).
 */

import { createHash } from "node:crypto";

const TS_LIKE = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]);
const RUNNABLE = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "py"]);
const TEST_FILE_RE = /(^|\/)(test_[^/]+\.py|[^/]+_test\.py|[^/]+\.(test|spec)\.[cm]?[jt]sx?)$/i;
const MAX_FAILURES = 20;
const MAX_TEXT = 4000;

const sha = (s) => createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");
const extOf = (p) => (String(p).split(".").pop() || "").toLowerCase();
const isCode = (p) => RUNNABLE.has(extOf(p));
export const isTestPath = (p) => TEST_FILE_RE.test(String(p));

function countDiff(lineDiff, before, after) {
  let additions = 0, deletions = 0;
  for (const h of lineDiff(before, after)) {
    if (h.type === "add") additions++;
    else if (h.type === "del") deletions++;
  }
  return { additions, deletions };
}

function nonNegInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 1_000_000 ? n : null;
}

export function registerCodeProof(registerLensAction, h) {
  const { getWorkspaceState, saveWS, aidC, bucketC, ensureFiles, ensureGit, headTree, tsLang, analyzeFile, lineDiff, codePushGovernance, isTextPath, newProject } = h;

  function ensureProof(git) {
    if (!git.proof || typeof git.proof !== "object") git.proof = {};
    const p = git.proof;
    if (!p.reviews || typeof p.reviews !== "object") p.reviews = {};
    if (!Array.isArray(p.pushes)) p.pushes = [];
    return p;
  }

  /** The base the change is measured against — the same base a push uses. */
  function baseOf(git) {
    if (git.remote?.provider === "github" && git.remoteBase && typeof git.remoteBase === "object") {
      return {
        kind: "remote",
        label: `${git.remote.owner}/${git.remote.repo} @ ${git.remoteBaseRef || git.remote.defaultBranch || "main"}`,
        ref: git.remoteBaseRef || git.remote.defaultBranch || "main",
        tree: git.remoteBase,
      };
    }
    if (git.head) return { kind: "head", label: "last commit", ref: git.head, tree: headTree(git) };
    return { kind: "empty", label: "an empty project", ref: null, tree: {} };
  }

  /** Fingerprint of every code file in the project — what tests and runs depend on. */
  function codeFingerprint(files) {
    const lines = [];
    for (const [path, blob] of files) if (isCode(path)) lines.push(`${path}\0${sha(blob.content)}`);
    lines.sort();
    return sha(lines.join("\n"));
  }

  function changeSet(files, base) {
    const changes = [];
    const paths = new Set([...files.keys(), ...Object.keys(base.tree)]);
    for (const path of [...paths].sort()) {
      const has = files.has(path);
      const before = typeof base.tree[path] === "string" ? base.tree[path] : null;
      const after = has ? files.get(path).content : null;
      if (before === after) continue;
      const status = before == null ? "added" : after == null ? "deleted" : "modified";
      const { additions, deletions } = countDiff(lineDiff, before ?? "", after ?? "");
      changes.push({ path, status, additions, deletions, hash: after == null ? "deleted" : sha(after), code: isCode(path), test: isTestPath(path) });
    }
    return changes;
  }

  function typesCheck(files, changes) {
    const live = changes.filter((c) => c.status !== "deleted");
    const ts = live.filter((c) => TS_LIKE.has(extOf(c.path)));
    const json = live.filter((c) => extOf(c.path) === "json");
    if (ts.length === 0 && json.length === 0) return { status: "not_applicable", reason: "No TypeScript, JavaScript or JSON in this change.", errors: 0, problems: [], filesChecked: 0 };
    const problems = [];
    const external = new Set();
    let unavailable = false;
    for (const c of ts) {
      const d = tsLang.tsAvailable(c.path) ? tsLang.diagnostics(files, c.path) : null;
      if (!d) { unavailable = true; continue; }
      for (const p of d.problems) {
        if (p.severity !== "error") continue;
        // A package that is not part of the project (node:test, react, …)
        // has no type declarations here. That is a gap in what could be
        // checked, reported as such — not a type error, and not a pass for
        // that package. A missing RELATIVE import is a real error.
        const m = /^Cannot find module '([^']+)'/.exec(String(p.message || ""));
        if (m && (p.rule === "ts(2307)" || p.rule === "ts(2792)") && !m[1].startsWith(".") && !m[1].startsWith("/")) { external.add(m[1]); continue; }
        problems.push({ path: c.path, line: p.line ?? null, message: String(p.message || "").slice(0, 300) });
      }
    }
    for (const c of json) {
      try { JSON.parse(files.get(c.path).content); }
      catch (e) { problems.push({ path: c.path, line: null, message: `JSON does not parse: ${String(e?.message || e).slice(0, 200)}` }); }
    }
    if (unavailable && problems.length === 0) {
      return { status: "unavailable", reason: "The TypeScript service is not running on this server, so types could not be checked.", engine: "none", errors: 0, problems: [], filesChecked: json.length, uncheckedPackages: [] };
    }
    return {
      status: problems.length ? "failed" : "proved",
      engine: unavailable ? "partial" : "typescript",
      errors: problems.length,
      problems: problems.slice(0, 50),
      filesChecked: ts.length + json.length,
      uncheckedPackages: [...external].sort(),
    };
  }

  function lintCheck(files, changes) {
    const live = changes.filter((c) => c.status !== "deleted");
    if (live.length === 0) return { status: "not_applicable", reason: "Only deletions in this change.", errors: 0, warnings: 0, info: 0, problems: [] };
    const problems = [];
    for (const c of live) for (const p of analyzeFile(c.path, files.get(c.path).content)) problems.push(p);
    const errors = problems.filter((p) => p.severity === "error").length;
    const warnings = problems.filter((p) => p.severity === "warning").length;
    const info = problems.filter((p) => p.severity === "info").length;
    return {
      status: errors + warnings > 0 ? "failed" : "proved",
      errors, warnings, info,
      problems: problems.slice(0, 50).map((p) => ({ path: p.path, line: p.line, severity: p.severity, rule: p.rule, message: p.message })),
    };
  }

  function testsCheck(files, changes, proof, fp) {
    if (!changes.some((c) => c.code && c.status !== "deleted")) return { status: "not_applicable", reason: "No code changed.", testFiles: [] };
    const testFiles = [...files.keys()].filter(isTestPath).sort();
    if (testFiles.length === 0) return { status: "not_run", reason: "This project has no test files yet.", testFiles };
    const a = proof.tests;
    if (!a) return { status: "not_run", reason: "Tests have not been run on this code.", testFiles };
    const base = { testFiles, source: "browser", at: a.at, total: a.total, passed: a.passed, failed: a.failed, failures: a.failures || [], files: a.files || [] };
    if (a.fingerprint !== fp) return { ...base, status: "stale", reason: "The code changed after these tests ran." };
    if (a.total === 0) return { ...base, status: "failed", reason: "The run found no tests to execute." };
    return { ...base, status: a.failed === 0 && a.passed === a.total ? "proved" : "failed" };
  }

  function runCheck(changes, proof, fp) {
    const runnable = changes.filter((c) => c.code && !c.test && c.status !== "deleted");
    if (runnable.length === 0) return { status: "not_applicable", reason: "No runnable file changed.", candidates: [] };
    const candidates = runnable.map((c) => c.path);
    const a = proof.run;
    if (!a) return { status: "not_run", reason: "No changed file has been run yet.", candidates };
    const base = { candidates, source: "browser", at: a.at, path: a.path, exitCode: a.exitCode, timedOut: a.timedOut, durationMs: a.durationMs, stdoutTail: a.stdoutTail, stderrTail: a.stderrTail };
    if (a.fingerprint !== fp) return { ...base, status: "stale", reason: "The code changed after this run." };
    if (!candidates.includes(a.path)) return { ...base, status: "not_run", reason: "The last run was of a file that is not part of this change." };
    return { ...base, status: a.exitCode === 0 && !a.timedOut ? "proved" : "failed" };
  }

  function reviewCheck(changes, proof) {
    if (changes.length === 0) return { status: "not_applicable", reviewed: 0, total: 0 };
    const reviewed = changes.filter((c) => proof.reviews[c.path] === c.hash).length;
    return { status: reviewed === changes.length ? "proved" : "not_run", reviewed, total: changes.length };
  }

  const CHECK_ORDER = ["types", "lint", "tests", "run", "review"];

  function buildLedger(s, userId, projectId) {
    const project = bucketC(s.projects, userId).find((p) => p.id === projectId);
    if (!project) return null;
    const files = ensureFiles(s, userId, projectId);
    const git = ensureGit(s, userId, projectId);
    const proof = ensureProof(git);
    const base = baseOf(git);
    const changes = changeSet(files, base);
    const fp = codeFingerprint(files);
    const checks = changes.length === 0
      ? Object.fromEntries(CHECK_ORDER.map((k) => [k, { status: "not_applicable", reason: "Nothing has changed." }]))
      : {
          types: typesCheck(files, changes),
          lint: lintCheck(files, changes),
          tests: testsCheck(files, changes, proof, fp),
          run: runCheck(changes, proof, fp),
          review: reviewCheck(changes, proof),
        };
    const open = CHECK_ORDER.filter((k) => !["proved", "not_applicable"].includes(checks[k].status));
    const green = changes.length > 0 && open.length === 0;
    const remote = git.remote?.provider === "github" ? { owner: git.remote.owner, repo: git.remote.repo, defaultBranch: git.remote.defaultBranch || "main", url: git.remote.url || null } : null;
    const pushBlockers = [];
    if (!green) pushBlockers.push(changes.length === 0 ? "no_changes" : "proof_open");
    if (!remote) pushBlockers.push("no_remote");
    else if (base.kind !== "remote") pushBlockers.push("no_remote_base");
    if (changes.some((c) => c.status === "deleted")) pushBlockers.push("deletions_not_pushable");
    return {
      projectId,
      projectName: project.name,
      base: { kind: base.kind, label: base.label, ref: base.ref },
      codeFingerprint: fp,
      changes: changes.map((c) => ({ ...c, reviewed: proof.reviews[c.path] === c.hash })),
      checks,
      order: CHECK_ORDER,
      open,
      green,
      remote,
      canPush: pushBlockers.length === 0,
      pushBlockers,
      pushes: proof.pushes.slice(0, 10),
    };
  }

  const ctxProject = (ctx, params) => {
    const s = getWorkspaceState(); if (!s) return { err: { ok: false, error: "STATE unavailable" } };
    const userId = aidC(ctx);
    const projectId = String(params?.projectId || "");
    if (!projectId) return { err: { ok: false, error: "projectId required" } };
    if (!bucketC(s.projects, userId).some((p) => p.id === projectId)) return { err: { ok: false, error: "project not found" } };
    return { s, userId, projectId };
  };

  registerLensAction("code", "proof-get", (ctx, _a, params = {}) => {
    try {
      const c = ctxProject(ctx, params); if (c.err) return c.err;
      return { ok: true, result: { proof: buildLedger(c.s, c.userId, c.projectId) } };
    } catch (e) { return { ok: false, error: "proof_failed", message: String(e?.message || e) }; }
  });

  /**
   * The browser reports what its runner actually executed. params:
   *   tests: { projectId, check:'tests', fingerprint, total, passed, failed, failures:[{name,error}], files:[path] }
   *   run:   { projectId, check:'run', fingerprint, path, exitCode, timedOut, durationMs, stdout, stderr }
   * Refused when the fingerprint is not the project's current code.
   */
  registerLensAction("code", "proof-attest", (ctx, _a, params = {}) => {
    try {
      const c = ctxProject(ctx, params); if (c.err) return c.err;
      const files = ensureFiles(c.s, c.userId, c.projectId);
      const git = ensureGit(c.s, c.userId, c.projectId);
      const proof = ensureProof(git);
      const fp = codeFingerprint(files);
      if (String(params.fingerprint || "") !== fp) return { ok: false, error: "stale_fingerprint", message: "The code changed while this ran. Run it again on the current code." };
      const at = new Date().toISOString();
      if (params.check === "tests") {
        const total = nonNegInt(params.total), passed = nonNegInt(params.passed), failed = nonNegInt(params.failed);
        if (total == null || passed == null || failed == null) return { ok: false, error: "invalid_counts" };
        if (passed + failed !== total) return { ok: false, error: "invalid_counts", message: "passed + failed must equal total." };
        const ran = Array.isArray(params.files) ? params.files.map(String).filter((p) => files.has(p) && isTestPath(p)) : [];
        if (ran.length === 0) return { ok: false, error: "no_test_files", message: "Report which of the project's test files ran." };
        const failures = (Array.isArray(params.failures) ? params.failures : []).slice(0, MAX_FAILURES).map((f) => ({ name: String(f?.name || "").slice(0, 200), error: String(f?.error || "").slice(0, 500) }));
        if (failed > 0 && failures.length === 0) return { ok: false, error: "invalid_counts", message: "Failed tests need their failures." };
        proof.tests = { fingerprint: fp, at, total, passed, failed, failures, files: [...new Set(ran)] };
      } else if (params.check === "run") {
        const path = String(params.path || "");
        if (!files.has(path) || !isCode(path)) return { ok: false, error: "not_runnable", message: "Report a runnable file in this project." };
        const exitCode = Number(params.exitCode);
        if (!Number.isInteger(exitCode)) return { ok: false, error: "invalid_exit_code" };
        const durationMs = nonNegInt(params.durationMs);
        proof.run = {
          fingerprint: fp, at, path, exitCode,
          timedOut: params.timedOut === true,
          durationMs: durationMs ?? null,
          stdoutTail: String(params.stdout ?? "").slice(-MAX_TEXT),
          stderrTail: String(params.stderr ?? "").slice(-MAX_TEXT),
        };
      } else {
        return { ok: false, error: "unknown_check", message: "check must be 'tests' or 'run'." };
      }
      saveWS();
      return { ok: true, result: { proof: buildLedger(c.s, c.userId, c.projectId) } };
    } catch (e) { return { ok: false, error: "proof_failed", message: String(e?.message || e) }; }
  });

  /** Mark one changed file's diff as read (or un-read). params: { projectId, path, hash, reviewed? } */
  registerLensAction("code", "proof-review", (ctx, _a, params = {}) => {
    try {
      const c = ctxProject(ctx, params); if (c.err) return c.err;
      const git = ensureGit(c.s, c.userId, c.projectId);
      const proof = ensureProof(git);
      const changes = changeSet(ensureFiles(c.s, c.userId, c.projectId), baseOf(git));
      const path = String(params.path || "");
      const change = changes.find((x) => x.path === path);
      if (!change) return { ok: false, error: "not_changed", message: "That file has no change to review." };
      if (params.reviewed === false) delete proof.reviews[path];
      else {
        if (String(params.hash || "") !== change.hash) return { ok: false, error: "stale_review", message: "The file changed since you opened its diff. Read it again." };
        proof.reviews[path] = change.hash;
      }
      saveWS();
      return { ok: true, result: { proof: buildLedger(c.s, c.userId, c.projectId) } };
    } catch (e) { return { ok: false, error: "proof_failed", message: String(e?.message || e) }; }
  });

  /** One changed file against the proof's base: the before/after the review view diffs. params: { projectId, path } */
  registerLensAction("code", "proof-diff", (ctx, _a, params = {}) => {
    try {
      const c = ctxProject(ctx, params); if (c.err) return c.err;
      const files = ensureFiles(c.s, c.userId, c.projectId);
      const base = baseOf(ensureGit(c.s, c.userId, c.projectId));
      const path = String(params.path || "");
      const change = changeSet(files, base).find((x) => x.path === path);
      if (!change) return { ok: false, error: "not_changed", message: "That file has no change against the base." };
      const before = typeof base.tree[path] === "string" ? base.tree[path] : "";
      const after = files.has(path) ? files.get(path).content : "";
      return { ok: true, result: { path, status: change.status, hash: change.hash, before, after, base: { kind: base.kind, label: base.label }, hunks: lineDiff(before, after) } };
    } catch (e) { return { ok: false, error: "proof_failed", message: String(e?.message || e) }; }
  });

  /**
   * Turn a proved change into a governed push proposal (code-push-governance):
   * nothing reaches GitHub until the member approves it with
   * `push-proposal-approve`, which pushes to a NEW branch only.
   * params: { projectId, branchName, message?, fingerprint }
   */
  registerLensAction("code", "proof-push", (ctx, _a, params = {}) => {
    try {
      const c = ctxProject(ctx, params); if (c.err) return c.err;
      const userId = ctx?.actor?.userId || ctx?.userId || null;
      if (!userId || userId === "anon") return { ok: false, error: "no_user" };
      const ledger = buildLedger(c.s, c.userId, c.projectId);
      if (String(params.fingerprint || "") !== ledger.codeFingerprint) return { ok: false, error: "stale_fingerprint", message: "The code changed. Check the proof again before pushing." };
      if (!ledger.canPush) return { ok: false, error: "proof_not_green", blockers: ledger.pushBlockers, open: ledger.open };
      const branchName = String(params.branchName || "").trim();
      if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branchName) || branchName.includes("..") || branchName.startsWith("/") || branchName.endsWith("/")) return { ok: false, error: "invalid_branch_name" };
      if (branchName === ledger.base.ref || branchName === ledger.remote.defaultBranch) return { ok: false, error: "branch_is_base", message: "Proof pushes to a new branch, never to the base branch." };
      const git = ensureGit(c.s, c.userId, c.projectId);
      const files = ensureFiles(c.s, c.userId, c.projectId);
      const message = String(params.message || "").trim().slice(0, 200);
      const edits = ledger.changes.map((ch) => ({
        filename: ch.path,
        before: typeof git.remoteBase[ch.path] === "string" ? git.remoteBase[ch.path] : "",
        after: files.get(ch.path).content,
        reason: message || `${ch.status} ${ch.path}`,
      }));
      const proposal = codePushGovernance.createProposal({
        userId, repo: `${ledger.remote.owner}/${ledger.remote.repo}`, baseRef: ledger.base.ref, branchName, edits,
      });
      const proofRecord = {
        proposalId: proposal.id, branchName, at: new Date().toISOString(), codeFingerprint: ledger.codeFingerprint,
        checks: Object.fromEntries(ledger.order.map((k) => [k, ledger.checks[k].status])),
        files: ledger.changes.length,
      };
      ensureProof(git).pushes.unshift(proofRecord);
      ensureProof(git).pushes.splice(20);
      saveWS();
      return { ok: true, result: { proposal, proof: proofRecord } };
    } catch (e) { return { ok: false, error: "proof_failed", message: String(e?.message || e) }; }
  });

  /**
   * Import a repository from the member's CONNECTED GitHub account (private
   * repos included) into a new project, through the same authenticated
   * connector that later pushes. The imported content becomes the base the
   * proof measures against. params: { repo: "owner/name", ref?, name? }
   */
  registerLensAction("code", "github-import", async (ctx, _a, params = {}) => {
    try {
      const s = getWorkspaceState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aidC(ctx);
      if (!userId || userId === "anon") return { ok: false, error: "no_user" };
      const repo = String(params.repo || "").trim();
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { ok: false, error: "invalid_repo", message: "Use owner/name." };
      const runMacro = ctx?.runMacro || globalThis.__concordRunMacro;
      if (typeof runMacro !== "function") return { ok: false, error: "runMacro unavailable" };
      const tree = await runMacro("github", "repo-tree", { repo, ref: params.ref || undefined }, ctx);
      if (!tree?.ok) return { ok: false, error: tree?.error || tree?.reason || "repo_tree_failed", message: "Could not read that repository from your GitHub account." };
      const ref = String(tree.result?.ref || params.ref || "main");
      const blobs = (Array.isArray(tree.result?.tree) ? tree.result.tree : [])
        .filter((t) => t && t.type === "blob" && Number(t.size) < 100_000 && isTextPath(String(t.path)))
        .slice(0, 60);
      const pulled = {};
      const skipped = [];
      for (const b of blobs) {
        const f = await runMacro("github", "file-get", { repo, path: b.path, ref }, ctx);
        if (f?.ok && typeof f.result?.content === "string") pulled[b.path] = f.result.content;
        else skipped.push(b.path);
      }
      if (Object.keys(pulled).length === 0) return { ok: false, error: "nothing_imported", message: "No readable text files were found.", skipped };
      const [owner, name] = repo.split("/");
      const project = newProject(s, userId, { name: String(params.name || name).slice(0, 80), description: `Imported from ${repo}` });
      const files = ensureFiles(s, userId, project.id);
      for (const [path, content] of Object.entries(pulled)) files.set(path, { content, modifiedAt: new Date().toISOString() });
      const git = ensureGit(s, userId, project.id);
      git.remote = { provider: "github", owner, repo: name, url: `https://github.com/${repo}`, defaultBranch: ref, via: "connected", pulledAt: new Date().toISOString() };
      git.remoteBase = { ...pulled };
      git.remoteBaseRef = ref;
      saveWS();
      return { ok: true, result: { project, imported: Object.keys(pulled).length, skipped, truncated: !!tree.result?.truncated, ref } };
    } catch (e) { return { ok: false, error: "import_failed", message: String(e?.message || e) }; }
  });
}

export default registerCodeProof;
