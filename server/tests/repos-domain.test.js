// Repos domain — handler-level behaviour tests (B5, Review 2 build).
// Runs the real registrar + guardAnonWrites against a shimmed
// globalThis._concordSTATE. Covers the review's acceptance
// constructions: R3 (branch holds work), R5(b) (conflict blocked with
// named lines), lifecycle, guards, and the Analysis engines' params
// shape (F6). OSV network access is NOT exercised here.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};

const { default: registerReposActions } = await import("../domains/repos.js");
const handlers = new Map();
registerReposActions((domain, name, fn) => handlers.set(`${domain}:${name}`, fn));

const U1 = { actor: { userId: "user-1" } };
const ANON = {};
const run = (name, ctx, params = {}) => handlers.get(`repos:${name}`)(ctx, {}, params);
const runAsync = (name, ctx, params = {}) => handlers.get(`repos:${name}`)(ctx, {}, params);

async function freshRepo(name = "demo") {
  const r = await run("repo-create", U1, { name });
  assert.equal(r.ok, true, JSON.stringify(r));
  const list = await run("repo-list", U1, {});
  const repo = list.result.repos.find((x) => x.name === name);
  assert.ok(repo);
  return repo.id;
}

test("registration: the substrate + lifecycle macros exist", () => {
  for (const m of ["repo-create", "repo-list", "repo-update", "repo-delete", "file-tree", "file-read",
    "file-save", "file-delete", "branch-list", "branch-create", "branch-delete", "tag-create", "tag-delete",
    "commit-graph", "commit-detail", "issue-create", "issue-detail", "pull-create", "pull-detail",
    "pull-merge", "pull-comment", "pull-link-issue", "security-scan", "repo-insights",
    "codeComplexity", "commitAnalysis", "dependencyAudit"]) {
    assert.ok(handlers.has(`repos:${m}`), `missing macro ${m}`);
  }
});

test("S1/R3: a branch holds work — main does not move, the branch count does", async () => {
  const repoId = await freshRepo("s1-repo");
  const before = await run("branch-list", U1, { repoId });
  const mainBefore = before.result.branches.find((b) => b.name === "main");
  assert.equal(mainBefore.commits, 1); // the initial commit, by ancestry

  await run("branch-create", U1, { repoId, name: "feature" });
  const save1 = await run("file-save", U1, { repoId, branch: "feature", path: "README.md", content: "# demo\n\nEdited on the branch.\n", message: "branch edit" });
  assert.equal(save1.ok, true, JSON.stringify(save1));
  assert.equal(save1.result.branch, "feature");
  const save2 = await run("file-save", U1, { repoId, branch: "feature", path: "src/new.ts", content: "export const x = 1;\n", message: "add new file on branch" });
  assert.equal(save2.ok, true);
  assert.equal(save2.result.created, true);

  const after = await run("branch-list", U1, { repoId });
  const main = after.result.branches.find((b) => b.name === "main");
  const feature = after.result.branches.find((b) => b.name === "feature");
  assert.equal(main.commits, 1, "main must not gain the branch's commits");
  assert.equal(feature.commits, 3, "feature = initial + its own two commits");

  const mainReadme = await run("file-read", U1, { repoId, path: "README.md" });
  assert.match(mainReadme.result.content, /A Concord repository/);
  const branchReadme = await run("file-read", U1, { repoId, branch: "feature", path: "README.md" });
  assert.match(branchReadme.result.content, /Edited on the branch/);
  const mainTree = await run("file-tree", U1, { repoId });
  assert.equal(mainTree.result.fileCount, 4);
  const featureTree = await run("file-tree", U1, { repoId, branch: "feature" });
  assert.equal(featureTree.result.fileCount, 5);
});

