// server/tests/document-domain.test.js
//
// domains/document.js — document.create / document.export_dtu /
// document.read_zip. Real end-to-end: mints real DTUs, stores real files
// via artifact-store.js, reads them back. ARTIFACT_DIR is pointed at a
// throwaway temp dir so this never touches real server data.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-doc-domain-test-"));
process.env.ARTIFACT_DIR = tmpDir;

const { default: registerDocumentActions } = await import("../domains/document.js");

function setup() {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  const registry = new Map();
  registerDocumentActions((domain, name, handler) => registry.set(`${domain}.${name}`, handler));
  return registry;
}

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("document.create mints a real DTU and stores a real PDF artifact", async () => {
  const registry = setup();
  const ctx = { actor: { userId: "u1" } };
  const r = await registry.get("document.create")(ctx, {
    title: "Blueprint v1", format: "pdf", summary: "A real blueprint.", claims: ["load-bearing wall at x=4"],
  });
  assert.equal(r.ok, true);
  assert.equal(r.mimeType, "application/pdf");
  assert.ok(r.dtuId.startsWith("dtu_doc_"));
  assert.equal(r.downloadUrl, `/api/artifact/${r.dtuId}/download`);

  const dtu = globalThis._concordSTATE.dtus.get(r.dtuId);
  assert.ok(dtu, "the DTU must actually exist in STATE.dtus");
  assert.equal(dtu.title, "Blueprint v1");
  assert.equal(dtu.artifact.type, "application/pdf");
  assert.ok(fs.existsSync(dtu.artifact.diskPath), "the file must actually be on disk");
});

test("document.create with format:zip and files builds a real multi-file zip", async () => {
  const registry = setup();
  const ctx = { actor: { userId: "u1" } };
  const r = await registry.get("document.create")(ctx, {
    title: "Project Bundle", format: "zip",
    files: [{ name: "readme.md", content: "# Hi" }, { name: "data.json", content: "{\"a\":1}" }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.mimeType, "application/zip");

  const read = await registry.get("document.read_zip")(ctx, { dtuId: r.dtuId });
  assert.equal(read.ok, true);
  assert.deepEqual(read.entries.map((e) => e.name).sort(), ["data.json", "readme.md"]);
});

test("document.export_dtu renders an EXISTING DTU into a companion export DTU with real content", async () => {
  const registry = setup();
  const ctx = { actor: { userId: "u1" } };
  globalThis._concordSTATE.dtus.set("dtu_source1", {
    id: "dtu_source1", title: "My Research Note", domain: "research", tags: ["note"],
    ownerId: "u1", visibility: "private", createdAt: new Date().toISOString(),
    human: { summary: "Findings on X.", bullets: [] },
    core: { claims: ["X is true"], definitions: [], invariants: [], examples: [], nextActions: [] },
    machine: {},
  });

  const r = await registry.get("document.export_dtu")(ctx, { dtuId: "dtu_source1", format: "md" });
  assert.equal(r.ok, true);
  assert.equal(r.sourceDtuId, "dtu_source1");
  assert.notEqual(r.dtuId, "dtu_source1", "export creates a NEW DTU, never overwrites the source");

  const exportDtu = globalThis._concordSTATE.dtus.get(r.dtuId);
  assert.equal(exportDtu.machine.sourceDtuId, "dtu_source1");
  const buf = fs.readFileSync(exportDtu.artifact.diskPath);
  assert.match(buf.toString("utf-8"), /Findings on X\./);
});

test("document.export_dtu denies exporting another user's private DTU (no fabricated success)", async () => {
  const registry = setup();
  globalThis._concordSTATE.dtus.set("dtu_private1", {
    id: "dtu_private1", title: "Private", ownerId: "owner_a", visibility: "private", tags: [],
    human: {}, core: {}, machine: {},
  });
  const r = await registry.get("document.export_dtu")({ actor: { userId: "attacker" } }, { dtuId: "dtu_private1", format: "pdf" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "forbidden");
});

test("document.export_dtu allows exporting a public DTU regardless of owner", async () => {
  const registry = setup();
  globalThis._concordSTATE.dtus.set("dtu_public1", {
    id: "dtu_public1", title: "Public Doc", ownerId: "owner_a", visibility: "public", tags: [],
    human: { summary: "s" }, core: {}, machine: {},
  });
  const r = await registry.get("document.export_dtu")({ actor: { userId: "someone_else" } }, { dtuId: "dtu_public1", format: "json" });
  assert.equal(r.ok, true);
});

test("document.export_dtu fails honestly for a nonexistent DTU", async () => {
  const registry = setup();
  const r = await registry.get("document.export_dtu")({ actor: { userId: "u1" } }, { dtuId: "dtu_does_not_exist", format: "pdf" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "dtu_not_found");
});

test("document.export_dtu fails honestly for an unsupported format (docx)", async () => {
  const registry = setup();
  globalThis._concordSTATE.dtus.set("dtu_x", { id: "dtu_x", title: "X", ownerId: "u1", human: {}, core: {}, machine: {} });
  const r = await registry.get("document.export_dtu")({ actor: { userId: "u1" } }, { dtuId: "dtu_x", format: "docx" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "unsupported_format");
});

test("document.read_zip refuses to read a non-zip artifact as a zip", async () => {
  const registry = setup();
  const ctx = { actor: { userId: "u1" } };
  const created = await registry.get("document.create")(ctx, { title: "Just a PDF", format: "pdf" });
  const r = await registry.get("document.read_zip")(ctx, { dtuId: created.dtuId });
  assert.equal(r.ok, false);
  assert.equal(r.error, "not_a_zip_artifact");
});

test("document.read_zip on a missing entry reports it honestly, listing what IS available", async () => {
  const registry = setup();
  const ctx = { actor: { userId: "u1" } };
  const created = await registry.get("document.create")(ctx, {
    title: "Bundle", format: "zip", files: [{ name: "real.txt", content: "hi" }],
  });
  const r = await registry.get("document.read_zip")(ctx, { dtuId: created.dtuId, entryName: "ghost.txt" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "entry_not_found");
  assert.deepEqual(r.entries, ["real.txt"]);
});
