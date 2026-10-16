// server/tests/conkay-chat-live.test.js
//
// The live build stream (conversational-loop item 3): recording a run (local snapshot paths become file names with
// a sha256; a tampered file is refused), the read-only SSE route (events in order with ids, resume from
// Last-Event-ID, 404s), runs in this process streaming to late subscribers, and the recorded item-2 electric car
// replaying every iteration in order.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import createConkayDemoRouter from "../routes/conkay-demo.js";
import { recordLiveRun, loadLiveRun, loadLiveRunFile, startLiveRun, subscribeLive, eventsAfter, _resetLiveHubForTest } from "../lib/conkay/chat/live.js";

/** Parse an SSE body into [{ id, event, data }]. */
function parseSse(text) {
  return text.split("\n\n").map((block) => {
    const f = {};
    for (const line of block.split("\n")) {
      const m = line.match(/^(id|event|data): (.*)$/);
      if (m) f[m[1]] = m[2];
    }
    return f.data ? { id: Number(f.id), event: f.event, data: JSON.parse(f.data) } : null;
  }).filter(Boolean);
}

function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

describe("recording a run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conkay-live-"));
  const stl = path.join(dir, "body.stl");
  fs.writeFileSync(stl, Buffer.alloc(84 + 50)); // a one-triangle binary STL's size
  const events = [{ type: "start" }, { type: "evaluated", snapshot: { kind: "stl", path: stl, triangles: 1 } }, { type: "done", snapshot: { kind: "stl", path: stl } }];
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  it("numbers the events, replaces local paths by a file name + sha256, copies the file once", () => {
    const run = recordLiveRun({ id: "t-run", prompt: "p", events, liveDir: dir });
    assert.deepEqual(run.events.map((e) => e.id), [1, 2, 3]);
    assert.equal(JSON.stringify(run).includes(stl), false, "no local path in the record");
    assert.match(run.events[1].snapshot.file, /^[a-f0-9]{12}\.stl$/);
    assert.equal(run.files.length, 1);
    assert.ok(loadLiveRunFile("t-run", run.events[1].snapshot.file, { liveDir: dir }));
  });
  it("refuses a file that is not listed, a bad name, or one whose bytes changed", () => {
    _resetLiveHubForTest();
    const run = loadLiveRun("t-run", { liveDir: dir });
    const name = run.files[0].name;
    assert.equal(loadLiveRunFile("t-run", "000000000000.stl", { liveDir: dir }), null);
    assert.equal(loadLiveRunFile("t-run", "../t-run.json", { liveDir: dir }), null);
    fs.writeFileSync(path.join(dir, "t-run", name), Buffer.from("tampered"));
    assert.equal(loadLiveRunFile("t-run", name, { liveDir: dir }), null);
    assert.equal(loadLiveRun("../etc", { liveDir: dir }), null);
  });
});

describe("the SSE route replays the recorded electric car (item 2) in order", () => {
  let server, port;
  before(async () => {
    _resetLiveHubForTest();
    const app = express();
    app.use("/api/conkay/demo", createConkayDemoRouter({}));
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  after(() => new Promise((r) => server.close(r)));

  it("every event in order with its id; the iteration says what failed, what changed and why", async () => {
    const r = await get(port, "/api/conkay/demo/designs/ev-180/live");
    assert.equal(r.status, 200);
    assert.match(r.type, /text\/event-stream/);
    const ev = parseSse(r.body.toString());
    assert.deepEqual(ev.map((e) => [e.id, e.event]), [[1, "start"], [2, "evaluated"], [3, "iteration"], [4, "done"]]);
    const it1 = ev[2].data;
    assert.ok(it1.failingChecks.includes("requirement.check@REQ_topSpeed"));
    assert.equal(it1.change.rule, "top-speed.next-drive-unit");
    assert.equal(it1.change.value, "motor.cascadia.im-375-dz");
    assert.match(it1.change.reason, /clears requirement\.check@REQ_topSpeed/);
    assert.ok(it1.candidates.length >= 2 && it1.rerunNodes.length > 0);
    assert.equal(ev[3].data.outcome.kind, "all-pass");
    assert.equal(ev[3].data.receiptSha256, "5f5ce815011faf5c21071741e3bbd0f63fe1ea4120548e6e43b94f47ab12ba71", "the same receipt as the item-2 runs");
  });
  it("resumes after Last-Event-ID (and ?from=)", async () => {
    const r = await get(port, "/api/conkay/demo/designs/ev-180/live", { "Last-Event-ID": "2" });
    assert.deepEqual(parseSse(r.body.toString()).map((e) => e.id), [3, 4]);
    const q = await get(port, "/api/conkay/demo/designs/ev-180/live?from=3");
    assert.deepEqual(parseSse(q.body.toString()).map((e) => e.id), [4]);
  });
  it("serves the snapshot the event names, and 404s what it does not", async () => {
    const ev = parseSse((await get(port, "/api/conkay/demo/designs/ev-180/live")).body.toString());
    const f = await get(port, `/api/conkay/demo/designs/ev-180/live/files/${ev[1].data.snapshot.file}`);
    assert.equal(f.status, 200);
    assert.equal(f.body.readUInt32LE(80), ev[1].data.snapshot.triangles);
    assert.equal((await get(port, "/api/conkay/demo/designs/ev-180/live/files/000000000000.stl")).status, 404);
    assert.equal((await get(port, "/api/conkay/demo/designs/no-such-run/live")).status, 404);
  });
});

describe("a run in this process streams to every viewer", () => {
  it("a late subscriber gets the events so far, then the rest, then the end", async () => {
    _resetLiveHubForTest();
    let release;
    const gate = new Promise((r) => { release = r; });
    const done = startLiveRun("t-live", async (onEvent) => {
      onEvent({ type: "start" });
      onEvent({ type: "evaluated", snapshot: null });
      await gate;
      onEvent({ type: "done", outcome: { kind: "all-pass" }, snapshot: null });
    });
    await new Promise((r) => setImmediate(r));
    const got = [];
    let ended = false;
    subscribeLive("t-live", 1, (e) => { if (e) got.push(e.id); else ended = true; });
    assert.deepEqual(got, [2]);
    release();
    await done;
    assert.deepEqual(got, [2, 3]);
    assert.equal(ended, true);
    assert.deepEqual(eventsAfter("t-live", 0).map((e) => e.type), ["start", "evaluated", "done"]);
  });
});
