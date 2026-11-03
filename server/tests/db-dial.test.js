// DBX-3 — db-dial: the guarded Postgres dial-out.
//
// Two layers under test:
//   dialPostgres       — the wire behaviour, proven against a local
//                        stub speaking just enough Postgres protocol
//                        for the REAL pg driver (loopback is legitimate
//                        here: this layer takes its host as given).
//   testRemotePostgres — the composed path: the SSRF guard runs first
//                        and the dial lands on the pinned IP (proven
//                        with an injected factory + resolver; the guard
//                        correctly refuses loopback, so no stub may be
//                        routed through this layer).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { dialPostgres, testRemotePostgres } from "../lib/db-dial.js";

// ── Minimal Postgres wire stub ─────────────────────────────────────────────
function msg(type, payload) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length + 4, 0);
  return Buffer.concat([Buffer.from(type), len, payload]);
}
function startupOk(socket, version = "16.0-stub") {
  const authOk = msg("R", (() => { const b = Buffer.alloc(4); b.writeUInt32BE(0, 0); return b; })());
  const param = (k, v) => msg("S", Buffer.concat([Buffer.from(k + "\0"), Buffer.from(v + "\0")]));
  const keyData = msg("K", Buffer.alloc(8));
  const ready = msg("Z", Buffer.from("I"));
  socket.write(Buffer.concat([authOk, param("server_version", version), param("client_encoding", "UTF8"), keyData, ready]));
}
function errorResponse(socket, code, messageText) {
  const fields = Buffer.concat([
    Buffer.from("S"), Buffer.from("FATAL\0"),
    Buffer.from("V"), Buffer.from("FATAL\0"),
    Buffer.from("C"), Buffer.from(code + "\0"),
    Buffer.from("M"), Buffer.from(messageText + "\0"),
    Buffer.from([0]),
  ]);
  socket.write(msg("E", fields));
  socket.end();
}
function rowDescription(name, typeOid) {
  const field = Buffer.concat([
    Buffer.from(name + "\0"),
    Buffer.alloc(4), // table oid
    Buffer.alloc(2), // column attr
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(typeOid, 0); return b; })(),
    Buffer.alloc(2, 0xff), // type size -1
    Buffer.alloc(4, 0xff), // modifier -1
    Buffer.alloc(2), // format 0
  ]);
  const count = Buffer.alloc(2);
  count.writeUInt16BE(1, 0);
  return msg("T", Buffer.concat([count, field]));
}
function dataRow(value) {
  const v = Buffer.from(String(value));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(v.length, 0);
  const count = Buffer.alloc(2);
  count.writeUInt16BE(1, 0);
  return msg("D", Buffer.concat([count, len, v]));
}
function handleQuery(socket, query) {
  if (/server_version/i.test(query)) {
    socket.write(Buffer.concat([rowDescription("server_version", 25), dataRow("16.0-stub"), msg("C", Buffer.from("SHOW\0")), msg("Z", Buffer.from("I"))]));
  } else {
    socket.write(Buffer.concat([rowDescription("ok", 23), dataRow("1"), msg("C", Buffer.from("SELECT 1\0")), msg("Z", Buffer.from("I"))]));
  }
}
function startStub(mode) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buf = Buffer.alloc(0);
    let started = false;
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      // Startup phase: length-prefixed, no type byte.
      while (!started && buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (buf.length < len) return;
        const code = buf.readUInt32BE(4);
        buf = buf.subarray(len);
        if (code === 80877103) { socket.write("N"); continue; } // SSLRequest → no
        if (code === 196608) {
          started = true;
          if (mode === "authfail") { errorResponse(socket, "28P01", "password authentication failed for user \"svc\""); return; }
          if (mode === "silent") return; // never answer — the client must time out
          startupOk(socket);
        }
      }
      // Query phase: typed messages.
      while (started && buf.length >= 5) {
        const type = String.fromCharCode(buf[0]);
        const len = buf.readUInt32BE(1);
        if (buf.length < 1 + len) return;
        const payload = buf.subarray(5, 1 + len);
        buf = buf.subarray(1 + len);
        if (type === "Q") handleQuery(socket, payload.toString("utf8").replace(/\0$/, ""));
        else if (type === "X") { socket.end(); return; }
        // Extended-protocol messages are not used by parameterless queries.
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, sockets, port: server.address().port }));
  });
}
async function stopStub({ server, sockets }) {
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
}

