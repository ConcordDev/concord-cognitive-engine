// INC-SWEEP lab F7 — prove batch-022 COMMON duplicate id gate on Lab surface.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import { LensArtifactStore } from "../lib/lens-artifact-store.js";
import { up as createTable } from "../migrations/398_lens_artifact_store.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";
import Database from "better-sqlite3";

describe("lab F7 COMMON duplicate (ALREADY-CLOSED-BY-022)", () => {
  let STATE, LENS_ACTIONS;

  before(async () => {
    const t = await load();
    STATE = t.STATE;
    LENS_ACTIONS = t.LENS_ACTIONS || globalThis.__concordLensActions;
    assert.ok(LENS_ACTIONS);
  });

  it("lab.duplicate {} refuses (no Copy of undefined)", () => {
    const dup = LENS_ACTIONS.get("lab.duplicate");
    const virtual = { id: null, domain: "lab", type: "domain_action", data: {}, meta: {} };
    const r = dup({ actor: { userId: "u-lab-f7" } }, virtual, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /artifact id required/i);
    assert.equal(shapeLensRunHttp(r).status, 422);
    assert.ok(!String(r.artifact?.title || "").includes("undefined"));
  });

  it("real duplicate persists through store rehydrate", () => {
    const src = {
      id: "lart_lab_f7_src",
      domain: "lab",
      title: "Source experiment",
      type: "experiment",
      data: { marker: "lab-f7-dup" },
      meta: {},
      ownerId: "u-lab-f7",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(src.id, src);
    const r = LENS_ACTIONS.get("lab.duplicate")(
      { actor: { userId: "u-lab-f7" } },
      src,
      {},
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.artifact.title, "Copy of Source experiment");
    assert.equal(r.artifact.data.marker, "lab-f7-dup");

    const db = new Database(":memory:");
    createTable(db);
    const first = new LensArtifactStore(db);
    first.set(r.artifact.id, structuredClone(r.artifact));
    const second = new LensArtifactStore(db);
    assert.equal(second.rehydrateFromSQLite().loaded, 1);
    const back = second.get(r.artifact.id);
    assert.equal(back.title, "Copy of Source experiment");
    assert.equal(back.data.marker, "lab-f7-dup");
  });
});
