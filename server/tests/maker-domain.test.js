// server/tests/maker-domain.test.js
//
// Behavioral tests for server/domains/maker.js (migration 497). Review
// findings F2/F3 (a make now carries a spec and a real edit/delete
// lifecycle) and F5 (the bench no longer shares app-maker's store — these
// macros read/write their own table, owner-scoped).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerMakerMacros from "../domains/maker.js";

describe("maker domain", () => {
  let db, macros;

  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    macros = new Map();
    registerMakerMacros((domain, name, fn) => macros.set(`${domain}.${name}`, fn));
  });

  function call(name, ctx, input = {}) {
    return macros.get(`maker.${name}`)(ctx, input);
  }

  function ctxFor(userId) {
    return { db, actor: { userId }, userId };
  }

  it("create + list: a make is readable back with its name and spec", async () => {
    const created = await call("create", ctxFor("user_a"), { name: "Bench lamp", spec: "oak base, LED strip" });
    assert.equal(created.ok, true);
    assert.equal(created.make.name, "Bench lamp");
    assert.equal(created.make.spec, "oak base, LED strip");

    const listed = await call("list", ctxFor("user_a"));
    assert.equal(listed.ok, true);
    assert.equal(listed.makes.length, 1);
    assert.equal(listed.makes[0].id, created.make.id);
  });

  it("create: a blank name is refused, not silently stored", async () => {
    const res = await call("create", ctxFor("user_a"), { name: "   " });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "no_name");
  });

  it("F3 — update renames a make and edits its spec", async () => {
    const created = await call("create", ctxFor("user_a"), { name: "Original", spec: "v1" });
    const updated = await call("update", ctxFor("user_a"), { id: created.make.id, name: "Renamed", spec: "v2" });
    assert.equal(updated.ok, true);
    assert.equal(updated.make.name, "Renamed");
    assert.equal(updated.make.spec, "v2");

    const listed = await call("list", ctxFor("user_a"));
    const row = listed.makes.find((m) => m.id === created.make.id);
    assert.equal(row.name, "Renamed");
    assert.equal(row.spec, "v2");
  });

  it("F3 — delete removes a make from the bench", async () => {
    const created = await call("create", ctxFor("user_a"), { name: "Temporary" });
    const del = await call("delete", ctxFor("user_a"), { id: created.make.id });
    assert.equal(del.ok, true);
    const listed = await call("list", ctxFor("user_a"));
    assert.equal(listed.makes.some((m) => m.id === created.make.id), false);
  });

  it("F5 — makes are owner-scoped: one user cannot see, edit, or delete another's make", async () => {
    const created = await call("create", ctxFor("user_a"), { name: "User A's make" });

    const listedB = await call("list", ctxFor("user_b"));
    assert.equal(listedB.makes.some((m) => m.id === created.make.id), false);

    const updateB = await call("update", ctxFor("user_b"), { id: created.make.id, name: "Hijacked" });
    assert.equal(updateB.ok, false);
    assert.equal(updateB.reason, "not_found");

    const deleteB = await call("delete", ctxFor("user_b"), { id: created.make.id });
    assert.equal(deleteB.ok, false);
    assert.equal(deleteB.reason, "not_found");

    const listedA = await call("list", ctxFor("user_a"));
    assert.equal(listedA.makes.some((m) => m.id === created.make.id), true);
  });

  it("update: a request with neither name nor spec is refused", async () => {
    const created = await call("create", ctxFor("user_a"), { name: "Untouched" });
    const res = await call("update", ctxFor("user_a"), { id: created.make.id });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "nothing_to_update");
  });
});
