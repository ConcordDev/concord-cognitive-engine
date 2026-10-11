// Whiteboards are owner-scoped: a board is listed, opened and updated only by
// the user who created it. Boards stored before ownerId was recorded (no
// owner) stay reachable so existing users don't lose them.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { macroRuntime, load } from "./_harness.js";

process.env.CONCORD_RATE_LIMIT_BYPASS = process.env.CONCORD_RATE_LIMIT_BYPASS || "1";
process.env.CONCORD_LOAD_SHED_ENABLED = process.env.CONCORD_LOAD_SHED_ENABLED || "0";

describe("whiteboard ownership", () => {
  let runMacro, STATE, alice, bob;
  before(async () => {
    ({ runMacro, STATE, ctx: alice } = await macroRuntime("wb-alice"));
    ({ ctx: bob } = await macroRuntime("wb-bob"));
  });

  it("the creator lists, opens and updates their board", async () => {
    const c = await runMacro("whiteboard", "create", { title: "Plan" }, alice);
    assert.equal(c.ok, true);
    const list = await runMacro("whiteboard", "list", {}, alice);
    assert.ok(list.whiteboards.some((w) => w.id === c.dtuId));
    const u = await runMacro("whiteboard", "update", { whiteboardId: c.dtuId, elements: [{ id: "e1", type: "rectangle" }] }, alice);
    assert.equal(u.ok, true);
    const g = await runMacro("whiteboard", "get", { whiteboardId: c.dtuId }, alice);
    assert.equal(g.whiteboard.elements.length, 1);
  });

  it("another user can't see, open or overwrite it", async () => {
    const c = await runMacro("whiteboard", "create", { title: "Private" }, alice);
    const list = await runMacro("whiteboard", "list", {}, bob);
    assert.equal(list.whiteboards.some((w) => w.id === c.dtuId), false);
    const hidden = await runMacro("whiteboard", "get", { whiteboardId: c.dtuId }, bob);
    const missing = await runMacro("whiteboard", "get", { whiteboardId: "wb_does_not_exist" }, bob);
    assert.equal(hidden.ok, false);
    assert.equal(hidden.status, 404);
    assert.equal(hidden.error, "Whiteboard not found");
    assert.equal(hidden.whiteboard, undefined);
    assert.equal(missing.status, 404);
    assert.equal(missing.error, hidden.error);
    const anon = await runMacro("whiteboard", "get", { whiteboardId: c.dtuId }, { actor: { userId: "anon", role: "viewer", scopes: ["read"] }, internal: true });
    assert.equal(anon.status, 404);
    assert.equal(anon.error, "Whiteboard not found");
    assert.equal(anon.whiteboard, undefined);
    const u = await runMacro("whiteboard", "update", { whiteboardId: c.dtuId, elements: [{ id: "nope" }] }, bob);
    assert.equal(u.ok, false);
    assert.equal(u.status, 404);
    const g = await runMacro("whiteboard", "get", { whiteboardId: c.dtuId }, alice);
    assert.equal(g.ok, true);
    assert.equal(g.whiteboard.elements.length, 0);
  });

  it("boards without a recorded owner stay reachable", async () => {
    const id = "wb_legacy_test";
    STATE.dtus.set(id, { id, title: "Whiteboard: Old", machine: { kind: "whiteboard", data: { id, title: "Old", elements: [] } }, lineage: { parents: [] }, createdAt: new Date().toISOString() });
    const r = await runMacro("whiteboard", "get", { whiteboardId: id }, bob);
    assert.equal(r.ok, true);
    assert.equal(r.whiteboard.id, id);
    assert.equal(r.whiteboard.title, "Old");
    STATE.dtus.delete(id);
  });

  it("the owner can rename and delete; a stranger gets 403 and the board stays", async () => {
    const c = await runMacro("whiteboard", "create", { title: "Plan" }, alice);
    assert.equal(c.ok, true);
    const renamed = await runMacro("whiteboard", "rename", { whiteboardId: c.dtuId, title: "Plan v2" }, alice);
    assert.equal(renamed.ok, true);
    assert.equal(renamed.whiteboard.title, "Plan v2");
    const again = await runMacro("whiteboard", "get", { whiteboardId: c.dtuId }, alice);
    assert.equal(again.whiteboard.title, "Plan v2");

    const stranger = await runMacro("whiteboard", "delete", { whiteboardId: c.dtuId }, bob);
    assert.equal(stranger.ok, false);
    assert.equal(stranger.status, 403);
    assert.equal(stranger.error, "owner_required");
    assert.equal((await runMacro("whiteboard", "get", { whiteboardId: c.dtuId }, alice)).ok, true);

    const gone = await runMacro("whiteboard", "delete", { whiteboardId: c.dtuId }, alice);
    assert.equal(gone.ok, true);
    assert.equal((await runMacro("whiteboard", "get", { whiteboardId: c.dtuId }, alice)).ok, false);
    const missing = await runMacro("whiteboard", "delete", { whiteboardId: c.dtuId }, alice);
    assert.equal(missing.status, 404);
  });

  it("a board with no owner cannot be deleted by a caller", async () => {
    const id = "wb_legacy_delete";
    STATE.dtus.set(id, { id, title: "Whiteboard: Old", machine: { kind: "whiteboard", data: { id, title: "Old", elements: [] } }, lineage: { parents: [] }, createdAt: new Date().toISOString() });
    const r = await runMacro("whiteboard", "delete", { whiteboardId: id }, bob);
    assert.equal(r.status, 403);
    assert.equal(STATE.dtus.has(id), true);
    STATE.dtus.delete(id);
  });

  it("lists most recently updated first", async () => {
    const a = await runMacro("whiteboard", "create", { title: "Older" }, alice);
    await new Promise((r) => setTimeout(r, 5));
    const b = await runMacro("whiteboard", "create", { title: "Newer" }, alice);
    await new Promise((r) => setTimeout(r, 5));
    await runMacro("whiteboard", "update", { whiteboardId: a.dtuId, elements: [{ id: "x", type: "line" }] }, alice);
    const ids = (await runMacro("whiteboard", "list", {}, alice)).whiteboards.map((w) => w.id);
    assert.ok(ids.indexOf(a.dtuId) < ids.indexOf(b.dtuId));
  });

  it("keeps the lens artifact in step from create through rename to delete", async () => {
    const c = await runMacro("whiteboard", "create", { title: "Plan", linkedDtus: ["dtu_a"] }, alice);
    assert.equal(c.ok, true);
    const id = c.dtuId;
    const artifactId = c.whiteboard.artifactId;
    assert.ok(artifactId);
    const listed = (await runMacro("whiteboard", "list", {}, alice)).whiteboards.find((w) => w.id === id);
    assert.equal(listed.title, "Whiteboard: Plan");
    assert.equal((await runMacro("whiteboard", "get", { whiteboardId: id }, alice)).whiteboard.title, "Plan");

    const shadows = () => [...STATE.lensArtifacts.values()].filter((a) => a?.domain === "whiteboard" && a?.type === "board" && (a.data?.whiteboardId === id || a.id === artifactId));
    assert.equal(shadows().length, 1);
    assert.equal(shadows()[0].title, "Plan");
    assert.equal(shadows()[0].ownerId, alice.actor.userId);
    assert.equal(shadows()[0].data.whiteboardId, id);
    assert.deepEqual(shadows()[0].data.elements, undefined);

    const renamed = await runMacro("whiteboard", "rename", { whiteboardId: id, title: "Plan v2" }, alice);
    assert.equal(renamed.ok, true);
    assert.equal(shadows().length, 1);
    assert.equal(shadows()[0].id, artifactId);
    assert.equal(shadows()[0].title, "Plan v2");
    assert.equal(STATE.dtus.get(id).title, "Whiteboard: Plan v2");

    const stranger = await runMacro("whiteboard", "delete", { whiteboardId: id }, bob);
    assert.equal(stranger.status, 403);
    assert.equal(shadows().length, 1);

    const gone = await runMacro("whiteboard", "delete", { whiteboardId: id }, alice);
    assert.equal(gone.ok, true);
    assert.equal(STATE.dtus.has(id), false);
    assert.equal(shadows().length, 0);
    const still = await runMacro("lens", "list", { domain: "whiteboard", type: "board", limit: 200 }, alice);
    // Match this board only. Earlier cases in this file leave other boards titled "Plan".
    assert.equal(still.artifacts.some((a) => a.id === artifactId || a.data?.whiteboardId === id), false);
  });

  it("renames and deletes the unlinked shadow the studio used to write", async () => {
    const c = await runMacro("whiteboard", "create", { title: "Legacy" }, alice);
    const artifact = STATE.lensArtifacts.get(c.whiteboard.artifactId);
    delete artifact.data.whiteboardId;
    delete c.whiteboard.artifactId;
    STATE.lensArtifacts.set(artifact.id, artifact);

    const renamed = await runMacro("whiteboard", "rename", { whiteboardId: c.dtuId, title: "Legacy v2" }, alice);
    assert.equal(renamed.ok, true);
    const after = STATE.lensArtifacts.get(artifact.id);
    assert.equal(after.title, "Legacy v2");
    assert.equal(after.data.whiteboardId, c.dtuId);

    await runMacro("whiteboard", "delete", { whiteboardId: c.dtuId }, alice);
    assert.equal(STATE.lensArtifacts.has(artifact.id), false);
  });

  it("does not guess when two unlinked shadows share a title", async () => {
    const c = await runMacro("whiteboard", "create", { title: "Twin" }, alice);
    STATE.lensArtifacts.delete(c.whiteboard.artifactId);
    const extra = await runMacro("lens", "create", {
      domain: "whiteboard", type: "board", title: "Twin",
      data: { linkedDtus: [], createdAt: new Date().toISOString() },
    }, alice);
    const extra2 = await runMacro("lens", "create", {
      domain: "whiteboard", type: "board", title: "Twin",
      data: { linkedDtus: [], createdAt: new Date().toISOString() },
    }, alice);
    assert.equal(extra.ok, true, extra.error);
    assert.equal(extra2.ok, true, extra2.error);
    await runMacro("whiteboard", "delete", { whiteboardId: c.dtuId }, alice);
    assert.equal(STATE.lensArtifacts.has(extra.artifact.id), true);
    assert.equal(STATE.lensArtifacts.has(extra2.artifact.id), true);
    assert.equal(extra.artifact.data.whiteboardId, undefined);
  });
});

