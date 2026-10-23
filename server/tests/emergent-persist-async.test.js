// Pins persistEmergentStateAsync (2026-10-23): the 15-minute emergent-state
// timer writes with non-blocking I/O and compact JSON, and what it writes
// reads back through the existing loader exactly like the sync version.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { persistEmergentState, persistEmergentStateAsync, serializeEmergentState, loadEmergentState } from "../emergent/persistence.js";

test("async persist writes the same snapshot the sync one does, compactly, and it loads back", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "emergent-persist-"));
  try {
    const STATE = {};
    const before = serializeEmergentState(STATE);
    const r = await persistEmergentStateAsync(STATE, { dataDir: dir });
    assert.equal(r.ok, true, JSON.stringify(r));
    const files = fs.readdirSync(dir);
    assert.ok(files.every((f) => !f.endsWith(".tmp")), `no temp files left: ${files}`);
    const raw = fs.readFileSync(r.path, "utf-8");
    assert.ok(!raw.includes("\n  "), "compact JSON");
    const parsed = JSON.parse(raw);
    delete parsed.persistedAt; const b = { ...before }; delete b.persistedAt;
    assert.deepEqual(Object.keys(parsed).sort(), Object.keys(b).sort());

    // Second run keeps a backup of the first; a sync write still works alongside.
    assert.equal((await persistEmergentStateAsync(STATE, { dataDir: dir })).ok, true);
    assert.equal(persistEmergentState(STATE, { dataDir: dir }).ok, true);
    const loaded = loadEmergentState({}, { dataDir: dir });
    assert.equal(loaded.ok, true, JSON.stringify(loaded));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("overlapping async persists don't race on the file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "emergent-persist-"));
  try {
    const [a, b] = await Promise.all([persistEmergentStateAsync({}, { dataDir: dir }), persistEmergentStateAsync({}, { dataDir: dir })]);
    assert.ok(a.ok !== b.ok, "exactly one runs");
    assert.ok([a, b].some((x) => x.error === "already_running"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
