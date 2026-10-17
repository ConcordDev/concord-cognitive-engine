// ARTIFACTS-AUTHZ regression test.
//
// Pins ownership/visibility rules on /api/artifacts:
//   - public artifacts are readable (and downloadable) by anyone, including anonymous
//   - private artifacts are readable only by their owner or an admin
//   - non-owners/admins get 404 on private reads (no existence leak)
//   - anonymous callers get 401 on private reads
//   - only the owner or an admin can delete an artifact
//   - upload identity comes from req.user only; body/query userId is ignored
//   - list returns public artifacts plus the caller's own, never others' private ones

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import express from "express";

let tmpDir;
let uploadDir;
let db;
let app;
let server;
let baseUrl;
let createArtifactsRouter;

function makeFakeRequireAuth() {
  return () => (req, res, next) => {
    if (req.user?.id) return next();
    return res.status(401).json({ ok: false, error: "auth_required" });
  };
}

function authMiddleware(req, res, next) {
  const h = req.headers["x-test-user"];
  if (h) {
    req.user = { id: h, role: h === "admin" ? "admin" : undefined };
  } else {
    req.user = null;
  }
  next();
}

function freshApp() {
  const router = createArtifactsRouter({ db, requireAuth: makeFakeRequireAuth(), STATE: {} });
  const application = express();
  application.use(express.json({ limit: "10mb" }));
  application.use(authMiddleware);
  application.use("/api/artifacts", router);
  return application;
}

