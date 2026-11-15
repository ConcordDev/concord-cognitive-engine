// FIX-ml-012 — 'public' must have a visible effect: a discovery listing.
//
// space-create defaulted spaces to public and space-get honoured a
// public space for anyone with its URL, but space-list only ever
// returned the CALLER's own spaces — no browse/discovery existed, so
// the public badge changed nothing anyone could see. space-list now
// takes scope:'public': every user's public spaces (newest first,
// private spaces never included, owner id kept server-side behind an
// isOwner flag). The default own-list is unchanged.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("ml public space discovery (FIX-ml-012)", () => {
  let ctxA, ctxB;
  before(async () => {
    ctxA = await depthCtx("ml-spaces-a");
    ctxB = await depthCtx("ml-spaces-b");
    await lensRun("ml", "space-create", { params: { title: "Pub Demo", modelId: "m1" } }, ctxA);
    await lensRun("ml", "space-create", { params: { title: "Secret Demo", modelId: "m2", private: true } }, ctxA);
  });

  it("another user discovers the public space, never the private one", async () => {
    const r = await lensRun("ml", "space-list", { params: { scope: "public" } }, ctxB);
    assert.equal(r.ok, true);
    const titles = r.result.spaces.map((s) => s.title);
    assert.ok(titles.includes("Pub Demo"), JSON.stringify(titles));
    assert.ok(!titles.includes("Secret Demo"));
    const pub = r.result.spaces.find((s) => s.title === "Pub Demo");
    assert.equal(pub.isOwner, false);
    assert.equal(pub.owner, undefined);
    assert.equal(pub.userId, undefined);
  });

  it("the owner sees their public space flagged as theirs", async () => {
    const r = await lensRun("ml", "space-list", { params: { scope: "public" } }, ctxA);
    const pub = r.result.spaces.find((s) => s.title === "Pub Demo");
    assert.equal(pub.isOwner, true);
  });

  it("the default list is still the caller's own spaces only", async () => {
    const r = await lensRun("ml", "space-list", { params: {} }, ctxB);
    assert.equal(r.result.spaces.some((s) => s.title === "Pub Demo"), false);
  });
});
