// Verify-admin grant (founder ruling GB-0310): committed allowlist applied at boot +
// an owner/founder-only role route. Temp in-memory SQLite, no server boot.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createRoleGate } from "../lib/role-gate.js";
import { applyVerifyAdmins, loadVerifyAdminEntries, mountUserRoleRoute, setUserRole, validateEntry } from "../lib/verify-admins.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const VID = "9f150688-1dd4-44c3-953b-277d11935556";
const ENTRY = { username: "zuko3_admin_verify", userId: VID, role: "admin" };

function mkDb({ testFlag = true } = {}) {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'member', scopes TEXT NOT NULL DEFAULT '["read","write"]'${testFlag ? ", is_test_account INTEGER NOT NULL DEFAULT 0" : ""})`);
  const ins = db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)");
  ins.run(VID, "zuko3_admin_verify", "member");
  ins.run("id-boss", "boss", "owner");
  ins.run("id-bob", "bob", "member");
  return db;
}
const row = (db, id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);

describe("boot grant (applyVerifyAdmins)", () => {
  let db; beforeEach(() => { db = mkDb(); });

  it("listed + matching username AND id -> admin + is_test_account 1", () => {
    const r = applyVerifyAdmins({ db, entries: [ENTRY] });
    assert.deepEqual(r.granted, ["zuko3_admin_verify"]);
    assert.equal(row(db, VID).role, "admin");
    assert.equal(row(db, VID).is_test_account, 1);
    assert.equal(row(db, VID).scopes, '["read","write"]', "scopes untouched");
  });
  it("username match but id mismatch -> unchanged", () => {
    const r = applyVerifyAdmins({ db, entries: [{ ...ENTRY, userId: "someone-elses-id" }] });
    assert.deepEqual(r.skipped, [{ username: "zuko3_admin_verify", reason: "id_mismatch" }]);
    assert.equal(row(db, VID).role, "member");
    assert.equal(row(db, VID).is_test_account, 0);
  });
  it("id match but username mismatch -> unchanged (matched on username first)", () => {
    const r = applyVerifyAdmins({ db, entries: [{ ...ENTRY, username: "bob" }] });
    assert.equal(r.granted.length, 0);
    assert.equal(row(db, "id-bob").role, "member");
  });
  it("role other than admin in the file is rejected, nothing changes", () => {
    for (const role of ["owner", "founder", "sovereign", "member", undefined]) {
      const r = applyVerifyAdmins({ db, entries: [{ ...ENTRY, role }] });
      assert.equal(r.granted.length, 0, String(role));
      assert.equal(r.skipped[0].reason, "role_must_be_admin");
    }
    assert.equal(row(db, VID).role, "member");
  });
  it("unknown user is skipped; no user is ever created", () => {
    const n = db.prepare("SELECT COUNT(*) n FROM users").get().n;
    const r = applyVerifyAdmins({ db, entries: [{ username: "ghost", userId: "g1", role: "admin" }] });
    assert.deepEqual(r.skipped, [{ username: "ghost", reason: "unknown_user" }]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, n);
  });
  it("never touches or downgrades an owner/founder/sovereign account", () => {
    db.prepare("UPDATE users SET role = 'founder' WHERE id = ?").run(VID);
    const r = applyVerifyAdmins({ db, entries: [ENTRY] });
    assert.deepEqual(r.unchanged, ["zuko3_admin_verify"]);
    assert.equal(row(db, VID).role, "founder");
  });
  it("idempotent: a second boot changes nothing and logs nothing", () => {
    const logs = [];
    applyVerifyAdmins({ db, entries: [ENTRY], log: (...a) => logs.push(a) });
    assert.equal(logs.filter((l) => l[1] === "verify_admin_granted").length, 1);
    const r2 = applyVerifyAdmins({ db, entries: [ENTRY], log: (...a) => logs.push(a) });
    assert.deepEqual(r2.granted, []);
    assert.deepEqual(r2.unchanged, ["zuko3_admin_verify"]);
    assert.equal(logs.filter((l) => l[1] === "verify_admin_granted").length, 1);
  });
  it("works on a schema with no is_test_account column", () => {
    const d2 = mkDb({ testFlag: false });
    assert.deepEqual(applyVerifyAdmins({ db: d2, entries: [ENTRY] }).granted, ["zuko3_admin_verify"]);
    assert.equal(row(d2, VID).role, "admin");
  });
  it("removing the entry does not demote (boot only grants)", () => {
    applyVerifyAdmins({ db, entries: [ENTRY] });
    applyVerifyAdmins({ db, entries: [] });
    assert.equal(row(db, VID).role, "admin");
  });
  it("validateEntry rejects malformed entries", () => {
    for (const e of [null, "x", {}, { username: "a" }, { userId: "a", role: "admin" }]) assert.equal(validateEntry(e).ok, false);
  });
  it("the committed allowlist is exactly the one verify account, role admin", () => {
    const entries = loadVerifyAdminEntries();
    assert.deepEqual(entries, [ENTRY]);
    const raw = fs.readFileSync(path.join(here, "..", "config", "verify-admins.json"), "utf8");
    assert.ok(!/password|secret|token/i.test(raw));
  });
});

describe("POST /api/admin/users/:id/role", () => {
  let db, srv, port, busted;
  const post = (id, role, body = { role }) => new Promise((resolve, reject) => {
    const headers = { "content-type": "application/json" }; if (role) headers["x-test-role"] = role;
    const req = http.request({ hostname: "127.0.0.1", port, path: `/api/admin/users/${id}/role`, method: "POST", headers }, (res) => {
      const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(c).toString() || "{}") }));
    });
    req.on("error", reject); req.write(JSON.stringify(body)); req.end();
  });
  const start = async () => {
    db = mkDb(); busted = []; const logs = [];
    const { requireRole } = createRoleGate(() => "hybrid");
    const app = express(); app.use(express.json());
    app.use((req, _r, next) => { const r = req.headers["x-test-role"]; if (r) req.user = { id: "actor1", role: r }; next(); });
    mountUserRoleRoute(app, { requireRole, getDb: () => db, bustUserCache: (id) => busted.push(id), log: (...a) => logs.push(a) });
    srv = await new Promise((r) => { const s = http.createServer(app); s.listen(0, "127.0.0.1", () => r(s)); });
    port = srv.address().port; return logs;
  };

  it("anonymous 401, member 403, admin 403 (owner/founder only); nothing changes", async () => {
    await start();
    try {
      assert.equal((await post(VID, null, { role: "admin" })).status, 401);
      assert.equal((await post(VID, "member", { role: "admin" })).status, 403);
      assert.equal((await post(VID, "admin", { role: "admin" })).status, 403);
      assert.equal(row(db, VID).role, "member");
    } finally { srv.close(); }
  });
  it("owner promotes (200), sets the test flag for the allowlisted verify account, busts the cache, audit-logs", async () => {
    const logs = await start();
    try {
      const r = await post(VID, "owner", { role: "admin" });
      assert.equal(r.status, 200);
      assert.equal(r.body.role, "admin");
      assert.equal(r.body.testFlagSet, true);
      assert.equal(row(db, VID).role, "admin");
      assert.equal(row(db, VID).is_test_account, 1);
      assert.deepEqual(busted, [VID]);
      const l = logs.find((x) => x[1] === "user_role_changed");
      assert.equal(l[2].actor, "actor1"); assert.equal(l[2].from, "member"); assert.equal(l[2].to, "admin");
    } finally { srv.close(); }
  });
  it("founder can demote with the one-line route", async () => {
    await start();
    try {
      await post(VID, "owner", { role: "admin" });
      const r = await post(VID, "founder", { role: "member" });
      assert.equal(r.status, 200);
      assert.equal(row(db, VID).role, "member");
    } finally { srv.close(); }
  });
  it("role owner/founder/sovereign or anything else -> 400; unchanged", async () => {
    await start();
    try {
      for (const role of ["owner", "founder", "sovereign", "root", "", null, 5]) {
        assert.equal((await post("id-bob", "owner", { role })).status, 400, String(role));
      }
      assert.equal(row(db, "id-bob").role, "member");
    } finally { srv.close(); }
  });
  it("cannot change a protected account (403) and unknown id is 404; non-allowlisted promote leaves the flag alone", async () => {
    await start();
    try {
      assert.equal((await post("id-boss", "owner", { role: "member" })).status, 403);
      assert.equal(row(db, "id-boss").role, "owner");
      assert.equal((await post("nope", "owner", { role: "admin" })).status, 404);
      const r = await post("id-bob", "owner", { role: "admin" });
      assert.equal(r.status, 200);
      assert.equal(r.body.testFlagSet, false);
      assert.equal(row(db, "id-bob").is_test_account, 0);
    } finally { srv.close(); }
  });
});

describe("wiring", () => {
  it("server.js applies the allowlist after the admin seed and mounts the route behind owner/founder", () => {
    const src = fs.readFileSync(path.join(here, "..", "server.js"), "utf8");
    assert.match(src, /applyVerifyAdmins\(\{ db, log: structuredLog \}\);/);
    assert.ok(src.indexOf('"auth_admin_created"') < src.indexOf("applyVerifyAdmins({ db"), "grant runs after the ADMIN_PASSWORD seed");
    assert.match(src, /mountUserRoleRoute\(app, \{ requireRole, getDb: \(\) => db, bustUserCache,/);
    const lib = fs.readFileSync(path.join(here, "..", "lib", "verify-admins.js"), "utf8");
    assert.match(lib, /requireRole\("owner", "founder"\)/);
  });
});
