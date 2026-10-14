// INC-SWEEP research F6 — COMMON duplicate rejects empty/virtual source;
// research.list_mine surfaces the caller's DTUs (type filter no longer
// drops Save-as-DTU rows); a real duplicate survives LensArtifactStore rehydrate.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import { LensArtifactStore } from "../lib/lens-artifact-store.js";
import { up as createTable } from "../migrations/398_lens_artifact_store.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";
import Database from "better-sqlite3";

describe("COMMON duplicate + research list_mine (F6)", () => {
  let runMacro, STATE, LENS_ACTIONS, makeInternalCtx;

  before(async () => {
    const t = await load();
    ({ runMacro, STATE, makeInternalCtx } = t);
    LENS_ACTIONS = t.LENS_ACTIONS || globalThis.__concordLensActions;
    assert.ok(LENS_ACTIONS, "LENS_ACTIONS missing");
  });

  function ctxFor(userId) {
    const ctx = makeInternalCtx(userId);
    ctx.actor = { userId, role: "member", scope: "local", scopes: ["*"] };
    ctx.userId = userId;
    ctx.internal = false;
    return ctx;
  }

  it("duplicate on virtual {} refuses (no Copy of undefined)", () => {
    const dup = LENS_ACTIONS.get("research.duplicate");
    const virtual = { id: null, domain: "research", type: "domain_action", data: {}, meta: {} };
    const r = dup({ actor: { userId: "u-f6" } }, virtual, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /artifact id required/i);
    assert.equal(shapeLensRunHttp(r).status, 422);
    assert.ok(!String(r.artifact?.title || "").includes("undefined"));
  });

  it("duplicate of a real artifact persists through store rehydrate", () => {
    const src = {
      id: "lart_f6_src",
      domain: "research",
      title: "Source paper note",
      type: "domain_action",
      data: { marker: "rsch-f6-dup" },
      meta: {},
      ownerId: "u-f6",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(src.id, src);

    const r = LENS_ACTIONS.get("research.duplicate")(
      { actor: { userId: "u-f6" } },
      src,
      {},
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.artifact.title, "Copy of Source paper note");
    assert.equal(r.artifact.data.marker, "rsch-f6-dup");
    assert.ok(STATE.lensArtifacts.has(r.artifact.id));

    const db = new Database(":memory:");
    createTable(db);
    const first = new LensArtifactStore(db);
    first.set(r.artifact.id, structuredClone(r.artifact));
    const second = new LensArtifactStore(db);
    const loaded = second.rehydrateFromSQLite();
    assert.equal(loaded.loaded, 1);
    const back = second.get(r.artifact.id);
    assert.ok(back);
    assert.equal(back.title, "Copy of Source paper note");
    assert.equal(back.data.marker, "rsch-f6-dup");
  });

  it("research.list_mine includes a knowledge-type DTU (type filter no longer drops it)", async () => {
    const userId = "u-f6-list-" + Date.now().toString(36);
    const ctx = ctxFor(userId);
    const db = ctx.db || STATE.db;
    assert.ok(db, "test db required for list_mine");
    try {
      db.prepare(
        "INSERT OR IGNORE INTO users (id, username, email, password_hash, role, created_at) VALUES (?,?,?,?,?,datetime('now'))",
      ).run(userId, userId, `${userId}@test.local`, "x", "member");
    } catch {
      try {
        db.prepare("INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)").run(userId, userId);
      } catch { /* best-effort for FK */ }
    }
    const dtuId = "dtu_f6_list_" + Date.now().toString(36);
    db.prepare(`
      INSERT INTO dtus (id, owner_user_id, creator_id, title, body_json, tags_json, visibility, tier, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, '{}', ?, 'private', 'regular', ?, datetime('now'), datetime('now'))
    `).run(
      dtuId,
      userId,
      userId,
      "Research note f6 list_mine",
      JSON.stringify(["research-lens", "rsch-f6"]),
      "knowledge",
    );

    const listed = await runMacro("research", "list_mine", { limit: 50 }, ctx);
    assert.equal(listed.ok, true, JSON.stringify(listed));
    const items = listed.items || listed.rows || [];
    assert.ok(
      items.some((x) => x.id === dtuId),
      `list_mine missing ${dtuId}; total=${listed.total} items=${JSON.stringify(items.slice(0, 5))}`,
    );
    assert.ok(listed.total >= 1);
  });
});

