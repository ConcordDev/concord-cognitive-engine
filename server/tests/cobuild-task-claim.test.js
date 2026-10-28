// cobuild task-claim and the /sim/projects/* routes that alias cobuild.
// In-memory STATE only; no network beyond a loopback test server.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import createWorldRoutes from "../routes/world.js";
import { runLensAction } from "../lib/sim-lens-bridge.js";

describe("cobuild task-claim + /sim/projects alias", () => {
  let server;
  let url;
  let savedState;
  let sessionId;
  let taskId;

  before(async () => {
    savedState = globalThis._concordSTATE;
    globalThis._concordSTATE = {};
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id) };
      next();
    });
    const requireAuth = (req, res, next) =>
      req.user ? next() : res.status(401).json({ ok: false, error: "auth_required" });
    app.use("/api/world", createWorldRoutes({ requireAuth }));
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        url = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
    sessionId = runLensAction("cobuild", "session-create", "alice", { name: "Pier crew" }).result.session.id;
    taskId = runLensAction("cobuild", "task-create", "alice", { sessionId, title: "Pave the road" }).result.task.id;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    globalThis._concordSTATE = savedState;
  });

  async function call(path, { method = "GET", user, body } = {}) {
    const headers = { "content-type": "application/json" };
    if (user) headers["x-user-id"] = user;
    const res = await fetch(`${url}/api/world/sim/projects${path}`, {
      method, headers, body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    return { status: res.status, body: await res.json() };
  }

  it("anonymous claim is 401 at the action and at the route", () => {
    const direct = runLensAction("cobuild", "task-claim", null, { sessionId, taskId });
    assert.equal(direct.ok, false);
    assert.equal(direct.status, 401);
    return call(`/${sessionId}/tasks/${taskId}/claim`, { method: "POST" }).then((r) => {
      assert.equal(r.status, 401);
    });
  });

  it("GET board lists the cobuild tasks for that session id", async () => {
    const r = await call(`/${sessionId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.boardId, sessionId);
    assert.equal(r.body.count, 1);
    assert.equal(r.body.tasks[0].title, "Pave the road");
    assert.equal(r.body.byStatus.todo, 1);
  });

  it("POST tasks creates a cobuild task; blank title is 400; unknown board is 404", async () => {
    const ok = await call(`/${sessionId}/tasks`, { method: "POST", user: "alice", body: { title: "Lay beams" } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.task.title, "Lay beams");
    assert.equal(ok.body.task.createdBy, "alice");
    const bad = await call(`/${sessionId}/tasks`, { method: "POST", user: "alice", body: { title: " " } });
    assert.equal(bad.status, 400);
    const none = await call("/nope/tasks", { method: "POST", user: "alice", body: { title: "x" } });
    assert.equal(none.status, 404);
  });

  it("first claim assigns the caller, same user again is idempotent, another user gets 409", async () => {
    const first = await call(`/${sessionId}/tasks/${taskId}/claim`, { method: "POST", user: "bob" });
    assert.equal(first.status, 200);
    assert.equal(first.body.task.assignee, "bob");
    assert.equal(first.body.unchanged, false);

    const again = await call(`/${sessionId}/tasks/${taskId}/claim`, { method: "POST", user: "bob" });
    assert.equal(again.status, 200);
    assert.equal(again.body.unchanged, true);
    assert.equal(again.body.task.assignee, "bob");

    const other = await call(`/${sessionId}/tasks/${taskId}/claim`, { method: "POST", user: "carol" });
    assert.equal(other.status, 409);
    assert.equal(other.body.error, "already_claimed");
    assert.equal(other.body.assignee, "bob");

    // Persisted on the cobuild task itself.
    const list = runLensAction("cobuild", "task-list", "alice", { sessionId });
    assert.equal(list.result.tasks.find((t) => t.id === taskId).assignee, "bob");
  });

  it("unknown task or session is 404", async () => {
    const t = await call(`/${sessionId}/tasks/missing/claim`, { method: "POST", user: "bob" });
    assert.equal(t.status, 404);
    const s = await call("/missing/tasks/x/claim", { method: "POST", user: "bob" });
    assert.equal(s.status, 404);
  });

  it("claiming saves through the debounced state save", () => {
    let saves = 0;
    const prev = globalThis._concordSaveStateDebounced;
    globalThis._concordSaveStateDebounced = () => { saves++; };
    try {
      const t = runLensAction("cobuild", "task-create", "alice", { sessionId, title: "Paint" }).result.task;
      const before = saves;
      assert.equal(runLensAction("cobuild", "task-claim", "dave", { sessionId, taskId: t.id }).ok, true);
      assert.equal(saves, before + 1);
      // idempotent re-claim does not write again
      runLensAction("cobuild", "task-claim", "dave", { sessionId, taskId: t.id });
      assert.equal(saves, before + 1);
    } finally { globalThis._concordSaveStateDebounced = prev; }
  });
});
