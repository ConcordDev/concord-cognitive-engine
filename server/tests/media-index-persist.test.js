// A backend restart used to drop the in-memory media map, so
// /api/media/:id/stream 404'd every existing URL. The row now lives in
// SQLite. Privacy is unchanged: the owner can stream, anyone else cannot.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import Database from "better-sqlite3";
import {
  createMediaDTU,
  updateMediaDTU,
  deleteMediaDTU,
  hydrateMediaIndex,
  canAccessMediaDTU,
} from "../lib/media-dtu.js";
import createMediaRouter from "../routes/media.js";
import { createErrorMiddleware } from "../lib/async-handler.js";
import { up as migrateMediaIndex } from "../migrations/472_media_index.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("a private media stream survives a cleared in-memory map", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-idx-"));
  const bytes = Buffer.from("private-png-bytes");
  const diskPath = path.join(dir, "image.png");
  fs.writeFileSync(diskPath, bytes);
  const db = new Database(":memory:");
  migrateMediaIndex(db);
  const STATE = { db, dtus: new Map() };
  let server;
  try {
    const created = createMediaDTU(STATE, {
      authorId: "owner-1",
      title: "red bicycle",
      mediaType: "image",
      mimeType: "image/png",
      privacy: "private",
      fileSize: bytes.length,
      duration: 3.5,
      priceCc: 4.5,
      currency: "CC",
      previewUrl: "/previews/red-bicycle.jpg",
      previewStartMs: 120,
      previewSeconds: 8,
      artifactRef: {
        type: "image/png",
        diskPath,
        filename: "image.png",
        sizeBytes: bytes.length,
      },
    });
    assert.equal(created.ok, true);
    const id = created.mediaDTU.id;

    const row = db.prepare("SELECT owner_id, privacy, mime_type, disk_path, size_bytes, duration, price_cc, price_currency, preview_url, preview_start_ms, preview_seconds FROM media_index WHERE id = ?").get(id);
    assert.equal(row.owner_id, "owner-1");
    assert.equal(row.privacy, "private");
    assert.equal(row.mime_type, "image/png");
    assert.equal(row.disk_path, diskPath);
    assert.equal(row.size_bytes, bytes.length);
    assert.equal(row.duration, 3.5);
    assert.equal(row.price_cc, 4.5);
    assert.equal(row.price_currency, "CC");
    assert.equal(row.preview_url, "/previews/red-bicycle.jpg");
    assert.equal(row.preview_start_ms, 120);
    assert.equal(row.preview_seconds, 8);

    const updated = updateMediaDTU(STATE, id, "owner-1", { priceCc: 9, previewSeconds: 4 });
    assert.equal(updated.ok, true);
    const priced = db.prepare("SELECT price_cc, preview_seconds, privacy FROM media_index WHERE id = ?").get(id);
    assert.equal(priced.price_cc, 9);
    assert.equal(priced.preview_seconds, 4);
    assert.equal(priced.privacy, "private");

    // Simulate a restart: empty map, same database, same file on disk.
    STATE._media.mediaDTUs.clear();
    STATE.dtus.clear();

    const app = express();
    app.use((req, _res, next) => {
      const userId = req.headers["x-test-user"];
      if (typeof userId === "string" && userId) req.user = { id: userId };
      next();
    });
    app.use("/api/media", createMediaRouter({ STATE }));
    app.use(createErrorMiddleware(() => {}));
    server = await listen(app);
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/api/media/${id}/stream`;

    const owner = await fetch(url, { headers: { "x-test-user": "owner-1" } });
    assert.equal(owner.status, 200);
    assert.match(owner.headers.get("content-type") || "", /image\/png/);
    assert.equal(Buffer.from(await owner.arrayBuffer()).equals(bytes), true);

    const other = await fetch(url, { headers: { "x-test-user": "someone-else" } });
    assert.equal(other.status, 404);
    const otherBody = Buffer.from(await other.arrayBuffer());
    assert.equal(otherBody.equals(bytes), false);
    assert.match(otherBody.toString(), /not found/i);

    const anon = await fetch(url);
    assert.equal(anon.status, 401);

    const reloaded = STATE._media.mediaDTUs.get(id);
    assert.equal(reloaded.privacy, "private");
    assert.equal(reloaded.author, "owner-1");
    assert.equal(canAccessMediaDTU(STATE, reloaded, "someone-else").allowed, false);
    assert.equal(canAccessMediaDTU(STATE, reloaded, "owner-1").allowed, true);

    // A fresh process hydrates the same rows at boot.
    const booted = { db, dtus: new Map() };
    const hydrated = hydrateMediaIndex(booted);
    assert.equal(hydrated.loaded, 1);
    assert.equal(booted._media.mediaDTUs.get(id).privacy, "private");
    assert.equal(booted._media.mediaDTUs.get(id).priceCc, 9);
    assert.equal(booted._media.mediaDTUs.get(id).previewUrl, "/previews/red-bicycle.jpg");

    assert.equal(deleteMediaDTU(STATE, id, "owner-1").ok, true);
    STATE._media.mediaDTUs.clear();
    STATE.dtus.clear();
    const gone = await fetch(url, { headers: { "x-test-user": "owner-1" } });
    assert.equal(gone.status, 404);
    assert.equal(db.prepare("SELECT id FROM media_index WHERE id = ?").get(id), undefined);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
