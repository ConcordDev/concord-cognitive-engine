// FIX-plugins-005: the Plugins lens export must include the caller's own
// gallery records. The catalogue is shared platform content; the caller's
// records are their installs and ratings, held in plugin-gallery.js's
// module-private maps — so the lib registers a lens export provider over
// them, where the records live.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const { collectLensExport, hasLensExportProvider } = await import("../lib/lens-export.js");
const gallery = await import("../lib/plugin-gallery.js");

const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

describe("plugins export provider (FIX-plugins-005)", () => {
  before(() => {
    gallery.__resetGalleryForTests();
    const src = "export default { id: 'x' };";
    assert.equal(gallery.publishPlugin({ pluginId: "plug-a", authorId: "author-1", name: "Alpha Tools", version: "1.2.0", source: src }).ok, true);
    assert.equal(gallery.publishPlugin({ pluginId: "plug-b", authorId: "author-2", name: "Beta Kit", version: "0.9.1", source: src }).ok, true);
    assert.equal(gallery.publishPlugin({ pluginId: "plug-c", authorId: "author-2", name: "Gamma Pack", version: "2.0.0", source: src }).ok, true);
    assert.equal(gallery.recordInstall("plug-a", "user-a").ok, true);
    assert.equal(gallery.recordInstall("plug-b", "user-a").ok, true);
    assert.equal(gallery.recordInstall("plug-c", "user-b").ok, true);
    assert.equal(gallery.ratePlugin("plug-a", "user-a", "up").ok, true);
    assert.equal(gallery.ratePlugin("plug-c", "user-b", "down").ok, true);
  });

  it("registers a provider for the plugins domain", () => {
    assert.equal(hasLensExportProvider("plugins"), true);
  });

  it("exports the caller's installs and ratings", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "plugins",
      ctx: { actor: { userId: "user-a" } },
    });
    assert.equal(out.ok, true);
    const installs = out.artifacts.filter((r) => r.type === "plugin-install");
    const byId = new Map(installs.map((r) => [r.id, r]));
    assert.ok(byId.get("plug-a"), "first install present");
    assert.equal(byId.get("plug-a").title, "Alpha Tools");
    assert.equal(byId.get("plug-a").data.version, "1.2.0");
    assert.equal(byId.get("plug-a").data.authorId, "author-1");
    assert.ok(byId.get("plug-b"), "second install present");
    const rating = out.artifacts.find((r) => r.type === "plugin-rating");
    assert.ok(rating, "rating present");
    assert.equal(rating.data.pluginId, "plug-a");
    assert.equal(rating.data.vote, "up");
  });

  it("never leaks another user's installs or ratings", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "plugins",
      ctx: { actor: { userId: "user-a" } },
    });
    assert.equal(out.artifacts.some((r) => r.id === "plug-c"), false);
    assert.equal(out.artifacts.some((r) => r.id === "plug-c:rating"), false);
  });

  it("exports nothing for an anonymous caller", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "plugins", ctx: {},
    });
    assert.equal(out.artifacts.length, 0);
  });
});
