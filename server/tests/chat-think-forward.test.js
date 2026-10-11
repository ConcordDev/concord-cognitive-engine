// ctx.llm.chat must forward a caller's think flag onto the Ollama body.
//
// chat.respond passes think:false. The chat() signature does not name
// that field, so it used to be dropped. With qwen3.5 the model then spent
// the whole num_predict budget on hidden thinking and returned an empty
// reply (no tool call). The request guard also injects think:false when
// the body omits it, but only while CONCORD_OLLAMA_THINK is not 1 — an
// operator who turns thinking back on would still lose an explicit
// think:false. This file sets that switch so the guard cannot paper over
// a dropped flag.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

process.env.CONCORD_OLLAMA_THINK = "1";
process.env.NODE_ENV = "test";
process.env.CONCORD_NO_LISTEN = "true";

let currentBehavior = () => ({ status: 200, body: { message: { content: "ok" }, done: true } });

function makeFakeOllama() {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch { /* ignore */ }
      if (req.method === "POST" && req.url === "/api/chat") hits.push(parsed);
      const result = currentBehavior();
      res.writeHead(result.status || 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.body ?? {}));
    });
  });
  return { server, hits };
}

function listen(fake) {
  return new Promise((resolve, reject) => {
    fake.server.listen(0, "127.0.0.1", (err) => {
      if (err) return reject(err);
      const { port } = fake.server.address();
      fake.url = `http://127.0.0.1:${port}`;
      resolve(fake);
    });
  });
}

let T;
let fake;
registerServerCleanExit(() => T);

before(async () => {
  if (!process.env.STATE_PATH) {
    process.env.STATE_PATH = path.join(os.tmpdir(), `concord-think-forward-state-${process.pid}.json`);
  }
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = path.join(os.tmpdir(), `concord-think-forward-${process.pid}.db`);
  }
  fake = makeFakeOllama();
  await listen(fake);
  delete process.env.BRAIN_CONSCIOUS_URLS;
  process.env.BRAIN_CONSCIOUS_URL = fake.url;
  T = (await import("../server.js")).__TEST__;
  assert.equal(T.BRAIN.conscious.url, fake.url);
  T.BRAIN.conscious.enabled = true;
});

after(async () => {
  await new Promise((resolve) => fake.server.close(() => resolve()));
});

async function postedBody(extra) {
  fake.hits.length = 0;
  currentBehavior = () => ({ status: 200, body: { message: { content: "pong" }, done: true } });
  const ctx = T.makeCtx(null);
  const result = await ctx.llm.chat({
    messages: [{ role: "user", content: "ping" }],
    maxTokens: 16,
    timeoutMs: 5000,
    ...extra,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fake.hits.length, 1);
  return fake.hits[0];
}

describe("ctx.llm.chat forwards think onto the Ollama request", () => {
  it("sends think:false when the caller sets it", async () => {
    const body = await postedBody({ think: false });
    assert.equal(body.think, false);
    assert.equal(body.stream, false);
    assert.equal(body.messages.at(-1).content, "ping");
  });

  it("sends think:true when the caller sets it", async () => {
    const body = await postedBody({ think: true });
    assert.equal(body.think, true);
  });

  it("omits think when the caller does not set a boolean", async () => {
    const body = await postedBody({});
    assert.equal(Object.prototype.hasOwnProperty.call(body, "think"), false);
    const weird = await postedBody({ think: "false" });
    assert.equal(Object.prototype.hasOwnProperty.call(weird, "think"), false);
  });
});
