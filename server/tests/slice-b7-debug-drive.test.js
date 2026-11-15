import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDebug from "../domains/debug.js";
const ACTIONS = new Map();
function register(d, n, fn) { ACTIONS.set(`${d}.${n}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`debug.${name}`);
  assert.ok(fn, `debug.${name} missing`);
  return await fn(ctx, { id: null, domain: "debug", type: "domain_action", data: params, meta: {} }, params);
}
before(() => registerDebug(register));
beforeEach(() => { globalThis._concordSTATE = {}; });
const u1 = { actor: { userId: "u1" } };
describe("FIX-debug-006 drive — release-update", () => {
  it("rename reties issues, collision refused, notes edit lands", async () => {
    const r1 = await call("release-create", u1, { version: "v1.0", environment: "production", notes: "first" });
    assert.equal(r1.ok, true);
    const id1 = r1.result.release.id;
    const r2 = await call("release-create", u1, { version: "v2.0" });
    assert.equal(r2.ok, true);
    const ing = await call("issue-ingest", u1, { type: "error", message: "boom", release: "v1.0" });
    assert.equal(ing.ok, true);
    let list = await call("release-list", u1, {});
    assert.equal(list.result.releases.find((r) => r.version === "v1.0").issueCount, 1);

    const ren = await call("release-update", u1, { id: id1, version: "v1.1" });
    assert.equal(ren.ok, true);
    list = await call("release-list", u1, {});
    const renamed = list.result.releases.find((r) => r.version === "v1.1");
    assert.ok(renamed, "the renamed release is listed");
    assert.equal(renamed.issueCount, 1, "the issue followed the rename");

    const collide = await call("release-update", u1, { id: id1, version: "v2.0" });
    assert.equal(collide.ok, false);
    assert.match(collide.error, /release already tracked/);

    const notes = await call("release-update", u1, { id: id1, notes: "hotfix notes" });
    assert.equal(notes.ok, true);
    assert.equal(notes.result.release.notes, "hotfix notes");
    const missing = await call("release-update", u1, { id: "nope", notes: "x" });
    assert.equal(missing.ok, false);
  });
});
