// INC-SWEEP agents F1 (private shadow DTU) + F3 (title required).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

describe("agents F3 title required", () => {
  let runMacro;

  before(async () => {
    const t = await load();
    runMacro = t.runMacro;
  });

  it("blank agents title refuses", async () => {
    const ctx = { actor: { userId: "u_f3", role: "member" }, macro: { run: async () => ({ allowed: true }) } };
    // bridge.lensScope via ctx.macro.run — provide permissive stub
    ctx.macro = {
      run: async (domain, name) => {
        if (name === "bridge.lensScope") return { ok: true, allowed: true };
        return { ok: false };
      },
    };
    const r = await runMacro("lens", "create", { domain: "agents", type: "agent", title: "", data: {} }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.error, /title required/i);
    assert.equal(shapeLensRunHttp(r).status, 422);
  });

  it("titled agents create persists and re-reads", async () => {
    const ctx = {
      actor: { userId: "u_f3", role: "member" },
      macro: { run: async (_d, name) => (name === "bridge.lensScope" ? { ok: true, allowed: true } : { ok: false }) },
    };
    const r = await runMacro("lens", "create", {
      domain: "agents", type: "agent", title: "Agent f3 titled", data: { tools: ["classify"] },
    }, ctx);
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    const id = r.artifact?.id || r.result?.artifact?.id;
    assert.ok(id);
    const get = await runMacro("lens", "get", { id, domain: "agents" }, ctx);
    assert.equal(get.ok, true);
    const title = get.artifact?.title || get.result?.artifact?.title || get.title;
    assert.equal(title, "Agent f3 titled");
  });
});

describe("agents F1 shadow DTU is private", () => {
  let runMacro, STATE;

  before(async () => {
    const t = await load();
    runMacro = t.runMacro;
    STATE = t.STATE;
  });

  it("create exhaust DTU carries ownerId + private visibility", async () => {
    const owner = "u_f1_owner";
    const ctx = {
      actor: { userId: owner, role: "member" },
      macro: { run: async (_d, name) => (name === "bridge.lensScope" ? { ok: true, allowed: true } : { ok: false }) },
    };
    const before = STATE.dtus.size;
    const r = await runMacro("lens", "create", {
      domain: "agents", type: "agent", title: "Agent f1 private", data: {},
    }, ctx);
    assert.equal(r.ok, true);
    // Find a newly emitted lens exhaust DTU.
    let found = null;
    for (const d of STATE.dtus.values()) {
      if (d.title?.startsWith("Lens:agents create") && d.ownerId === owner) {
        found = d;
        break;
      }
    }
    assert.ok(found, `no private exhaust DTU after create (dtus grew ${STATE.dtus.size - before})`);
    assert.equal(found.visibility, "private");
    assert.equal(found.ownerId, owner);
  });
});
