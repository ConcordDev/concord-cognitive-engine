// CB-1324 F2, reworked CB-1369 — paper.build ownership (papers are
// USER-owned; create stamps createdBy/ownerId from the session actor).
//
// Extracts the paper.create / paper.build registration spans from
// server.js and runs them with stubbed collaborators. The org gate it
// replaces was vacuous (orgId defaults to "default" for every member).
// Shape per PR #2403 + CB-1369: signed-out 401, missing paper 404,
// non-owner 403 with nothing written — including a second member in
// the SAME default org — owner + admin pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(here, "..", "server.js"), "utf8");
const { DTU_ADMIN_ROLES } = await import("../lib/dtu-ownership.js");

function extractSpan(marker, params, args) {
  const start = serverSrc.indexOf(marker);
  assert.ok(start >= 0, marker + " found in server.js");
  const descAt = serverSrc.indexOf(", { summary:", start);
  const end = serverSrc.indexOf("});", descAt);
  const span = serverSrc.slice(start, end + 3);
  const factory = new Function("register", ...params, span + "\nreturn register.__handler;");
  const register = (domain, nm, fn) => { register.__handler = fn; };
  return factory(register, ...args);
}
function extractBuild() {
  return extractSpan('register("paper","build"',
    ["STATE", "normalizeText", "retrieveDTUs", "nowISO", "saveStateDebounced", "AUTH_MODE", "DTU_ADMIN_ROLES"],
    [STATE, (x) => String(x || ""), () => ({ top: [] }), () => "2026-01-01T00:00:00Z", () => {}, "hybrid", DTU_ADMIN_ROLES]);
}
function extractCreate() {
  return extractSpan('register("paper","create"',
    ["STATE", "normalizeText", "uid", "nowISO", "saveStateDebounced"],
    [STATE, (x) => String(x || ""), (p) => p + "_new1", () => "2026-01-01T00:00:00Z", () => {}]);
}

let STATE;
function freshState() {
  STATE = { papers: new Map(), sources: new Map() };
  STATE.papers.set("paper_alice", { id: "paper_alice", orgId: "default", createdBy: "alice", ownerId: "alice", topic: "Fusion", outline: ["old"], sections: [{ heading: "old", body: "old" }], refs: [], status: "draft" });
  STATE.papers.set("paper_ownerless", { id: "paper_ownerless", orgId: "default", topic: "Orphan", outline: [], sections: [], refs: [], status: "draft" });
  return STATE;
}
// Two members in the SAME default org — the CB-1369 case.
const alice = { actor: { userId: "alice", role: "member", orgId: "default" } };
const bob = { actor: { userId: "bob", role: "member", orgId: "default" } };
const anon = {};
const admin = { actor: { userId: "root", role: "admin", orgId: "default" } };

test("create stamps the creator's user id", () => {
  freshState();
  const out = extractCreate()(alice, { topic: "New" });
  assert.equal(out.ok, true);
  assert.equal(out.paper.createdBy, "alice");
  assert.equal(out.paper.ownerId, "alice");
});

test("owner builds her paper", () => {
  freshState();
  const out = extractBuild()(alice, { paperId: "paper_alice" });
  assert.equal(out.ok, true);
  assert.equal(out.paper.status, "built");
  assert.equal(out.paper.sections[0].heading, "Abstract");
});

test("CB-1369: second member in the same default org is 403 and the paper is unchanged", () => {
  freshState();
  const out = extractBuild()(bob, { paperId: "paper_alice" });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  const p = STATE.papers.get("paper_alice");
  assert.equal(p.status, "draft");
  assert.deepEqual(p.outline, ["old"]);
});

test("signed-out is 401", () => {
  freshState();
  const out = extractBuild()(anon, { paperId: "paper_alice" });
  assert.equal(out.ok, false);
  assert.equal(out.status, 401);
});

test("missing paper is 404", () => {
  freshState();
  const out = extractBuild()(alice, { paperId: "paper_nope" });
  assert.equal(out.ok, false);
  assert.equal(out.status, 404);
});

test("ownerless (pre-stamp) paper is 403 for a member", () => {
  freshState();
  const out = extractBuild()(alice, { paperId: "paper_ownerless" });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
});

test("admin builds any user's paper", () => {
  freshState();
  const out = extractBuild()(admin, { paperId: "paper_alice" });
  assert.equal(out.ok, true);
});
