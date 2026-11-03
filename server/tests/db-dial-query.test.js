// DBX-4 — the remote read-only query path (db-dial's query layer).
//
// Defence in depth, both layers proven:
//   1. classifyReadOnlyStatement — the client-side gate (literals and
//      comments are data, not code; data-modifying CTEs are caught).
//   2. executeRemoteQuery — every statement runs inside
//      BEGIN TRANSACTION READ ONLY … ROLLBACK, proven against the real
//      pg driver on a wire stub and against a recording fake factory.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { classifyReadOnlyStatement, executeRemoteQuery, runRemoteQuery, REMOTE_RESULT_CAP } from "../lib/db-dial.js";

describe("DBX-4: classifyReadOnlyStatement", () => {
  const ok = (sql, kind) => {
    const r = classifyReadOnlyStatement(sql);
    assert.equal(r.ok, true, `${sql} → ${JSON.stringify(r)}`);
    if (kind) assert.equal(r.kind, kind);
  };
  const refused = (sql, code) => {
    const r = classifyReadOnlyStatement(sql);
    assert.equal(r.ok, false, `${sql} → ${JSON.stringify(r)}`);
    if (code) assert.equal(r.code, code);
  };

  it("accepts plain reads", () => {
    ok("SELECT * FROM users", "SELECT");
    ok("select id from t where x = 1;", "SELECT");
    ok("SHOW server_version", "SHOW");
    ok("WITH a AS (SELECT 1) SELECT * FROM a", "SELECT");
    ok("  -- a comment\n  SELECT 1", "SELECT");
  });

  it("refuses writes by verb, naming the problem", () => {
    refused("INSERT INTO t VALUES (1)", "statement_not_read_only");
    refused("UPDATE t SET x = 1", "statement_not_read_only");
    refused("DELETE FROM t", "statement_not_read_only");
    refused("DROP TABLE t", "statement_not_read_only");
    refused("CREATE TABLE t (id int)", "statement_not_read_only");
    refused("TRUNCATE t", "statement_not_read_only");
    refused("GRANT SELECT ON t TO x", "statement_not_read_only");
    refused("COPY t TO '/tmp/x'", "statement_not_read_only");
    refused("VACUUM t", "statement_not_read_only");
    refused("SET client_encoding TO 'UTF8'", "statement_not_read_only");
  });

  it("refuses multiple statements — one at a time", () => {
    refused("SELECT 1; SELECT 2", "multiple_statements");
    refused("SELECT 1; DROP TABLE t", "multiple_statements");
  });

  it("treats semicolons and write-words inside string literals as data", () => {
    ok("SELECT * FROM t WHERE note = 'a; DROP TABLE t'", "SELECT");
    ok("SELECT 'DELETE FROM users' AS label", "SELECT");
    ok("SELECT 'it''s; fine'", "SELECT");
  });

  it("catches a data-modifying CTE", () => {
    refused("WITH d AS (DELETE FROM t RETURNING id) SELECT * FROM d", "statement_not_read_only");
    refused("WITH u AS (UPDATE t SET x = 1 RETURNING id) SELECT * FROM u", "statement_not_read_only");
  });

  it("gates the inner statement of an EXPLAIN", () => {
    ok("EXPLAIN SELECT * FROM t", "EXPLAIN");
    ok("EXPLAIN ANALYZE SELECT * FROM t", "EXPLAIN");
    ok("EXPLAIN (FORMAT JSON) SELECT 1", "EXPLAIN");
    refused("EXPLAIN ANALYZE INSERT INTO t VALUES (1)", "statement_not_read_only");
    refused("EXPLAIN DELETE FROM t", "statement_not_read_only");
  });

  it("refuses empty input", () => {
    refused("", "empty_statement");
    refused("   -- only a comment", "empty_statement");
  });
});

describe("DBX-4: executeRemoteQuery — the READ ONLY wrapper (fake factory)", () => {
  it("wraps the statement in BEGIN TRANSACTION READ ONLY … ROLLBACK, in order", async () => {
    const calls = [];
    const client = {
      connect: async () => {},
      query: async (sql) => {
        calls.push(sql);
        if (sql.startsWith("SELECT")) return { rows: [{ id: 1 }], rowCount: 1, fields: [{ name: "id" }], command: "SELECT" };
        return { rows: [], rowCount: 0, fields: [], command: "BEGIN" };
      },
      end: async () => { calls.push("END"); },
    };
    const r = await executeRemoteQuery({ host: "203.0.113.10", port: 5432 }, "SELECT id FROM t", { clientFactory: async () => client });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(calls.slice(0, 3), ["BEGIN TRANSACTION READ ONLY", "SELECT id FROM t", "ROLLBACK"]);
    assert.deepEqual(r.columns, ["id"]);
    assert.equal(r.rowCount, 1);
  });

  it("rolls back and reports the stage when the query fails", async () => {
    const calls = [];
    const client = {
      connect: async () => {},
      query: async (sql) => {
        calls.push(sql);
        if (sql === "SELECT bad") { const e = new Error("column \"bad\" does not exist"); e.code = "42703"; throw e; }
        return { rows: [], rowCount: 0, fields: [], command: "BEGIN" };
      },
      end: async () => {},
    };
    const r = await executeRemoteQuery({ host: "203.0.113.10", port: 5432 }, "SELECT bad", { clientFactory: async () => client });
    assert.equal(r.ok, false);
    assert.equal(r.stage, "protocol");
    assert.equal(r.code, "42703");
    assert.ok(calls.includes("ROLLBACK"));
  });

  it("caps shipped rows at the workspace engine's cap and says so", async () => {
    const many = Array.from({ length: REMOTE_RESULT_CAP + 5 }, (_, i) => ({ id: i }));
    const client = {
      connect: async () => {},
      query: async (sql) => (sql.startsWith("SELECT") ? { rows: many, rowCount: many.length, fields: [{ name: "id" }], command: "SELECT" } : { rows: [], rowCount: 0, fields: [], command: "BEGIN" }),
      end: async () => {},
    };
    const r = await executeRemoteQuery({ host: "203.0.113.10", port: 5432 }, "SELECT id FROM big", { clientFactory: async () => client });
    assert.equal(r.rows.length, REMOTE_RESULT_CAP);
    assert.equal(r.rowCount, REMOTE_RESULT_CAP + 5);
    assert.equal(r.truncated, true);
    assert.equal(r.cap, REMOTE_RESULT_CAP);
  });
});

