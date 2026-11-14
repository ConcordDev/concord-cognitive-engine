import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSuffering from "../domains/suffering.js";
const ACTIONS = new Map();
function register(d, n, fn) { ACTIONS.set(`${d}.${n}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`suffering.${name}`);
  assert.ok(fn, `suffering.${name} missing`);
  return await fn(ctx, { id: null, domain: "suffering", type: "domain_action", data: params, meta: {} }, params);
}
before(() => registerSuffering(register));
beforeEach(() => { globalThis._concordSTATE = {}; });
const u1 = { actor: { userId: "u1" } };
describe("FIX-suffering-004 drive — theme-update + intervention title", () => {
  it("a theme renames/recolors in place and member pains keep the link", async () => {
    const theme = (await call("theme-create", u1, { name: "Onbording", color: "#6366f1" })).result.theme;
    const pain = (await call("pain-create", u1, { title: "setup hurts", themeId: theme.id })).result.pain;
    const upd = await call("theme-update", u1, { id: theme.id, name: "Onboarding", description: "first-run pain" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.theme.name, "Onboarding");
    const list = await call("theme-list", u1, {});
    assert.equal(list.result.themes[0].painCount, 1);
    assert.equal(list.result.themes[0].description, "first-run pain");
    const bad = await call("theme-update", u1, { id: theme.id, name: "  " });
    assert.equal(bad.ok, false);
    assert.equal(pain.themeId, theme.id);
  });
  it("an intervention retitles via intervention-update", async () => {
    const iv = (await call("intervention-track", u1, { title: "Fix it somehow" })).result.intervention;
    const upd = await call("intervention-update", u1, { id: iv.id, title: "Guided setup wizard" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.intervention.title, "Guided setup wizard");
  });
});
