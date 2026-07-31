// tests/internal-actor-stamp-detector.test.js
//
// Bidirectional pin: `{ ...var, internal: true }` and `x.internal = true`
// must be flagged; the confirmed-guarded jobs.enqueue site (isSystemJob check
// nearby) must be allowlisted and NOT flagged.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInternalActorStampDetector } from "../lib/detectors/internal-actor-stamp-detector.js";

async function tmpRepo({ serverJs = "" }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ias-"));
  await mkdir(path.join(dir, "server"), { recursive: true });
  await writeFile(path.join(dir, "server", "server.js"), serverJs, "utf8");
  return dir;
}

describe("internal-actor-stamp detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS a spread-then-stamp actor built from a variable", async () => {
    const serverJs = `
function runSomeJob(j) {
  const ctx = { actor: { ...j.actor, internal: true } };
  return ctx;
}
`;
    dir = await tmpRepo({ serverJs });
    const r = await runInternalActorStampDetector({ root: dir });
    assert.equal(r.ok, true);
    const hit = r.findings.find((f) => f.id === "internal_actor_stamp_spread");
    assert.ok(hit, "spread-then-stamp from j.actor must be flagged");
    assert.equal(hit.evidence.spreadSource, "j.actor");
    assert.equal(hit.severity, "high");
  });

  it("FLAGS a bare .internal = true assignment", async () => {
    const serverJs = `
function attach(ctx) {
  ctx.internal = true;
}
`;
    dir = await tmpRepo({ serverJs });
    const r = await runInternalActorStampDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "internal_actor_stamp_assign");
    assert.ok(hit);
    assert.equal(hit.evidence.target, "ctx");
    assert.equal(hit.severity, "medium");
  });

  it("does NOT flag the reviewed jobs.enqueue site (isSystemJob guard present nearby)", async () => {
    const serverJs = `
async function runJob(j) {
  const actorRole = String(j.actor?.role || "");
  const isSystemJob = !j.actor || j.actor.internal === true || actorRole === "system" || actorRole === "owner" || actorRole === "founder";
  let ctx;
  if (isSystemJob) {
    ctx = makeInternalCtx("job_runner");
    if (j.actor) { ctx.actor = { ...j.actor, internal: true }; }
  } else {
    ctx = makeCtx(null);
    ctx.internal = false;
    ctx.actor = { ...j.actor, internal: false };
  }
}
`;
    dir = await tmpRepo({ serverJs });
    const r = await runInternalActorStampDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "internal_actor_stamp_spread");
    assert.equal(hit, undefined, "the reviewed, isSystemJob-guarded site must be allowlisted");
    const summary = r.findings.find((f) => f.id === "internal_actor_stamp_summary");
    assert.ok(summary.evidence.exempted >= 1, "the allowlisted site must still be counted");
  });

  it("does NOT flag the pattern when it only appears inside a comment (self-inflicted false-positive guard)", async () => {
    // This detector's OWN source file explains the bug shape by quoting it
    // in prose ("{ ...j.actor, internal: true }") — without comment-
    // stripping, the detector would flag its own documentation. Pin that
    // directly rather than relying on eyeballing the real-tree run.
    const serverJs = `
// Seeded by a bug where code did { ...j.actor, internal: true } and also
// somewhere did x.internal = true without checking anything first.
function realCode() {
  return { userId: "system", role: "owner", internal: true };
}
`;
    dir = await tmpRepo({ serverJs });
    const r = await runInternalActorStampDetector({ root: dir });
    const nonInfo = r.findings.filter((f) => f.severity !== "info");
    assert.equal(nonInfo.length, 0, "a comment-only mention of the risky shape must not be flagged");
  });

  it("does NOT flag a fully-literal system actor with no spread/variable", async () => {
    const serverJs = `
const ctx = { actor: { userId: "system", role: "owner", scopes: ["*"], internal: true } };
`;
    dir = await tmpRepo({ serverJs });
    const r = await runInternalActorStampDetector({ root: dir });
    assert.equal(r.findings.filter((f) => f.severity !== "info").length, 0, "a hardcoded literal actor is the safe shape");
  });
});
