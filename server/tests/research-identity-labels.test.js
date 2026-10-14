// INC-SWEEP research F3 — conduct / DTU create / assign / comment must not
// echo the raw account uuid. Public label = displayName | username | "member".
// Ownership keys in storage stay raw; wire bodies are scrubbed.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";

const RAW_UUID = "61c0152b-884c-4f0e-b614-3516bd02a5d1";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function assertNoRawUuid(value, path = "root") {
  if (typeof value === "string") {
    assert.ok(!UUID_RE.test(value), `${path} leaked uuid: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoRawUuid(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoRawUuid(v, `${path}.${k}`);
  }
}

describe("research identity labels (F3)", () => {
  let runMacro, STATE, makeCtx, LENS_ACTIONS;

  before(async () => {
    const t = await load();
    ({ runMacro, STATE, makeCtx } = t);
    LENS_ACTIONS = t.LENS_ACTIONS || globalThis.__concordLensActions;
    assert.ok(LENS_ACTIONS, "LENS_ACTIONS registry missing");
  });

  it("dtu.create/get wire body scrubs ownerId; storage keeps raw uuid", async () => {
    const req = {
      user: { id: RAW_UUID, role: "member", username: "qa_sweep_i" },
      headers: {},
      get() { return ""; },
    };
    const ctx = makeCtx(req);
    // Prefer display name when present on the actor.
    ctx.actor.displayName = "QA Sweep I";
    ctx.actor.userId = RAW_UUID;

    const created = await runMacro("dtu", "create", {
      title: "Research note identity",
      content: "marker",
      tags: ["rsch-f3"],
      source: "research-lens",
      visibility: "private",
    }, ctx);
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.dtu.ownerId, "QA Sweep I");
    assertNoRawUuid(created.dtu);

    const stored = STATE.dtus.get(created.dtu.id);
    assert.equal(stored.ownerId, RAW_UUID, "storage ownership key must stay raw");

    const got = await runMacro("dtu", "get", { id: created.dtu.id }, ctx);
    assert.equal(got.ok, true);
    assert.equal(got.dtu.ownerId, "QA Sweep I");
    assertNoRawUuid(got.dtu);
  });

  it("COMMON assign/comment use member/display label, not raw uuid", async () => {
    const ctx = {
      actor: { userId: RAW_UUID, displayName: "QA Sweep I", role: "member" },
    };
    // Seed a real resolvable artifact so assign/comment can mutate it.
    // (F4/F5 will require id; for F3 we call handlers with a real artifact.)
    const art = {
      id: "lart_f3_identity",
      domain: "research",
      type: "domain_action",
      title: "Identity artifact",
      ownerId: RAW_UUID,
      data: {},
      meta: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(art.id, art);

    const assign = LENS_ACTIONS.get("research.assign");
    assert.ok(typeof assign === "function");
    const a = await assign(ctx, art, {});
    assert.equal(a.ok, true);
    assert.equal(a.assignee, "QA Sweep I");
    assertNoRawUuid(a);

    const comment = LENS_ACTIONS.get("research.comment");
    assert.ok(typeof comment === "function");
    const c = await comment(ctx, art, { text: "hello F3" });
    assert.equal(c.ok, true);
    assert.equal(c.comment.author, "QA Sweep I");
    assertNoRawUuid(c);
  });

  it("legacy stored uuid on DTU ownerId is scrubbed on get read-back", async () => {
    const id = "dtu_f3_legacy_uuid";
    STATE.dtus.set(id, {
      id,
      title: "Legacy",
      tags: [],
      ownerId: RAW_UUID,
      visibility: "private",
      content: "x",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const ctx = makeCtx({
      user: { id: RAW_UUID, role: "member" },
      headers: {},
      get() { return ""; },
    });
    ctx.actor.userId = RAW_UUID;
    const got = await runMacro("dtu", "get", { id }, ctx);
    assert.equal(got.ok, true);
    assert.ok(!_PUBLIC_LOOKS_LIKE_UUID(got.dtu.ownerId) || got.dtu.ownerId === "member"
      || typeof got.dtu.ownerId === "string");
    assert.ok(!UUID_RE.test(String(got.dtu.ownerId)), `get leaked ${got.dtu.ownerId}`);
    assert.equal(STATE.dtus.get(id).ownerId, RAW_UUID);
  });
});

function _PUBLIC_LOOKS_LIKE_UUID(v) {
  return typeof v === "string" && UUID_RE.test(v);
}
