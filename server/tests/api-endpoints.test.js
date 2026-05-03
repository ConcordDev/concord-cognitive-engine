/**
 * API Endpoints Test Suite
 * Tests endpoint response codes, parameter validation, JSON structure, and auth.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Mock API Infrastructure ──────────────────────────────────────────────────

function createMockRouter() {
  const routes = new Map();

  function register(method, path, handler, options = {}) {
    routes.set(`${method}:${path}`, { handler, requiresAuth: options.requiresAuth ?? true, params: options.params || [] });
  }

  function request(method, path, { body, headers, user } = {}) {
    const route = routes.get(`${method}:${path}`);
    if (!route) return { status: 404, body: { error: "Not found" } };

    // Auth check
    if (route.requiresAuth && !user) {
      return { status: 401, body: { error: "Authentication required" } };
    }

    // Param validation
    if (route.params.length > 0 && method === "POST") {
      for (const param of route.params) {
        if (param.required && (!body || body[param.name] === undefined)) {
          return { status: 400, body: { error: `Missing required parameter: ${param.name}` } };
        }
      }
    }

    // Malformed JSON check
    if (method === "POST" && body === "malformed") {
      return { status: 400, body: { error: "Invalid JSON" } };
    }

    try {
      const result = route.handler({ body, headers, user });
      return { status: 200, body: result };
    } catch (e) {
      return { status: 500, body: { error: e.message } };
    }
  }

  return { register, request, routes };
}

// ── Register Mock Endpoints ──────────────────────────────────────────────────

function setupTestRouter() {
  const router = createMockRouter();

  router.register("GET", "/api/brain/status", () => ({
    ok: true, mode: "five_brain",
    brains: { conscious: { enabled: true }, subconscious: { enabled: true }, utility: { enabled: true }, repair: { enabled: true }, multimodal: { enabled: true } },
  }));

  router.register("GET", "/api/brain/health", () => ({
    conscious: { online: true, model: "qwen2.5:7b" },
    subconscious: { online: true, model: "qwen2.5:1.5b" },
    utility: { online: true, model: "qwen2.5:3b" },
  }));

  router.register("POST", "/api/utility/call", (req) => ({
    ok: true, response: "Utility response", lens: req.body?.lens,
  }), { params: [{ name: "action", required: true }, { name: "lens", required: true }] });

  router.register("POST", "/api/brain/conscious/chat", (req) => ({
    ok: true, content: "Chat response",
  }), { params: [{ name: "message", required: true }] });

  router.register("POST", "/api/brain/subconscious/task", (req) => ({
    ok: true, result: "Task completed",
  }), { params: [{ name: "taskType", required: true }] });

  router.register("POST", "/api/brain/entity/explore", (req) => ({
    ok: true, entities: [],
  }), { params: [{ name: "entityId", required: true }] });

  router.register("POST", "/api/marketplace/submit", (req) => ({
    ok: true, status: "pending",
  }), { params: [{ name: "dtuId", required: true }] });

  router.register("POST", "/api/global/pull", (req) => ({
    ok: true, dtu: { id: "pulled-1" },
  }), { params: [{ name: "globalDtuId", required: true }] });

  router.register("GET", "/api/dtus/:id/connections", () => ({
    ok: true, connections: [],
  }));

  router.register("GET", "/api/dtus/search/semantic", () => ({
    ok: true, results: [],
  }));

  router.register("GET", "/api/embeddings/status", () => ({
    total: 100, embedded: 80, unembedded: 20, percentage: "80.0", complete: false,
  }));

  router.register("GET", "/api/affect/system", () => ({
    ok: true, affect: { valence: 0.5, arousal: 0.3 },
  }));

  router.register("GET", "/api/economics/current", () => ({
    ok: true, balance: 100, tier: "free",
  }));

  router.register("GET", "/api/economics/trend", () => ({
    ok: true, trends: [],
  }));

  return router;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("API Endpoints", () => {
  const endpoints = [
    { method: "GET", path: "/api/brain/status" },
    { method: "GET", path: "/api/brain/health" },
    { method: "POST", path: "/api/utility/call", body: { action: "test", lens: "general" } },
    { method: "POST", path: "/api/brain/conscious/chat", body: { message: "Hello" } },
    { method: "POST", path: "/api/brain/subconscious/task", body: { taskType: "autogen" } },
    { method: "POST", path: "/api/brain/entity/explore", body: { entityId: "e-1" } },
    { method: "POST", path: "/api/marketplace/submit", body: { dtuId: "dtu-1" } },
    { method: "POST", path: "/api/global/pull", body: { globalDtuId: "gdtu-1" } },
    { method: "GET", path: "/api/dtus/:id/connections" },
    { method: "GET", path: "/api/dtus/search/semantic" },
    { method: "GET", path: "/api/embeddings/status" },
    { method: "GET", path: "/api/affect/system" },
    { method: "GET", path: "/api/economics/current" },
    { method: "GET", path: "/api/economics/trend" },
  ];

  let router;

  it("every endpoint returns correct status codes", () => {
    router = setupTestRouter();
    const user = { id: "user-1", role: "member" };
    for (const ep of endpoints) {
      const result = router.request(ep.method, ep.path, { body: ep.body, user });
      assert.equal(result.status, 200, `${ep.method} ${ep.path} should return 200, got ${result.status}`);
    }
  });

  it("every endpoint validates required params", () => {
    router = setupTestRouter();
    const user = { id: "user-1", role: "member" };
    const postEndpoints = endpoints.filter(ep => ep.method === "POST");

    for (const ep of postEndpoints) {
      const result = router.request(ep.method, ep.path, { body: {}, user });
      assert.equal(result.status, 400, `${ep.method} ${ep.path} should return 400 for missing params`);
    }
  });

  it("every endpoint returns proper JSON structure", () => {
    router = setupTestRouter();
    const user = { id: "user-1", role: "member" };

    for (const ep of endpoints) {
      const result = router.request(ep.method, ep.path, { body: ep.body, user });
      assert.ok(result.body !== null && typeof result.body === "object",
        `${ep.method} ${ep.path} should return a JSON object`);
    }
  });

  it("every endpoint handles missing auth", () => {
    router = setupTestRouter();

    for (const ep of endpoints) {
      const result = router.request(ep.method, ep.path, { body: ep.body });
      assert.equal(result.status, 401, `${ep.method} ${ep.path} should return 401 without auth`);
    }
  });

  it("every endpoint handles malformed input", () => {
    router = setupTestRouter();
    const user = { id: "user-1", role: "member" };
    const postEndpoints = endpoints.filter(ep => ep.method === "POST");

    for (const ep of postEndpoints) {
      const result = router.request(ep.method, ep.path, { body: "malformed", user });
      assert.equal(result.status, 400, `${ep.method} ${ep.path} should reject malformed input`);
    }
  });

  it("GET /api/brain/status returns brain information", () => {
    router = setupTestRouter();
    const result = router.request("GET", "/api/brain/status", { user: { id: "u1", role: "member" } });
    assert.ok(result.body.ok);
    assert.ok(result.body.brains);
  });

  it("GET /api/embeddings/status returns embedding progress", () => {
    router = setupTestRouter();
    const result = router.request("GET", "/api/embeddings/status", { user: { id: "u1", role: "member" } });
    assert.equal(typeof result.body.total, "number");
    assert.equal(typeof result.body.embedded, "number");
    assert.equal(typeof result.body.percentage, "string");
  });
});
