// INC-SWEEP agents F10 — /api/agents/swarm|evaluate|route must not 500 on {}.
// Mirrors the LENS_ACTIONS dispatch now used in routes/domain.js (not runMacro).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { asyncHandler } from "../lib/async-handler.js";

describe("agents F10 swarm/evaluate/route empty body", () => {
  let port;
  let server;

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
  });

  before(async () => {
    const handlers = new Map();
    const { default: registerAgents } = await import("../domains/agents.js");
    registerAgents((domain, name, fn) => handlers.set(`${domain}.${name}`, fn));
    globalThis.__concordLensActions = handlers;

    async function runAgentsLensAction(name, input, ctx) {
      const fn = globalThis.__concordLensActions.get(`agents.${name}`);
      const artifact = { id: null, domain: "agents", title: "", data: {}, meta: {} };
      return await fn(ctx, artifact, input || {});
    }
    const makeCtx = () => ({ actor: { userId: "u_f10" }, userId: "u_f10" });
    const app = express();
    app.use(express.json());
    app.get("/api/agents/swarm", asyncHandler(async (req, res) => {
      const out = await runAgentsLensAction("swarmStatus", req.query, makeCtx());
      return res.status(out?.ok === false ? 400 : 200).json(out);
    }));
    app.post("/api/agents/evaluate", asyncHandler(async (req, res) => {
      const out = await runAgentsLensAction("evaluateCapability", req.body, makeCtx());
      return res.status(out?.ok === false ? 400 : 200).json(out);
    }));
    app.post("/api/agents/route", asyncHandler(async (req, res) => {
      const out = await runAgentsLensAction("routeTask", req.body, makeCtx());
      return res.status(out?.ok === false ? 400 : 200).json(out);
    }));
    server = await new Promise((r) => {
      const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    port = server.address().port;
  });

  it("GET swarm and POST evaluate/route on {} return non-500 honest bodies", async () => {
    const swarm = await fetch(`http://127.0.0.1:${port}/api/agents/swarm`);
    const swarmBody = await swarm.json();
    assert.notEqual(swarm.status, 500);
    assert.equal(swarmBody.ok, true);
    assert.equal(swarmBody.result.totalAgents, 0);

    const ev = await fetch(`http://127.0.0.1:${port}/api/agents/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const evBody = await ev.json();
    assert.notEqual(ev.status, 500);
    assert.equal(evBody.ok, true);

    const rt = await fetch(`http://127.0.0.1:${port}/api/agents/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const rtBody = await rt.json();
    assert.notEqual(rt.status, 500);
    assert.equal(rtBody.ok, true);
    assert.match(rtBody.result.message || "", /No agents available/i);
  });
});
