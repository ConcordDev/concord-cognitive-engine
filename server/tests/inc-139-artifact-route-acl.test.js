// server/tests/inc-139-artifact-route-acl.test.js
//
// INC-139: /api/artifact/:dtuId/{download,stream,info,thumbnail} returned a
// private DTU's artifact to other accounts and to logged-out callers. They
// now use the same read gate as GET /api/dtus/:id, and DTU payloads no longer
// carry absolute server disk paths.
//
// Run:
//   cd server && NODE_ENV=test nice -n 10 node --test --test-concurrency=2 --import=./tests/preload/no-egress.mjs tests/inc-139-artifact-route-acl.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { artifactDtuForViewer, publicArtifactRef } from "../lib/artifact-access.js";
import registerDocumentActions from "../domains/document.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const artifact = {
  type: "text/markdown",
  filename: "report.md",
  diskPath: "/srv/concord/server/data/artifacts/abc/report.md",
  compressedPath: "/srv/concord/server/data/artifacts/abc/report.md.gz",
  transcodedPath: null,
  thumbnail: "/srv/concord/server/data/artifacts/abc/thumb.jpg",
  preview: null,
  sizeBytes: 1885,
  hash: "sha256:abc",
  multipart: false,
  parts: null,
  derivatives: { webp: "/srv/concord/derivatives/abc/x.webp" },
};

// The shape document.create stamps on a background research report.
const privateDoc = { id: "dtu_doc_private", ownerId: "user_a", visibility: "private", artifact };
const publicDoc = { id: "dtu_doc_public", ownerId: "user_a", visibility: "public", scope: "global", artifact };
const scopedDoc = { id: "dtu_scoped", author: "user_a", scope: "user", artifact };
const internalDoc = { id: "dtu_internal", visibility: "internal", artifact };
const shadowDoc = { id: "dtu_shadow", tier: "shadow", visibility: "public", artifact };
const store = new Map([privateDoc, publicDoc, scopedDoc, internalDoc, shadowDoc].map((d) => [d.id, d]));
const isShadow = (d) => d.tier === "shadow";

const owner = { actor: { id: "user_a", userId: "user_a" } };
const ownerUserIdOnly = { actor: { userId: "user_a" } };
const other = { actor: { id: "user_b", userId: "user_b" } };
const anon = { actor: { userId: "anon" } };
const none = {};

describe("INC-139 artifactDtuForViewer", () => {
  it("private DTU: owner gets it, another account and anon do not", () => {
    assert.equal(artifactDtuForViewer(store, privateDoc.id, owner, { isShadow }), privateDoc);
    assert.equal(artifactDtuForViewer(store, privateDoc.id, ownerUserIdOnly, { isShadow }), privateDoc);
    assert.equal(artifactDtuForViewer(store, privateDoc.id, other, { isShadow }), null);
    assert.equal(artifactDtuForViewer(store, privateDoc.id, anon, { isShadow }), null);
    assert.equal(artifactDtuForViewer(store, privateDoc.id, none, { isShadow }), null);
  });

  it("scope:user DTU owned via author is owner-only", () => {
    assert.equal(artifactDtuForViewer(store, scopedDoc.id, owner, { isShadow }), scopedDoc);
    assert.equal(artifactDtuForViewer(store, scopedDoc.id, other, { isShadow }), null);
    assert.equal(artifactDtuForViewer(store, scopedDoc.id, none, { isShadow }), null);
  });

  it("public DTU stays readable by everyone", () => {
    for (const ctx of [owner, other, anon, none]) {
      assert.equal(artifactDtuForViewer(store, publicDoc.id, ctx, { isShadow }), publicDoc);
    }
  });

  it("internal and shadow DTUs are hidden; missing ids are null", () => {
    assert.equal(artifactDtuForViewer(store, internalDoc.id, other, { isShadow }), null);
    assert.equal(artifactDtuForViewer(store, shadowDoc.id, other, { isShadow }), null);
    assert.equal(artifactDtuForViewer(store, "nope", owner, { isShadow }), null);
    assert.equal(artifactDtuForViewer(null, privateDoc.id, owner), null);
  });

  it("server-internal ctx bypasses the private gate (same as dtu.get)", () => {
    assert.equal(artifactDtuForViewer(store, privateDoc.id, { internal: true }, { isShadow }), privateDoc);
  });
});

