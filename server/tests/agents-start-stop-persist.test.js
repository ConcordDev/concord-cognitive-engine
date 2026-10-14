// INC-SWEEP agents F4 — start/stop persist enabled + isRunning on the fleet row.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";

describe("agents F4 start/stop persistence", () => {
  let STATE, LENS_ACTIONS;

  before(async () => {
    const t = await load();
    STATE = t.STATE;
    LENS_ACTIONS = t.LENS_ACTIONS || globalThis.__concordLensActions;
  });

  it("start then GET shows enabled/isRunning; stop clears them", () => {
    const id = `lart_f4_${Date.now().toString(36)}`;
    const art = {
      id,
      domain: "agents",
      type: "agent",
      title: "Persist me",
      ownerId: "u_f4",
      data: { status: "dormant", enabled: false, isRunning: false, tickCount: 0 },
      meta: { visibility: "private" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(id, art);
    const ctx = { actor: { userId: "u_f4", role: "member" } };
    const start = LENS_ACTIONS.get("agents.start")(ctx, art, {});
    assert.equal(start.ok, true);
    assert.equal(start.status, "active");
    const afterStart = STATE.lensArtifacts.get(id);
    assert.equal(afterStart.data.status, "active");
    assert.equal(afterStart.data.enabled, true);
    assert.equal(afterStart.data.isRunning, true);

    const stop = LENS_ACTIONS.get("agents.stop")(ctx, afterStart, {});
    assert.equal(stop.ok, true);
    const afterStop = STATE.lensArtifacts.get(id);
    assert.equal(afterStop.data.status, "dormant");
    assert.equal(afterStop.data.enabled, false);
    assert.equal(afterStop.data.isRunning, false);
  });
});
