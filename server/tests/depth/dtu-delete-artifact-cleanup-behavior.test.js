// tests/depth/dtu-delete-artifact-cleanup-behavior.test.js — REAL behavioral
// test for the storage-audit fix (2026-07-27): `register("dtu","delete", …)`
// now calls `deleteArtifact(id)` when the DTU carries an artifact.
//
// Before this fix, deleteArtifact() existed in server/lib/artifact-store.js
// (tested in isolation at tests/artifact-store.test.js) but was never called
// from anywhere — deleting a DTU left its per-DTU legacy artifact directory
// (ARTIFACT_ROOT/{dtuId}/: the symlinked/copied original file plus any
// generated thumbnail.jpg/waveform.json/text_preview.txt) on disk forever,
// because none of those filenames match artifact-gc.js's hash-pattern
// orphan scan (they're namespaced by dtuId, not content hash).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { macroRuntime } from "./_harness.js";
import { storeArtifact, ARTIFACT_ROOT } from "../../lib/artifact-store.js";

describe("dtu.delete — cleans up the per-DTU legacy artifact directory", () => {
  let runMacro, STATE, ctx;

  before(async () => {
    ({ runMacro, STATE, ctx } = await macroRuntime("dtu-delete-artifact-cleanup"));
  });

  it("removes ARTIFACT_ROOT/{dtuId}/ when the deleted DTU carried an artifact", async () => {
    const id = `depth-dtu-artifact-${Date.now()}`;
    const buf = Buffer.from("hello world, this is a real text artifact\n");
    const artifact = await storeArtifact(id, buf, "text/plain", "note.txt");

    const legacyDir = path.join(ARTIFACT_ROOT, id);
    assert.equal(fs.existsSync(legacyDir), true, "storeArtifact should have created the legacy per-DTU dir");

    STATE.dtus.set(id, {
      id,
      title: "Artifact-bearing test DTU",
      artifact,
      createdBy: ctx.actor.userId,
      ownerId: ctx.actor.userId,
    });

    const result = await runMacro("dtu", "delete", { id }, ctx);
    assert.equal(result.ok, true, "delete should succeed");
    assert.equal(fs.existsSync(legacyDir), false, "the legacy per-DTU artifact directory must be removed on delete");
    assert.equal([...STATE.dtus.keys()].includes(id), false, "the DTU record itself must be removed from STATE.dtus");

    // The shared content-addressed hash file must NOT be removed by this —
    // it's dedup'd storage that other DTUs may still reference; only the
    // reference-counted weekly orphan GC (artifact-gc.js) may reclaim it.
    assert.equal(fs.existsSync(artifact.diskPath), true, "the shared content-addressed file must survive a single DTU's delete");
  });

  it("does not throw when the deleted DTU has no artifact", async () => {
    const id = `depth-dtu-no-artifact-${Date.now()}`;
    STATE.dtus.set(id, {
      id,
      title: "Plain text-only test DTU",
      createdBy: ctx.actor.userId,
      ownerId: ctx.actor.userId,
    });
    assert.equal([...STATE.dtus.keys()].includes(id), true, "sanity: DTU must exist before delete");
    const result = await runMacro("dtu", "delete", { id }, ctx);
    assert.equal(result.ok, true);
    assert.equal([...STATE.dtus.keys()].includes(id), false, "the DTU record must be removed from STATE.dtus even with no artifact to clean up");
  });
});
