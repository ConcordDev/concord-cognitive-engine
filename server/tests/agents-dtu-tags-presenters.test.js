// INC-SWEEP agents F14 — prove batch 022 dtu.create tag discipline + public
// actor labels on the Agents surface (Save-as-DTU tags; assign/comment).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./depth/_harness.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

describe("agents F14 tags + presenters (ALREADY-CLOSED shared)", () => {
  let runMacro, ctx, STATE, LENS_ACTIONS;

  before(async () => {
    ({ runMacro, ctx, STATE } = await macroRuntime("agt-f14-tags"));
    LENS_ACTIONS = globalThis.__concordLensActions;
    assert.ok(LENS_ACTIONS, "LENS_ACTIONS missing");
  });

  it("dtu.create with caller tags does not add code/entity", async () => {
    const sent = ["real-data", "concord-agents", "agents", "roster"];
    const r = await runMacro("dtu", "create", {
      title: "Agent note tags",
      content: "Roster note with aperture and weld markers that must not auto-tag.",
      tags: sent,
      source: "concord-agents",
      contentClass: "dataset",
      visibility: "private",
      isGlobal: false,
    }, ctx);
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 240));
    const tags = r.dtu?.tags || [];
    assert.deepEqual(tags.slice().sort(), sent.slice().sort());
    assert.ok(!tags.includes("code"), String(tags));
    assert.ok(!tags.includes("entity"), String(tags));
  });

  it("agents.comment author is a public label, not a raw uuid", () => {
    const uuid = "906f92c4-a991-4ea5-ac07-2fb210e2ef85";
    const art = {
      id: "lart_f14_cmt",
      domain: "agents",
      title: "C",
      data: {},
      meta: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(art.id, art);
    const cctx = { actor: { userId: uuid, role: "member", username: "qa_sweep_k" } };
    const out = LENS_ACTIONS.get("agents.comment")(cctx, art, { text: "hello", id: art.id });
    assert.equal(out.ok, true);
    assert.notEqual(out.comment.author, uuid);
    assert.ok(out.comment.author === "qa_sweep_k" || out.comment.author === "member");
    assert.equal(shapeLensRunHttp(out).status, 200);
  });
});
