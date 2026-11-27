// CB-1324 F3 — verify.lineageLink ownership (provenance mutation gate).
//
// Extracts the lineageLink registration span from server.js and runs it
// against the REAL dtuMutationDenial. Shape per PR #2403: signed-out 401,
// missing child 404, non-owner 403 with nothing written, owner + admin pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(here, "..", "server.js"), "utf8");
const { dtuMutationDenial } = await import("../lib/dtu-ownership.js");

function extractLink() {
  const start = serverSrc.indexOf('register("verify","lineageLink"');
  assert.ok(start >= 0, "lineageLink found in server.js");
  const descAt = serverSrc.indexOf(", { summary:", start);
  const end = serverSrc.indexOf("});", descAt);
  const span = serverSrc.slice(start, end + 3);
  // eslint-disable-next-line no-new-func -- compiles a slice of server.js to test one handler in isolation
  const factory = new Function(
    "register", "STATE", "isShadowDTU", "nowISO", "dtuMutationDenial", "AUTH_MODE", "upsertDTU",
    span + "\nreturn register.__handler;");
  const register = (domain, nm, fn) => { register.__handler = fn; };
  return factory(register, STATE, () => false, () => "2026-01-01T00:00:00Z", dtuMutationDenial, "hybrid", () => {});
}

let STATE;
function freshState() {
  STATE = { dtus: new Map() };
  STATE.dtus.set("child_a", { id: "child_a", ownerId: "alice", createdBy: "alice", lineage: { parents: [], children: [] } });
  STATE.dtus.set("parent_x", { id: "parent_x", ownerId: "carol", createdBy: "carol", lineage: { parents: [], children: [] } });
  return STATE;
}
const alice = { actor: { userId: "alice", role: "member" } };
const bob = { actor: { userId: "bob", role: "member" } };
const anon = {};
const admin = { actor: { userId: "root", role: "admin" } };

test("owner links parents into her own DTU", () => {
  freshState();
  const out = extractLink()(alice, { childId: "child_a", parents: ["parent_x"] });
  assert.equal(out.ok, true);
  assert.deepEqual(STATE.dtus.get("child_a").lineage.parents, ["parent_x"]);
  assert.deepEqual(STATE.dtus.get("parent_x").lineage.children, ["child_a"]);
});

test("stranger cannot forge lineage on another user's DTU (403, nothing written)", () => {
  freshState();
  const out = extractLink()(bob, { childId: "child_a", parents: ["parent_x"] });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.deepEqual(STATE.dtus.get("child_a").lineage.parents, []);
  assert.deepEqual(STATE.dtus.get("parent_x").lineage.children, []);
});

test("signed-out is 401", () => {
  freshState();
  const out = extractLink()(anon, { childId: "child_a", parents: ["parent_x"] });
  assert.equal(out.ok, false);
  assert.equal(out.status, 401);
});

test("missing child is 404", () => {
  freshState();
  const out = extractLink()(alice, { childId: "nope", parents: ["parent_x"] });
  assert.equal(out.ok, false);
  assert.equal(out.status, 404);
});

test("admin may link lineage on any DTU", () => {
  freshState();
  const out = extractLink()(admin, { childId: "child_a", parents: ["parent_x"] });
  assert.equal(out.ok, true);
});
