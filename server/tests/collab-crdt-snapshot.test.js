// server/tests/collab-crdt-snapshot.test.js
//
// Tier-2 contract test for CRDT-aware snapshot/restore on the collab
// domain. Drives the macros end-to-end via the registry: create doc →
// edit Y.Doc directly → snapshot → mutate further → restore → verify
// the restored state matches the snapshot, not the post-snapshot mutation.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import registerCollabActions from "../domains/collab.js";
import {
  getDoc,
  encodeStateAsUpdate,
  replaceDoc,
  attachYjsSync,
} from "../lib/yjs-realtime.js";

// Minimal lensRegistry stub: collects registered macros so we can call them.
const macros = new Map();
function registerLensAction(domain, name, fn) {
  macros.set(`${domain}.${name}`, fn);
}

describe("collab CRDT snapshot + restore", () => {
  before(() => {
    // Wire collab domain.
    registerCollabActions(registerLensAction);
    // Stub realtime emit (collab calls globalThis._concordREALTIME?.io.to(...).emit)
    globalThis._concordREALTIME = {
      io: { to: () => ({ emit: () => {} }) },
    };
  });

  function call(name, ctx, params) {
    const fn = macros.get(name);
    assert.ok(fn, `${name} registered`);
    return fn(ctx || { actor: { userId: "u1", name: "Alice" } }, null, params);
  }

  it("captures and restores a Y.Doc binary state", async () => {
    // Create a collab doc.
    const created = call("collab.docCreate", { actor: { userId: "u1", name: "Alice" } }, { title: "Test" });
    assert.equal(created.ok, true);
    const docId = created.result.id;

    // Edit the Y.Doc directly (simulating the frontend CRDT path).
    const ydoc = getDoc("collab:doc", docId);
    const ytext = ydoc.getText("content");
    ytext.insert(0, "Hello, world.");

    // Take a snapshot.
    const snap1 = await call("collab.docCrdtSnapshot",
      { actor: { userId: "u1", name: "Alice" } },
      { docId, label: "v1" });
    assert.equal(snap1.ok, true);
    assert.equal(snap1.result.label, "v1");
    assert.ok(snap1.result.bytes > 0, "snapshot has nonzero binary size");
    const snap1Id = snap1.result.id;

    // Mutate further.
    ytext.insert(ytext.length, " More text.");
    assert.equal(ytext.toString(), "Hello, world. More text.");

    // Take a second snapshot.
    const snap2 = await call("collab.docCrdtSnapshot",
      { actor: { userId: "u1", name: "Alice" } },
      { docId, label: "v2" });
    assert.equal(snap2.ok, true);

    // List — should show both snapshots, newest first.
    const list = call("collab.docCrdtSnapshotList", null, { docId });
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 2);
    assert.equal(list.result.snapshots[0].label, "v2", "newest first");
    assert.equal(list.result.snapshots[1].label, "v1");

    // Restore to snap1 — should rewind text to "Hello, world."
    const restore = await call("collab.docCrdtRestore",
      { actor: { userId: "u1", name: "Alice" } },
      { docId, snapshotId: snap1Id });
    assert.equal(restore.ok, true);
    assert.equal(restore.result.restoredTo, "v1");

    // After restore, getDoc returns a NEW Y.Doc (the old one was replaced).
    const newDoc = getDoc("collab:doc", docId);
    const newText = newDoc.getText("content");
    assert.equal(newText.toString(), "Hello, world.", "text rewound to snapshot state");

    // Restore should auto-save the current state first, so list now has 3.
    const list2 = call("collab.docCrdtSnapshotList", null, { docId });
    assert.equal(list2.result.total, 3, "auto-save adds a snapshot");
    assert.ok(list2.result.snapshots.some(s => s.label.includes("Auto-save before CRDT restore")));
  });

  it("rejects restore from non-edit users", async () => {
    const created = call("collab.docCreate",
      { actor: { userId: "owner", name: "Owner" } },
      { title: "Private" });
    const docId = created.result.id;
    // Docs default to defaultTier=edit so anyone can edit — explicitly
    // lock down the default to "view" so non-owners are read-only.
    const lock = call("collab.setPermission",
      { actor: { userId: "owner", name: "Owner" } },
      { docId, isDefault: true, tier: "view" });
    assert.equal(lock.ok, true);

    const ydoc = getDoc("collab:doc", docId);
    ydoc.getText("content").insert(0, "owned text");

    const snap = await call("collab.docCrdtSnapshot",
      { actor: { userId: "owner", name: "Owner" } },
      { docId, label: "v1" });
    assert.equal(snap.ok, true);

    // Different user — defaultTier is now view, so restore is denied.
    const result = await call("collab.docCrdtRestore",
      { actor: { userId: "stranger", name: "Stranger" } },
      { docId, snapshotId: snap.result.id });
    assert.equal(result.ok, false);
    assert.match(result.error, /permission denied/);
  });

  it("handles missing snapshotId gracefully", async () => {
    const created = call("collab.docCreate",
      { actor: { userId: "u1", name: "Alice" } },
      { title: "X" });
    const result = await call("collab.docCrdtRestore",
      { actor: { userId: "u1", name: "Alice" } },
      { docId: created.result.id, snapshotId: "nonexistent" });
    assert.equal(result.ok, false);
    assert.match(result.error, /not found/);
  });

  it("replaceDoc swaps the in-memory doc atomically", () => {
    const docId = "raw-replace-test";
    const source = getDoc("collab:doc", docId);
    source.getText("content").insert(0, "original");
    const bytes = encodeStateAsUpdate("collab:doc", docId);

    // Mutate the source so we know if replace really happens.
    source.getText("content").insert(source.getText("content").length, " mutated");

    const res = replaceDoc("collab:doc", docId, bytes);
    assert.equal(res.ok, true);
    assert.ok(res.state instanceof Uint8Array);
    assert.equal(getDoc("collab:doc", docId).getText("content").toString(), "original",
      "replaceDoc replaces with the snapshot state, not the mutated state");
  });

  it("attachYjsSync is no-op when io is missing", () => {
    assert.doesNotThrow(() => attachYjsSync(null));
    assert.doesNotThrow(() => attachYjsSync({}));
  });
});