describe("INC-139 server.js artifact routes use the gate", () => {
  for (const sub of ["thumbnail", "stream", "download", "info"]) {
    it(`/api/artifact/:dtuId/${sub} reads through _artifactDtuForReq`, () => {
      const start = SERVER_SRC.indexOf(`app.get("/api/artifact/:dtuId/${sub}"`);
      assert.ok(start > 0, `route ${sub} not found`);
      // Exactly one registration per route.
      assert.equal(SERVER_SRC.indexOf(`app.get("/api/artifact/:dtuId/${sub}"`, start + 1), -1);
      const head = SERVER_SRC.slice(start, start + 400);
      assert.match(head, /const dtu = _artifactDtuForReq\(req\);/);
      assert.doesNotMatch(head, /STATE\.dtus\.get\(req\.params\.dtuId\)/);
    });
  }

  it("the gate is the by-id read predicate with the shadow filter", () => {
    assert.match(
      SERVER_SRC,
      /function _artifactDtuForReq\(req\) \{\s*return artifactDtuForViewer\(STATE\.dtus, req\.params\.dtuId, makeCtx\(req\), \{ isShadow: isShadowDTU \}\);/,
    );
  });

  it("_presentDtuPublic strips artifact disk paths", () => {
    const start = SERVER_SRC.indexOf("function _presentDtuPublic(");
    const body = SERVER_SRC.slice(start, start + 900);
    assert.match(body, /out\.artifact = publicArtifactRef\(out\.artifact\)/);
  });
});

describe("INC-139 publicArtifactRef", () => {
  it("drops absolute paths and keeps metadata", () => {
    const out = publicArtifactRef(artifact);
    const wire = JSON.stringify(out);
    assert.doesNotMatch(wire, /\/srv\/concord/);
    assert.equal(out.diskPath, undefined);
    assert.equal(out.compressedPath, undefined);
    assert.equal(out.transcodedPath, undefined);
    assert.equal(out.thumbnail, true);
    assert.equal(out.preview, null);
    assert.deepEqual(out.derivatives, { webp: true });
    assert.equal(out.filename, "report.md");
    assert.equal(out.sizeBytes, 1885);
    assert.equal(out.hash, "sha256:abc");
    // Storage is untouched.
    assert.equal(artifact.diskPath, "/srv/concord/server/data/artifacts/abc/report.md");
  });

  it("strips multipart part paths", () => {
    const out = publicArtifactRef({
      multipart: true, diskPath: "/srv/x", thumbnail: "/srv/x/a.png",
      parts: [{ filename: "a.png", type: "image/png", diskPath: "/srv/x/a.png", sizeBytes: 3 }],
    });
    assert.doesNotMatch(JSON.stringify(out), /\/srv\//);
    assert.deepEqual(out.parts, [{ filename: "a.png", type: "image/png", sizeBytes: 3 }]);
  });

  it("passes non-objects through", () => {
    assert.equal(publicArtifactRef(null), null);
    assert.equal(publicArtifactRef(undefined), undefined);
  });
});

describe("INC-139 document.export_dtu / read_zip use the by-id gate", () => {
  const actions = new Map();
  registerDocumentActions((domain, name, fn) => { actions.set(name, fn); });

  it("another account cannot export a private DTU owned via author only", async () => {
    const prev = globalThis._concordSTATE;
    globalThis._concordSTATE = { dtus: new Map([[scopedDoc.id, { ...scopedDoc, title: "secret", human: { summary: "s" } }]]) };
    try {
      const r = await actions.get("export_dtu")(other, { dtuId: scopedDoc.id, format: "md" });
      assert.equal(r.ok, false);
      assert.equal(r.error, "forbidden");
      const z = await actions.get("read_zip")(other, { dtuId: scopedDoc.id });
      assert.equal(z.ok, false);
      assert.equal(z.error, "forbidden");
    } finally {
      globalThis._concordSTATE = prev;
    }
  });
});