test("S6 guards: duplicate name, empty message, empty content, no-change save", async () => {
  const repoId = await freshRepo("guard-repo");
  const dupe = await run("repo-create", U1, { name: "GUARD-REPO" });
  assert.equal(dupe.ok, false);
  assert.equal(dupe.error, "duplicate_name");

  const noMsg = await run("file-save", U1, { repoId, path: "README.md", content: "# x\n", message: "" });
  assert.equal(noMsg.ok, false);
  assert.equal(noMsg.error, "commit_message_required");

  const empty = await run("file-save", U1, { repoId, path: "README.md", content: "", message: "empty it" });
  assert.equal(empty.ok, false);
  assert.equal(empty.error, "empty_content");
  const emptyOk = await run("file-save", U1, { repoId, path: "README.md", content: "", message: "empty it", confirmEmpty: true });
  assert.equal(emptyOk.ok, true, JSON.stringify(emptyOk));

  const pkg = await run("file-read", U1, { repoId, path: "package.json" });
  const noChange = await run("file-save", U1, { repoId, path: "package.json", content: pkg.result.content, message: "same" });
  assert.equal(noChange.ok, false);
  assert.equal(noChange.error, "no_changes");
  assert.ok(repoId);
});

test("S2: PR diff is real (merge-base vs head), and commit-detail diffs one commit", async () => {
  const repoId = await freshRepo("diff-repo");
  await run("branch-create", U1, { repoId, name: "feature" });
  await run("file-save", U1, { repoId, branch: "feature", path: "README.md", content: "# diff-repo\n\nChanged on the branch.\n", message: "third line change" });
  await run("file-save", U1, { repoId, branch: "feature", path: "src/added.ts", content: "a\nb\nc\n", message: "add file" });
  const pr = await run("pull-create", U1, { repoId, title: "Feature work", head: "feature" });
  assert.equal(pr.ok, true, JSON.stringify(pr));

  const detail = await run("pull-detail", U1, { repoId, number: pr.result.pull.number });
  assert.equal(detail.ok, true);
  assert.equal(detail.result.diff.fileCount, 2);
  const readme = detail.result.diff.files.find((f) => f.path === "README.md");
  assert.equal(readme.status, "modified");
  assert.equal(readme.additions, 1);
  assert.equal(readme.deletions, 1);
  const added = detail.result.diff.files.find((f) => f.path === "src/added.ts");
  assert.equal(added.status, "added");
  assert.equal(added.additions, 3);
  assert.equal(added.deletions, 0);
  assert.deepEqual(detail.result.conflicts, []);
  assert.equal(detail.result.mergeable, true);

  const graph = await run("commit-graph", U1, { repoId });
  const addCommit = graph.result.nodes.find((n) => n.message === "add file");
  const cd = await run("commit-detail", U1, { repoId, sha: addCommit.sha });
  assert.equal(cd.result.diff.fileCount, 1);
  assert.equal(cd.result.diff.files[0].path, "src/added.ts");
  assert.equal(cd.result.diff.additions, 3);
  // The file's state at that commit is viewable.
  const atCommit = await run("file-read", U1, { repoId, path: "src/added.ts", sha: addCommit.sha });
  assert.equal(atCommit.result.content, "a\nb\nc\n");
});

test("S6: a no-change PR is refused at creation, saying so", async () => {
  const repoId = await freshRepo("empty-pr-repo");
  await run("branch-create", U1, { repoId, name: "nothing" });
  const pr = await run("pull-create", U1, { repoId, title: "Empty", head: "nothing" });
  assert.equal(pr.ok, false);
  assert.equal(pr.error, "no_changes");
});

