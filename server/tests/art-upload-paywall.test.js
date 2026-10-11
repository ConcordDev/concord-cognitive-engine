/**
 * Art lens upload contract, My art listing, ownership, and priced-art paywall.
 *
 *   node --test --import=./tests/preload/no-egress.mjs --test-timeout=300000 tests/art-upload-paywall.test.js
 *
 * AUTH_MODE is set in art-upload-env.mjs before server.js loads. public mode
 * skips the delete owner check, which would make account B's refusal a no-op.
 */

import "./art-upload-env.mjs";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";
import { load, lensRun } from "./depth/_harness.js";
import { bytesForViewer } from "../lib/art-paywall.js";
import { isArtDtu } from "../lib/art-dtu-filter.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const OWNER = "art-upload-owner";
const OTHER = "art-upload-other";
const LICENSEE = "art-upload-licensee";

function ctxFor(makeCtx, id) {
  return makeCtx({
    user: { id, role: "member" },
    headers: {},
    method: "GET",
    path: "/api/dtus",
    url: "/api/dtus",
    ip: "127.0.0.1",
    get() { return ""; },
  });
}

describe("art upload, my art, ownership, paywall", () => {
  let makeCtx, STATE, db, base, server;
  let seq = 0;

  before(async () => {
    const loaded = await load();
    makeCtx = loaded.makeCtx;
    STATE = loaded.STATE;
    db = loaded.db;
    const { runMacro } = loaded;
    const { mountArtifactUploadRoutes } = await import("../lib/artifact-upload-routes.js");
    const { validateMimeType } = await import("../lib/upload-mime.js");
    const { assertHasSpaceFor, recordStorageDelta, STORAGE_REASONS } = await import("../lib/storage-quota.js");

    const app = express();
    app.use((req, _res, next) => {
      const id = req.headers["x-test-user"];
      if (id) req.user = { id: String(id), role: "member" };
      next();
    });
    mountArtifactUploadRoutes(app, {
      db,
      STATE,
      uid: (prefix) => `${prefix}_arttest_${++seq}`,
      assertHasSpaceFor,
      recordStorageDelta,
      STORAGE_REASONS,
      validateMimeType,
      saveState: () => {},
    });
    // Same list/delete contract as server/routes/dtus.js. The full router
    // needs the monolith's validate() middleware, which is not exported.
    app.get("/api/dtus", async (req, res) => {
      const out = await runMacro("dtu", "list", {
        limit: req.query.limit,
        offset: req.query.offset,
        mine: req.query.mine,
        domain: req.query.domain || null,
        kind: req.query.kind || null,
        scope: req.query.scope || null,
        tier: req.query.tier || "any",
        q: req.query.q,
      }, makeCtx(req));
      res.json(out);
    });
    app.delete("/api/dtus/:id", async (req, res) => {
      const out = await runMacro("dtu", "delete", { id: req.params.id }, makeCtx(req));
      if (!out.ok && /unauthorized/i.test(String(out.error || ""))) {
        return res.status(403).json(out);
      }
      return res.json(out);
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  async function uploadRaw(userId, { contentType, filename, title, domain, body }) {
    const res = await fetch(`${base}/api/artifact/upload`, {
      method: "POST",
      headers: {
        "content-type": contentType,
        "x-filename": encodeURIComponent(filename),
        "x-title": encodeURIComponent(title || filename),
        "x-domain": domain || "art",
        ...(userId ? { "x-test-user": userId } : {}),
      },
      body,
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  it("rejects a JSON body with a readable 400", async () => {
    const res = await fetch(`${base}/api/artifact/upload`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": OWNER },
      body: JSON.stringify({ file: "not-bytes" }),
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.ok, false);
    assert.match(json.error, /raw file|multipart/i);
  });

  it("requires a signed-in user", async () => {
    const { status, json } = await uploadRaw("", {
      contentType: "image/png",
      filename: "anon.png",
      title: "Anon",
      body: PNG,
    });
    assert.equal(status, 401);
    assert.equal(json.ok, false);
    assert.match(json.error, /sign in/i);
  });

  it("uploads a raw PNG, lists it in My art, and refuses account B's delete", async () => {
    const { status, json } = await uploadRaw(OWNER, {
      contentType: "image/png",
      filename: "harbor.png",
      title: "Harbor Study",
      body: PNG,
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.ok(json.dtuId);
    const stored = STATE.dtus.get(json.dtuId);
    assert.equal(stored.ownerId, OWNER);
    assert.equal(stored.domain, "art");
    assert.equal(isArtDtu(stored), true);

    STATE.dtus.set("art-upload-music", {
      id: "art-upload-music",
      tier: "regular",
      scope: "local",
      visibility: "private",
      domain: "music",
      title: "Bass Loop",
      ownerId: OWNER,
      createdBy: OWNER,
      machine: { kind: "track" },
      meta: { lens: "music", type: "track", createdBy: OWNER },
      createdAt: new Date().toISOString(),
    });

    const listed = await fetch(`${base}/api/dtus?mine=true&domain=art&limit=100`, {
      headers: { "x-test-user": OWNER },
    });
    const page = await listed.json();
    assert.equal(listed.status, 200);
    assert.equal(page.ok, true);
    const titles = (page.dtus || []).map((d) => d.title);
    assert.ok(titles.includes("Harbor Study"), `My art missing upload: ${titles.join(", ")}`);
    assert.equal(titles.includes("Bass Loop"), false);

    const again = await fetch(`${base}/api/dtus?mine=true&domain=art&limit=100`, {
      headers: { "x-test-user": OWNER },
    });
    const reloaded = await again.json();
    assert.ok((reloaded.dtus || []).some((d) => d.id === json.dtuId && d.title === "Harbor Study"));

    const denied = await fetch(`${base}/api/dtus/${json.dtuId}`, {
      method: "DELETE",
      headers: { "x-test-user": OTHER },
    });
    const deniedBody = await denied.json();
    assert.equal(denied.status, 403);
    assert.equal(deniedBody.ok, false);
    assert.match(String(deniedBody.error), /unauthorized/i);
    assert.ok(STATE.dtus.get(json.dtuId), "account B must not delete the piece");

    const ownerDel = await fetch(`${base}/api/dtus/${json.dtuId}`, {
      method: "DELETE",
      headers: { "x-test-user": OWNER },
    });
    const ownerBody = await ownerDel.json();
    assert.equal(ownerBody.ok, true);
    assert.equal(STATE.dtus.get(json.dtuId), undefined);
  });

  it("accepts a multipart PNG on /api/artifact/upload", async () => {
    const boundary = "----artboundary";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="domain"\r\n\r\nart\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nMultipart Piece\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="piece.png"\r\nContent-Type: image/png\r\n\r\n`),
      PNG,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await fetch(`${base}/api/artifact/upload`, {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-test-user": OWNER,
      },
      body,
    });
    const json = await res.json();
    assert.equal(res.status, 200, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.equal(STATE.dtus.get(json.dtuId).title, "Multipart Piece");
    assert.equal(STATE.dtus.get(json.dtuId).domain, "art");
  });

  it("serves a watermarked preview of priced art to non-licensees", async () => {
    const { status, json } = await uploadRaw(OWNER, {
      contentType: "image/png",
      filename: "priced.png",
      title: "Priced Study",
      body: PNG,
    });
    assert.equal(status, 200, JSON.stringify(json));
    const dtu = STATE.dtus.get(json.dtuId);
    dtu.marketplace = { price: 25 };
    const { retrieveArtifact } = await import("../lib/artifact-store.js");
    const original = retrieveArtifact(json.dtuId, dtu.artifact);
    assert.ok(original && original.length);

    const stranger = await bytesForViewer({
      dtu, userId: OTHER, db, buffer: original, contentType: "image/png",
    });
    assert.equal(stranger.access, "preview");
    assert.equal(stranger.contentType, "image/png");
    assert.equal(stranger.buffer.equals(original), false);
    assert.equal(stranger.buffer[0], 0x89);
    assert.equal(stranger.buffer[1], 0x50);
    assert.equal(stranger.buffer[2], 0x4e);
    assert.equal(stranger.buffer[3], 0x47);

    const ownerView = await bytesForViewer({
      dtu, userId: OWNER, db, buffer: original, contentType: "image/png",
    });
    assert.equal(ownerView.access, "full");
    assert.ok(ownerView.buffer.equals(original));

    db.prepare(
      `INSERT INTO creative_artifacts (id, creator_id, type, title, file_path, file_size, file_hash)
       VALUES (?, ?, 'image', ?, '/x', ?, 'h')`,
    ).run(json.dtuId, OWNER, "Priced Study", original.length);
    db.prepare(
      `INSERT INTO creative_usage_licenses (id, artifact_id, licensee_id, license_type, status, purchase_price)
       VALUES (?, ?, ?, 'standard', 'active', 25)`,
    ).run(`lic_${json.dtuId}`, json.dtuId, LICENSEE);

    const licensed = await bytesForViewer({
      dtu, userId: LICENSEE, db, buffer: original, contentType: "image/png",
    });
    assert.equal(licensed.access, "full");
    assert.ok(licensed.buffer.equals(original));

    const pdf = await bytesForViewer({
      dtu: { id: "priced-notes", ownerId: OWNER, marketplace: { price: 9 }, artifact: { type: "application/pdf" } },
      userId: OTHER,
      db,
      buffer: Buffer.from("%PDF-1.1\n"),
      contentType: "application/pdf",
    });
    assert.equal(pdf.access, "denied");
    assert.equal(pdf.status, 402);
    assert.match(pdf.body.error, /priced/i);
    assert.equal(pdf.buffer, undefined);
  });

  it("stream and download routes call the paywall before sending bytes", () => {
    const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
    for (const path of ["/api/artifact/:dtuId/stream", "/api/artifact/:dtuId/download"]) {
      const at = src.indexOf(`app.get("${path}"`);
      assert.ok(at > 0, path);
      const body = src.slice(at, at + 2200);
      assert.match(body, /bytesForViewer/);
      assert.match(body, /gated\.access === "denied"/);
    }
    const routes = fs.readFileSync(new URL("../routes/dtus.js", import.meta.url), "utf8");
    assert.match(routes, /unauthorized/);
    assert.match(routes, /status\(403\)/);
  });

  it("artwork-create asks for a canvas name", async () => {
    // lens.run wraps the handler. A refusal is { ok:true, result:{ ok:false, error } }.
    const missing = await lensRun("art", "artwork-create", { params: {} });
    assert.equal(missing.result?.ok, false);
    assert.match(String(missing.result?.error || missing.error || ""), /Name this canvas/);

    const named = await lensRun("art", "artwork-create", { params: { title: "Harbor Study" } });
    assert.equal(named.ok, true);
    assert.equal(named.result.artwork.title, "Harbor Study");
  });

  it("keeps makeCtx wired for the owner list path", () => {
    const ctx = ctxFor(makeCtx, OWNER);
    assert.equal(ctx.actor.id, OWNER);
  });
});
