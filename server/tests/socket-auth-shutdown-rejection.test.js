// During graceful shutdown the sealed DB throws shutting_down out of AuthDB.getUser. The socket.io auth
// middleware let that throw escape; socket.io v4 runs middleware from an async Namespace._add and does not catch
// a sync throw, so it surfaced as a FATAL unhandled_rejection in the old process on every deploy
// (01:29:13 ET Nov 1; 18:00 Oct 31). guardSocketAuth turns it into a normal handshake refusal.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { Server } from "socket.io";
import { guardSocketAuth, shuttingDownError } from "../lib/shutdown-http.js";

const serverSrc = readFileSync(new URL("../server.js", import.meta.url), "utf8");

function loadClient() {
  try { return createRequire(new URL("../../concord-frontend/package.json", import.meta.url))("socket.io-client").io; } catch { return null; }
}
const ioClient = loadClient();

async function handshake(middleware) {
  const rejections = [];
  const onRej = (r) => rejections.push(r);
  process.on("unhandledRejection", onRej);
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  io.use(middleware);
  await new Promise((r) => httpServer.listen(0, "127.0.0.1", r));
  const client = ioClient(`http://127.0.0.1:${httpServer.address().port}`, { reconnection: false, transports: ["websocket"] });
  const outcome = await new Promise((resolve) => {
    client.on("connect", () => resolve({ connected: true }));
    client.on("connect_error", (e) => resolve({ connected: false, message: e.message }));
    setTimeout(() => resolve({ timeout: true }), 3000);
  });
  await new Promise((r) => setTimeout(r, 150)); // let a stray rejection surface
  process.off("unhandledRejection", onRej);
  client.close(); io.close(); httpServer.close();
  return { outcome, rejections };
}

describe("guardSocketAuth (unit)", () => {
  it("a shutdown throw becomes next(Error('shutting_down')); other throws become 'Authentication error'; normal flow is untouched", () => {
    const seen = [];
    guardSocketAuth(() => { throw shuttingDownError(); })({}, (e) => seen.push(e?.message));
    guardSocketAuth(() => { throw new Error("boom: secret detail"); })({}, (e) => seen.push(e?.message));
    guardSocketAuth(() => { throw Object.assign(new Error("The database connection is not open"), {}); })({}, (e) => seen.push(e?.message));
    guardSocketAuth((_s, next) => next())({}, (e) => seen.push(e === undefined ? "ok" : "err"));
    assert.deepEqual(seen, ["shutting_down", "Authentication error", "shutting_down", "ok"]);
  });
});

describe("real socket.io handshake while the DB is sealed", { skip: ioClient ? false : "socket.io-client not installed" }, () => {
  it("UNGUARDED middleware (the old code) escapes as an unhandled rejection (run in a child: node:test would fail on it here)", () => {
    const code = `
      import http from "node:http";
      import { createRequire } from "node:module";
      import { Server } from "socket.io";
      import { shuttingDownError } from ${JSON.stringify(new URL("../lib/shutdown-http.js", import.meta.url).href)};
      const io = createRequire(${JSON.stringify(new URL("../../concord-frontend/package.json", import.meta.url).href)})("socket.io-client").io;
      const seen = [];
      process.on("unhandledRejection", (r) => seen.push(r && r.message));
      const hs = http.createServer(); const srv = new Server(hs);
      srv.use((_s, _n) => { throw shuttingDownError(); });
      hs.listen(0, "127.0.0.1", async () => {
        const c = io("http://127.0.0.1:" + hs.address().port, { reconnection: false, transports: ["websocket"] });
        c.on("connect_error", () => {});
        await new Promise((r) => setTimeout(r, 400));
        console.log(JSON.stringify(seen)); process.exit(0);
      });`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", timeout: 20000 });
    assert.match(r.stdout, /\["shutting_down"\]/, `stdout=${r.stdout} stderr=${r.stderr}`);
  });

  it("GUARDED middleware refuses the handshake cleanly: client sees shutting_down, no unhandled rejection", async () => {
    const { outcome, rejections } = await handshake(guardSocketAuth((_socket, _next) => { throw shuttingDownError(); }));
    assert.deepEqual(outcome, { connected: false, message: "shutting_down" });
    assert.equal(rejections.length, 0);
  });
});

describe("server.js wiring", () => {
  it("the root auth middleware and the /dx validator are both guarded", () => {
    assert.match(serverSrc, /io\.use\(guardSocketAuth\(_socketAuth\)\);/);
    assert.match(serverSrc, /const dxValidateAuth = \(socket\) => \{\s*\n\s*try \{ return _dxValidateAuthUnguarded\(socket\); \} catch \{ return null; \}/);
    assert.doesNotMatch(serverSrc, /io\.use\(\(socket, next\) => \{\s*\n\s*\/\/ Parse cookies from handshake/);
  });
});
