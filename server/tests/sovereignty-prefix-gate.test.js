/**
 * Live defect 2026-10-11: GET /api/sovereignty/status returned 403
 * sovereign_only for an ordinary member because SOVEREIGN_ROUTES lists
 * "/api/sovereign" and the gate matched with startsWith. That prefix also
 * covers /api/sovereignty and /api/sovereignty/*.
 *
 * User-own lock routes stay caller-scoped (requireAuth, own rows only).
 * Sovereign prefixes, lookalikes (/api/sovereignX, /api/sovereign-emergent),
 * and the x-entity-id block stay denied. Anonymous callers stay 401,
 * including a curl user-agent (the public-read bypass must not newly
 * apply to this prefix).
 *
 * Run: node --test --import=./tests/preload/no-egress.mjs --test-timeout=180000 tests/sovereignty-prefix-gate.test.js
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { load } from "./depth/_harness.js";

process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "hybrid";
process.env.CONCORD_NO_LISTEN = "true";
process.env.CONCORD_LOAD_SHED_ENABLED = "0";
process.env.CONCORD_RATE_LIMIT_BYPASS = "1";

const UA = "Mozilla/5.0 (compatible; ConcordSovereigntyGateTest/1.0)";

describe("sovereignty prefix does not capture user-own lock routes", { timeout: 180000 }, () => {
  let server;
  let port;
  let state;
  let db;

  before(async () => {
    const t = await load();
    state = t.STATE;
    db = t.db;
    assert.ok(state?.dtus, "STATE.dtus must exist");
    assert.ok(db, "db must exist");
    server = http.createServer(t.app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  async function call(method, path, { cookie, headers = {}, body } = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        "user-agent": UA,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: res.status, body: json };
  }

  async function register(username) {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({
        username,
        email: `${username}@sovereignty-gate.test`,
        password: "SovereigntyGate_Test_12345!",
        dateOfBirth: "1990-01-01",
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 201, JSON.stringify(data));
    const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    const auth = cookies.find((c) => c.startsWith("concord_auth="));
    assert.ok(auth, `register should set concord_auth (got ${JSON.stringify(cookies)})`);
    return { cookie: auth.split(";")[0], userId: data.user.id, role: data.user.role };
  }

  it("a member reads only their own counts; anon is 401; sovereign prefixes stay 403", async () => {
    const stamp = `${Date.now()}_${process.pid}`;
    // A fresh DB promotes the first human to owner (and may also seed an
    // admin). The defect is the ordinary member path — pick two members.
    const created = [];
    for (const name of ["a", "b", "c"]) created.push(await register(`sov_${name}_${stamp}`));
    const members = created.filter((u) => u.role === "member");
    assert.ok(members.length >= 2, `expected two members, got roles ${created.map((u) => u.role).join(",")}`);
    const member = members[0];
    const other = members[1];

    const secret = "OTHER_USER_SECRET_MARKER";
    state.dtus.set(`sov_mine_p_${stamp}`, { id: `sov_mine_p_${stamp}`, ownerId: member.userId, scope: "personal", domain: "lock" });
    state.dtus.set(`sov_mine_s_${stamp}`, { id: `sov_mine_s_${stamp}`, ownerId: member.userId, scope: "synced_global", domain: "math" });
    state.dtus.set(`sov_theirs_a_${stamp}`, { id: `sov_theirs_a_${stamp}`, ownerId: other.userId, scope: "personal", domain: "lock", secret });
    state.dtus.set(`sov_theirs_b_${stamp}`, { id: `sov_theirs_b_${stamp}`, ownerId: other.userId, scope: "personal", domain: "lock", secret });
    state.dtus.set(`sov_theirs_c_${stamp}`, { id: `sov_theirs_c_${stamp}`, ownerId: other.userId, scope: "synced_global", domain: "math", secret });
    if (!state.entities) state.entities = new Map();
    state.entities.set(`ent_mine_${stamp}`, { id: `ent_mine_${stamp}`, ownerId: member.userId });
    state.entities.set(`ent_theirs_${stamp}`, { id: `ent_theirs_${stamp}`, ownerId: other.userId });

    const anon = await call("GET", "/api/sovereignty/status");
    assert.equal(anon.status, 401, JSON.stringify(anon.body));

    const curlAnon = await call("GET", "/api/sovereignty/status", { headers: { "user-agent": "curl/8.7.1" } });
    assert.equal(curlAnon.status, 401, JSON.stringify(curlAnon.body));

    const status = await call("GET", "/api/sovereignty/status", { cookie: member.cookie });
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.ok, true);
    assert.equal(status.body.personalDTUs, 1);
    assert.equal(status.body.syncedGlobalDTUs, 1);
    assert.equal(status.body.totalDTUs, 2);
    assert.equal(status.body.entities, 1);
    const payload = JSON.stringify(status.body);
    assert.equal(payload.includes(secret), false);
    assert.equal(payload.includes(other.userId), false);

    const blocked = [
      ["GET", "/api/sovereign/pulse"],
      ["GET", "/api/sovereign/dashboard"],
      ["GET", "/api/admin/sovereign"],
      ["GET", "/api/admin/sovereign/policies"],
      ["POST", "/api/reproduction/enable"],
      ["POST", "/api/reproduction/disable"],
      ["POST", "/api/entity/kill"],
      ["POST", "/api/system/shutdown"],
      ["POST", "/api/economy/mint"],
      ["POST", "/api/economy/redistribute"],
      ["GET", "/api/sovereignX"],
      ["POST", "/api/sovereign-emergent/decree"],
    ];
    for (const [method, path] of blocked) {
      const r = await call(method, path, { cookie: member.cookie, body: method === "POST" ? {} : undefined });
      assert.equal(r.status, 403, `${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, "sovereign_only", `${method} ${path}`);
    }

    const anonAudit = await call("POST", "/api/sovereignty/audit", { body: { userId: other.userId } });
    assert.equal(anonAudit.status, 401, JSON.stringify(anonAudit.body));

    const memberAudit = await call("POST", "/api/sovereignty/audit", {
      cookie: member.cookie,
      body: { userId: other.userId, ownerId: other.userId, user_id: other.userId },
    });
    assert.notEqual(memberAudit.body?.error, "sovereign_only");
    assert.equal(memberAudit.status, 200, JSON.stringify(memberAudit.body));
    const auditPayload = JSON.stringify(memberAudit.body);
    assert.equal(auditPayload.includes(secret), false);
    assert.equal(auditPayload.includes(other.userId), false);

    db.prepare("UPDATE users SET role = ? WHERE id = ?").run("sovereign", member.userId);
    if (typeof globalThis.__concordBustUserCache === "function") globalThis.__concordBustUserCache(member.userId);
    const entity = await call("GET", "/api/sovereign/pulse", {
      cookie: member.cookie,
      headers: { "x-entity-id": "entity-1" },
    });
    assert.equal(entity.status, 403, JSON.stringify(entity.body));
    assert.equal(entity.body.error, "entity_access_denied");
  });
});