test("S3/R5(b): same-line divergence blocks the merge, names the lines, PR stays open", async () => {
  const repoId = await freshRepo("conflict-repo");
  await run("branch-create", U1, { repoId, name: "side" });
  // Both sides change README line 1 differently.
  await run("file-save", U1, { repoId, branch: "main", path: "README.md", content: "# main version\n\nA Concord repository.\n", message: "main title" });
  await run("file-save", U1, { repoId, branch: "side", path: "README.md", content: "# side version\n\nA Concord repository.\n", message: "side title" });
  const pr = await run("pull-create", U1, { repoId, title: "Conflicting", head: "side" });
  assert.equal(pr.ok, true, JSON.stringify(pr));

  const detail = await run("pull-detail", U1, { repoId, number: pr.result.pull.number });
  assert.equal(detail.result.conflicts.length, 1);
  assert.equal(detail.result.conflicts[0].path, "README.md");
  assert.deepEqual(detail.result.conflicts[0].lines, [1]);
  assert.equal(detail.result.mergeable, false);

  const merge = await run("pull-merge", U1, { repoId, number: pr.result.pull.number });
  assert.equal(merge.ok, false);
  assert.equal(merge.error, "merge_conflict");
  assert.match(merge.message, /README\.md/);
  assert.match(merge.message, /stays open/);

  const list = await run("pull-list", U1, { repoId, state: "open" });
  assert.equal(list.result.open, 1, "the blocked PR remains open");
  const mainReadme = await run("file-read", U1, { repoId, path: "README.md" });
  assert.match(mainReadme.result.content, /# main version/, "main was not overwritten by the blocked merge");
});

test("S3: disjoint line edits merge cleanly; linked issue closes on merge", async () => {
  const repoId = await freshRepo("merge-repo");
  const issue = await run("issue-create", U1, { repoId, title: "Track the merge" });
  await run("branch-create", U1, { repoId, name: "side" });
  await run("file-save", U1, { repoId, branch: "main", path: "README.md", content: "# merge-repo\n\nMain was here.\n", message: "main line 3" });
  await run("file-save", U1, { repoId, branch: "side", path: "README.md", content: "# merge-repo (side)\n\nA Concord repository.\n", message: "side line 1" });
  const pr = await run("pull-create", U1, { repoId, title: "Clean merge", head: "side" });
  const link = await run("pull-link-issue", U1, { repoId, number: pr.result.pull.number, issueNumber: issue.result.issue.number });
  assert.equal(link.ok, true);
  assert.deepEqual(link.result.linkedIssues, [issue.result.issue.number]);

  const merge = await run("pull-merge", U1, { repoId, number: pr.result.pull.number });
  assert.equal(merge.ok, true, JSON.stringify(merge));
  assert.deepEqual(merge.result.closedIssues, [issue.result.issue.number]);

  const mainReadme = await run("file-read", U1, { repoId, path: "README.md" });
  assert.match(mainReadme.result.content, /# merge-repo \(side\)/);
  assert.match(mainReadme.result.content, /Main was here\./);
  const issueAfter = await run("issue-detail", U1, { repoId, number: issue.result.issue.number });
  assert.equal(issueAfter.result.issue.state, "closed");
  assert.equal(issueAfter.result.issue.linkedPulls[0].state, "merged");
});

test("S4/S5 lifecycle: file-delete, branch-delete rules, tag-delete, repo-update, repo-delete", async () => {
  const repoId = await freshRepo("life-repo");
  await run("branch-create", U1, { repoId, name: "scratch" });
  const del = await run("file-delete", U1, { repoId, branch: "scratch", path: "src/util.ts" });
  assert.equal(del.ok, true, JSON.stringify(del));
  const tree = await run("file-tree", U1, { repoId, branch: "scratch" });
  assert.equal(tree.result.fileCount, 3);
  const mainTree = await run("file-tree", U1, { repoId });
  assert.equal(mainTree.result.fileCount, 4, "the delete stayed on its branch");

  const delDefault = await run("branch-delete", U1, { repoId, name: "main" });
  assert.equal(delDefault.ok, false);
  assert.equal(delDefault.error, "default_branch");

  await run("file-save", U1, { repoId, branch: "scratch", path: "src/util.ts", content: "export {};\n", message: "restore" });
  const pr = await run("pull-create", U1, { repoId, title: "Scratch PR", head: "scratch" });
  assert.equal(pr.ok, true, JSON.stringify(pr));
  const delInPr = await run("branch-delete", U1, { repoId, name: "scratch" });
  assert.equal(delInPr.ok, false);
  assert.equal(delInPr.error, "branch_in_open_pr");

  await run("tag-create", U1, { repoId, name: "v9" });
  const tagDel = await run("tag-delete", U1, { repoId, name: "v9" });
  assert.equal(tagDel.ok, true);

  const upd = await run("repo-update", U1, { repoId, name: "life-repo-renamed", isPrivate: true, description: "Now private." });
  assert.equal(upd.ok, true);
  assert.equal(upd.result.repo.isPrivate, true);

  const badDelete = await run("repo-delete", U1, { repoId, confirmName: "wrong name" });
  assert.equal(badDelete.ok, false);
  assert.equal(badDelete.error, "confirm_mismatch");
  const goodDelete = await run("repo-delete", U1, { repoId, confirmName: "life-repo-renamed" });
  assert.equal(goodDelete.ok, true);
  const list = await run("repo-list", U1, {});
  assert.equal(list.result.repos.some((r) => r.id === repoId), false);
});

test("S10: line comments anchor to a diff line; general comments coexist", async () => {
  const repoId = await freshRepo("comment-repo");
  await run("branch-create", U1, { repoId, name: "feature" });
  await run("file-save", U1, { repoId, branch: "feature", path: "src/index.ts", content: "export function main(): void {\n  console.log('changed');\n}\n", message: "change body" });
  const pr = await run("pull-create", U1, { repoId, title: "Commentable", head: "feature" });
  const line = await run("pull-comment", U1, { repoId, number: pr.result.pull.number, body: "Why the change?", path: "src/index.ts", line: 2 });
  assert.equal(line.ok, true);
  assert.equal(line.result.comment.line, 2);
  const general = await run("pull-comment", U1, { repoId, number: pr.result.pull.number, body: "Overall looks fine." });
  assert.equal(general.result.comment.path, undefined);
  const detail = await run("pull-detail", U1, { repoId, number: pr.result.pull.number });
  assert.equal(detail.result.comments.length, 2);
});

test("S7/F6: the Analysis engines answer from lens params, not only artifacts", async () => {
  const cx = await run("codeComplexity", U1, {
    modules: [{ name: "m", functions: [{ name: "f", branches: 2, loops: 1, conditions: 1, lines: 10, nesting: 0 }], imports: [], exports: [] }],
  });
  assert.equal(cx.ok, true);
  assert.equal(cx.result.totalFunctions, 1);
  // ...and via params.input, and via the artifact (both shapes kept).
  const ca = await run("commitAnalysis", U1, {
    commits: [
      { hash: "a", author: "you", date: "2026-10-01T10:00:00Z", files: ["x.ts"], additions: 3, deletions: 1, message: "feat: one" },
      { hash: "b", author: "you", date: "2026-10-02T10:00:00Z", files: ["x.ts"], additions: 1, deletions: 0, message: "fix: two" },
    ],
  });
  assert.equal(ca.ok, true);
  assert.equal(ca.result.totalCommits, 2);
  const da = await run("dependencyAudit", U1, { dependencies: [{ name: "lodash", version: "4.17.20" }] });
  assert.equal(da.ok, true);
  assert.equal(da.result.totalDependencies, 1);
  const empty = await run("codeComplexity", U1, {});
  assert.equal(empty.ok, true);
  assert.match(empty.result.message, /No modules/);
});

test("follow-up/legacy: a pre-snapshot repo heals at its default head — branch view, commit, PR diff (re-pass checkpoint 1)", async () => {
  // Hand-build a pre-snapshot repo directly in state: two legacy
  // commits (no `changes` on either), repo.files mirroring the head's
  // tree, plus a legacy side branch pointing at the OLDER commit —
  // forked mid-history, which stays unanchorable. This is the
  // fixture class whose absence let #1808 ship: every #1808 fixture
  // was born on snapshot-era code, so the fold never met a legacy
  // commit until Review 2 ran it live on an 8-commit legacy repo.
  const s = globalThis._concordSTATE.reposLens;
  const legacy = {
    id: "repo_legacy", name: "legacy-repo", description: "", language: "TypeScript",
    isPrivate: false, stars: 0, defaultBranch: "main", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    files: [
      { path: "README.md", type: "file", content: "# legacy\n\nhead state\n", size: 20 },
      { path: "src/index.ts", type: "file", content: "export const v = 2;\n", size: 20 },
    ],
    branches: [
      { name: "main", head: "legacyc2", protected: true, createdAt: "2026-01-01T00:00:00Z" },
      { name: "old-side", head: "legacyc1", protected: false, createdAt: "2026-01-01T00:00:00Z" },
    ],
    tags: [],
    commits: [
      { sha: "legacyc1", message: "old 1", author: "you", branch: "main", parents: [], date: "2026-01-01T00:00:00Z", additions: 1, deletions: 0, files: ["README.md"] },
      { sha: "legacyc2", message: "old 2", author: "you", branch: "main", parents: ["legacyc1"], date: "2026-01-02T00:00:00Z", additions: 1, deletions: 0, files: ["README.md"] },
    ],
    issues: [], pulls: [], workflowRuns: [], securityAlerts: [],
  };
  if (!s.repos) s.repos = new Map();
  const list = s.repos.get("user-1") || [];
  list.push(legacy);
  s.repos.set("user-1", list);

  // Counts (item 4): main reports its total (2); the side branch has
  // no commits of its own → 0 ahead, not its inherited prefix.
  const bl = await run("branch-list", U1, { repoId: "repo_legacy" });
  assert.equal(bl.result.branches.find((b) => b.name === "main").commits, 2);
  assert.equal(bl.result.branches.find((b) => b.name === "old-side").commits, 0);

  // What stays honest: the mid-history branch and the older commit
  // are genuinely unrecoverable, and the surfaces still say so.
  const sideTree = await run("file-tree", U1, { repoId: "repo_legacy", branch: "old-side" });
  assert.equal(sideTree.ok, false);
  assert.equal(sideTree.error, "history_unrecorded");
  const atOldSha = await run("file-read", U1, { repoId: "repo_legacy", path: "README.md", sha: "legacyc1" });
  assert.equal(atOldSha.ok, false);
  assert.equal(atOldSha.error, "history_unrecorded");

  // The checkpoint-1 motion exactly: create a branch TODAY on the
  // legacy repo, view its files, commit on it.
  const bc = await run("branch-create", U1, { repoId: "repo_legacy", name: "repass-feature" });
  assert.equal(bc.ok, true, JSON.stringify(bc));
  const tree = await run("file-tree", U1, { repoId: "repo_legacy", branch: "repass-feature" });
  assert.equal(tree.ok, true, "branch file view must render on a healed legacy repo");
  assert.equal(tree.result.fileCount, 2);
  const read = await run("file-read", U1, { repoId: "repo_legacy", branch: "repass-feature", path: "README.md" });
  assert.match(read.result.content, /head state/);
  const save = await run("file-save", U1, { repoId: "repo_legacy", branch: "repass-feature", path: "README.md", content: "# legacy\n\nbranch state\n", message: "branch edit on legacy repo" });
  assert.equal(save.ok, true, JSON.stringify(save));

  const bl2 = await run("branch-list", U1, { repoId: "repo_legacy" });
  assert.equal(bl2.result.branches.find((b) => b.name === "main").commits, 2, "main's total must not move");
  assert.equal(bl2.result.branches.find((b) => b.name === "repass-feature").commits, 1, "the branch's own commit counts as 1 ahead");
  const mainRead = await run("file-read", U1, { repoId: "repo_legacy", path: "README.md" });
  assert.match(mainRead.result.content, /head state/, "main's tree is untouched by the branch commit");

  // The PR the re-pass could not get (its #6 showed the
  // predates-snapshots message on a branch created that day): the
  // diff computes, because the merge-base IS the anchored head.
  const pr = await run("pull-create", U1, { repoId: "repo_legacy", title: "legacy branch work", head: "repass-feature", base: "main" });
  assert.equal(pr.ok, true, JSON.stringify(pr));
  const detail = await run("pull-detail", U1, { repoId: "repo_legacy", number: pr.result.pull.number });
  assert.equal(detail.ok, true);
  assert.ok(detail.result.diff, "diff must compute on a healed legacy repo");
  assert.equal(detail.result.diff.fileCount, 1);
  const readme = detail.result.diff.files.find((f) => f.path === "README.md");
  assert.equal(readme.additions, 1);
  assert.equal(readme.deletions, 1);
  assert.deepEqual(detail.result.conflicts, []);

  // The anchored head itself is readable at its sha (its tree IS the
  // recorded mirror); deeper legacy history stays unrecorded.
  const atHead = await run("file-read", U1, { repoId: "repo_legacy", path: "README.md", sha: "legacyc2" });
  assert.equal(atHead.ok, true);
  assert.match(atHead.result.content, /head state/);
  const defRead = await run("file-read", U1, { repoId: "repo_legacy", path: "README.md" });
  assert.equal(defRead.ok, true, "default-branch legacy reads still serve the stored tree");
});

test("anon writes are refused; per-user isolation holds", async () => {
  const denied = await run("repo-create", ANON, { name: "anon-repo" });
  assert.equal(denied.ok, false);
  const other = await run("repo-list", { actor: { userId: "user-2" } }, {});
  assert.equal(other.result.repos.some((r) => r.name === "s1-repo"), false);
});
