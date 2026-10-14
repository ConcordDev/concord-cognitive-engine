// INC-SWEEP debate F2 — floor artifact create/list/detail must not echo raw
// user uuids (INC-60/77 class). Authz still uses stored ownerId: owner can
// update/delete; acct2 cannot.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import registerDebateActions from "../domains/debate.js";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const OWNER = "6f4308d5-039c-45ac-bd9c-254d0c498b0d";
const OTHER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function assertNoRawUserUuid(payload, label) {
  const blob = JSON.stringify(payload);
  assert.equal(blob.includes(OWNER), false, `${label} leaked OWNER uuid`);
  assert.equal(blob.includes(OTHER), false, `${label} leaked OTHER uuid`);
  assert.equal(UUID_RE.test(blob), false, `${label} contained a raw uuid: ${blob.slice(0, 400)}`);
}

describe("debate floor artifact privacy (F2)", () => {
  let runMacro;
  let STATE;
  let makeInternalCtx;

  before(async () => {
    ({ runMacro, STATE, makeInternalCtx } = await load());
  });

  // lens.create's scope-check needs ctx.macro.run (makeInternalCtx); bare
  // {actor} objects always fall through to scope_denied.
  function ctxFor(userId) {
    const ctx = makeInternalCtx(userId);
    ctx.actor = { userId, role: "member", scope: "local", scopes: ["*"] };
    ctx.userId = userId;
    ctx.internal = false;
    return ctx;
  }

  it("create + list + get strip raw owner uuid; owner update/delete still work; acct2 refused", async () => {
    const created = await runMacro("lens", "create", {
      domain: "debate",
      type: "debate",
      title: "Sweep floor privacy",
      data: {
        topic: "Sweep floor privacy",
        description: "no raw ids",
        status: "open",
        format: "oxford",
        proArguments: [],
        conArguments: [],
        proVotes: 0,
        conVotes: 0,
      },
    }, ctxFor(OWNER));
    assert.equal(created.ok, true, JSON.stringify(created));
    assertNoRawUserUuid(created, "create");
    assert.equal(created.artifact.ownerId, undefined);
    assert.equal(typeof created.artifact.owner, "object");
    assert.equal(created.artifact.owner.isMine, true);

    // Stored row still has the real ownerId for authz.
    const stored = STATE.lensArtifacts.get(created.artifact.id);
    assert.equal(stored.ownerId, OWNER);

    const listed = await runMacro("lens", "list", { domain: "debate", type: "debate" }, ctxFor(OWNER));
    assert.equal(listed.ok, true);
    const mine = (listed.artifacts || []).find((a) => a.id === created.artifact.id);
    assert.ok(mine, "created artifact missing from list");
    assertNoRawUserUuid(mine, "list item");
    assert.equal(mine.ownerId, undefined);

    const got = await runMacro("lens", "get", { id: created.artifact.id, domain: "debate" }, ctxFor(OWNER));
    assert.equal(got.ok, true);
    assertNoRawUserUuid(got, "get");
    assert.equal(got.artifact.ownerId, undefined);

    const updated = await runMacro("lens", "update", {
      id: created.artifact.id,
      title: "Sweep floor privacy edited",
      data: { description: "owner edit ok" },
    }, ctxFor(OWNER));
    assert.equal(updated.ok, true, JSON.stringify(updated));
    assertNoRawUserUuid(updated, "update");

    const hijack = await runMacro("lens", "update", {
      id: created.artifact.id,
      title: "hijacked",
    }, ctxFor(OTHER));
    assert.equal(hijack.ok, false, "acct2 must not update owner's debate");

    const steal = await runMacro("lens", "delete", { id: created.artifact.id }, ctxFor(OTHER));
    assert.equal(steal.ok, false, "acct2 must not delete owner's debate");

    const deleted = await runMacro("lens", "delete", { id: created.artifact.id }, ctxFor(OWNER));
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
  });

  it("argument-map debate.* create/list/detail payloads carry no raw user uuid", () => {
    const ACTIONS = new Map();
    registerDebateActions((domain, name, fn) => {
      assert.equal(domain, "debate");
      ACTIONS.set(name, fn);
    });
    globalThis._concordSTATE = { debateLens: { debates: new Map() } };
    globalThis._concordSaveStateDebounced = () => {};

    const call = (name, ctx, params = {}) =>
      ACTIONS.get(name)(ctx, { id: null, data: {}, meta: {} }, params);

    const ctxA = { actor: { userId: OWNER }, userId: OWNER };
    const ctxB = { actor: { userId: OTHER }, userId: OTHER };

    const created = call("debate-create", ctxA, { thesis: "Privacy thesis stays on the map here." });
    assert.equal(created.ok, true);
    assertNoRawUserUuid(created, "debate-create");

    const listed = call("debate-list", ctxA, {});
    assert.equal(listed.ok, true);
    assertNoRawUserUuid(listed, "debate-list");
    assert.equal(listed.result.count, 1);

    const detail = call("debate-detail", ctxA, { id: created.result.debate.id });
    assert.equal(detail.ok, true);
    assertNoRawUserUuid(detail, "debate-detail");

    // acct2 isolation: empty list, no leak of owner's thesis id via list.
    const listedB = call("debate-list", ctxB, {});
    assert.equal(listedB.result.count, 0);
    assertNoRawUserUuid(listedB, "debate-list acct2");
  });
});