async function listen(app) {
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      resolve({ server: srv, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function headers(user) {
  const h = { "content-type": "application/json" };
  if (user) h["x-test-user"] = user;
  return h;
}

async function upload(user, { name = "file.txt", content, visibility = "private", userId } = {}) {
  const body = { name, content, visibility };
  if (userId !== undefined) body.userId = userId;
  const res = await fetch(`${baseUrl}/api/artifacts/upload`, {
    method: "POST",
    headers: headers(user),
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function getMeta(user, id) {
  const res = await fetch(`${baseUrl}/api/artifacts/${id}`, { headers: headers(user) });
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.json() };
}

async function getInfo(user, id) {
  const res = await fetch(`${baseUrl}/api/artifacts/${id}/info`, { headers: headers(user) });
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.json() };
}

async function download(user, id) {
  const res = await fetch(`${baseUrl}/api/artifacts/${id}/download`, { headers: headers(user) });
  const body = res.status === 200 ? Buffer.from(await res.arrayBuffer()) : await res.json();
  return { status: res.status, body };
}

async function del(user, id) {
  const res = await fetch(`${baseUrl}/api/artifacts/${id}`, { method: "DELETE", headers: headers(user) });
  return { status: res.status, body: await res.json() };
}

async function list(user) {
  const res = await fetch(`${baseUrl}/api/artifacts`, { headers: headers(user) });
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifacts-authz-"));
  uploadDir = path.join(tmpDir, "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  process.env.ARTIFACTS_DIR = uploadDir;

  db = new Database(":memory:");
  ({ default: createArtifactsRouter } = await import("../routes/artifacts.js"));

  app = freshApp();
  const listening = await listen(app);
  server = listening.server;
  baseUrl = listening.baseUrl;
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) db.close();
  delete process.env.ARTIFACTS_DIR;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("ARTIFACTS-AUTHZ", () => {
  it("upload requires login and stamps identity from req.user only", async () => {
    const content = Buffer.from("alice secret").toString("base64");

    // anonymous upload is rejected by requireAuth()
    const anon = await upload(null, { name: "x.txt", content });
    assert.equal(anon.status, 401);
    assert.equal(anon.body.ok, false);

    // logged-in upload succeeds; spoofed body.userId is ignored
    const owner = await upload("alice", { name: "x.txt", content, visibility: "private", userId: "victim" });
    assert.equal(owner.status, 200);
    assert.equal(owner.body.ok, true);
    assert.equal(typeof owner.body.artifactId, "string");

    const row = db.prepare("SELECT created_by, visibility FROM route_artifacts WHERE artifact_id = ?").get(owner.body.artifactId);
    assert.equal(row.created_by, "alice", "body userId must not spoof identity");
    assert.equal(row.visibility, "private");
  });

  it("owner can read, info, download and delete own artifacts", async () => {
    const content = Buffer.from("owner content").toString("base64");
    const { body: up } = await upload("alice", { name: "owned.txt", content, visibility: "private" });
    const id = up.artifactId;

    const meta = await getMeta("alice", id);
    assert.equal(meta.status, 200);
    assert.equal(meta.body.ok, true);
    assert.equal(meta.body.artifact.createdBy, "alice");
    assert.equal(meta.body.artifact.visibility, "private");

    const info = await getInfo("alice", id);
    assert.equal(info.status, 200);
    assert.equal(info.body.ok, true);
    assert.equal(info.body.artifact.visibility, "private");

    const dl = await download("alice", id);
    assert.equal(dl.status, 200);
    assert.deepEqual(dl.body, Buffer.from("owner content"));

    const removed = await del("alice", id);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.ok, true);

    const gone = await getMeta("alice", id);
    assert.equal(gone.status, 404);
  });

  it("account B cannot read/info/download A's private artifact (404, row + bytes intact)", async () => {
    const content = Buffer.from("alice private").toString("base64");
    const { body: up } = await upload("alice", { name: "private.txt", content, visibility: "private" });
    const id = up.artifactId;

    const meta = await getMeta("bob", id);
    assert.equal(meta.status, 404);
    assert.equal(meta.body.ok, false);

    const info = await getInfo("bob", id);
    assert.equal(info.status, 404);

    const dl = await download("bob", id);
    assert.equal(dl.status, 404);

    // Row and bytes are unchanged.
    const row = db.prepare("SELECT content_b64 FROM route_artifacts WHERE artifact_id = ?").get(id);
    assert.ok(row);
    assert.equal(Buffer.from(row.content_b64, "base64").toString(), "alice private");
  });

  it("anonymous caller is refused on private artifact (401) but can download public", async () => {
    const privateContent = Buffer.from("alice private").toString("base64");
    const publicContent = Buffer.from("alice public").toString("base64");
    const { body: privUp } = await upload("alice", { name: "private.txt", content: privateContent, visibility: "private" });
    const { body: pubUp } = await upload("alice", { name: "public.txt", content: publicContent, visibility: "public" });

    const privateMeta = await getMeta(null, privUp.artifactId);
    assert.equal(privateMeta.status, 401);
    assert.equal(privateMeta.body.error, "auth_required");

    const privateInfo = await getInfo(null, privUp.artifactId);
    assert.equal(privateInfo.status, 401);

    const privateDl = await download(null, privUp.artifactId);
    assert.equal(privateDl.status, 401);

    const publicDl = await download(null, pubUp.artifactId);
    assert.equal(publicDl.status, 200);
    assert.deepEqual(publicDl.body, Buffer.from("alice public"));
  });

  it("B can download A's public artifact but cannot delete it", async () => {
    const content = Buffer.from("public bytes").toString("base64");
    const { body: up } = await upload("alice", { name: "public.txt", content, visibility: "public" });
    const id = up.artifactId;

    const dl = await download("bob", id);
    assert.equal(dl.status, 200);
    assert.deepEqual(dl.body, Buffer.from("public bytes"));

    const removal = await del("bob", id);
    assert.equal(removal.status, 403);
    assert.equal(removal.body.ok, false);
    assert.equal(removal.body.error, "forbidden");

    const row = db.prepare("SELECT artifact_id FROM route_artifacts WHERE artifact_id = ?").get(id);
    assert.ok(row, "public row must remain after non-owner delete attempt");
  });

  it("admin can delete another user's artifact", async () => {
    const content = Buffer.from("admin target").toString("base64");
    const { body: up } = await upload("alice", { name: "admin-delete.txt", content, visibility: "private" });
    const id = up.artifactId;

    const removal = await del("admin", id);
    assert.equal(removal.status, 200);
    assert.equal(removal.body.ok, true);

    const gone = db.prepare("SELECT COUNT(*) AS n FROM route_artifacts WHERE artifact_id = ?").get(id);
    assert.equal(gone.n, 0);
  });

  it("non-owner cannot delete a disk-stored private artifact; owner delete removes the file", async () => {
    const content = Buffer.alloc(1024 * 1024 + 128, 0x42).toString("base64");
    const { body: up } = await upload("alice", { name: "big.bin", content, visibility: "private" });
    const id = up.artifactId;

    const rowBefore = db.prepare("SELECT storage_path FROM route_artifacts WHERE artifact_id = ?").get(id);
    assert.equal(rowBefore.storage_path ? "disk" : "inline", "disk");
    assert.ok(fs.existsSync(rowBefore.storage_path), "disk file exists after upload");

    const blocked = await del("bob", id);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, "forbidden");
    assert.ok(fs.existsSync(rowBefore.storage_path), "disk file must remain after non-owner delete");

    const ownerDel = await del("alice", id);
    assert.equal(ownerDel.status, 200);
    assert.ok(!fs.existsSync(rowBefore.storage_path), "disk file must be removed after owner delete");
  });

  it("list returns public artifacts plus the caller's own, never others' private ones", async () => {
    const aPrivate = Buffer.from("a private").toString("base64");
    const aPublic = Buffer.from("a public").toString("base64");
    const bPrivate = Buffer.from("b private").toString("base64");

    const { body: aPriv } = await upload("alice", { name: "a-priv.txt", content: aPrivate, visibility: "private" });
    const { body: aPub } = await upload("alice", { name: "a-pub.txt", content: aPublic, visibility: "public" });
    const { body: bPriv } = await upload("bob", { name: "b-priv.txt", content: bPrivate, visibility: "private" });

    // Anonymous list: only public artifact.
    const anonList = await list(null);
    assert.equal(anonList.status, 200);
    const anonIds = anonList.body.artifacts.map((a) => a.artifactId);
    assert.deepEqual(anonIds, [aPub.artifactId]);

    // Bob's list: his own private + Alice's public, not Alice's private.
    const bobList = await list("bob");
    assert.equal(bobList.status, 200);
    const bobIds = bobList.body.artifacts.map((a) => a.artifactId).sort();
    assert.deepEqual(bobIds, [aPub.artifactId, bPriv.artifactId].sort());

    // Alice's list: both of hers, not Bob's private.
    const aliceList = await list("alice");
    assert.equal(aliceList.status, 200);
    const aliceIds = aliceList.body.artifacts.map((a) => a.artifactId).sort();
    assert.deepEqual(aliceIds, [aPriv.artifactId, aPub.artifactId].sort());

    // Admin list matches single-artifact read: admins see private artifacts too.
    const adminList = await list("admin");
    assert.equal(adminList.status, 200);
    const adminIds = adminList.body.artifacts.map((a) => a.artifactId).sort();
    assert.deepEqual(adminIds, [aPriv.artifactId, aPub.artifactId, bPriv.artifactId].sort());
  });
});
