import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  authenticatedBrainStatus,
  brainStatusForViewer,
  mountBrainStatusRoute,
  viewerCanSeeBrainUrls,
} from "../lib/brain-status-public.js";

const RAW = {
  ok: true,
  llmReady: false,
  mode: "partial",
  onlineCount: 1,
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
  routing: { pipelineOllamaModel: "qwen2.5:7b-instruct-q4_K_M" },
  embeddings: { model: "nomic-embed-text", ollamaUrl: "http://ollama-utility:11436", available: true },
  extras: ["http://ollama-utility:11436", "pod-healthy"],
};

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function forbiddenHits(value, hits = []) {
  const urlKeys = new Set(["url", "urls", "host", "hostname", "endpoint", "endpoints", "baseUrl", "baseURL", "ollamaUrl"]);
  const modelKeys = new Set(["model", "modelName", "pipelineOllamaModel"]);
  if (Array.isArray(value)) {
    for (const child of value) forbiddenHits(child, hits);
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (urlKeys.has(key) || modelKeys.has(key)) hits.push(key);
      forbiddenHits(child, hits);
    }
    return hits;
  }
  if (typeof value === "string" && /^(https?|cloudflare|ollama):\/\//i.test(value)) hits.push(value);
  if (typeof value === "string" && /ollama-(conscious|subconscious|utility|repair|vision)/i.test(value)) hits.push(value);
  return hits;
}

describe("brain status projection", () => {
  it("strips URLs and model names for a member and leaves the raw object for an admin", () => {
    const member = brainStatusForViewer(RAW, { id: "u1", role: "member" });
    assert.equal(member.urlsRedacted, true);
    assert.equal(member.modelsRedacted, true);
    assert.equal(member.mode, "partial");
    assert.equal(member.onlineCount, 1);
    assert.equal(member.brains.conscious.role, "chat");
    assert.equal(member.brains.conscious.enabled, true);
    assert.deepEqual(forbiddenHits(member), []);
    assert.equal(RAW.brains.conscious.url, "http://ollama-conscious:11434");
    assert.equal(RAW.brains.conscious.model, "concord-conscious:latest");

    const admin = brainStatusForViewer(RAW, { id: "a1", role: "admin" });
    assert.equal(admin.brains.conscious.url, "http://ollama-conscious:11434");
    assert.equal(admin.brains.conscious.model, "concord-conscious:latest");
    assert.equal(admin.urlsRedacted, undefined);
    assert.equal(viewerCanSeeBrainUrls({ role: "owner" }), true);
    assert.equal(viewerCanSeeBrainUrls({ actor: { role: "founder" } }), true);
    assert.equal(viewerCanSeeBrainUrls({ role: "sovereign" }), true);
    assert.equal(viewerCanSeeBrainUrls({ role: "member" }), false);
    assert.equal(viewerCanSeeBrainUrls(null), false);
  });

  it("refuses an anonymous macro caller and still redacts a nested public payload", () => {
    const anon = authenticatedBrainStatus(RAW, null);
    assert.equal(anon.ok, false);
    assert.equal(anon.error, "authentication_required");
    assert.equal(anon.brains, undefined);
    const nested = brainStatusForViewer(RAW, null);
    assert.deepEqual(forbiddenHits(nested), []);
    assert.equal(brainStatusForViewer(null, { role: "member" }), null);
    assert.equal(brainStatusForViewer("nope", { role: "admin" }), "nope");
  });
});

describe("GET /api/brain/status mount", () => {
  let server;
  let url;

  before(async () => {
    const app = express();
    app.use((req, _res, next) => {
      const role = req.get("x-test-role");
      if (role === "none") req.user = undefined;
      else if (role === "actor-founder") req.user = { actor: { role: "founder", userId: "f1" } };
      else if (role) req.user = { id: "u1", role };
      next();
    });
    mountBrainStatusRoute(app, () => RAW);
    ({ server, url } = await listen(app));
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  async function get(role) {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    if (role) headers["x-test-role"] = role;
    const res = await fetch(`${url}/api/brain/status`, { headers });
    const body = await res.json();
    return { status: res.status, body, text: JSON.stringify(body) };
  }

  it("returns 401 to an anonymous browser and a reduced body to a member", async () => {
    const anon = await get("none");
    assert.equal(anon.status, 401);
    assert.equal(anon.body.error, "authentication_required");
    assert.equal(anon.body.brains, undefined);
    assert.doesNotMatch(anon.text, /1143|ollama-conscious|concord-conscious/);

    const member = await get("member");
    assert.equal(member.status, 200);
    assert.equal(member.body.mode, "partial");
    assert.deepEqual(forbiddenHits(member.body), []);
    assert.doesNotMatch(member.text, /concord-conscious|qwen2\.5|nomic-embed|1143/);
  });

  it("returns the raw payload to admin, owner, founder, and sovereign", async () => {
    for (const role of ["admin", "owner", "sovereign", "actor-founder"]) {
      const res = await get(role);
      assert.equal(res.status, 200, role);
      assert.equal(res.body.brains.conscious.url, "http://ollama-conscious:11434");
      assert.equal(res.body.brains.conscious.model, "concord-conscious:latest");
    }
  });

  it("returns 500 when the status reader throws", async () => {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: "u1", role: "member" }; next(); });
    mountBrainStatusRoute(app, () => { throw new Error("status_down"); });
    const opened = await listen(app);
    try {
      const res = await fetch(`${opened.url}/api/brain/status`);
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.equal(body.ok, false);
      assert.match(body.error, /status_down/);
    } finally {
      await new Promise((resolve) => opened.server.close(resolve));
    }
  });
});
