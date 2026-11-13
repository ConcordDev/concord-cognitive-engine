// FIX-feed-001 — the shared lens export's artifact leg applies the
// takeout scope itself. lens.list treats social-domain artifacts as
// an open square (no ownership filter), so before this fix an export
// for a social domain carried every artifact in the domain store,
// including another user's private record. The pins: another user's
// private or unmarked artifact never rides; their public/published
// artifacts and ownerless catalog rows still ride; the caller's own
// records ride at any visibility.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { collectLensExport } from "../lib/lens-export.js";

const CALLER = "user_t1";
const OTHER = "user_other";

const ARTIFACTS = [
  { id: "lart_own_private", domain: "feed", type: "review", title: "My private review", ownerId: CALLER, meta: { visibility: "private" } },
  { id: "lart_other_private", domain: "feed", type: "review", title: "Someone else's private review", ownerId: OTHER, meta: { visibility: "private" } },
  { id: "lart_other_unmarked", domain: "feed", type: "note", title: "Someone else's unmarked record", ownerId: OTHER, meta: {} },
  { id: "lart_other_public", domain: "feed", type: "post", title: "A public post", ownerId: OTHER, meta: { visibility: "public" } },
  { id: "lart_other_published", domain: "feed", type: "post", title: "A published post", ownerId: OTHER, meta: { visibility: "published" } },
  { id: "lart_catalog", domain: "feed", type: "recall", title: "Public catalog row", ownerId: null, meta: {} },
];

function fakeRunMacro(domain, action) {
  if (domain === "lens" && action === "list") {
    return { ok: true, artifacts: ARTIFACTS.map((a) => ({ ...a })) };
  }
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
}

beforeEach(() => {
  globalThis._concordSTATE = {};
});

describe("FIX-feed-001 lens export artifact scope", () => {
  it("another user's private artifact does not ride the caller's export", async () => {
    const out = await collectLensExport({ runMacro: fakeRunMacro, domain: "feed", ctx: { actor: { userId: CALLER } } });
    assert.equal(out.ok, true);
    const ids = out.artifacts.map((r) => r.id);
    assert.ok(!ids.includes("lart_other_private"), "private record of another user leaked into the export");
    assert.ok(!ids.includes("lart_other_unmarked"), "unmarked record of another user leaked into the export");
  });

  it("public rows and the caller's own records still ride", async () => {
    const out = await collectLensExport({ runMacro: fakeRunMacro, domain: "feed", ctx: { actor: { userId: CALLER } } });
    const ids = out.artifacts.map((r) => r.id);
    assert.ok(ids.includes("lart_own_private"), "caller's own private record must ride their own export");
    assert.ok(ids.includes("lart_other_public"));
    assert.ok(ids.includes("lart_other_published"));
    assert.ok(ids.includes("lart_catalog"));
    assert.equal(out.sources.artifacts, 4);
  });

  it("the scope follows the caller, not the artifact set", async () => {
    const out = await collectLensExport({ runMacro: fakeRunMacro, domain: "feed", ctx: { actor: { userId: OTHER } } });
    const ids = out.artifacts.map((r) => r.id);
    assert.ok(ids.includes("lart_other_private"), "the owner's own export includes their private record");
    assert.ok(!ids.includes("lart_own_private"), "the first user's private record must not ride another's export");
  });
});
