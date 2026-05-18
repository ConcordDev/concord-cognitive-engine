// server/domains/code-github.js
//
// Code Sprint D — full GitHub API macro surface.
// Wraps lib/code/github-client.js into register()-style macros so they
// surface in BOTH /api/lens/run AND the MCP tool catalogue (via the
// Sprint C MCP extension that enumerates both registries).

import { githubClient } from "../lib/code/github-client.js";

export default function registerCodeGithubMacros(register) {
  register("code", "gh_list_issues", async (_ctx, input = {}) => {
    return githubClient.listIssues(input);
  }, { note: "List GitHub issues for owner/repo" });

  register("code", "gh_read_issue", async (_ctx, input = {}) => {
    return githubClient.readIssue({ ...input, number: Number(input.number) });
  }, { note: "Read a single GitHub issue" });

  register("code", "gh_create_issue", async (_ctx, input = {}) => {
    return githubClient.createIssue(input);
  }, { destructive: true, note: "Create a GitHub issue (requires GH_TOKEN with write scope)" });

  register("code", "gh_comment_issue", async (_ctx, input = {}) => {
    return githubClient.commentIssue({ ...input, number: Number(input.number) });
  }, { destructive: true, note: "Add a comment to a GitHub issue" });

  register("code", "gh_list_prs", async (_ctx, input = {}) => {
    return githubClient.listPullRequests(input);
  }, { note: "List GitHub pull requests" });

  register("code", "gh_read_pr", async (_ctx, input = {}) => {
    return githubClient.readPr({ ...input, number: Number(input.number) });
  }, { note: "Read a single PR" });

  register("code", "gh_merge_pr", async (_ctx, input = {}) => {
    return githubClient.mergePr({ ...input, number: Number(input.number) });
  }, { destructive: true, note: "Merge a PR via GitHub API (requires write scope)" });

  register("code", "gh_list_reviews", async (_ctx, input = {}) => {
    return githubClient.listReviews({ ...input, number: Number(input.number) });
  }, { note: "List PR reviews" });

  register("code", "gh_submit_review", async (_ctx, input = {}) => {
    return githubClient.submitReview({ ...input, number: Number(input.number) });
  }, { destructive: true, note: "Submit a PR review (APPROVE / REQUEST_CHANGES / COMMENT)" });

  register("code", "gh_list_workflows", async (_ctx, input = {}) => {
    return githubClient.listWorkflows(input);
  }, { note: "List GitHub Actions workflows" });

  register("code", "gh_list_runs", async (_ctx, input = {}) => {
    return githubClient.listWorkflowRuns(input);
  }, { note: "List GitHub Actions workflow runs" });

  register("code", "gh_trigger_workflow", async (_ctx, input = {}) => {
    return githubClient.triggerWorkflow(input);
  }, { destructive: true, note: "Trigger a workflow_dispatch run" });

  register("code", "gh_get_run_log", async (_ctx, input = {}) => {
    return githubClient.getRunLog({ ...input, run_id: Number(input.run_id) });
  }, { note: "Download workflow run logs (metadata only — log bytes returned as size)" });

  register("code", "gh_search_code", async (_ctx, input = {}) => {
    return githubClient.searchCode(input);
  }, { note: "GitHub code search across all of GitHub" });

  register("code", "gh_list_branches", async (_ctx, input = {}) => {
    return githubClient.listBranches(input);
  }, { note: "List repo branches" });

  register("code", "gh_rate_limit", async (_ctx, input = {}) => {
    return githubClient.checkRateLimit(input);
  }, { note: "Check GitHub API rate limit (free per-token visibility)" });
}
