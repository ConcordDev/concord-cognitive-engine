// Pins the fix for live `state_save_failed` ENOENT (2026-10-19..22): overlapping
// state saves must not share a tmp file, and an older snapshot that finishes
// last must never be renamed over a newer one.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uniqueTmpPath, writeFileAtomicSync, createSnapshotOrdering, sweepStaleStateTmps } from "../lib/state-file-write.js";

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "state write ")); }

test("every write gets a distinct tmp path", () => {
  const target = "/x/concord_state.json";
  const a = uniqueTmpPath(target);
  const b = uniqueTmpPath(target);
  assert.notEqual(a, b);
  assert.match(a, new RegExp(`^/x/concord_state\\.json\\.${process.pid}\\.\\d+\\.tmp$`));
});

test("old shared-tmp shape reproduces ENOENT; unique tmps do not", async () => {
  const dir = tmpDir();
  const target = path.join(dir, "concord_state.json");
  try {
    // Reproduce the bug: async writer stages the shared tmp, a sync writer
    // renames it away in the yield gap, the async rename then fails.
    const shared = target + ".tmp";
    fs.writeFileSync(shared, "async-old");
    fs.writeFileSync(shared, "sync-new");
    fs.renameSync(shared, target);
    await assert.rejects(fs.promises.rename(shared, target), { code: "ENOENT" });

    // Fixed shape: both complete.
    const order = createSnapshotOrdering();
    const asyncTmp = uniqueTmpPath(target);
    await fs.promises.writeFile(asyncTmp, "async seq 1");
    writeFileAtomicSync(target, "sync seq 2"); // lands in the async writer's gap
    order.committed(2);
    if (order.isCurrent(1)) await fs.promises.rename(asyncTmp, target);
    else await fs.promises.unlink(asyncTmp);
    assert.equal(fs.readFileSync(target, "utf8"), "sync seq 2", "older async snapshot must not overwrite newer sync one");
    assert.deepEqual(fs.readdirSync(dir), ["concord_state.json"], "no tmp left behind");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("ordering accepts equal-or-newer seqs only", () => {
  const o = createSnapshotOrdering();
  assert.equal(o.isCurrent(0), true);
  o.committed(5);
  assert.equal(o.isCurrent(4), false);
  assert.equal(o.isCurrent(5), true);
  o.committed(3); // late commit of an older seq never moves it backwards
  assert.equal(o.onDiskSeq, 5);
});

test("writeFileAtomicSync leaves no tmp when the rename fails", () => {
  const dir = tmpDir();
  try {
    const target = path.join(dir, "sub-is-a-dir");
    fs.mkdirSync(target); fs.writeFileSync(path.join(target, "f"), "x"); // rename onto non-empty dir fails
    assert.throws(() => writeFileAtomicSync(target, "data"));
    assert.deepEqual(fs.readdirSync(dir), ["sub-is-a-dir"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("boot sweep removes legacy and per-write tmps, nothing else", () => {
  const dir = tmpDir();
  try {
    const target = path.join(dir, "concord_state.json");
    for (const n of ["concord_state.json", "concord_state.json.tmp", "concord_state.json.123.4.tmp", "concord_state.json.bak", "other.json.1.2.tmp", "concord_state.json.x.tmp"]) {
      fs.writeFileSync(path.join(dir, n), "x");
    }
    assert.equal(sweepStaleStateTmps(target), 2);
    assert.deepEqual(fs.readdirSync(dir).sort(), ["concord_state.json", "concord_state.json.bak", "concord_state.json.x.tmp", "other.json.1.2.tmp"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
