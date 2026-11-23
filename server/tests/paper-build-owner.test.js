// CB-1324 F2 — paper.build ownership (papers are org-owned).
//
// Extracts the paper.build registration span from server.js and runs it
// with stubbed collaborators. Shape per PR #2403: signed-out 401, missing
// paper 404, foreign-org 403 with nothing written, owning org + admin pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(here, "..", "server.js"), "utf8");
const { DTU_ADMIN_ROLES } = await import("../lib/dtu-ownership.js");

function extractBuild() {
  const start = serverSrc.indexOf('register("paper","build"');
  assert.ok(start >= 0, "paper.build found in server.js");
  const descAt = serverSrc.indexOf(", { summary:", start);
  const end = serverSrc.indexOf("});", descAt);
  const span = serverSrc.slice(start, end + 3);
  const factory = new Function(
    "register", "STATE", "normalizeText", "retrieveDTUs", "nowISO",
    "saveStateDebounced", "AUTH_MODE", "DTU_ADMIN_ROLES",
    span + "\nreturn register.__handler;");
  const register = (domain, nm, fn) => { register.__handler = fn; };
  return factory(register, STATE,
    (x) => String(x || ""), () => ({ top: [] }), () => "2026-01-01T00:00:00Z",
    () => {}, "hybrid", DTU_ADMIN_ROLES);
}

let STATE;
function freshState() {
  STATE = { papers: new Map(), sources: new Map() };
  STATE.papers.set("paper_orgA", { id: "paper_orgA", orgId: "orgA", topic: "Fusion", outline: ["old"], sections: [{ heading: "old", body: "old" }], refs: [], status: "draft" });
  STATE.papers.set("paper_orgless", { id: "paper_orgless", topic: "Orphan", outline: [], sections: [], refs: [], status: "draft" });
  return STATE;
}
const memberA = { actor: { userId: "alice", role: "member", orgId: "orgA" } };
const memberB = { actor: { userId: "bob", role: "member", orgId: "orgB" } };
const anon = {};
const admin = { actor: { userId: "root", role: "admin", orgId: "orgZ" } };

test("owning org builds its paper", () => {
  freshState();
  const out = extractBuild()(memberA, { paperId: "paper_orgA" });
  assert.equal(out.ok, true);
  assert.equal(out.paper.status, "built");
  assert.equal(out.paper.sections[0].heading, "Abstract");
});

test("foreign org is 403 and the paper is untouched", () => {
  freshState();
  const out = extractBuild()(memberB, { paperId: "paper_orgA" });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  const p = STATE.papers.get("paper_orgA");
  assert.equal(p.status, "draft");
  assert.deepEqual(p.outline, ["old"]);
});

test("signed-out is 401", () => {
  freshState();
  const out = extractBuild()(anon, { paperId: "paper_orgA" });
  assert.equal(out.ok, false);
  assert.equal(out.status, 401);
});

test("missing paper is 404", () => {
  freshState();
  const out = extractBuild()(memberA, { paperId: "paper_nope" });
  assert.equal(out.ok, false);
  assert.equal(out.status, 404);
});

test("org-less paper is 403 for a member", () => {
  freshState();
  const out = extractBuild()(memberA, { paperId: "paper_orgless" });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
});

test("admin builds any org's paper", () => {
  freshState();
  const out = extractBuild()(admin, { paperId: "paper_orgA" });
  assert.equal(out.ok, true);
});
