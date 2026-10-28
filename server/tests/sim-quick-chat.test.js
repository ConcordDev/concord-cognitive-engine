// POST /api/world/sim/mobile/quick-action quick-chat, manage-inventory and the
// retired toggle-notifications. quick-chat sends through message.js; inventory
// reads world.js inventory-get. In-memory SQLite and in-memory STATE only.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createWorldRoutes from "../routes/world.js";
import { runLensAction } from "../lib/sim-lens-bridge.js";

describe("sim quick-action: chat, inventory, retired toggle", () => {
  let db;
  let server;
  let url;
  let savedState;

  before(async () => {
    savedState = globalThis._concordSTATE;
    globalThis._concordSTATE = {};
    db = new Database(":memory:");
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)");
    db.prepare("INSERT INTO users VALUES ('alice','alice'),('bob','bob')").run();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id) };
      next();
    });
    app.use("/api/world", createWorldRoutes({ db }));
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        url = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    db?.close();
    globalThis._concordSTATE = savedState;
  });

  async function act(body, user = "alice") {
    const headers = { "content-type": "application/json" };
    if (user) headers["x-user-id"] = user;
    const res = await fetch(`${url}/api/world/sim/mobile/quick-action`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  it("anonymous callers get 401", async () => {
    const r = await act({ action: "quick-chat", toUserId: "bob", text: "hi" }, null);
    assert.equal(r.status, 401);
  });

  it("empty or blank text is 400 and nothing is stored", async () => {
    for (const text of [undefined, "", "   "]) {
      const r = await act({ action: "quick-chat", toUserId: "bob", text });
      assert.equal(r.status, 400);
      assert.equal(r.body.error, "empty_text");
    }
    assert.equal(globalThis._concordSTATE.messageLens, undefined);
  });

  it("a missing recipient is 400, yourself is 400, an unknown user is 404", async () => {
    const none = await act({ action: "quick-chat", text: "hi" });
    assert.equal(none.status, 400);
    assert.equal(none.body.error, "recipient_required");
    const self = await act({ action: "quick-chat", toUserId: "alice", text: "hi" });
    assert.equal(self.status, 400);
    const ghost = await act({ action: "quick-chat", toUserId: "nobody", text: "hi" });
    assert.equal(ghost.status, 404);
    assert.equal(ghost.body.error, "recipient_not_found");
  });

  it("persists the message in one DM that both sides can read, reusing the channel", async () => {
    const first = await act({ action: "quick-chat", toUserId: "bob", text: "  hello bob  " });
    assert.equal(first.status, 200);
    assert.equal(first.body.message.body, "hello bob");
    assert.equal(first.body.message.senderId, "alice");
    const second = await act({ action: "quick-chat", toUserId: "bob", text: "again" });
    assert.equal(second.status, 200);
    assert.equal(second.body.channelId, first.body.channelId);

    const asBob = runLensAction("message", "messages-list", "bob", { channelId: first.body.channelId });
    assert.equal(asBob.ok, true);
    assert.deepEqual(asBob.result.messages.map((m) => m.body), ["hello bob", "again"]);
    const asAlice = runLensAction("message", "messages-list", "alice", { channelId: first.body.channelId });
    assert.equal(asAlice.result.messages.length, 2);

    // Bob replying uses the same DM, not a second one.
    const reply = await act({ action: "quick-chat", toUserId: "alice", text: "hi alice" }, "bob");
    assert.equal(reply.status, 200);
    assert.equal(reply.body.channelId, first.body.channelId);
  });

  it("manage-inventory returns the same shape as world inventory-get", async () => {
    const r = await act({ action: "manage-inventory" });
    assert.equal(r.status, 200);
    const direct = runLensAction("world", "inventory-get", "alice", {});
    assert.deepEqual(r.body.items, direct.result.items);
    assert.deepEqual(r.body.slots, direct.result.slots);
    assert.deepEqual(r.body.slotNames, direct.result.slotNames);
  });

  it("manage-inventory writes are 400 read_only and change nothing", async () => {
    for (const body of [
      { action: "manage-inventory", op: "add", itemId: "x" },
      { action: "manage-inventory", op: "equip", slot: "head" },
      { action: "manage-inventory", itemId: "x" },
    ]) {
      const r = await act(body);
      assert.equal(r.status, 400);
      assert.equal(r.body.error, "read_only");
    }
    const after = runLensAction("world", "inventory-get", "alice", {});
    assert.deepEqual(after.result.items, []);
  });

  it("toggle-notifications is retired with a pointer to companion push-prefs-set", async () => {
    const r = await act({ action: "toggle-notifications", key: "buildComplete", enabled: false });
    assert.equal(r.status, 410);
    assert.equal(r.body.error, "retired");
    assert.equal(r.body.use, "companion.push-prefs-set");
  });
});
