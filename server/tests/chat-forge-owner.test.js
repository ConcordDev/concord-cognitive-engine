// CB-1323 F1 — chat.forge.save / forge.delete / forge.list ownership.
//
// The forge handlers live in server.js (not bootable in a unit harness), so
// this suite extracts the three registration spans from server.js and runs
// them against the REAL helpers (lib/inline-dtu-forge.js) and the REAL
// mutation gate (lib/dtu-ownership.js dtuMutationDenial), with a stub STATE.
// Shape per PR #2403: caller from the session, signed-out 401, non-owner
// 403 with nothing written, owner + admin pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(here, "..", "server.js"), "utf8");
const { saveForgedDTU, deleteForgedDTU, saveAndList } = await import("../lib/inline-dtu-forge.js");
const { dtuMutationDenial } = await import("../lib/dtu-ownership.js");

function extractHandler(name) {
  const start = serverSrc.indexOf(`register("chat", "${name}"`);
  assert.ok(start >= 0, `handler ${name} found in server.js`);
  const descAt = serverSrc.indexOf(", { description:", start);
  assert.ok(descAt > start, `handler ${name} registration closes with a description`);
  const end = serverSrc.indexOf("});", descAt);
  const span = serverSrc.slice(start, end + 3);
  const factory = new Function(
    "register", "STATE", "saveForgedDTU", "deleteForgedDTU", "saveAndList",
    "recordForgeMetric", "saveStateDebounced", "dtuMutationDenial", "AUTH_MODE",
    span + "\nreturn register.__handler;");
  const register = (domain, nm, fn) => { register.__handler = fn; };
  return factory(register, STATE, saveForgedDTU, deleteForgedDTU, saveAndList,
    () => {}, () => {}, dtuMutationDenial, "hybrid");
}

let STATE;
function freshState() {
  STATE = { dtus: new Map() };
  STATE.dtus.set("dtu_victim", { id: "dtu_victim", title: "victim", ownerId: "alice", createdBy: "alice", meta: { forged: true } });
  STATE.dtus.set("dtu_ownerless", { id: "dtu_ownerless", title: "ownerless", meta: { forged: true } });
  return STATE;
}
const alice = { actor: { userId: "alice", role: "member" } };
const bob = { actor: { userId: "bob", role: "member" } };
const anon = {};
const admin = { actor: { userId: "root", role: "admin" } };

test("owner saves over her own forged DTU", () => {
  freshState();
  const save = extractHandler("forge.save");
  const out = save(alice, { dtu: { id: "dtu_victim", title: "updated", meta: {} } });
  assert.equal(out.ok, true);
  assert.equal(STATE.dtus.get("dtu_victim").title, "updated");
});

test("stranger cannot overwrite another user's DTU (403, nothing written)", () => {
  freshState();
  const save = extractHandler("forge.save");
  const out = save(bob, { dtu: { id: "dtu_victim", title: "pwned", meta: {} } });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(STATE.dtus.get("dtu_victim").title, "victim");
});

test("signed-out cannot overwrite an owned DTU (401)", () => {
  freshState();
  const save = extractHandler("forge.save");
  const out = save(anon, { dtu: { id: "dtu_victim", title: "pwned", meta: {} } });
  assert.equal(out.ok, false);
  assert.equal(out.status, 401);
  assert.equal(STATE.dtus.get("dtu_victim").title, "victim");
});

test("member cannot overwrite an ownerless DTU (403)", () => {
  freshState();
  const save = extractHandler("forge.save");
  const out = save(bob, { dtu: { id: "dtu_ownerless", title: "pwned", meta: {} } });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(STATE.dtus.get("dtu_ownerless").title, "ownerless");
});

test("admin may save over another user's DTU", () => {
  freshState();
  const save = extractHandler("forge.save");
  const out = save(admin, { dtu: { id: "dtu_victim", title: "admin edit", meta: {} } });
  assert.equal(out.ok, true);
});

test("fresh save by a member succeeds and stamps ownership from the session", () => {
  freshState();
  const save = extractHandler("forge.save");
  const out = save(bob, { dtu: { id: "dtu_new", title: "bob's", meta: {} } });
  assert.equal(out.ok, true);
  assert.equal(STATE.dtus.get("dtu_new").ownerId, "bob");
  assert.equal(STATE.dtus.get("dtu_new").createdBy, "bob");
});

test("signed-out fresh save is 401 and stores nothing", () => {
  freshState();
  const save = extractHandler("forge.save");
  const out = save(anon, { dtu: { id: "dtu_new", title: "anon", meta: {} } });
  assert.equal(out.ok, false);
  assert.equal(out.status, 401);
  assert.equal(STATE.dtus.has("dtu_new"), false);
});

test("stranger cannot delete another user's forged DTU (403, survives)", () => {
  freshState();
  const del = extractHandler("forge.delete");
  const out = del(bob, { dtuId: "dtu_victim" });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(STATE.dtus.has("dtu_victim"), true);
});

test("owner deletes her own forged DTU", () => {
  freshState();
  const del = extractHandler("forge.delete");
  const out = del(alice, { dtuId: "dtu_victim" });
  assert.equal(out.ok, true);
  assert.equal(STATE.dtus.has("dtu_victim"), false);
});

test("stranger cannot list over another user's DTU (403, nothing written)", () => {
  freshState();
  const list = extractHandler("forge.list");
  const out = list(bob, { dtu: { id: "dtu_victim", title: "pwned", meta: {} } });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(STATE.dtus.get("dtu_victim").title, "victim");
});