// ── Wire stub that answers transaction control properly ────────────────────
function msg(type, payload) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length + 4, 0);
  return Buffer.concat([Buffer.from(type), len, payload]);
}
function startTxStub() {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buf = Buffer.alloc(0);
    let started = false;
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (!started && buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (buf.length < len) return;
        const code = buf.readUInt32BE(4);
        buf = buf.subarray(len);
        if (code === 80877103) { socket.write("N"); continue; }
        if (code === 196608) {
          started = true;
          const authOk = msg("R", Buffer.alloc(4));
          const param = msg("S", Buffer.from("server_version\0" + "16.0-stub\0"));
          const ready = msg("Z", Buffer.from("I"));
          socket.write(Buffer.concat([authOk, param, msg("K", Buffer.alloc(8)), ready]));
        }
      }
      while (started && buf.length >= 5) {
        const type = String.fromCharCode(buf[0]);
        const len = buf.readUInt32BE(1);
        if (buf.length < 1 + len) return;
        const payload = buf.subarray(5, 1 + len);
        buf = buf.subarray(1 + len);
        if (type === "X") { socket.end(); return; }
        if (type !== "Q") continue;
        const q = payload.toString("utf8").replace(/\0$/, "");
        const ready = msg("Z", Buffer.from("I"));
        if (/^BEGIN/i.test(q)) socket.write(Buffer.concat([msg("C", Buffer.from("BEGIN\0")), ready]));
        else if (/^ROLLBACK/i.test(q)) socket.write(Buffer.concat([msg("C", Buffer.from("ROLLBACK\0")), ready]));
        else if (/^INSERT|^UPDATE|^DELETE/i.test(q)) {
          // A REAL Postgres inside READ ONLY answers exactly this.
          const fields = Buffer.concat([Buffer.from("S"), Buffer.from("ERROR\0"), Buffer.from("V"), Buffer.from("ERROR\0"), Buffer.from("C"), Buffer.from("25006\0"), Buffer.from("M"), Buffer.from("cannot execute INSERT in a read-only transaction\0"), Buffer.from([0])]);
          socket.write(Buffer.concat([msg("E", fields), ready]));
        } else {
          const count = Buffer.alloc(2); count.writeUInt16BE(1, 0);
          const field = Buffer.concat([Buffer.from("id\0"), Buffer.alloc(4), Buffer.alloc(2), (() => { const b = Buffer.alloc(4); b.writeUInt32BE(23, 0); return b; })(), Buffer.alloc(2, 0xff), Buffer.alloc(4, 0xff), Buffer.alloc(2)]);
          const vlen = Buffer.alloc(4); vlen.writeUInt32BE(1, 0);
          const row = msg("D", Buffer.concat([count, vlen, Buffer.from("7")]));
          socket.write(Buffer.concat([msg("T", Buffer.concat([count, field])), row, msg("C", Buffer.from("SELECT 1\0")), ready]));
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, sockets, port: server.address().port })));
}

describe("DBX-4: executeRemoteQuery against a wire stub (real pg driver)", () => {
  let stub;
  before(async () => { stub = await startTxStub(); });
  after(async () => {
    for (const so of stub.sockets) so.destroy();
    await new Promise((r) => stub.server.close(r));
  });

  it("runs a SELECT end to end inside the transaction", async () => {
    const r = await executeRemoteQuery({ host: "127.0.0.1", port: stub.port, user: "svc", database: "app" }, "SELECT id FROM t");
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.rows, [{ id: 7 }]);
    assert.deepEqual(r.columns, ["id"]);
  });

  it("a write the gate somehow missed still dies at the server (25006, protocol stage)", async () => {
    const r = await executeRemoteQuery({ host: "127.0.0.1", port: stub.port, user: "svc", database: "app" }, "INSERT INTO t VALUES (1)");
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.code, "25006");
  });
});

describe("DBX-4: runRemoteQuery composition", () => {
  it("a write is refused at the statement stage — guard and dial never run", async () => {
    let dialed = false;
    const r = await runRemoteQuery({ host: "8.8.8.8", port: 5432 }, "DELETE FROM t", { clientFactory: async () => { dialed = true; throw new Error("no"); } });
    assert.equal(r.ok, false);
    assert.equal(r.stage, "statement");
    assert.equal(r.remoteContacted, false);
    assert.equal(dialed, false);
  });

  it("a read at a private target is refused at the guard stage", async () => {
    const r = await runRemoteQuery({ host: "192.168.1.9", port: 5432 }, "SELECT 1");
    assert.equal(r.ok, false);
    assert.equal(r.stage, "guard");
    assert.equal(r.code, "private_address");
  });
});
