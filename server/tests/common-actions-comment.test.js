// INC-SWEEP research F5 — COMMON_ACTIONS.comment rejects blank text; a real
// comment persists on the artifact and survives LensArtifactStore rehydrate.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import { LensArtifactStore } from "../lib/lens-artifact-store.js";
import { up as createTable } from "../migrations/398_lens_artifact_store.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";
import Database from "better-sqlite3";

describe("COMMON_ACTIONS comment blank + restart (F5)", () => {
  let STATE, LENS_ACTIONS;

  before(async () => {
    const t = await load();
    STATE = t.STATE;
    LENS_ACTIONS = t.LENS_ACTIONS || globalThis.__concordLensActions;
    assert.ok(LENS_ACTIONS, "LENS_ACTIONS missing");
  });

  function comment() {
    return LENS_ACTIONS.get("research.comment");
  }

  it("rejects empty / whitespace comment with text required (422)", () => {
    const ctx = { actor: { userId: "u-f5", displayName: "F5", role: "member" } };
    const art = {
      id: "lart_f5_blank",
      domain: "research",
      title: "Blank guard",
      data: {},
      meta: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(art.id, art);

    for (const params of [{}, { text: "" }, { text: "   " }]) {
      const r = comment()(ctx, art, params);
      assert.equal(r.ok, false, JSON.stringify(params));
      assert.match(r.error, /text required/i);
      assert.equal(shapeLensRunHttp(r).status, 422);
    }
    assert.equal((art.data.comments || []).length, 0);
  });

  it("stores a real comment and survives fresh store rehydrate", () => {
    const ctx = { actor: { userId: "u-f5", displayName: "F5 User", role: "member" } };
    const art = {
      id: "lart_f5_persist",
      domain: "research",
      title: "Comment persist",
      data: {},
      meta: {},
      ownerId: "u-f5",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(art.id, art);

    const r = comment()(ctx, art, { text: "marker comment rsch-f5" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.comment.text, "marker comment rsch-f5");
    assert.equal(r.totalComments, 1);
    assert.equal(art.data.comments[0].text, "marker comment rsch-f5");

    const db = new Database(":memory:");
    createTable(db);
    const first = new LensArtifactStore(db);
    first.set(art.id, structuredClone(art));

    const second = new LensArtifactStore(db);
    assert.equal(second.size, 0);
    const loaded = second.rehydrateFromSQLite();
    assert.equal(loaded.loaded, 1);
    assert.equal(loaded.errors, 0);
    const back = second.get(art.id);
    assert.ok(back);
    assert.equal(back.data.comments[0].text, "marker comment rsch-f5");
    assert.equal(back.data.comments[0].author, "F5 User");
  });
});
