import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { brainStatusForViewer, mountBrainStatusRoute, viewerCanSeeBrainUrls } from "../lib/brain-status-public.js";

const RAW = {
  llmReady: false,
  brains: {
    conscious: {
      url: "http://ollama-conscious:11434",
      model: "concord-conscious:latest",
      role: "chat",
      enabled: true,
      note: "reach it at http://10.0.0.8:11434",
      routing: "ollama_conscious",
    },
    vision: {
      urls: ["https://vision.internal.example/v1"],
      model: "qwen2.5vl:7b",
      endpoint: "cloudflare://vision",
    },
  },
  extras: ["http://ollama-utility:11436", "pod-healthy"],
};

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

describe("brain status is sanitized for members", () => {
  let server;
  let url;

  before(async () => {
    const app = express();
    app.use((req, _res, next) => {
      const role = req.get("x-test-role");
      if (role === "none") req.user = undefined;
      else if (role === "actor-founder") req.user = { actor: { role: "founder" } };
      else if (role) req.user = { id: "u1", role };
      next();
    });
    mountBrainStatusRoute(app, () => RAW);
    ({ server, url } = await listen(app));
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  async function get(role) {
    const headers = role ? { "x-test-role": role } : {};
    const res = await fetch(`${url}/api/brain/status`, { headers });
    const body = await res.json();
    return { status: res.status, body, text: JSON.stringify(body) };
  }

  it("gives a member the model and role, and no internal URL", async () => {
    const { status, body, text } = await get("member");
    assert.equal(status, 200);
    assert.equal(body.brains.conscious.model, "concord-conscious:latest");
    assert.equal(body.brains.conscious.role, "chat");
    assert.equal(body.brains.conscious.routing, "ollama_conscious");
    assert.equal(body.brains.vision.model, "qwen2.5vl:7b");
    assert.equal(body.urlsRedacted, true);
    assert.equal(body.llmReady, false);
    assert.equal("url" in body.brains.conscious, false);
    assert.equal("urls" in body.brains.vision, false);
    assert.equal("endpoint" in body.brains.vision, false);
    assert.equal("note" in body.brains.conscious, false);
    assert.deepEqual(body.extras, ["pod-healthy"]);
    assert.doesNotMatch(text, /1143/);
    assert.doesNotMatch(text, /ollama-conscious/);
    assert.doesNotMatch(text, /https?:\/\//);
  });

  it("strips URLs for an anonymous caller too", async () => {
    const { body } = await get("none");
    assert.equal(body.urlsRedacted, true);
    assert.equal(body.brains.conscious.model, "concord-conscious:latest");
    assert.equal("url" in body.brains.conscious, false);
  });

  it("leaves the raw payload for an admin, including a founder carried on actor", async () => {
    const admin = await get("admin");
    assert.equal(admin.body.brains.conscious.url, "http://ollama-conscious:11434");
    assert.equal(admin.body.urlsRedacted, undefined);
    const founder = await get("actor-founder");
    assert.equal(founder.body.brains.vision.endpoint, "cloudflare://vision");
    assert.equal(viewerCanSeeBrainUrls({ role: "owner" }), true);
    assert.equal(viewerCanSeeBrainUrls({ role: "sovereign" }), true);
    assert.equal(viewerCanSeeBrainUrls({ role: "member" }), false);
    assert.equal(viewerCanSeeBrainUrls(null), false);
  });

  it("returns non-objects unchanged and redacts a copy rather than the original", () => {
    assert.equal(brainStatusForViewer(null, { role: "member" }), null);
    assert.equal(brainStatusForViewer("nope", { role: "admin" }), "nope");
    const copy = brainStatusForViewer(RAW, { role: "member" });
    assert.equal(RAW.brains.conscious.url, "http://ollama-conscious:11434");
    assert.equal(copy.brains.conscious.url, undefined);
  });
});

describe("brain status route failures", () => {
  it("returns 500 when the status reader throws, and an empty object when it is missing", async () => {
    const app = express();
    mountBrainStatusRoute(app, () => { throw new Error("status_down"); });
    const { server, url } = await listen(app);
    try {
      const res = await fetch(`${url}/api/brain/status`);
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.equal(body.ok, false);
      assert.match(body.error, /status_down/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    const bare = express();
    mountBrainStatusRoute(bare, null);
    const opened = await listen(bare);
    try {
      const res = await fetch(`${opened.url}/api/brain/status`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.urlsRedacted, true);
    } finally {
      await new Promise((resolve) => opened.server.close(resolve));
    }
  });
});
