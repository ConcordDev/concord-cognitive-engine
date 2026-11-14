// BR-01 (GB-1541) — repair hot-patch: the repair brain proposes, the queue
// governs, the flag gates apply, the test gate rolls back. Design confirmed
// CB-0719. The model never writes; there is no confidence field anywhere.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  hotpatchEnabled, isPathAllowed, applyUnifiedDiff,
  proposeHotpatch, applyHotpatch, rollbackHotpatch,
} from "../lib/repair-hotpatch.js";
import { approve, getEntry, _resetRemediationQueue } from "../lib/repair-remediation.js";

const ORIGINAL = ["line one", "line two", "line three", ""].join("\n");
const DIFF = [
  "--- a/server/lib/example.js",
  "+++ b/server/lib/example.js",
  "@@ -1,3 +1,3 @@",
  " line one",
  "-line two",
  "+line TWO",
  " line three",
].join("\n");

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "hotpatch-"));
  await mkdir(path.join(root, "server", "lib"), { recursive: true });
  await writeFile(path.join(root, "server", "lib", "example.js"), ORIGINAL);
  return root;
}
const stubBrainOk = async () => ({ ok: true, model: "gpt-oss:120b-cloud", proposal: { file: "server/lib/example.js", diff: DIFF, rationale: "typo in line two" } });
const noopAudit = async () => {};

describe("BR-01 repair hot-patch", () => {
  beforeEach(() => _resetRemediationQueue());

  it("the flag is off unless CONCORD_REPAIR_HOTPATCH=1 exactly", () => {
    assert.equal(hotpatchEnabled({}), false);
    assert.equal(hotpatchEnabled({ CONCORD_REPAIR_HOTPATCH: "0" }), false);
    assert.equal(hotpatchEnabled({ CONCORD_REPAIR_HOTPATCH: "1" }), true);
  });

  it("the path allowlist refuses data, env, migrations, and anything outside the source trees", () => {
    assert.equal(isPathAllowed("server/lib/x.js"), true);
    assert.equal(isPathAllowed("concord-frontend/app/page.tsx"), true);
    assert.equal(isPathAllowed("server/data/users.db"), false);
    assert.equal(isPathAllowed("server/.env"), false);
    assert.equal(isPathAllowed("server/migrations/501_x.sql"), false);
    assert.equal(isPathAllowed("../server/lib/x.js"), false);
    assert.equal(isPathAllowed("/etc/passwd"), false);
    assert.equal(isPathAllowed("docs/readme.md"), false);
  });

  it("a proposal lands in the remediation queue as proposed — not applied, no confidence field", async () => {
    const root = await fixtureRoot();
    const r = await proposeHotpatch({ error: "boom", filePath: "server/lib/example.js", rootDir: root, brainCall: stubBrainOk, audit: noopAudit });
    assert.equal(r.ok, true);
    assert.equal(r.entry.status, "proposed");
    assert.equal(r.entry.model, "gpt-oss:120b-cloud");
    assert.ok(!("confidence" in r.entry), "no confidence field in the authorization path");
    assert.equal(await readFile(path.join(root, "server/lib/example.js"), "utf8"), ORIGINAL);
  });

  it("a data-path proposal is refused at propose time, before the brain is called", async () => {
    const root = await fixtureRoot();
    let called = false;
    const r = await proposeHotpatch({
      error: "boom", filePath: "server/data/x.js", rootDir: root,
      brainCall: async () => { called = true; return stubBrainOk(); }, audit: noopAudit,
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "path_not_allowed");
    assert.equal(called, false);
  });

  it("an unreachable repair brain produces no proposal and no queue entry (repair pauses cleanly)", async () => {
    const root = await fixtureRoot();
    const r = await proposeHotpatch({
      error: "boom", filePath: "server/lib/example.js", rootDir: root,
      brainCall: async () => ({ ok: false, error: "repair_brain_unreachable" }), audit: noopAudit,
    });
    assert.equal(r.ok, false);
    assert.equal(getEntry("repair-cortex:hotpatch:anything"), null);
  });

  it("apply refuses with the flag off, and refuses an unapproved entry with the flag on", async () => {
    const root = await fixtureRoot();
    const p = await proposeHotpatch({ error: "boom", filePath: "server/lib/example.js", rootDir: root, brainCall: stubBrainOk, audit: noopAudit });
    const off = await applyHotpatch(p.entry.id, { rootDir: root, env: {}, audit: noopAudit });
    assert.equal(off.error, "hotpatch_disabled");
    const unapproved = await applyHotpatch(p.entry.id, { rootDir: root, env: { CONCORD_REPAIR_HOTPATCH: "1" }, audit: noopAudit });
    assert.equal(unapproved.error, "wrong_state");
    assert.equal(await readFile(path.join(root, "server/lib/example.js"), "utf8"), ORIGINAL);
  });

  it("an approved entry applies with the flag on, and manual rollback restores the bytes", async () => {
    const root = await fixtureRoot();
    const p = await proposeHotpatch({ error: "boom", filePath: "server/lib/example.js", rootDir: root, brainCall: stubBrainOk, audit: noopAudit });
    assert.equal(approve(p.entry.id, "admin-1").ok, true);
    const a = await applyHotpatch(p.entry.id, { rootDir: root, env: { CONCORD_REPAIR_HOTPATCH: "1" }, testGate: async () => ({ ok: true }), audit: noopAudit });
    assert.equal(a.ok, true);
    assert.match(await readFile(path.join(root, "server/lib/example.js"), "utf8"), /line TWO/);
    const rb = await rollbackHotpatch(p.entry.id, { rootDir: root, audit: noopAudit });
    assert.equal(rb.ok, true);
    assert.equal(await readFile(path.join(root, "server/lib/example.js"), "utf8"), ORIGINAL);
  });

  it("a failing test gate auto-rolls-back byte-identically and lands the entry at apply_failed", async () => {
    const root = await fixtureRoot();
    const p = await proposeHotpatch({ error: "boom", filePath: "server/lib/example.js", rootDir: root, brainCall: stubBrainOk, audit: noopAudit });
    approve(p.entry.id, "admin-1");
    const a = await applyHotpatch(p.entry.id, {
      rootDir: root, env: { CONCORD_REPAIR_HOTPATCH: "1" },
      testGate: async () => ({ ok: false, error: "suite_red" }), audit: noopAudit,
    });
    assert.equal(a.ok, false);
    assert.equal(a.error, "test_gate_failed");
    assert.equal(a.entry.status, "apply_failed");
    assert.equal(await readFile(path.join(root, "server/lib/example.js"), "utf8"), ORIGINAL);
  });

  it("the diff applier verifies context strictly — a stale diff refuses whole", () => {
    const stale = DIFF.replace("line one", "line uno");
    assert.equal(applyUnifiedDiff(ORIGINAL, stale).ok, false);
    const good = applyUnifiedDiff(ORIGINAL, DIFF);
    assert.equal(good.ok, true);
    assert.match(good.content, /line TWO/);
  });
});
