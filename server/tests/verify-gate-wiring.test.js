// Brief F: the gate is wired into the running server, behind auth, off the hot path, and never deletes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server.js"), "utf8");
const between = (a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, `missing: ${a}`); const j = src.indexOf(b, i + a.length); return src.slice(i, j > 0 ? j : i + 4000); };

test("a heartbeat drains the queue and runs the retention batch, guarded by try/catch", () => {
  const hb = between('registerHeartbeat("verify-gate-cycle"', 'registerHeartbeat("brain-daily-refresh"');
  assert.match(hb, /getVerifyGate\(\)\.cycle\(\)/);
  assert.match(hb, /try \{[\s\S]*\} catch/);
  assert.match(hb, /scope: "global"/);
});

test("new and grown consolidated nodes are submitted after a promote batch", () => {
  const blk = between("async function _promoteClusterBatch", "return promotedCount;");
  assert.match(blk, /getVerifyGate\(\)\.submit\(id\)/);
  assert.match(blk, /\.\.\.megaIds, \.\.\.grownIds/);
});

test("the admin endpoint is role-gated", () => {
  assert.match(src, /app\.get\("\/api\/admin\/verify-gate", requireRole\("owner", "admin", "sovereign", "founder"\)/);
});

test("the store adapter only annotates, demotes or quarantines: it never deletes a DTU", () => {
  const adapter = between("function getVerifyGate()", "async function _promoteClusterBatch");
  assert.doesNotMatch(adapter, /STATE\.dtus\.delete|\.delete\(/);
  assert.match(adapter, /quarantine:\$\{reason\}/);
  assert.match(adapter, /slot: "subconscious"/);
});

test("retention scan is a resumable, bounded iterator over the DTU map", () => {
  const adapter = between("scan: (maxExamine)", "deps: {");
  assert.match(adapter, /while \(examined < maxExamine\)/);
  assert.match(adapter, /_vgIter = STATE\.dtus\.values\(\)/);
});
