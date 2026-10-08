// ConKay OCC routes must not let a request choose file paths.
//
// The OCC CLI treats `out`, `path`, `keep_path` and `tmp_path` in its payload
// as filesystem paths. POST /api/conkay/occ/feature-rebuild used to pass the
// request body straight through, so any signed-in user picked where the
// server wrote a STEP file. The STEP import routes also opened any existing
// file whose path was posted as the "step" text.
//
// A stand-in CLI (node running a script that echoes its payload) shows
// exactly what each route hands to the CLI.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import Database from "better-sqlite3";
import { createAssembly } from "../lib/conkay/assembly-store.js";
import createConkayAssemblyRouter from "../routes/conkay-assembly.js";
import { confineRequestPayload, importBrepStepToAssembly, brepDataDir } from "../lib/conkay/occ-bridge.js";

let server;
let base;
let tmp;
const saved = {};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "occ-confine-"));
  const cli = path.join(tmp, "echo-cli.mjs");
  fs.writeFileSync(cli, "const [cmd, json] = process.argv.slice(2);\nconsole.log(JSON.stringify({ ok: true, cmd, received: JSON.parse(json) }));\n");
  for (const k of ["CONKAY_OCC_PYTHON", "CONKAY_OCC_CLI", "CONCORD_OCC_DAEMON_DISABLE", "DATA_DIR"]) saved[k] = process.env[k];
  process.env.CONKAY_OCC_PYTHON = process.execPath;
  process.env.CONKAY_OCC_CLI = cli;
  process.env.CONCORD_OCC_DAEMON_DISABLE = "1";
  process.env.DATA_DIR = path.join(tmp, "data");

  const app = express();
  app.use(express.json());
  app.use("/api/conkay", createConkayAssemblyRouter({ requireAuth: (_req, _res, next) => next(), db: null }));
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/conkay`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function post(route, body) {
  const r = await fetch(base + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

const HOSTILE = { out: "/etc/evil.step", path: "/etc/evil.step", keep_path: "/tmp/x", tmp_path: "/tmp/y", outDir: "/", features: [{ id: "f1", op: "box" }], include_mesh: false };

describe("OCC routes confine file paths", () => {
  it("feature-rebuild writes only into the server's brep directory", async () => {
    const r = await post("/occ/feature-rebuild", HOSTILE);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const got = r.body.received;
    const dir = path.join(brepDataDir(), "requests");
    assert.ok(got.out.startsWith(dir + path.sep), got.out);
    assert.match(path.basename(got.out), /^feature-rebuild-[0-9a-f-]{36}\.step$/);
    for (const k of ["path", "keep_path", "tmp_path", "outDir"]) assert.equal(got[k], undefined, k);
    assert.deepEqual(got.features, HOSTILE.features, "the rest of the body still goes through");
  });

  for (const [route, writes] of [
    ["/occ/sketch-extrude", "sketch-extrude"], ["/occ/mate-solids", "mate-solids"],
    ["/occ/mate-solve-dof", "mate-solve-dof"], ["/occ/sketch-solve", "sketch-solve"],
  ]) {
    it(`${route} writes only into the server's brep directory`, async () => {
      const r = await post(route, HOSTILE);
      assert.ok(r.body.received.out.includes(`${path.sep}requests${path.sep}${writes}-`), r.body.received.out);
      assert.equal(r.body.received.path, undefined);
    });
  }

  for (const route of ["/occ/feature-create", "/occ/feature-append", "/occ/feature-undo", "/occ/measure", "/occ/gdt-digital", "/occ/feature-list"]) {
    it(`${route} passes no caller path at all`, async () => {
      const r = await post(route, { ...HOSTILE, partId: "p1" });
      for (const k of ["out", "path", "keep_path", "tmp_path", "outDir"]) assert.equal(r.body.received?.[k], undefined, `${route} ${k}`);
    });
  }

  it("each request gets its own output file", () => {
    const a = confineRequestPayload({}, { writes: "x" }).out;
    const b = confineRequestPayload({}, { writes: "x" }).out;
    assert.notEqual(a, b);
  });
});

describe("STEP import never opens a posted path", () => {
  it("a file path posted as STEP text is refused, not read", async () => {
    const secret = path.join(tmp, "secret.txt");
    fs.writeFileSync(secret, "not for you");
    const db = new Database(":memory:");
    const asm = createAssembly(db, { name: "a", ownerId: "u1" });
    const r = await importBrepStepToAssembly(db, asm.id, secret, {});
    assert.equal(r.ok, false);
    assert.equal(r.code, "MISSING_STEP");
  });
});
