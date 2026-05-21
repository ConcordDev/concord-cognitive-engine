// Contract tests for server/domains/forge.js — the Forge lens
// interaction-model macros (conversational refinement, live preview
// sandbox, multi-file output, version history + diff, shareable links,
// component-level regeneration, image → app input).
//
// These exercise the deterministic transform engine over the real
// 13-subsystem polyglot generator — no LLM, no synthesised data.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerForgeActions from "../domains/forge.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`forge.${name}`);
  if (!fn) throw new Error(`forge.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerForgeActions(register); });

// Each test run gets a fresh per-user state slate.
beforeEach(() => {
  if (globalThis._concordSTATE?.forgeLens) {
    delete globalThis._concordSTATE.forgeLens;
  }
});

const ctxA = { actor: { userId: "forge_user_a" }, userId: "forge_user_a" };
const ctxB = { actor: { userId: "forge_user_b" }, userId: "forge_user_b" };

function newProject(ctx = ctxA, params = {}) {
  const r = call("createProject", ctx, { appName: "test-app", templateId: "blank", ...params });
  assert.equal(r.ok, true, `createProject failed: ${r.error}`);
  return r.result;
}

describe("forge.createProject", () => {
  it("requires an appName", () => {
    const r = call("createProject", ctxA, { templateId: "blank" });
    assert.equal(r.ok, false);
    assert.match(r.error, /appName/);
  });

  it("generates a base app with a multi-file tree + version 1", () => {
    const p = newProject();
    assert.equal(p.versionId, "1");
    assert.equal(p.appName, "test-app");
    assert.ok(p.code.length > 0);
    assert.ok(Array.isArray(p.files) && p.files.length > 1);
    assert.ok(p.files.some((f) => f.path === "index.mjs"));
  });
});

describe("forge.refine (conversational iterative refinement)", () => {
  it("requires projectId and instruction", () => {
    assert.equal(call("refine", ctxA, { instruction: "x" }).ok, false);
    const p = newProject();
    assert.equal(call("refine", ctxA, { projectId: p.projectId }).ok, false);
  });

  it("applies a recolour edit and forks a new version", () => {
    const p = newProject();
    const r = call("refine", ctxA, { projectId: p.projectId, instruction: "make the background blue" });
    assert.equal(r.ok, true);
    assert.equal(r.result.understood, true);
    assert.ok(r.result.totalChanges > 0);
    assert.equal(r.result.newVersion, "2");
  });

  it("returns understood=false for an unmappable instruction without forking", () => {
    const p = newProject();
    const r = call("refine", ctxA, { projectId: p.projectId, instruction: "do something vague" });
    assert.equal(r.ok, true);
    assert.equal(r.result.understood, false);
    assert.equal(r.result.newVersion, null);
  });

  it("records both sides of the conversation in the thread", () => {
    const p = newProject();
    call("refine", ctxA, { projectId: p.projectId, instruction: "rename to forged-thing" });
    const t = call("thread", ctxA, { projectId: p.projectId });
    assert.equal(t.ok, true);
    assert.equal(t.result.thread.length, 2);
    assert.equal(t.result.thread[0].role, "user");
    assert.equal(t.result.thread[1].role, "forge");
  });
});

describe("forge.versions + forge.diff + forge.restoreVersion", () => {
  it("lists every version and tracks the current pointer", () => {
    const p = newProject();
    const refined = call("refine", ctxA, { projectId: p.projectId, instruction: 'add a comment header "Logged"' });
    assert.equal(refined.result.newVersion, "2");
    const v = call("versions", ctxA, { projectId: p.projectId });
    assert.equal(v.ok, true);
    assert.equal(v.result.versions.length, 2);
    assert.equal(v.result.currentVersion, "2");
  });

  it("computes a line-level diff between two versions", () => {
    const p = newProject();
    call("refine", ctxA, { projectId: p.projectId, instruction: 'add a comment header "Forged"' });
    const d = call("diff", ctxA, { projectId: p.projectId, fromVersion: 1, toVersion: 2 });
    assert.equal(d.ok, true);
    assert.ok(d.result.diff.addedLines >= 1);
    assert.equal(typeof d.result.diff.oldLineCount, "number");
  });

  it("restores a past version as current", () => {
    const p = newProject();
    call("refine", ctxA, { projectId: p.projectId, instruction: "make the theme red" });
    const r = call("restoreVersion", ctxA, { projectId: p.projectId, versionId: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.currentVersion, "1");
  });
});

describe("forge.files (multi-file project output)", () => {
  it("returns the partitioned file tree for the current version", () => {
    const p = newProject();
    const r = call("files", ctxA, { projectId: p.projectId });
    assert.equal(r.ok, true);
    assert.ok(r.result.files.length > 1);
    assert.ok(r.result.files.every((f) => typeof f.path === "string" && typeof f.content === "string"));
  });
});

describe("forge.regenerateSection (component-level regeneration)", () => {
  it("requires a sectionId", () => {
    const p = newProject();
    assert.equal(call("regenerateSection", ctxA, { projectId: p.projectId }).ok, false);
  });

  it("regenerates one section into a new version", () => {
    const p = newProject();
    const r = call("regenerateSection", ctxA, { projectId: p.projectId, sectionId: "database" });
    assert.equal(r.ok, true);
    assert.equal(r.result.newVersion, "2");
    assert.ok(r.result.insertedLines > 0);
  });
});

describe("forge.sandbox (live preview)", () => {
  it("builds a self-contained HTML preview document", () => {
    const p = newProject();
    const r = call("sandbox", ctxA, { projectId: p.projectId });
    assert.equal(r.ok, true);
    assert.match(r.result.html, /<!doctype html>/i);
    assert.ok(r.result.fileCount > 0);
  });
});

describe("forge.share + forge.openShare (shareable hosted link)", () => {
  it("mints a share token resolvable by any user", () => {
    const p = newProject(ctxA);
    const s = call("share", ctxA, { projectId: p.projectId });
    assert.equal(s.ok, true);
    assert.ok(s.result.shareToken);
    assert.match(s.result.shareUrl, /share=/);
    // A different user can open the shared link (read-only).
    const o = call("openShare", ctxB, { shareToken: s.result.shareToken });
    assert.equal(o.ok, true);
    assert.equal(o.result.appName, "test-app");
    assert.ok(o.result.html.length > 0);
  });

  it("rejects an unknown share token", () => {
    const r = call("openShare", ctxA, { shareToken: "share_nope" });
    assert.equal(r.ok, false);
  });
});

describe("forge.fromImage (image/screenshot → app input)", () => {
  it("requires a caption or detected labels", () => {
    const r = call("fromImage", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("maps e-commerce screenshot hints to the ecommerce template", () => {
    const r = call("fromImage", ctxA, {
      caption: "a shopping cart checkout page",
      detectedLabels: ["cart", "price", "products"],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.recommendedTemplate, "ecommerce");
    assert.ok(r.result.domainTables.includes("products"));
    assert.ok(r.result.suggestedAppName.length > 0);
  });

  it("maps social-feed hints to the social template", () => {
    const r = call("fromImage", ctxA, { caption: "a social feed with posts and comments" });
    assert.equal(r.ok, true);
    assert.equal(r.result.recommendedTemplate, "social");
  });
});

describe("forge.listProjects", () => {
  it("lists only the calling user's projects", () => {
    newProject(ctxA, { appName: "a-one" });
    newProject(ctxA, { appName: "a-two" });
    newProject(ctxB, { appName: "b-one" });
    const a = call("listProjects", ctxA, {});
    assert.equal(a.ok, true);
    assert.equal(a.result.projects.length, 2);
    const b = call("listProjects", ctxB, {});
    assert.equal(b.result.projects.length, 1);
  });
});

describe("INVARIANT: handlers never throw", () => {
  it("returns { ok:false } for malformed input instead of throwing", () => {
    for (const name of [
      "createProject", "refine", "thread", "versions", "diff",
      "restoreVersion", "files", "regenerateSection", "sandbox",
      "share", "openShare", "fromImage", "listProjects",
    ]) {
      const r = call(name, ctxA, {});
      assert.equal(typeof r.ok, "boolean", `${name} returned a non-envelope`);
    }
  });
});
