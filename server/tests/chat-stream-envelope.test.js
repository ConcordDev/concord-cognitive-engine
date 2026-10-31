// The SSE final envelope must say what the turn did: `ok` mirrors out.ok, and a
// thrown turn still ends with an error envelope. Each completion logs one line.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import registerChatRoutes from "../routes/chat.js";
import logger from "../logger.js";

function build(runMacro) {
  const app = express();
  app.use(express.json());
  app.use((req, _s, next) => { req.user = { id: "u1" }; next(); });
  registerChatRoutes(app, {
    STATE: { __chicken3: { streamingEnabled: true }, sessions: new Map() },
    makeCtx: () => ({}),
    runMacro,
    enforceRequestInvariants: (_r, b) => b,
    enforceEthosInvariant: () => {},
    uid: (p) => `${p}_t`,
    kernelTick: () => {},
    uiJson: (res, body) => res.json(body),
    _withAck: (x) => x,
    _extractReply: (x) => x,
    clamp: (n, lo, hi) => Math.min(hi, Math.max(lo, n)),
    nowISO: () => new Date().toISOString(),
    saveStateDebounced: () => {},
    ETHOS_INVARIANTS: {},
    validate: () => (_q, _s, next) => next(),
    perEndpointRateLimit: () => (_q, _s, next) => next(),
    requireAuth: () => (req, _s, next) => { req.user = { id: "u1" }; next(); },
  });
  return app;
}

async function post(app) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/chat/stream`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }),
    });
    const text = await res.text();
    return text.split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  } finally { server.close(); }
}

const lines = [];
const origInfo = logger.info;
logger.info = (...a) => { lines.push(a); };
after(() => { logger.info = origInfo; });

test("a refused turn (session_forbidden) is announced ok:false and logged", async () => {
  lines.length = 0;
  const ev = await post(build(async () => ({ ok: false, error: "session_forbidden", reason: "not_owner_or_participant" })));
  const done = ev.find((e) => e.done);
  assert.equal(done.ok, false);
  assert.equal(done.out.error, "session_forbidden");
  const log = lines.find((l) => l[1] === "chat_stream_done");
  assert.ok(log, "completion line logged");
  assert.equal(log[2].ok, false);
  assert.equal(log[2].error, "session_forbidden");
  assert.equal(log[2].userId, "u1");
});

test("a normal answer stays ok:true", async () => {
  lines.length = 0;
  const ev = await post(build(async () => ({ ok: true, reply: "hello" })));
  assert.equal(ev.find((e) => e.done).ok, true);
  assert.equal(lines.find((l) => l[1] === "chat_stream_done")[2].ok, true);
});

test("a thrown turn ends with an error envelope and is logged", async () => {
  lines.length = 0;
  const ev = await post(build(async () => { throw new Error("boom"); }));
  const done = ev.find((e) => e.done);
  assert.equal(done.ok, false);
  assert.equal(done.error, "boom");
  assert.equal(lines.find((l) => l[1] === "chat_stream_done")[2].error, "boom");
});
