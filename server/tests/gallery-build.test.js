// Build tests for the Gallery fix return (B2) — F7: the export READ.
// The shared export (lib/lens-export.js collectLensExport) merges
// canonical lens artifacts with the domain's registered provider rows.
// Gallery registers a provider over the caller's hung works, keyed by
// the wired DTU id the hang mints. Mirrors the parity harness.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGalleryActions from "../domains/gallery.js";
import {
  collectLensExport,
  hasLensExportProvider,
} from "../lib/lens-export.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`gallery.${name}`);
  assert.ok(fn, `gallery.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerGalleryActions(register);
});
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// The export read's artifact half: no canonical lens artifacts stand
// for gallery, exactly as in production — the provider is the read.
const noArtifacts = async (domain, action) => {
  assert.equal(domain, "lens");
  assert.equal(action, "list");
  return { ok: true, artifacts: [], total: 0 };
};

describe("gallery F7 — export provider", () => {
  it("the gallery provider is registered by the domain", () => {
    assert.equal(hasLensExportProvider("gallery"), true);
  });

  it("a hung work exports under the DTU id its hang minted", async () => {
    const mintCtx = {
      ...ctxA,
      runMacro: async (domain, name, input) => {
        assert.equal(domain, "dtu");
        assert.equal(name, "create");
        assert.match(input.title, /Still Life/);
        return { ok: true, dtu: { id: "dtu_gallery_1" } };
      },
    };
    const saved = await call("artwork-save", mintCtx, { title: "Still Life", image: "https://img.example/s.jpg" });
    assert.equal(saved.result.artwork.dtuId, "dtu_gallery_1");

    const out = await collectLensExport({ runMacro: noArtifacts, domain: "gallery", ctx: ctxA, limit: 100 });
    assert.equal(out.ok, true);
    assert.equal(out.stateBacked, true);
    assert.equal(out.sources.stateRecords, 1);
    assert.equal(out.artifacts.length, 1);
    const row = out.artifacts[0];
    assert.equal(row.id, "dtu_gallery_1");
    assert.equal(row.type, "gallery-artwork");
    assert.equal(row.title, "Still Life");
    assert.equal(row.data.dtuId, "dtu_gallery_1");
    assert.equal(row.data.artworkId, saved.result.artwork.id);
    assert.equal(row.data.image, "https://img.example/s.jpg");
  });

  it("the export is scoped to the caller — another account's read is honestly empty", async () => {
    await call("artwork-save", ctxA, { title: "Mine" });
    const outB = await collectLensExport({ runMacro: noArtifacts, domain: "gallery", ctx: ctxB, limit: 100 });
    assert.equal(outB.artifacts.length, 0);
    assert.equal(outB.total, 0);
  });

  it("a work whose mint was unavailable still exports, under its artwork id with dtuId null", async () => {
    const saved = await call("artwork-save", ctxA, { title: "Unminted" });
    assert.equal(saved.result.artwork.dtuError, "dtu_create_unavailable");
    const out = await collectLensExport({ runMacro: noArtifacts, domain: "gallery", ctx: ctxA, limit: 100 });
    assert.equal(out.artifacts.length, 1);
    assert.equal(out.artifacts[0].id, saved.result.artwork.id);
    assert.equal(out.artifacts[0].data.dtuId, null);
  });

  it("an export read does not create state for a caller who never hung a work", async () => {
    const out = await collectLensExport({ runMacro: noArtifacts, domain: "gallery", ctx: ctxB, limit: 100 });
    assert.equal(out.artifacts.length, 0);
    const s = globalThis._concordSTATE;
    assert.equal(s.galleryLens?.collections?.has("user_b") ?? false, false);
  });
});
