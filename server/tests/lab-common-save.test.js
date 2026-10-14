// INC-SWEEP lab F6 — prove batch-022 COMMON save id gate on Lab surface.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import { LensArtifactStore } from "../lib/lens-artifact-store.js";
import { up as createTable } from "../migrations/398_lens_artifact_store.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";
import Database from "better-sqlite3";

describe("lab F6 COMMON save (ALREADY-CLOSED-BY-022)", () => {
  let STATE, LENS_ACTIONS;

  before(async () => {
    const t = await load();
    STATE = t.STATE;
    LENS_ACTIONS = t.LENS_ACTIONS || globalThis.__concordLensActions;
    assert.ok(LENS_ACTIONS);
  });

  it("lab.save {} refuses artifact id required (no saved:true version:2)", () => {
    const save = LENS_ACTIONS.get("lab.save");
    assert.ok(typeof save === "function");
    const virtual = { id: null, domain: "lab", type: "domain_action", data: {}, meta: {} };
    const r = save({ actor: { userId: "u-lab-f6" } }, virtual, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /artifact id required/i);
    assert.equal(shapeLensRunHttp(r).status, 422);
    assert.equal(r.saved, undefined);
  });

  it("lab.save with id bumps version and survives rehydrate", () => {
    const art = {
      id: "lart_lab_f6_save",
      domain: "lab",
      title: "Save me",
      type: "experiment",
      data: { marker: "lab-f6" },
      meta: {},
      ownerId: "u-lab-f6",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(art.id, art);
    const r = LENS_ACTIONS.get("lab.save")(
      { actor: { userId: "u-lab-f6" } },
      { id: null, domain: "lab", data: {}, meta: {} },
      { id: art.id, note: "saved note" },
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.saved, true);
    assert.equal(r.version, 2);
    assert.equal(art.data.note, "saved note");

    const db = new Database(":memory:");
    createTable(db);
    const first = new LensArtifactStore(db);
    first.set(art.id, structuredClone(art));
    const second = new LensArtifactStore(db);
    assert.equal(second.rehydrateFromSQLite().loaded, 1);
    const back = second.get(art.id);
    assert.equal(back.version, 2);
    assert.equal(back.data.note, "saved note");
  });
});
