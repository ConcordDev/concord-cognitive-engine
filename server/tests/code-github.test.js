// server/tests/code-github.test.js
//
// Tier-2 contract tests for Code Sprint D — GitHub API connector.
// We don't hit GitHub in CI; we test the parser + arg validation
// surface. Real Octokit roundtrips happen in code-github.live.test.js
// (skipped when GH_TOKEN absent).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { githubClient } from "../lib/code/github-client.js";

describe("github-client: arg validation", () => {
  it("listIssues rejects invalid repo format", async () => {
    const r = await githubClient.listIssues({ repo: "not-a-slug" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_repo");
  });

  it("readIssue rejects missing number", async () => {
    const r = await githubClient.readIssue({ repo: "octocat/Hello-World" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "number_required");
  });

  it("createIssue rejects missing title", async () => {
    const r = await githubClient.createIssue({ repo: "octocat/Hello-World" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "title_required");
  });

  it("mergePr rejects invalid merge_method", async () => {
    const r = await githubClient.mergePr({ repo: "octocat/Hello-World", number: 1, merge_method: "rebase-and-squash" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_merge_method");
  });

  it("submitReview rejects invalid event", async () => {
    const r = await githubClient.submitReview({ repo: "octocat/Hello-World", number: 1, event: "FORCE_MERGE" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_event");
  });

  it("triggerWorkflow rejects missing workflow_id", async () => {
    const r = await githubClient.triggerWorkflow({ repo: "octocat/Hello-World" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "workflow_id_required");
  });

  it("searchCode rejects empty query", async () => {
    const r = await githubClient.searchCode({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "q_required");
  });
});
