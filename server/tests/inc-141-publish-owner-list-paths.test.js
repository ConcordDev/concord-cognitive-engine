// server/tests/inc-141-publish-owner-list-paths.test.js
//
// INC-141: (1) POST/DELETE /api/dtus/:id/publish accepted any member and any
// id, so a non-owner could push another user's private DTU into
// GET /api/public[/:id] and read its title + content. Publish now needs the
// DTU write rule (owner or platform admin role); others get the missing-DTU
// 404. (2) GET /api/dtus list rows carried artifact.diskPath /
// compressedPath; the wire copy now drops them.
//
// Run:
//   cd server && NODE_ENV=test nice -n 10 node --test --test-concurrency=2 --import=./tests/preload/no-egress.mjs tests/inc-141-publish-owner-list-paths.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { publishableDtuForCaller } from "../lib/public-lattice-access.js";
import { withPublicArtifact } from "../lib/artifact-access.js";
import registerDtuRoutes from "../routes/dtus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const OWNER = "owner-141-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER = "other-141-aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
const priv = { id: "dtu_141_private", title: "secret", content: "body", ownerId: OWNER, visibility: "private" };
const authorOnly = { id: "dtu_141_author", title: "t", author: OWNER, scope: "user" };
const system = { id: "dtu_141_system", title: "sys", ownerId: "system", visibility: "public" };
const store = new Map([priv, authorOnly, system].map((d) => [d.id, d]));
const ctxOf = (id, role = "member") => ({ actor: { id, userId: id, role } });

describe("INC-141 publishableDtuForCaller", () => {
  const opts = { authMode: "hybrid" };
  it("owner may publish their DTU (ownerId or author)", () => {
    assert.equal(publishableDtuForCaller(store, priv.id, ctxOf(OWNER), opts), priv);
    assert.equal(publishableDtuForCaller(store, authorOnly.id, ctxOf(OWNER), opts), authorOnly);
  });
  it("another member gets null (route answers 404 like a missing id)", () => {
    assert.equal(publishableDtuForCaller(store, priv.id, ctxOf(OTHER), opts), null);
    assert.equal(publishableDtuForCaller(store, authorOnly.id, ctxOf(OTHER), opts), null);
    assert.equal(publishableDtuForCaller(store, "dtu_missing", ctxOf(OTHER), opts), null);
  });
  it("anonymous gets null", () => {
    assert.equal(publishableDtuForCaller(store, priv.id, { actor: { userId: "anon", role: "anon" } }, opts), null);
    assert.equal(publishableDtuForCaller(store, priv.id, {}, opts), null);
  });
  it("platform admin roles keep the access dtu.update already grants", () => {
    for (const role of ["owner", "admin", "founder", "sovereign"]) {
      assert.equal(publishableDtuForCaller(store, priv.id, ctxOf("adm-1", role), opts), priv, role);
    }
  });
  it("ownerless/system DTUs are admin-only", () => {
    assert.equal(publishableDtuForCaller(store, system.id, ctxOf(OTHER), opts), null);
    assert.equal(publishableDtuForCaller(store, system.id, ctxOf("adm-1", "admin"), opts), system);
  });
});

describe("INC-141 server.js publish routes use the gate", () => {
  for (const method of ["post", "delete"]) {
    it(`${method.toUpperCase()} /api/dtus/:id/publish checks ownership before touching the lattice`, () => {
      const sig = `app.${method}("/api/dtus/:id/publish"`;
      const start = SERVER_SRC.indexOf(sig);
      assert.ok(start > 0, "route not found");
      assert.equal(SERVER_SRC.indexOf(sig, start + 1), -1, "single registration");
      const head = SERVER_SRC.slice(start, start + 300);
      const gate = head.indexOf("if (!_publishableDtuOr404(req, res)) return;");
      const act = head.search(/(publishDTU|unpublishDTU)\(req\.params\.id\)/);
      assert.ok(gate > 0 && act > gate, "gate runs before publish/unpublish");
    });
  }
  it("the gate is the DTU write rule with a missing-DTU 404", () => {
    assert.match(SERVER_SRC, /publishableDtuForCaller\(STATE\.dtus, req\.params\.id, makeCtx\(req\), \{ authMode: AUTH_MODE \}\)/);
    const start = SERVER_SRC.indexOf("function _publishableDtuOr404(");
    assert.match(SERVER_SRC.slice(start, start + 400), /res\.status\(404\)\.json\(\{ ok: false, error: "DTU not found" \}\)/);
  });
});

describe("INC-141 dtu.get sidecar branch uses the wire presenter", () => {
  it("the sidecar hit returns _presentDtuPublic(r.dtu, ctx), never the raw row", () => {
    const start = SERVER_SRC.indexOf('register("dtu", "get"');
    assert.ok(start > 0);
    const end = SERVER_SRC.indexOf("register(", start + 10);
    const body = SERVER_SRC.slice(start, end);
    assert.doesNotMatch(body, /return \{ ok: true, dtu: r\.dtu \}/);
    assert.match(body, /return \{ ok: true, dtu: _presentDtuPublic\(r\.dtu, ctx\) \}/);
    assert.match(body, /return \{ ok: true, dtu: _presentDtuPublic\(dtu, ctx\) \}/);
  });
});

describe("INC-141 GET /api/dtus has no disk paths", () => {
  const artifact = {
    type: "image/png", filename: "a.png", sizeBytes: 70, hash: "sha256:x",
    diskPath: "/srv/concord/data/artifacts/a/a.png",
    compressedPath: "/srv/concord/data/artifacts/a/a.png.gz",
    thumbnail: "/srv/concord/data/artifacts/a/thumb.jpg",
  };
  const rows = [
    { id: "dtu_with_art", title: "art", ownerId: OWNER, artifact },
    { id: "dtu_plain", title: "plain", ownerId: OWNER },
  ];
  let app;
  before(() => {
    app = express();
    registerDtuRoutes(app, {
      STATE: { dtus: new Map(rows.map((r) => [r.id, r])) },
      makeCtx: () => ({ actor: { id: OWNER, userId: OWNER, role: "member" } }),
      async runMacro(_d, name) {
        if (name !== "list") return { ok: false, error: "unexpected" };
        return { ok: true, dtus: rows, total: rows.length, limit: 50, offset: 0 };
      },
      dtuForClient: (d) => d,
      dtusArray: () => rows,
      userVisibleDTUs: () => rows,
      _withAck: (fn) => fn,
      _saveStateDebounced: () => {},
      validate: () => (_q, _s, n) => n(),
      requireRole: () => (_q, _s, n) => n(),
    });
  });

  it("list rows drop diskPath/compressedPath, keep metadata; storage untouched", async () => {
    const server = app.listen(0);
    try {
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/api/dtus?limit=50`);
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.doesNotMatch(text, /\/srv\/concord/);
      assert.doesNotMatch(text, /diskPath|compressedPath/);
      const body = JSON.parse(text);
      assert.equal(body.total, 2);
      assert.equal(body.dtus[0].artifact.filename, "a.png");
      assert.equal(body.dtus[0].artifact.sizeBytes, 70);
      assert.equal(body.dtus[0].artifact.thumbnail, true);
      assert.equal(body.dtus[1].artifact, undefined);
      assert.equal(rows[0].artifact.diskPath, "/srv/concord/data/artifacts/a/a.png");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("withPublicArtifact leaves artifact-less rows as the same object", () => {
    assert.equal(withPublicArtifact(rows[1]), rows[1]);
    assert.notEqual(withPublicArtifact(rows[0]), rows[0]);
    assert.equal(withPublicArtifact(null), null);
  });
});