describe("DBX-3: dialPostgres against a wire stub (real pg driver)", () => {
  let okStub, authStub, silentStub;
  before(async () => {
    okStub = await startStub("ok");
    authStub = await startStub("authfail");
    silentStub = await startStub("silent");
  });
  after(async () => {
    await stopStub(okStub);
    await stopStub(authStub);
    await stopStub(silentStub);
  });

  it("connects, authenticates and proves the session with SELECT 1", async () => {
    const r = await dialPostgres({ host: "127.0.0.1", port: okStub.port, user: "svc", password: "pw", database: "app" });
    assert.equal(r.connected, true, JSON.stringify(r));
    assert.equal(r.stage, "ok");
    assert.equal(r.remoteContacted, true);
    assert.equal(r.serverVersion, "16.0-stub");
    assert.equal(r.probeRows, 1);
  });

  it("an authentication refusal is the auth stage, with the SQLSTATE kept", async () => {
    const r = await dialPostgres({ host: "127.0.0.1", port: authStub.port, user: "svc", password: "wrong", database: "app" });
    assert.equal(r.connected, false, JSON.stringify(r));
    assert.equal(r.stage, "auth");
    assert.equal(r.code, "28P01");
    assert.equal(r.remoteContacted, true);
  });

  it("a closed port is the connect stage", async () => {
    const tmp = await startStub("ok");
    const port = tmp.port;
    await stopStub(tmp);
    const r = await dialPostgres({ host: "127.0.0.1", port, user: "svc", timeoutMs: 2000 });
    assert.equal(r.connected, false, JSON.stringify(r));
    assert.equal(r.stage, "connect");
    assert.equal(r.remoteContacted, true);
  });

  it("a server that never answers is a bounded connect-stage timeout", async () => {
    const t0 = Date.now();
    const r = await dialPostgres({ host: "127.0.0.1", port: silentStub.port, user: "svc", timeoutMs: 400 });
    assert.equal(r.connected, false, JSON.stringify(r));
    assert.equal(r.stage, "connect");
    assert.ok(Date.now() - t0 < 8000, "the dial stayed bounded");
  });
});

describe("DBX-3: dialPostgres outcome taxonomy (injected factory)", () => {
  const factoryReturning = (client) => async () => client;
  it("a post-connect probe failure is the protocol stage", async () => {
    const client = {
      connect: async () => {},
      query: async () => { const e = new Error("relation \"x\" does not exist"); e.code = "42P01"; throw e; },
      end: async () => {},
    };
    const r = await dialPostgres({ host: "203.0.113.10", port: 5432 }, { clientFactory: factoryReturning(client) });
    assert.equal(r.connected, false);
    assert.equal(r.stage, "protocol");
  });

  it("a client that cannot be constructed is a connect-stage setup failure", async () => {
    const r = await dialPostgres({ host: "203.0.113.10", port: 5432 }, { clientFactory: async () => { throw new Error("bad config"); } });
    assert.equal(r.connected, false);
    assert.equal(r.stage, "connect");
    assert.equal(r.remoteContacted, false);
  });
});

describe("DBX-3: testRemotePostgres — guard first, pinned dial second", () => {
  it("a private target is refused by the guard and never dialed", async () => {
    let dialed = false;
    const r = await testRemotePostgres({ host: "10.0.0.5", port: 5432 }, { clientFactory: async () => { dialed = true; throw new Error("must not dial"); } });
    assert.equal(r.connected, false);
    assert.equal(r.stage, "guard");
    assert.equal(r.code, "private_address");
    assert.equal(r.remoteContacted, false);
    assert.equal(dialed, false);
  });

  it("a non-database port is refused by the guard", async () => {
    const r = await testRemotePostgres({ host: "8.8.8.8", port: 22 });
    assert.equal(r.stage, "guard");
    assert.equal(r.code, "port_not_allowed");
  });

  it("the dial lands on the guard's pinned IP, not a re-resolution", async () => {
    let seenConfig = null;
    const client = {
      connect: async () => {},
      query: async (sql) => (/server_version/i.test(sql)
        ? { rows: [{ server_version: "15.4" }], rowCount: 1 }
        : { rows: [{ ok: 1 }], rowCount: 1 }),
      end: async () => {},
    };
    const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
    const r = await testRemotePostgres(
      { host: "db.example.com", port: 5432, user: "svc", password: "pw", database: "app" },
      { lookup, clientFactory: async (config) => { seenConfig = config; return client; } },
    );
    assert.equal(r.connected, true, JSON.stringify(r));
    assert.equal(seenConfig.host, "93.184.216.34");
    assert.equal(r.resolvedIp, "93.184.216.34");
    assert.equal(r.hostname, "db.example.com");
    assert.equal(r.serverVersion, "15.4");
  });
});
