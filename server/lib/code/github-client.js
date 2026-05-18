// server/lib/code/github-client.js
//
// Code Sprint D — full GitHub API client.
//
// Real @octokit/rest backend. Token sourced from GH_TOKEN /
// GITHUB_TOKEN env vars; user-supplied tokens are passed per-call
// (BYO key model). No mocks. All operations hit GitHub's REST API.
//
// Surface:
//   listIssues / readIssue / createIssue / commentIssue
//   listPullRequests / readPr / commentPr / mergePr
//   listReviews / submitReview
//   listWorkflows / triggerWorkflow / readRunLog
//   listProjects (Projects v2)
//
// All methods return { ok, ...data } envelopes; never throw.

import { Octokit } from "@octokit/rest";

const _cache = new Map();

function _client(token) {
  const auth = token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
  const key = auth || "anonymous";
  let c = _cache.get(key);
  if (!c) {
    c = new Octokit({ auth, userAgent: "concord-cognitive-engine/1.0" });
    _cache.set(key, c);
  }
  return c;
}

function _parseRepo(repo) {
  if (typeof repo !== "string") return null;
  const m = repo.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function _safe(p) {
  return p.then((r) => ({ ok: true, data: r.data }))
          .catch((err) => ({ ok: false, reason: err?.status === 404 ? "not_found" : "github_api_error", status: err?.status, error: err?.message }));
}

export const githubClient = {
  async listIssues({ repo, state = "open", labels, perPage = 30, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    const r = await _safe(_client(token).rest.issues.listForRepo({
      owner: p.owner, repo: p.repo, state, labels, per_page: perPage,
    }));
    if (!r.ok) return r;
    // strip prs (the issues endpoint includes PRs by default)
    const items = r.data.filter((it) => !it.pull_request).map((it) => ({
      number: it.number, title: it.title, state: it.state, user: it.user?.login,
      labels: (it.labels || []).map((l) => typeof l === "string" ? l : l.name),
      created_at: it.created_at, updated_at: it.updated_at, body_preview: (it.body || "").slice(0, 500),
    }));
    return { ok: true, issues: items };
  },

  async readIssue({ repo, number, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    if (!Number.isInteger(number)) return { ok: false, reason: "number_required" };
    return _safe(_client(token).rest.issues.get({ owner: p.owner, repo: p.repo, issue_number: number }));
  },

  async createIssue({ repo, title, body, labels, assignees, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    if (!title || typeof title !== "string") return { ok: false, reason: "title_required" };
    return _safe(_client(token).rest.issues.create({
      owner: p.owner, repo: p.repo, title, body, labels, assignees,
    }));
  },

  async commentIssue({ repo, number, body, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    if (!Number.isInteger(number) || !body) return { ok: false, reason: "number_and_body_required" };
    return _safe(_client(token).rest.issues.createComment({
      owner: p.owner, repo: p.repo, issue_number: number, body,
    }));
  },

  async listPullRequests({ repo, state = "open", base, head, perPage = 30, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    const r = await _safe(_client(token).rest.pulls.list({
      owner: p.owner, repo: p.repo, state, base, head, per_page: perPage,
    }));
    if (!r.ok) return r;
    return {
      ok: true, pulls: r.data.map((pr) => ({
        number: pr.number, title: pr.title, state: pr.state, draft: pr.draft,
        user: pr.user?.login, head: pr.head?.ref, base: pr.base?.ref,
        created_at: pr.created_at, updated_at: pr.updated_at,
        mergeable: pr.mergeable, additions: pr.additions, deletions: pr.deletions,
      })),
    };
  },

  async readPr({ repo, number, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    if (!Number.isInteger(number)) return { ok: false, reason: "number_required" };
    return _safe(_client(token).rest.pulls.get({ owner: p.owner, repo: p.repo, pull_number: number }));
  },

  async commentPr({ repo, number, body, token } = {}) {
    return this.commentIssue({ repo, number, body, token });
  },

  async mergePr({ repo, number, commit_title, commit_message, merge_method = "squash", token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    if (!Number.isInteger(number)) return { ok: false, reason: "number_required" };
    if (!["merge", "squash", "rebase"].includes(merge_method)) return { ok: false, reason: "invalid_merge_method" };
    return _safe(_client(token).rest.pulls.merge({
      owner: p.owner, repo: p.repo, pull_number: number,
      commit_title, commit_message, merge_method,
    }));
  },

  async listReviews({ repo, number, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    return _safe(_client(token).rest.pulls.listReviews({ owner: p.owner, repo: p.repo, pull_number: number }));
  },

  async submitReview({ repo, number, body, event = "COMMENT", comments, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    if (!Number.isInteger(number)) return { ok: false, reason: "number_required" };
    if (!["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(event)) return { ok: false, reason: "invalid_event" };
    return _safe(_client(token).rest.pulls.createReview({
      owner: p.owner, repo: p.repo, pull_number: number, body, event, comments,
    }));
  },

  async listWorkflows({ repo, perPage = 30, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    return _safe(_client(token).rest.actions.listRepoWorkflows({ owner: p.owner, repo: p.repo, per_page: perPage }));
  },

  async listWorkflowRuns({ repo, workflow_id, perPage = 30, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    if (!workflow_id) return { ok: false, reason: "workflow_id_required" };
    const r = await _safe(_client(token).rest.actions.listWorkflowRuns({
      owner: p.owner, repo: p.repo, workflow_id, per_page: perPage,
    }));
    if (!r.ok) return r;
    return { ok: true, runs: (r.data.workflow_runs || []).map((rn) => ({
      id: rn.id, name: rn.name, status: rn.status, conclusion: rn.conclusion,
      created_at: rn.created_at, updated_at: rn.updated_at, head_branch: rn.head_branch, head_sha: rn.head_sha,
    })) };
  },

  async triggerWorkflow({ repo, workflow_id, ref = "main", inputs, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    if (!workflow_id) return { ok: false, reason: "workflow_id_required" };
    return _safe(_client(token).rest.actions.createWorkflowDispatch({
      owner: p.owner, repo: p.repo, workflow_id, ref, inputs,
    }));
  },

  async getRunLog({ repo, run_id, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    if (!Number.isInteger(run_id)) return { ok: false, reason: "run_id_required" };
    const r = await _safe(_client(token).rest.actions.downloadWorkflowRunLogs({
      owner: p.owner, repo: p.repo, run_id,
    }));
    if (!r.ok) return r;
    // returns a Buffer (zipped logs); surface metadata only
    return { ok: true, sizeBytes: r.data.length, contentType: "application/zip" };
  },

  async searchCode({ q, perPage = 30, token } = {}) {
    if (!q || typeof q !== "string") return { ok: false, reason: "q_required" };
    const r = await _safe(_client(token).rest.search.code({ q, per_page: perPage }));
    if (!r.ok) return r;
    return { ok: true, total: r.data.total_count, items: (r.data.items || []).map((it) => ({
      path: it.path, repo: it.repository?.full_name, html_url: it.html_url, score: it.score,
    })) };
  },

  async listBranches({ repo, perPage = 100, token } = {}) {
    const p = _parseRepo(repo);
    if (!p) return { ok: false, reason: "invalid_repo" };
    const r = await _safe(_client(token).rest.repos.listBranches({ owner: p.owner, repo: p.repo, per_page: perPage }));
    if (!r.ok) return r;
    return { ok: true, branches: r.data.map((b) => ({ name: b.name, sha: b.commit.sha, protected: b.protected })) };
  },

  async checkRateLimit({ token } = {}) {
    return _safe(_client(token).rest.rateLimit.get());
  },
};
