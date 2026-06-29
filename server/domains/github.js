// server/domains/github.js
//
// Real GitHub connector. Thin macros over the SSRF-guarded connector egress
// (lib/connector-client.js), reading the user's stored OAuth token (connector_id
// "github") with Bearer auth. Inbound read (repos, issues) + outbound write
// (issue create). Honest reason codes when no token / not configured — never
// faked data.

import { listGitHubRepos, readGitHubIssues, createGitHubIssue } from "../lib/connector-client.js";

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

  // Authorize URL. Tokens persist under connector_id "github". `repo` scope
  // covers issue read+create on public and private repos.
  registerLensAction("github", "connect", (_ctx, _a, params = {}) => {
    const scopes = ["repo"];
    const qs = new URLSearchParams({ token_key: "github", scopes: scopes.join(" ") });
    if (params.redirect) qs.set("redirect", String(params.redirect));
    return { ok: true, result: { provider: "github", authorizeUrl: `/api/oauth/github/authorize?${qs.toString()}`, scopes } };
  });
}
