// FIX-photography-008: a photography export's rolls must carry their
// photos — refs (filename, mediaId, the /api/media/<id>/stream URL)
// and metadata (EXIF, capture date, rating/flag, keywords) — both
// nested in the roll rows and as flat frame rows a CSV reader can
// use. Before the fix the composed frames carried only
// id/filename/mediaId/mime/size and existed only nested. Hermetic:
// in-memory state plus a node:sqlite stand-in for the restart-
// durable roll/frame tables (migrations 459 + 500 shapes).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const { collectLensExport } = await import("../lib/lens-export.js");
const registerPhotographyActions = (await import("../domains/photography.js")).default;

const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

const photo = (id, shootId, over = {}) => ({
  id, filename: `${id}.jpg`, title: `${id}.jpg`, camera: "Z6", lens: "35mm",
  iso: 400, aperture: "f/2.8", shutter: "1/250", focalLength: 35,
  width: 6000, height: 4000, captureDate: "2026-10-01T10:00:00.000Z",
  rating: 4, flag: "flagged", colorLabel: "green", keywords: ["coast"],
  develop: {}, shootId, importedAt: "2026-11-01T00:00:00.000Z",
  mediaId: `media_${id}`, mimeType: "image/jpeg", fileSize: 12345, ...over,
});

describe("photography export frames (FIX-photography-008)", () => {
  let db;
  before(() => {
    registerPhotographyActions(() => {});
    db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE photography_rolls (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL)`);
    db.exec(`CREATE TABLE photography_roll_frames (id TEXT PRIMARY KEY, roll_id TEXT NOT NULL, user_id TEXT NOT NULL, filename TEXT NOT NULL, created_at TEXT NOT NULL, media_id TEXT, mime_type TEXT, file_size INTEGER)`);
    db.prepare(`INSERT INTO photography_rolls VALUES (?,?,?,?)`).run("sht_db", "user-a", "Restart roll", "2026-11-05T00:00:00.000Z");
    db.prepare(`INSERT INTO photography_roll_frames VALUES (?,?,?,?,?,?,?,?)`).run("img_db", "sht_db", "user-a", "img_db.jpg", "2026-11-05T01:00:00.000Z", "media_img_db", "image/jpeg", 999);
    globalThis._concordSTATE = {
      db,
      photographyLens: {
        photos: new Map([
          ["user-a", [photo("img_1", "sht_1"), photo("img_2", "sht_1", { mediaId: null, rating: 0 })]],
          ["user-b", [photo("img_9", "sht_9")]],
        ]),
        albums: new Map(), presets: new Map(), exportPresets: new Map(),
        shoots: new Map([
          ["user-a", [{ id: "sht_1", name: "Coast roll", date: "2026-10-01", location: "Big Sur", client: null, visibility: "private", createdAt: "2026-11-01T00:00:00.000Z" }]],
          ["user-b", [{ id: "sht_9", name: "Not yours", date: null, location: null, client: null, visibility: "private", createdAt: "2026-11-01T00:00:00.000Z" }]],
        ]),
      },
    };
  });

  it("roll rows carry frames with URL and metadata", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "photography",
      ctx: { db, actor: { userId: "user-a" } },
    });
    const roll = out.artifacts.find((r) => r.type === "photography_roll" && r.id === "sht_1");
    assert.ok(roll, "roll row present");
    assert.equal(roll.data.frames.length, 2);
    const f = roll.data.frames[0];
    assert.equal(f.url, "/api/media/media_img_1/stream");
    assert.equal(f.camera, "Z6");
    assert.equal(f.iso, 400);
    assert.equal(f.rating, 4);
    assert.deepEqual(f.keywords, ["coast"]);
    const noMedia = roll.data.frames[1];
    assert.equal(noMedia.url, null);
  });

  it("flat frame rows give the CSV real photo-ref columns, incl. the DB-only roll", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "photography",
      ctx: { db, actor: { userId: "user-a" } },
    });
    const frames = out.artifacts.filter((r) => r.type === "photography_frame");
    assert.equal(frames.length, 3);
    const dbFrame = frames.find((r) => r.id === "img_db");
    assert.ok(dbFrame, "DB-only roll's frame present as a flat row");
    assert.equal(dbFrame.data.rollId, "sht_db");
    assert.equal(dbFrame.data.rollName, "Restart roll");
    assert.equal(dbFrame.data.url, "/api/media/media_img_db/stream");
    assert.equal(dbFrame.data.camera, null);
    const mem = frames.find((r) => r.id === "img_1");
    assert.equal(mem.data.rollName, "Coast roll");
    assert.equal(mem.data.aperture, "f/2.8");
  });

  it("never leaks another photographer's rolls or frames", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "photography",
      ctx: { db, actor: { userId: "user-a" } },
    });
    assert.equal(out.artifacts.some((r) => r.id === "sht_9" || r.id === "img_9"), false);
  });
});
