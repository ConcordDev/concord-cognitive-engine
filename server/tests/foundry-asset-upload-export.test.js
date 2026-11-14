/**
 * FIX-foundry-011 — asset file upload + foundry worlds in the export.
 *
 * Leg 1: asset_import was URL-only. It now also accepts a file upload
 * as a base64 dataUrl (paper's pdf-attach pattern), capped at ~6MB with
 * a named refusal; malformed uploads are refused; the URL path and the
 * neither-given refusal are unchanged.
 * Leg 2: foundry worlds live in the foundry_worlds SQL table and no
 * export provider was registered, so collectLensExport exported
 * nothing for the lens. The provider now returns the caller's worlds.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerFoundryMacros from "../domains/foundry.js";
import { up as up191 } from "../migrations/191_foundry_worlds.js";
import { up as up192 } from "../migrations/192_foundry_phase7.js";
import { collectLensExport } from "../lib/lens-export.js";
import { MAX_ASSET_DATA_URL_CHARS } from "../lib/foundry/builder-extras.js";

function collectMacros() {
  const map = new Map();
  registerFoundryMacros((domain, name, handler) => map.set(name, handler));
  return map;
}
const MACROS = collectMacros();
function call(name, ctx, input = {}) {
  const fn = MACROS.get(name);
  if (!fn) throw new Error(`foundry.${name} not registered`);
  return fn(ctx, input);
}
function freshDb() {
  const db = new Database(":memory:");
  up191(db);
  up192(db);
  return db;
}
function ctxFor(db, userId) {
  return { db, actor: userId ? { userId } : undefined };
}

const A = "user_a";
const B = "user_b";
let db;
beforeEach(() => {
  db = freshDb();
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("FIX-foundry-011 leg 1 — asset_import file upload", () => {
  it("imports an uploaded file (dataUrl) and lists it as an upload", () => {
    const id = call("create", ctxFor(db, A), { name: "Upload World" }).world.id;
    const r = call("asset_import", ctxFor(db, A), { id, kind: "texture", name: "Bricks", dataUrl: PNG_DATA_URL, tags: ["wall"] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.asset.source, "upload");
    assert.equal(r.asset.url, "");
    const listed = call("asset_list", ctxFor(db, A), { id });
    assert.equal(listed.count, 1);
    assert.equal(listed.assets[0].source, "upload");
  });

  it("refuses an oversize upload by name", () => {
    const id = call("create", ctxFor(db, A), { name: "Big World" }).world.id;
    const big = "data:model/gltf-binary;base64," + "A".repeat(MAX_ASSET_DATA_URL_CHARS + 16);
    const r = call("asset_import", ctxFor(db, A), { id, kind: "model", name: "Huge", dataUrl: big });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_asset");
    assert.ok(r.errors.some((e) => /6MB max/.test(e)), JSON.stringify(r.errors));
  });

  it("refuses a malformed upload", () => {
    const id = call("create", ctxFor(db, A), { name: "Bad Upload World" }).world.id;
    const r = call("asset_import", ctxFor(db, A), { id, kind: "model", name: "Nope", dataUrl: "not-a-data-url" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_asset");
  });

  it("the URL path and the neither-given refusal are unchanged", () => {
    const id = call("create", ctxFor(db, A), { name: "URL World" }).world.id;
    const byUrl = call("asset_import", ctxFor(db, A), { id, kind: "model", name: "Tree", url: "https://cdn.example/tree.glb" });
    assert.equal(byUrl.ok, true);
    assert.equal(byUrl.asset.source, "url");
    const neither = call("asset_import", ctxFor(db, A), { id, kind: "model", name: "NoUrl" });
    assert.equal(neither.ok, false);
    assert.equal(neither.reason, "invalid_asset");
  });
});

describe("FIX-foundry-011 leg 2 — foundry worlds ride the lens export", () => {
  it("collectLensExport returns the caller's worlds, and only theirs", async () => {
    const mine = call("create", ctxFor(db, A), { name: "Exportable Vale" }).world;
    call("create", ctxFor(db, B), { name: "Someone Elses World" });
    const runMacro = async () => ({ ok: true, artifacts: [] });
    const out = await collectLensExport({ runMacro, domain: "foundry", ctx: ctxFor(db, A) });
    assert.equal(out.ok, true, JSON.stringify(out));
    const titles = (out.rows || out.artifacts || []).map((r) => r.title);
    assert.ok(titles.includes("Exportable Vale"), `export carries the caller's world: ${JSON.stringify(titles)}`);
    assert.ok(!titles.includes("Someone Elses World"), "another creator's world never rides");
    const row = (out.rows || out.artifacts || []).find((r) => r.title === "Exportable Vale");
    assert.equal(row.id, mine.id);
    assert.equal(row.type, "world");
    assert.ok(row.data.worldspec, "the worldspec rides the export row");
  });

  it("an anonymous caller exports no worlds", async () => {
    call("create", ctxFor(db, A), { name: "Exportable Vale" });
    const runMacro = async () => ({ ok: true, artifacts: [] });
    const out = await collectLensExport({ runMacro, domain: "foundry", ctx: { db } });
    assert.equal(out.ok, true, JSON.stringify(out));
    const rows = out.rows || out.artifacts || [];
    assert.equal(rows.filter((r) => r.domain === "foundry").length, 0);
  });
});
