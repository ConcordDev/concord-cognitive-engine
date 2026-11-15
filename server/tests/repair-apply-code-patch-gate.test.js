// Repair-cortex apply_code_patch must never write a source file on its own:
// it only queues a proposal; writes go through repair-hotpatch applyHotpatch
// (flag + approved entry + path allowlist + test gate + byte-identical rollback).
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { proposeSearchReplace, applyHotpatch, rollbackHotpatch } from "../lib/repair-hotpatch.js";
import { approve, getEntry, syncAndListQueue as listQueue, _resetRemediationQueue } from "../lib/repair-remediation.js";
import { executeRepairExecutor } from "../emergent/repair-cortex.js";

const noopAudit = async () => {};
const ORIGINAL = ["const a = 1;", "const b = brokn(2);", "export { a, b };", ""].join("\n");
const SR = { filePath: "server/lib/example.js", search: "brokn(2)", replace: "fixed(2)" };
const ON = { CONCORD_REPAIR_HOTPATCH: "1" };

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "rcgate-"));
  await mkdir(path.join(root, "server", "lib"), { recursive: true });
  await writeFile(path.join(root, "server", "lib", "example.js"), ORIGINAL);
  return root;
}
const read = (root) => readFile(path.join(root, "server/lib/example.js"), "utf8");

describe("apply_code_patch gate: proposeSearchReplace", () => {
  beforeEach(() => _resetRemediationQueue());

  it("queues a proposal and writes nothing", async () => {
    const root = await fixtureRoot();
    const r = await proposeSearchReplace({ ...SR, rootDir: root, audit: noopAudit });
    assert.equal(r.ok, true);
    assert.equal(r.entry.status, "proposed");
    assert.ok(!("confidence" in r.entry));
    assert.equal(await read(root), ORIGINAL);
  });

  it("flag off => apply refused, no write, even when approved", async () => {
    const root = await fixtureRoot();
    const { entry } = await proposeSearchReplace({ ...SR, rootDir: root, audit: noopAudit });
    approve(entry.id, "admin");
    const r = await applyHotpatch(entry.id, { rootDir: root, env: {}, audit: noopAudit });
    assert.equal(r.error, "hotpatch_disabled");
    assert.equal(await read(root), ORIGINAL);
  });

  it("flag on but unapproved => no write", async () => {
    const root = await fixtureRoot();
    const { entry } = await proposeSearchReplace({ ...SR, rootDir: root, audit: noopAudit });
    const r = await applyHotpatch(entry.id, { rootDir: root, env: ON, audit: noopAudit });
    assert.equal(r.error, "wrong_state");
    assert.equal(await read(root), ORIGINAL);
  });

  it("disallowed paths are refused at propose time", async () => {
    const root = await fixtureRoot();
    for (const filePath of ["server/data/x.js", "server/migrations/001_x.js", "server/.env", "../etc/x.js", "docs/x.js", "/etc/passwd"]) {
      const r = await proposeSearchReplace({ ...SR, filePath, rootDir: root, audit: noopAudit });
      assert.equal(r.ok, false, filePath);
      assert.equal(r.error, "path_not_allowed", filePath);
    }
    assert.equal(listQueue().length, 0);
  });

  it("absent or ambiguous search strings are refused", async () => {
    const root = await fixtureRoot();
    assert.equal((await proposeSearchReplace({ ...SR, search: "nope", rootDir: root, audit: noopAudit })).error, "search_not_found");
    assert.equal((await proposeSearchReplace({ ...SR, search: "const", rootDir: root, audit: noopAudit })).error, "search_not_unique");
  });

  it("approved + flag => written; failing test gate => byte-identical rollback", async () => {
    const root = await fixtureRoot();
    const { entry } = await proposeSearchReplace({ ...SR, rootDir: root, audit: noopAudit });
    approve(entry.id, "admin");
    const bad = await applyHotpatch(entry.id, { rootDir: root, env: ON, audit: noopAudit, testGate: async () => ({ ok: false }) });
    assert.equal(bad.error, "test_gate_failed");
    assert.equal(await read(root), ORIGINAL);
    assert.equal(getEntry(entry.id).status, "apply_failed");

    // fresh proposal (new queue) that passes the gate
    _resetRemediationQueue();
    const p2 = await proposeSearchReplace({ ...SR, rootDir: root, audit: noopAudit });
    approve(p2.entry.id, "admin");
    const ok = await applyHotpatch(p2.entry.id, { rootDir: root, env: ON, audit: noopAudit, testGate: async () => ({ ok: true }) });
    assert.equal(ok.ok, true);
    assert.equal(await read(root), ORIGINAL.replace("brokn(2)", "fixed(2)"));
    const rb = await rollbackHotpatch(p2.entry.id, { rootDir: root, audit: noopAudit });
    assert.equal(rb.ok, true);
    assert.equal(await read(root), ORIGINAL);
  });
});

describe("apply_code_patch gate: the cortex executor itself", () => {
  const scratch = fileURLToPath(new URL("./_scratch_repair_gate_target.js", import.meta.url));
  const rel = "server/tests/_scratch_repair_gate_target.js";
  beforeEach(async () => { _resetRemediationQueue(); await writeFile(scratch, ORIGINAL); });
  after(async () => { await rm(scratch, { force: true }); });

  for (const [label, env] of [["flag off", {}], ["flag on", ON]]) {
    it(`never writes (${label}), reports success:false, and only queues a proposal`, async () => {
      const prev = process.env.CONCORD_REPAIR_HOTPATCH;
      if (env.CONCORD_REPAIR_HOTPATCH) process.env.CONCORD_REPAIR_HOTPATCH = "1"; else delete process.env.CONCORD_REPAIR_HOTPATCH;
      try {
        const r = await executeRepairExecutor("apply_code_patch", { filePath: rel, search: "brokn(2)", replace: "fixed(2)", confidence: 0.99 });
        assert.equal(r.success, false);
        assert.equal(r.queued, true);
        assert.equal(await readFile(scratch, "utf8"), ORIGINAL);
        assert.equal(listQueue().filter((e) => e.status === "proposed").length, 1);
      } finally {
        if (prev === undefined) delete process.env.CONCORD_REPAIR_HOTPATCH; else process.env.CONCORD_REPAIR_HOTPATCH = prev;
      }
    });
  }

  it("refuses paths outside server/ (preconditions fail, nothing queued)", async () => {
    const r = await executeRepairExecutor("apply_code_patch", { filePath: "concord-frontend/x.js", search: "a", replace: "b" });
    assert.equal(r.ok, false);
    assert.equal(listQueue().length, 0);
  });
});
