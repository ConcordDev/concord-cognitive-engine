/**
 * Vision uploads must reject audio before any chat/LLM reply is produced.
 * Music's "Analyze with Vision" posts here with mode:"vision" and an images
 * array. A .wav must be 415 JSON {ok:false, error}, never a playlist prompt.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import registerChatRoutes from "../routes/chat.js";

function wavHeaderB64() {
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(8000, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(0, 40);
  return buf.toString("base64");
}

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function makeApp() {
  const calls = [];
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user-id");
    if (uid) req.user = { id: uid };
    next();
  });
  registerChatRoutes(app, {
    STATE: { sessions: new Map() },
    makeCtx: (req) => ({ actor: { userId: req.user?.id || null } }),
    runMacro: async (domain, name) => {
      calls.push({ domain, name });
      return { ok: true, reply: "should-not-run-for-audio" };
    },
    enforceRequestInvariants: (_req, body) => body,
    enforceEthosInvariant: () => {},
    uid: () => "test_uid",
    kernelTick: () => {},
    uiJson: (res, body) => res.json(body),
    _withAck: (x) => x,
    _extractReply: (x) => x,
    clamp: (v) => v,
    nowISO: () => new Date().toISOString(),
    saveStateDebounced: () => {},
    ETHOS_INVARIANTS: {},
    validate: () => (_req, _res, next) => next(),
    perEndpointRateLimit: () => (_req, _res, next) => next(),
    requireAuth: () => (req, res, next) => {
      if (!req.user) return res.status(401).json({ ok: false, error: "Unauthorized" });
      next();
    },
    realtimeEmit: () => {},
  });
  return { app, calls };
}

async function post(app, body) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/chat?full=1`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": "user-a" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("POST /api/chat vision image gate", () => {
  it("rejects a wav payload with 415 and does not call the chat macro", async () => {
    const { app, calls } = makeApp();
    const { status, body } = await post(app, {
      message: "Analyze this audio",
      images: [wavHeaderB64()],
      mode: "vision",
    });
    assert.equal(status, 415);
    assert.equal(body.ok, false);
    assert.match(body.error, /images only/);
    assert.equal(body.mode, undefined);
    assert.equal(body.sessionId, undefined);
    assert.equal(body.llmUsed, undefined);
    assert.equal(calls.length, 0);
  });

  it("lets a real PNG through to chat.respond", async () => {
    const { app, calls } = await (async () => makeApp())();
    const { status, body } = await post(app, {
      message: "Analyze this image",
      images: [PNG_1X1],
      mode: "vision",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].domain, "chat");
    assert.equal(calls[0].name, "respond");
  });
});
