// server/tests/code-multi-file-apply.test.js
//
// Tier-2 contract tests for Code Sprint A #3 (per-hunk diff accept/reject)
// and #4 (disk persistence). Exercises the `multi-file-apply` macro
// directly against an in-memory STATE.dtus + a tmp workspace root.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import registerCodeActions from "../domains/code.js";

describe("multi-file-apply: per-hunk acceptance + disk persistence", () => {
  let workspaceRoot; const handlers = new Map();
  before(() => {
    const reg = (_domain, name, handler) => handlers.set(name, handler);
    registerCodeActions(reg);
    workspaceRoot = mkdtempSync(join(tmpdir(), "mfa-"));
    process.env.CONCORD_CODE_WORKSPACE_ROOT = workspaceRoot;
    process.env.CONCORD_CODE_PERSIST_TO_DISK = "true";
    globalThis._concordSTATE = { dtus: new Map() };
  });
  after(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    delete globalThis._concordSTATE;
    delete process.env.CONCORD_CODE_PERSIST_TO_DISK;
  });

  it("with no hunkAcceptance, applies the whole edit", () => {
    const apply = handlers.get("multi-file-apply");
    globalThis._concordSTATE.dtus.set("s1", {
      id: "s1",
      machine: { code: "line a\nline b\nline c\n" },
      data: { content: "line a\nline b\nline c\n" },
      creator_id: "u1",
    });
    const r = apply({ userId: "u1" }, null, {
      edits: [{ scriptId: "s1", filename: "x.txt", after: "line a\nLINE B CHANGED\nline c\n" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.applied.length, 1);
    assert.ok(globalThis._concordSTATE.dtus.get("s1").machine.code.includes("LINE B CHANGED"));
  });

  it("with hunkAcceptance accepting hunk 0, keeps only that hunk", () => {
    const apply = handlers.get("multi-file-apply");
    // Need distant changes so the diff package's default context window
    // (4 lines) doesn't merge them into one hunk. 20 lines apart.
    const before = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n") + "\n";
    const afterArr = Array.from({ length: 30 }, (_, i) => `line${i}`);
    afterArr[0] = "FIRST_CHANGED";
    afterArr[29] = "LAST_CHANGED";
    const after = afterArr.join("\n") + "\n";
    globalThis._concordSTATE.dtus.set("s2", {
      id: "s2", machine: { code: before }, data: { content: before }, creator_id: "u1",
    });
    const r = apply({ userId: "u1" }, null, {
      edits: [{ scriptId: "s2", filename: "y.txt", after }],
      hunkAcceptance: { s2: { 0: true, 1: false } },
    });
    assert.equal(r.ok, true);
    const final = globalThis._concordSTATE.dtus.get("s2").machine.code;
    assert.ok(final.startsWith("FIRST_CHANGED"), `expected FIRST_CHANGED at start, got: ${final.slice(0, 60)}`);
    assert.ok(final.endsWith("line29\n"), `expected unchanged line29 at end, got: ${final.slice(-40)}`);
  });

  it("with hunkAcceptance rejecting all hunks, skips with reason", () => {
    const apply = handlers.get("multi-file-apply");
    globalThis._concordSTATE.dtus.set("s3", {
      id: "s3",
      machine: { code: "x\ny\nz\n" },
      data: { content: "x\ny\nz\n" },
      creator_id: "u1",
    });
    const r = apply({ userId: "u1" }, null, {
      edits: [{ scriptId: "s3", filename: "z.txt", after: "X\nY\nZ\n" }],
      hunkAcceptance: { s3: { 0: false } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.skipped.length, 1);
    assert.equal(r.result.skipped[0].reason, "no_hunks_accepted");
    // Original unchanged
    assert.equal(globalThis._concordSTATE.dtus.get("s3").machine.code, "x\ny\nz\n");
  });

  it("disk persistence: writes the applied bytes to workspace root", () => {
    const apply = handlers.get("multi-file-apply");
    globalThis._concordSTATE.dtus.set("s4", {
      id: "s4",
      machine: { code: "old\n" },
      data: { content: "old\n" },
      creator_id: "u1",
    });
    const r = apply({ userId: "u1" }, null, {
      edits: [{ scriptId: "s4", filename: "out/new.txt", after: "new content\n" }],
    });
    assert.equal(r.ok, true);
    const expected = join(workspaceRoot, "out", "new.txt");
    assert.ok(existsSync(expected), `file should be persisted at ${expected}`);
    assert.equal(readFileSync(expected, "utf-8"), "new content\n");
    assert.equal(r.result.applied[0].persistedToDisk, expected);
  });

  it("disk persistence rejects path traversal", () => {
    const apply = handlers.get("multi-file-apply");
    globalThis._concordSTATE.dtus.set("s5", {
      id: "s5",
      machine: { code: "old\n" },
      data: { content: "old\n" },
      creator_id: "u1",
    });
    const r = apply({ userId: "u1" }, null, {
      edits: [{ scriptId: "s5", filename: "../../etc/escape.txt", after: "evil\n" }],
    });
    assert.equal(r.ok, true);
    // Filename with `..` is not persisted; in-memory mutation still happens.
    const entry = r.result.applied[0];
    assert.equal(entry.persistedToDisk, undefined);
  });

  it("persistEnabled is reported in result envelope", () => {
    const apply = handlers.get("multi-file-apply");
    globalThis._concordSTATE.dtus.set("s6", {
      id: "s6", machine: { code: "a" }, data: { content: "a" }, creator_id: "u1",
    });
    const r = apply({ userId: "u1" }, null, {
      edits: [{ scriptId: "s6", filename: "p.txt", after: "b" }],
    });
    assert.equal(r.result.persistEnabled, true);
  });
});
