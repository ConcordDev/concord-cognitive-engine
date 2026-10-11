// Orphan classification for whiteboard lens artifacts, and the dry-run
// cleanup script. The script is never pointed at a live database here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  classifyOrphanBoardArtifacts,
  pickLegacyShadow,
  rawBoardTitle,
} from "../lib/whiteboard-board-artifacts.js";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/cleanup-whiteboard-orphan-artifacts.mjs");

function board(id, title, ownerId) {
  return {
    id,
    ownerId,
    title: `Whiteboard: ${title}`,
    machine: { kind: "whiteboard", data: { id, title, elements: [] } },
  };
}

function shadow(id, title, ownerId, extra = {}) {
  return {
    id,
    domain: "whiteboard",
    type: "board",
    ownerId,
    title,
    data: { linkedDtus: [], ...extra },
  };
}

describe("whiteboard board artifact classification", () => {
  it("reads the raw board name out of the DTU title prefix", () => {
    assert.equal(rawBoardTitle(board("wb_1", "Plan", "u1")), "Plan");
    assert.equal(rawBoardTitle({ title: "Whiteboard: Bare" }), "Bare");
  });

  it("links a missing board's shadow and leaves a live one, a titled match, and a canvas", () => {
    const artifacts = [
      shadow("lart_live", "Plan", "u1", { whiteboardId: "wb_live" }),
      shadow("lart_dead", "Gone", "u1", { whiteboardId: "wb_dead" }),
      shadow("lart_title", "Kept", "u1"),
      shadow("lart_orphan", "WBR42-55262", "u1"),
      shadow("lart_canvas", "Sketch", "u1", { elements: [{ id: "e1" }] }),
      shadow("lart_other", "WBR42-55262", "u2"),
      { id: "lart_note", domain: "whiteboard", type: "note", ownerId: "u1", title: "nope", data: {} },
    ];
    const boards = [board("wb_live", "Plan", "u1"), board("wb_kept", "Kept", "u1")];
    const { orphans, kept } = classifyOrphanBoardArtifacts(artifacts, boards);
    const orphanIds = orphans.map((o) => o.artifact.id).sort();
    assert.deepEqual(orphanIds, ["lart_dead", "lart_orphan", "lart_other"]);
    assert.equal(orphans.find((o) => o.artifact.id === "lart_dead").reason, "linked_board_missing");
    assert.equal(orphans.find((o) => o.artifact.id === "lart_orphan").reason, "unlinked_no_live_board");
    const keptIds = kept.map((k) => k.artifact.id);
    assert.ok(keptIds.includes("lart_live"));
    assert.ok(keptIds.includes("lart_title"));
    assert.ok(keptIds.includes("lart_canvas"));
    assert.equal(kept.find((k) => k.artifact.id === "lart_canvas").reason, "has_elements");
  });

  it("picks one unlinked shadow and refuses a title collision", () => {
    const one = [shadow("a", "Plan", "u1"), shadow("b", "Other", "u1")];
    assert.equal(pickLegacyShadow(one, { ownerId: "u1", title: "Plan" }).id, "a");
    const two = [shadow("a", "Plan", "u1"), shadow("b", "Plan", "u1")];
    assert.equal(pickLegacyShadow(two, { ownerId: "u1", title: "Plan" }), null);
    assert.equal(pickLegacyShadow([shadow("a", "Plan", "u1", { whiteboardId: "wb_1" })], { ownerId: "u1", title: "Plan" }), null);
    assert.equal(pickLegacyShadow([shadow("a", "Plan", "u2")], { ownerId: "u1", title: "Plan" }), null);
  });
});

describe("cleanup-whiteboard-orphan-artifacts", () => {
  it("prints orphans and deletes them only with --apply", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-orphan-"));
    const dbPath = path.join(dir, "concord.db");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE dtu_store (id TEXT PRIMARY KEY, owner_user_id TEXT, title TEXT, data TEXT, kind TEXT);
      CREATE TABLE lens_artifact_store (
        id TEXT PRIMARY KEY, domain TEXT, type TEXT, owner_id TEXT, title TEXT, data TEXT
      );
    `);
    const live = board("wb_live", "Plan", "u1");
    db.prepare("INSERT INTO dtu_store (id, owner_user_id, title, data, kind) VALUES (?, ?, ?, ?, ?)").run(
      live.id, "u1", live.title, JSON.stringify(live), "whiteboard",
    );
    const rows = [
      shadow("lart_live", "Plan", "u1", { whiteboardId: "wb_live" }),
      shadow("lart_orphan", "WBR42-55262", "u1"),
      shadow("lart_canvas", "Sketch", "u1", { elements: [{ id: "e" }] }),
    ];
    const insert = db.prepare("INSERT INTO lens_artifact_store (id, domain, type, owner_id, title, data) VALUES (?, 'whiteboard', 'board', ?, ?, ?)");
    for (const row of rows) insert.run(row.id, row.ownerId, row.title, JSON.stringify(row));
    db.close();

    const dry = spawnSync(process.execPath, [SCRIPT, "--db", dbPath], { encoding: "utf8" });
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /mode: dry-run/);
    assert.match(dry.stdout, /lart_orphan/);
    assert.match(dry.stdout, /no rows deleted/);
    const afterDry = new Database(dbPath, { readonly: true });
    assert.equal(afterDry.prepare("SELECT COUNT(*) AS n FROM lens_artifact_store").get().n, 3);
    afterDry.close();

    const applied = spawnSync(process.execPath, [SCRIPT, "--db", dbPath, "--apply"], { encoding: "utf8" });
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /deleted: 1/);
    const after = new Database(dbPath, { readonly: true });
    const left = after.prepare("SELECT id FROM lens_artifact_store ORDER BY id").all().map((r) => r.id);
    assert.deepEqual(left, ["lart_canvas", "lart_live"]);
    after.close();
  });
});
