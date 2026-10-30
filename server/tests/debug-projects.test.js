// Behaviour tests for Debug S10 — real projects (Review 2's frozen
// debug.md §7 S10 / F3, unparked by the §8 Q3 ruling: projects are
// real entities). Direct domain import, no native deps — the same
// pattern as timeline-wall-rework.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDebugActions from "../domains/debug.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`debug.${name}`);
  if (!fn) throw new Error(`debug.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerDebugActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
});

const asUser = (userId) => ({ actor: { userId }, userId });
const ada = asUser("pj_ada");
const bob = asUser("pj_bob");

const mkProject = (ctx, name) => {
  const r = call("project-create", ctx, { name });
  assert.equal(r.ok, true, `create project ${name}`);
  return r.result.project;
};
const defaultId = (ctx) => call("project-list", ctx, {}).result.defaultProjectId;

describe("S10 debug projects — the entity layer", () => {
  it("the default project materializes on first contact, as real state", () => {
    const r = call("project-list", ada, {});
    assert.equal(r.result.count, 1);
    assert.equal(r.result.projects[0].name, "Default project");
    assert.equal(r.result.projects[0].isDefault, true);
    assert.equal(r.result.defaultProjectId, r.result.projects[0].id);
    const stored = globalThis._concordSTATE.debugLens.projects.get("pj_ada");
    assert.equal(stored.length, 1, "materialized in state, not a virtual row");
  });

  it("create requires a name and refuses duplicates (case-insensitive)", () => {
    assert.equal(call("project-create", ada, { name: " " }).ok, false);
    mkProject(ada, "API Service");
    const dupe = call("project-create", ada, { name: "api service" });
    assert.equal(dupe.ok, false);
    assert.match(dupe.error, /already exists/);
    assert.equal(call("project-list", ada, {}).result.count, 2, "default + the new one");
  });

  it("rename works; renaming onto a sibling is refused; unknown ids are refused", () => {
    const p = mkProject(ada, "Worker");
    mkProject(ada, "Web");
    assert.equal(call("project-update", ada, { id: p.id, name: "Web" }).ok, false);
    const renamed = call("project-update", ada, { id: p.id, name: "Worker v2", description: "jobs" });
    assert.equal(renamed.ok, true);
    assert.equal(renamed.result.project.name, "Worker v2");
    assert.equal(call("project-update", ada, { id: "proj_nope", name: "x" }).error, "project not found");
  });

  it("projects are per-account — bob can't see or address ada's", () => {
    const p = mkProject(ada, "Ada Only");
    const bobs = call("project-list", bob, {}).result;
    assert.equal(bobs.count, 1, "bob gets only his own default");
    assert.equal(call("issue-list", bob, { projectId: p.id }).error, "project not found");
    assert.equal(call("project-update", bob, { id: p.id, name: "hijack" }).error, "project not found");
  });

  it("the default project can't be deleted", () => {
    const r = call("project-delete", ada, { id: defaultId(ada), confirm: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /default project can't be deleted/);
  });

  it("deleting a project with data needs an explicit confirm and cascades with a receipt", () => {
    const p = mkProject(ada, "Doomed");
    call("issue-ingest", ada, { projectId: p.id, type: "Error", message: "boom in doomed" });
    call("trace-record", ada, { projectId: p.id, spans: [{ spanId: "s1", name: "GET /", startMs: 0, endMs: 5 }] });
    const keep = call("issue-ingest", ada, { type: "Error", message: "boom in default" }).result.issue;
    const refused = call("project-delete", ada, { id: p.id });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /confirm the deletion/);
    assert.equal(refused.counts.issues, 1);
    assert.equal(refused.counts.traces, 1);
    const done = call("project-delete", ada, { id: p.id, confirm: true });
    assert.equal(done.ok, true);
    assert.deepEqual(done.result.removed, { issues: 1, traces: 1, metrics: 0, alerts: 0, releases: 0, ingestKeys: 0 });
    assert.equal(call("issue-list", ada, { projectId: p.id }).error, "project not found");
    const remaining = call("issue-list", ada, {}).result;
    assert.deepEqual(remaining.issues.map((i) => i.id), [keep.id], "the default project's data is untouched");
  });

  it("an empty project deletes without a confirm", () => {
    const p = mkProject(ada, "Empty");
    assert.equal(call("project-delete", ada, { id: p.id }).ok, true);
  });
});

describe("S10 debug projects — records belong to a project", () => {
  it("pre-project records (no projectId) belong to the default project", () => {
    // Seed a legacy issue directly, the way pre-S10 state looks.
    globalThis._concordSTATE = {
      debugLens: {
        issues: new Map([["pj_ada", [{
          id: "issue_legacy", fingerprint: "f", type: "Error", message: "legacy boom",
          culprit: null, level: "error", stack: null, status: "open", assignee: null,
          regressed: false, count: 3, breadcrumbs: [], releases: [],
          firstSeen: "2026-01-01T00:00:00.000Z", lastSeen: "2026-01-02T00:00:00.000Z",
          occurrenceTimes: [],
        }]]]),
      },
    };
    const list = call("issue-list", ada, {}).result;
    assert.deepEqual(list.issues.map((i) => i.id), ["issue_legacy"]);
    const projects = call("project-list", ada, {}).result.projects;
    assert.equal(projects[0].counts.issues, 1, "counted under the default project");
    const other = mkProject(ada, "Elsewhere");
    assert.equal(call("issue-list", ada, { projectId: other.id }).result.count, 0);
  });

  it("ingest stamps the project and groups by fingerprint per project", () => {
    const p = mkProject(ada, "API");
    const a = call("issue-ingest", ada, { type: "TypeError", message: "x is not a function", culprit: "f.js" }).result.issue;
    const b = call("issue-ingest", ada, { projectId: p.id, type: "TypeError", message: "x is not a function", culprit: "f.js" }).result.issue;
    assert.notEqual(a.id, b.id, "the same error in two projects is two issues");
    assert.equal(b.projectId, p.id);
    const again = call("issue-ingest", ada, { projectId: p.id, type: "TypeError", message: "x is not a function", culprit: "f.js" });
    assert.equal(again.result.issue.id, b.id);
    assert.equal(again.result.issue.count, 2);
    assert.equal(call("issue-list", ada, {}).result.issues.find((i) => i.id === a.id).count, 1);
  });

  it("issue-list summary describes the selected project, not the account", () => {
    const p = mkProject(ada, "API");
    call("issue-ingest", ada, { message: "default one" });
    call("issue-ingest", ada, { projectId: p.id, message: "api one" });
    call("issue-ingest", ada, { projectId: p.id, message: "api two" });
    const scoped = call("issue-list", ada, { projectId: p.id }).result;
    assert.equal(scoped.count, 2);
    assert.equal(scoped.summary.open, 2);
    assert.equal(scoped.projectId, p.id);
    assert.equal(call("issue-list", ada, { projectId: "proj_nope" }).error, "project not found");
  });

  it("issue-detail addressed under the wrong project answers not found", () => {
    const p = mkProject(ada, "API");
    const issue = call("issue-ingest", ada, { projectId: p.id, message: "scoped" }).result.issue;
    assert.equal(call("issue-detail", ada, { id: issue.id }).ok, true);
    assert.equal(call("issue-detail", ada, { id: issue.id, projectId: p.id }).ok, true);
    assert.equal(call("issue-detail", ada, { id: issue.id, projectId: defaultId(ada) }).error, "issue not found");
  });

  it("traces, metrics, alerts and releases scope the same way", () => {
    const p = mkProject(ada, "API");
    call("trace-record", ada, { projectId: p.id, spans: [{ spanId: "s1", name: "GET /api", startMs: 0, endMs: 9 }] });
    assert.equal(call("trace-list", ada, {}).result.count, 0);
    assert.equal(call("trace-list", ada, { projectId: p.id }).result.count, 1);

    // A rule in the default project must not fire on the API project's
    // samples, and vice versa.
    call("alert-create", ada, { name: "default cpu", metric: "cpu", op: ">", threshold: 90 });
    call("alert-create", ada, { projectId: p.id, name: "api cpu", metric: "cpu", op: ">", threshold: 90 });
    const rec = call("metric-record", ada, { projectId: p.id, metric: "cpu", value: 95 });
    assert.deepEqual(rec.result.breaches.map((b) => b.name), ["api cpu"]);
    assert.deepEqual(call("metric-series", ada, { metric: "cpu" }).result.points, []);
    assert.equal(call("metric-series", ada, { projectId: p.id, metric: "cpu" }).result.points.length, 1);
    assert.equal(call("alert-list", ada, {}).result.count, 1);
    assert.equal(call("alert-list", ada, { projectId: p.id }).result.count, 1);

    // A version is unique per project, not per account.
    assert.equal(call("release-create", ada, { version: "1.0.0" }).ok, true);
    assert.equal(call("release-create", ada, { projectId: p.id, version: "1.0.0" }).ok, true);
    assert.equal(call("release-create", ada, { projectId: p.id, version: "1.0.0" }).error, "release already tracked");
    assert.equal(call("release-list", ada, {}).result.count, 1);
    assert.equal(call("release-list", ada, { projectId: p.id }).result.count, 1);
  });

  it("an unknown project is refused on writes too — nothing is stamped to a phantom", () => {
    assert.equal(call("issue-ingest", ada, { projectId: "proj_nope", message: "x" }).error, "project not found");
    assert.equal(call("metric-record", ada, { projectId: "proj_nope", metric: "cpu", value: 1 }).error, "project not found");
    assert.equal(globalThis._concordSTATE.debugLens.issues.get("pj_ada"), undefined);
  });
});
