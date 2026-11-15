// FIX-creative-011 — proof-link sharing defaults + inbox hygiene.
// External comments on a proof link are opt-in (an explicit choice by the
// owner), and the owner's inbox only surfaces threads of links the owner
// still holds. Pins:
//  1. prooflink-create without allowComments stores allowComments=false and
//     a public comment is refused.
//  2. prooflink-create with allowComments=true accepts a public comment
//     that lands in the owner inbox.
//  3. prooflink-inbox hides comments whose token matches no live link of
//     the owner (orphaned threads), while the owner's live thread shows.
//  4. prooflink-delete removes the link's stored comments with the link.
import { test } from "node:test";
import assert from "node:assert/strict";
import registerCreativeActions from "../domains/creative.js";

const handlers = {};
registerCreativeActions((domain, name, fn) => { handlers[`${domain}.${name}`] = fn; });
const run = (name, ctx, params = {}) => handlers[`creative.${name}`](ctx, {}, params);
const ctx = (userId) => ({ actor: { userId } });

async function withState(fn) {
  const prev = globalThis._concordSTATE;
  globalThis._concordSTATE = {};
  try { return await fn(); } finally {
    if (prev === undefined) delete globalThis._concordSTATE;
    else globalThis._concordSTATE = prev;
  }
}

async function makeAssetAndLink(user, params = {}) {
  const asset = await run("review-asset-create", ctx(user), { name: "Cut v1", kind: "video", durationSec: 60 });
  assert.equal(asset.ok, true);
  const link = await run("prooflink-create", ctx(user), { assetId: asset.result.asset.id, ...params });
  assert.equal(link.ok, true);
  return link.result.link;
}

test("prooflink-create: no explicit choice -> comments closed, public comment refused", async () => {
  await withState(async () => {
    const link = await makeAssetAndLink("u-1");
    assert.equal(link.allowComments, false);
    const cmt = await run("prooflink-public-comment", ctx("guest"), { token: link.token, body: "hello" });
    assert.equal(cmt.ok, false);
    assert.match(cmt.error, /commenting disabled/);
  });
});

test("prooflink-create: explicit opt-in -> public comment lands in the owner inbox", async () => {
  await withState(async () => {
    const link = await makeAssetAndLink("u-1", { allowComments: true });
    assert.equal(link.allowComments, true);
    const cmt = await run("prooflink-public-comment", ctx("guest"), { token: link.token, body: "Looks good", authorName: "Client" });
    assert.equal(cmt.ok, true);
    const inbox = await run("prooflink-inbox", ctx("u-1"), {});
    assert.equal(inbox.result.comments.length, 1);
    assert.equal(inbox.result.comments[0].body, "Looks good");
  });
});

test("prooflink-inbox: orphaned threads (no live link) are not surfaced", async () => {
  await withState(async () => {
    const link = await makeAssetAndLink("u-1", { allowComments: true });
    await run("prooflink-public-comment", ctx("guest"), { token: link.token, body: "live thread" });
    // Seed an orphaned comment directly (a thread whose link is gone).
    const s = globalThis._concordSTATE.creativeLens;
    s.proofExtComments.get("u-1").push({
      id: "xcm_orphan", token: "pl_deadtoken", authorName: "Ghost", body: "orphaned", timestampSec: null,
      createdAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const inbox = await run("prooflink-inbox", ctx("u-1"), {});
    assert.equal(inbox.result.comments.length, 1);
    assert.equal(inbox.result.comments[0].body, "live thread");
  });
});

test("prooflink-delete: the link's stored comments are removed with the link", async () => {
  await withState(async () => {
    const link = await makeAssetAndLink("u-1", { allowComments: true });
    await run("prooflink-public-comment", ctx("guest"), { token: link.token, body: "to be retired" });
    const del = await run("prooflink-delete", ctx("u-1"), { id: link.id });
    assert.equal(del.ok, true);
    const s = globalThis._concordSTATE.creativeLens;
    assert.equal((s.proofExtComments.get("u-1") || []).length, 0);
    const inbox = await run("prooflink-inbox", ctx("u-1"), {});
    assert.equal(inbox.result.comments.length, 0);
  });
});
