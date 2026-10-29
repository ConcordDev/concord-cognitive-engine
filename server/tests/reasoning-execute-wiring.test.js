// REASONING-EXECUTE-WIRING regression test (FIX-ALL Q30, audit row A#37).
//
// Pins the fix for: POST /api/reasoning/execute only worked when a caller
// injected STATE.BRAIN / STATE.infer — the "Minimal stub" from before
// selectBrain wiring existed. The production registration passes only
// { STATE } and nothing injects those fields, so every real request got
// 503 "Brain not available for standalone reasoning".
//
// Now: injected wiring still wins (sovereign/agent dispatch), otherwise
// the route selects a brain via the real selectBrain and uses
// lib/inference's infer as the crystallizer's inferFn. selectBrain and
// infer are factory-injectable so this suite exercises the route's
// resolution logic with fakes — no live brain is ever called.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { createReasoningRouter } from "../routes/reasoning.js";

let server;
let baseUrl;

const fakeHandle = {
  name: "conscious",
  model: "fake-model",
  chat: async () => ({ ok: true, text: "reasoned answer", tokensIn: 5, tokensOut: 7, toolCalls: [] }),
};

function makeApp(deps) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: "user-1" }; next(); });
  app.use("/api/reasoning", createReasoningRouter(deps));
  return app;
}

async function listen(app) {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

async function postExecute(body) {
  const res = await fetch(`${baseUrl}/api/reasoning/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

describe("reasoning/execute selectBrain wiring (Q30)", () => {
  it("falls back to selectBrain when nothing is injected and completes", async () => {
    const calls = [];
    await listen(makeApp({
      STATE: {},
      selectBrain: async (role, opts) => {
        calls.push({ role, opts });
        return { handle: fakeHandle, fallbacksUsed: [] };
      },
      infer: async () => ({ finalText: "unused" }),
    }));
    const r = await postExecute({ intent: "think about tests" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.ok, true);
    assert.equal(r.json.finalText, "reasoned answer");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].role, "conscious");
    assert.equal(calls[0].opts.callerId, "reasoning:route:user-1");
    await new Promise((r2) => server.close(r2));
  });

  it("passes the requested brainRole to selectBrain", async () => {
    let seenRole = null;
    await listen(makeApp({
      STATE: {},
      selectBrain: async (role) => {
        seenRole = role;
        return { handle: fakeHandle, fallbacksUsed: [] };
      },
      infer: async () => ({ finalText: "unused" }),
    }));
    const r = await postExecute({ intent: "background thought", brainRole: "utility" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(seenRole, "utility");
    await new Promise((r2) => server.close(r2));
  });

  it("maps conscious_brain_unavailable to an honest 503", async () => {
    await listen(makeApp({
      STATE: {},
      selectBrain: async () => {
        const err = new Error("Conscious brain required for chat is currently unavailable.");
        err.code = "conscious_brain_unavailable";
        throw err;
      },
      infer: async () => ({ finalText: "unused" }),
    }));
    const r = await postExecute({ intent: "think" });
    assert.equal(r.status, 503);
    assert.equal(r.json.code, "conscious_brain_unavailable");
    await new Promise((r2) => server.close(r2));
  });

  it("injected STATE wiring still wins over selectBrain", async () => {
    let selectCalled = false;
    await listen(makeApp({
      STATE: {
        BRAIN: { conscious: fakeHandle },
        infer: async () => ({ finalText: "unused" }),
      },
      selectBrain: async () => {
        selectCalled = true;
        throw new Error("must not be called");
      },
      infer: async () => ({ finalText: "unused" }),
    }));
    const r = await postExecute({ intent: "think" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.finalText, "reasoned answer");
    assert.equal(selectCalled, false);
    await new Promise((r2) => server.close(r2));
  });

  it("still validates intent before any brain work", async () => {
    let selectCalled = false;
    await listen(makeApp({
      STATE: {},
      selectBrain: async () => {
        selectCalled = true;
        return { handle: fakeHandle, fallbacksUsed: [] };
      },
      infer: async () => ({ finalText: "unused" }),
    }));
    const r = await postExecute({});
    assert.equal(r.status, 400);
    assert.equal(selectCalled, false);
    await new Promise((r2) => server.close(r2));
  });
});
