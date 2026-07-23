// server/domains/github.js
//
// Real GitHub connector. Thin macros over the SSRF-guarded connector egress
// (lib/connector-client.js), reading the user's stored OAuth token (connector_id
// "github") with Bearer auth. Inbound read (repos, issues) + outbound write
// (issue create). Honest reason codes when no token / not configured — never
// faked data.

import {
  listGitHubRepos,
  readGitHubIssues,
  createGitHubIssue,
  getGitHubRepoTree,
  getGitHubFileContent,
  commitGitHubFile,
  createGitHubBranch,
} from "../lib/connector-client.js";

const GITHUB_ENABLED = process.env.CONCORD_GITHUB_ENABLED !== "0";

export default function registerGithubActions(registerLensAction) {
  const uid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const fail = (res, fallback) => {
    const reason = res?.reason || fallback;
    return { ok: false, reason, error: reason, detail: res };
  };
  const guard = (ctx) => {
    if (!GITHUB_ENABLED) return { ok: false, reason: "github_disabled", error: "github_disabled" };
    const userId = uid(ctx);
    if (!userId || userId === "anon") return { ok: false, reason: "no_user", error: "no_user" };
    if (!ctx?.db) return { ok: false, error: "db unavailable" };
    return null;
  };

  // List the user's repos. params: { perPage?, sort?, page? }
  registerLensAction("github", "repos", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    try {
      const res = await listGitHubRepos(ctx.db, uid(ctx), { perPage: params.perPage, sort: params.sort, page: params.page });
      if (!res.ok) return fail(res, "repos_failed");
      return { ok: true, result: { repos: res.repos } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // List issues for a repo. params: { repo: "owner/name", state?, labels?, perPage? }
  registerLensAction("github", "issues", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    if (!params.repo) return { ok: false, error: "repo required" };
    try {
      const res = await readGitHubIssues(ctx.db, uid(ctx), params.repo, { state: params.state, labels: params.labels, perPage: params.perPage });
      if (!res.ok) return fail(res, "issues_failed");
      return { ok: true, result: { issues: res.issues } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Create an issue. params: { repo: "owner/name", title, body?, labels? }
  registerLensAction("github", "issue-create", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    if (!params.repo) return { ok: false, error: "repo required" };
    if (!params.title) return { ok: false, error: "title required" };
    try {
      const res = await createGitHubIssue(ctx.db, uid(ctx), params.repo, { title: params.title, body: params.body, labels: params.labels });
      if (!res.ok) return fail(res, "issue_create_failed");
      return { ok: true, result: { number: res.number, url: res.url } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // List the file tree at a ref (recursive). params: { repo, ref? }. When ref
  // is omitted, the repo's real default branch is resolved first — never
  // guessed. Always uses the CALLING user's own stored token (uid(ctx)).
  registerLensAction("github", "repo-tree", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    if (!params.repo) return { ok: false, error: "repo required" };
    try {
      const res = await getGitHubRepoTree(ctx.db, uid(ctx), params.repo, { ref: params.ref });
      if (!res.ok) return fail(res, "repo_tree_failed");
      return { ok: true, result: { ref: res.ref, sha: res.sha, truncated: res.truncated, tree: res.tree } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Get a file's real decoded content + its blob sha (needed to update it).
  // params: { repo, path, ref? }
  registerLensAction("github", "file-get", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    if (!params.repo) return { ok: false, error: "repo required" };
    if (!params.path) return { ok: false, error: "path required" };
    try {
      const res = await getGitHubFileContent(ctx.db, uid(ctx), params.repo, params.path, { ref: params.ref });
      if (!res.ok) return fail(res, "file_get_failed");
      return { ok: true, result: { path: res.path, sha: res.sha, size: res.size, content: res.content, encoding: res.encoding, htmlUrl: res.htmlUrl } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Create or update a file via the real Contents API PUT. params:
  // { repo, path, content, message, sha?, branch? }. `sha` is required only
  // when updating an existing file (present -> update at that sha; absent ->
  // create). Always authenticates with the CALLING user's own stored token —
  // never a shared/hardcoded credential.
  registerLensAction("github", "file-commit", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    if (!params.repo) return { ok: false, error: "repo required" };
    if (!params.path) return { ok: false, error: "path required" };
    if (typeof params.content !== "string") return { ok: false, error: "content required" };
    if (!params.message) return { ok: false, error: "message required" };
    try {
      const res = await commitGitHubFile(ctx.db, uid(ctx), params.repo, params.path, {
        content: params.content, message: params.message, sha: params.sha, branch: params.branch,
      });
      if (!res.ok) return fail(res, "file_commit_failed");
      return { ok: true, result: { commitSha: res.commitSha, fileSha: res.fileSha, path: res.path, htmlUrl: res.htmlUrl } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Create a branch from an existing ref (branch/tag/sha). params:
  // { repo, branchName, fromRef }. fromRef's tip commit sha is resolved
  // server-side via the real commits API — never guessed.
  registerLensAction("github", "branch-create", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    if (!params.repo) return { ok: false, error: "repo required" };
    if (!params.branchName) return { ok: false, error: "branchName required" };
    if (!params.fromRef) return { ok: false, error: "fromRef required" };
    try {
      const res = await createGitHubBranch(ctx.db, uid(ctx), params.repo, { branchName: params.branchName, fromRef: params.fromRef });
      if (!res.ok) return fail(res, "branch_create_failed");
      return { ok: true, result: { ref: res.ref, sha: res.sha } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Authorize URL. Tokens persist under connector_id "github". `repo` scope
  // covers issue read+create on public and private repos.
  registerLensAction("github", "connect", (_ctx, _a, params = {}) => {
    const scopes = ["repo"];
    const qs = new URLSearchParams({ token_key: "github", scopes: scopes.join(" ") });
    if (params.redirect) qs.set("redirect", String(params.redirect));
    return { ok: true, result: { provider: "github", authorizeUrl: `/api/oauth/github/authorize?${qs.toString()}`, scopes } };
  });
}