function boardShadows(state, whiteboardId) {
  return [...state.lensArtifacts.values()].filter((a) => a?.domain === "whiteboard" && a?.type === "board" && a?.data?.whiteboardId === whiteboardId);
}

describe("whiteboard HTTP", () => {
  let base;
  let server;
  let STATE;
  let alice;
  let bob;

  before(async () => {
    const loaded = await load();
    STATE = loaded.STATE;
    server = loaded.app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    base = `http://127.0.0.1:${server.address().port}`;
    const stamp = randomUUID().slice(0, 8);
    alice = await registerUser(base, `wbhttp_a_${stamp}`);
    bob = await registerUser(base, `wbhttp_b_${stamp}`);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("create, rename, and delete leave no orphan, and a stranger or anonymous read is 404", async () => {
    const created = await api(base, "POST", "/api/whiteboard", { token: alice.token, body: { title: "Live", linkedDtus: [] } });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.ok, true);
    const id = created.data.dtuId;
    assert.match(id, /^wb_/);
    assert.equal(created.data.whiteboard.title, "Live");

    const list = await api(base, "GET", "/api/whiteboards", { token: alice.token });
    assert.equal(list.status, 200);
    assert.equal(list.data.whiteboards.find((w) => w.id === id).title, "Whiteboard: Live");

    const mine = await api(base, "GET", "/api/lens/whiteboard?type=board&limit=200", { token: alice.token });
    const shadow = mine.data.artifacts.filter((a) => a.data?.whiteboardId === id);
    assert.equal(shadow.length, 1);
    assert.equal(shadow[0].title, "Live");
    assert.equal(shadow[0].type, "board");

    const theirs = await api(base, "GET", "/api/lens/whiteboard?type=board&limit=200", { token: bob.token });
    assert.equal(theirs.data.artifacts.some((a) => a.data?.whiteboardId === id || a.id === shadow[0].id), false);

    const renamed = await api(base, "PATCH", `/api/whiteboard/${id}`, { token: alice.token, body: { title: "Live v2" } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
    assert.equal(renamed.data.whiteboard.title, "Live v2");
    const afterRename = await api(base, "GET", "/api/lens/whiteboard?type=board&limit=200", { token: alice.token });
    const renamedShadow = afterRename.data.artifacts.filter((a) => a.data?.whiteboardId === id || a.id === shadow[0].id);
    assert.equal(renamedShadow.length, 1);
    assert.equal(renamedShadow[0].title, "Live v2");

    const ownerGet = await api(base, "GET", `/api/whiteboard/${id}`, { token: alice.token });
    assert.equal(ownerGet.status, 200);
    assert.equal(ownerGet.data.whiteboard.title, "Live v2");

    const bobGet = await api(base, "GET", `/api/whiteboard/${id}`, { token: bob.token });
    const anonGet = await api(base, "GET", `/api/whiteboard/${id}`);
    const missingGet = await api(base, "GET", "/api/whiteboard/wb_missing_http");
    for (const res of [bobGet, anonGet, missingGet]) {
      assert.equal(res.status, 404, JSON.stringify(res.data));
      assert.equal(res.data.ok, false);
      assert.equal(res.data.error, "Whiteboard not found");
      assert.equal(res.data.whiteboard, undefined);
      assert.equal(JSON.stringify(res.data).includes("Live"), false);
    }
    assert.equal(bobGet.data.error, missingGet.data.error);

    const bobPut = await api(base, "PUT", `/api/whiteboard/${id}`, { token: bob.token, body: { elements: [{ id: "x" }] } });
    assert.equal(bobPut.status, 404);
    assert.equal(bobPut.data.whiteboard, undefined);
    assert.equal((await api(base, "GET", `/api/whiteboard/${id}`, { token: alice.token })).data.whiteboard.elements.length, 0);

    const bobDel = await api(base, "DELETE", `/api/whiteboard/${id}`, { token: bob.token });
    assert.equal(bobDel.status, 403);
    assert.equal(STATE.dtus.has(id), true);

    const deleted = await api(base, "DELETE", `/api/whiteboard/${id}`, { token: alice.token });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.equal(deleted.data.deleted, true);
    const afterDelete = await api(base, "GET", "/api/lens/whiteboard?type=board&limit=200", { token: alice.token });
    assert.equal(afterDelete.data.artifacts.some((a) => a.id === shadow[0].id || a.data?.whiteboardId === id || a.title === "Live" || a.title === "Live v2"), false);
    assert.equal(boardShadows(STATE, id).length, 0);
    const gone = await api(base, "GET", `/api/whiteboard/${id}`, { token: alice.token });
    assert.equal(gone.status, 404);
    assert.equal(gone.data.error, "Whiteboard not found");

    const legacyId = `wb_legacy_http_${randomUUID().slice(0, 8)}`;
    STATE.dtus.set(legacyId, {
      id: legacyId,
      title: "Whiteboard: Old",
      machine: { kind: "whiteboard", data: { id: legacyId, title: "Old", elements: [] } },
      lineage: { parents: [] },
      createdAt: new Date().toISOString(),
    });
    const legacy = await api(base, "GET", `/api/whiteboard/${legacyId}`);
    assert.equal(legacy.status, 200);
    assert.equal(legacy.data.ok, true);
    assert.equal(legacy.data.whiteboard.title, "Old");
    STATE.dtus.delete(legacyId);
  });
});

async function registerUser(base, username) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username,
      email: `${username}@whiteboard.test`,
      password: "Whiteboard_Test_12345!",
      dateOfBirth: "1990-01-01",
    }),
  });
  const data = await res.json();
  assert.equal(res.status, 201, JSON.stringify(data));
  assert.ok(data.token);
  assert.ok(data.user?.id);
  return data;
}

async function api(base, method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, data };
}
