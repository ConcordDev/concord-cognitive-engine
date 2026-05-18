// server/tests/code-slash.test.js
//
// Tier-2 contract tests for Code Sprint B #9 — slash command parser
// + skill resolver. Pure-unit tests of the parser; the dispatch path
// is integration-tested by hand against a real server.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSlash, listBuiltins } from "../lib/code/slash-commands.js";

describe("slash-commands parser", () => {
  it("listBuiltins returns the documented commands", () => {
    const got = listBuiltins().map((b) => b.name);
    for (const expected of ["test", "commit", "branch", "diff", "status", "log", "memory", "loop", "spec", "index", "search"]) {
      assert.ok(got.includes(expected), `missing ${expected}`);
    }
  });

  it("rejects non-slash input", async () => {
    const r = await parseSlash("hello");
    assert.equal(r.error, "not_a_slash_command");
  });

  it("rejects empty slash", async () => {
    const r = await parseSlash("/");
    assert.equal(r.error, "empty_command");
  });

  it("/test defaults to npm test", async () => {
    const r = await parseSlash("/test", { projectPath: "myproj" });
    assert.equal(r.domain, "code");
    assert.equal(r.macro, "run_tests");
    assert.equal(r.input.runner, "npm");
    assert.deepEqual(r.input.args, ["test"]);
    assert.equal(r.input.projectPath, "myproj");
  });

  it("/test jest --watch passes runner + args through", async () => {
    const r = await parseSlash("/test jest --watch", { projectPath: "x" });
    assert.equal(r.input.runner, "jest");
    assert.deepEqual(r.input.args, ["--watch"]);
  });

  it("/commit splits message at -- separator from files", async () => {
    const r = await parseSlash('/commit "Add feature X" -- src/a.ts src/b.ts', { projectPath: "x" });
    assert.equal(r.input.message, "Add feature X");
    assert.deepEqual(r.input.files, ["src/a.ts", "src/b.ts"]);
  });

  it("/branch create new-feature", async () => {
    const r = await parseSlash("/branch create new-feature", { projectPath: "." });
    assert.equal(r.macro, "git_branch");
    assert.equal(r.input.op, "create");
    assert.equal(r.input.name, "new-feature");
  });

  it("/memory add prompts memory_add with kind=rule pinned", async () => {
    const r = await parseSlash("/memory add use tailwind, not styled-components", { projectPath: "." });
    assert.equal(r.macro, "memory_add");
    assert.equal(r.input.kind, "rule");
    assert.equal(r.input.content, "use tailwind, not styled-components");
    assert.equal(r.input.pinned, true);
  });

  it("/loop runs the agent loop with openFiles", async () => {
    const r = await parseSlash("/loop refactor auth module", {
      projectPath: "x", openFiles: [{ scriptId: "s1", filename: "a.ts", language: "ts", content: "// a" }],
    });
    assert.equal(r.macro, "agent_loop");
    assert.equal(r.input.task, "refactor auth module");
    assert.equal(r.input.files.length, 1);
  });

  it("/spec create builds a spec_create call", async () => {
    const r = await parseSlash("/spec create build a leaderboard", { projectPath: "." });
    assert.equal(r.macro, "spec_create");
    assert.equal(r.input.title, "build a leaderboard");
  });

  it("/index github.com/owner/repo routes to ingest_repo as a URL", async () => {
    const r = await parseSlash("/index github.com/owner/repo");
    assert.equal(r.macro, "ingest_repo");
    assert.equal(r.input.url, "github.com/owner/repo");
  });

  it("/search architectural auth recognises category as first token", async () => {
    const r = await parseSlash("/search architectural auth");
    assert.equal(r.macro, "search_patterns");
    assert.equal(r.input.category, "architectural");
    assert.equal(r.input.name, "auth");
  });

  it("/help returns the builtins manifest", async () => {
    const r = await parseSlash("/help");
    assert.equal(r.domain, "_meta");
    assert.equal(r.macro, "help");
    assert.ok(Array.isArray(r.input.builtins));
  });

  it("unknown command without a skill resolver returns unknown_command", async () => {
    const r = await parseSlash("/zzz_unknown foo");
    assert.equal(r.error, "unknown_command");
    assert.equal(r.name, "zzz_unknown");
  });

  it("user skill resolves through skillResolver and substitutes ${args}", async () => {
    const resolver = async (name) => name === "mytool"
      ? { id: "dtu1", prompt: "Refactor: ${args}", domain: "code", macro: "multi-file-plan" }
      : null;
    const r = await parseSlash("/mytool the auth module", {
      openFiles: [{ scriptId: "s1", filename: "x.ts", language: "ts", content: "// x" }],
    }, resolver);
    assert.equal(r.source, "skill");
    assert.equal(r.skillName, "mytool");
    assert.equal(r.input.prompt, "Refactor: the auth module");
    assert.equal(r.input.files.length, 1);
  });
});
