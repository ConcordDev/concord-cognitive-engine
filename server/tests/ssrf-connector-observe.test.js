// INC-75 / INC-76 — user-supplied URLs must not be fetched by the server.
//
// app-maker.connectorTest used a bare fetch(conn.endpoint). observe.syntheticRun
// used a bare fetch(chk.url). Both reflected status/latency, so loopback and
// the cloud metadata address were reachable. Both probes now go through
// fetchPublicUrl (scheme + private IP + DNS-to-private, connection pinned).
// connectorSave / syntheticSave reject those hosts before they are stored.
//
// A permissive fetch stub returns HTTP 200 for every URL. A regression that
// calls fetch on a private target shows up as reachable/up. The stub is what
// proves the guard, not a closed port.
//
// Run: node --test server/tests/ssrf-connector-observe.test.js

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.AUTH_MODE = "hybrid";
process.env.CONCORD_NO_LISTEN = "true";
process.env.CONCORD_LOAD_SHED_ENABLED = "0";
process.env.CONCORD_DISABLE_HEARTBEAT = "true";
process.env.CONCORD_RATE_LIMIT_BYPASS = "1";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "ssrf-regression-jwt-secret-32chars!!";

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import registerAppmakerActions from "../domains/appmaker.js";
import registerObserveActions from "../domains/observe.js";
import { PUBLIC_URL_BLOCKED } from "../lib/public-fetch.js";
import { load } from "./depth/_harness.js";

const BLOCKED = [
  ["loopback", "http://127.0.0.1:5050/api/health"],
  ["link-local metadata", "http://169.254.169.254/"],
  ["ipv6 loopback", "http://[::1]/"],
  ["localhost", "http://localhost/api/health"],
];

const PUBLIC_IP = "https://8.8.8.8/health";
const PUBLIC_HOST = "https://example.com/health";

let localtestPrivate = false;
let examplePublic = false;
try {
  const addrs = await dns.lookup("localtest.me", { all: true, verbatim: true });
  localtestPrivate = addrs.some((a) => a.address === "127.0.0.1" || a.address === "::1");
} catch { /* DNS name that points at loopback is not practical here */ }
try {
  const addrs = await dns.lookup("example.com", { all: true, verbatim: true });
  const privateIp = (ip) => ip === "::1" || ip === "::"
    || ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.")
    || ip.startsWith("169.254.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
    || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
  examplePublic = addrs.length > 0 && addrs.every((a) => !privateIp(a.address));
} catch { /* public hostname probe is skipped when DNS is unavailable */ }

const fetchCalls = [];
const realFetch = globalThis.fetch;

const APP = new Map();
registerAppmakerActions((domain, name, fn) => { APP.set(`${domain}.${name}`, fn); });
async function appCall(name, ctx, input = {}) {
  const fn = APP.get(`app-maker.${name}`);
  if (!fn) throw new Error(`app-maker.${name} not registered`);
  return fn(ctx, { id: null, domain: "app-maker", type: "domain_action", data: input, meta: {} }, input);
}

const OBS = new Map();
registerObserveActions((domain, name, fn) => { OBS.set(`${domain}.${name}`, fn); });
async function obsCall(name, ctx, params = {}) {
  const fn = OBS.get(`observe.${name}`);
  if (!fn) throw new Error(`observe.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const acct1 = { actor: { userId: "acct1" }, userId: "acct1" };
const acct2 = { actor: { userId: "acct2" }, userId: "acct2" };

function installPermissiveFetch() {
  fetchCalls.length = 0;
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url?.url || url || ""));
    return { ok: true, status: 200, text: async () => "ok", json: async () => ({ ok: true }) };
  };
}

function assertFetchNeverSaw(url) {
  const hit = fetchCalls.find((u) => u.includes(new URL(url).hostname));
  assert.equal(hit, undefined, `fetch was called for a blocked target: ${hit}`);
}

describe("INC-75 / INC-76 — guarded connector and synthetic probes", () => {
  before(() => { installPermissiveFetch(); });
  after(() => { globalThis.fetch = realFetch; });
  beforeEach(() => {
    fetchCalls.length = 0;
    globalThis._concordSTATE = {};
  });

  async function project() {
    const created = await appCall("projectCreate", acct1, { name: "SSRF" });
    assert.equal(created.ok, true);
    return created.result.project;
  }

  for (const [label, url] of BLOCKED) {
    it(`acct1 cannot save or reach a connector/check at ${label}`, async () => {
      const proj = await project();
      const saved = await appCall("connectorSave", acct1, {
        projectId: proj.id,
        connector: { name: label, kind: "rest", endpoint: url, method: "GET" },
      });
      assert.equal(saved.ok, false, JSON.stringify(saved));
      assert.equal(saved.error, PUBLIC_URL_BLOCKED);
      const listed = await appCall("connectorList", acct1, { projectId: proj.id });
      assert.equal(listed.result.count, 0);

      const syn = await obsCall("syntheticSave", acct1, { url, name: label, expectStatus: 200 });
      assert.equal(syn.ok, false, JSON.stringify(syn));
      assert.equal(syn.error, PUBLIC_URL_BLOCKED);
      assert.equal((await obsCall("syntheticList", acct1)).result.total, 0);
      assertFetchNeverSaw(url);
    });
  }

  it("acct1 cannot save a DNS name that resolves to a loopback address", { skip: !localtestPrivate && "localtest.me did not resolve to loopback" }, async () => {
    const url = "http://localtest.me/latest/meta-data/";
    const proj = await project();
    const saved = await appCall("connectorSave", acct1, {
      projectId: proj.id,
      connector: { name: "dns", kind: "rest", endpoint: url },
    });
    assert.equal(saved.ok, false);
    assert.equal(saved.error, PUBLIC_URL_BLOCKED);
    const syn = await obsCall("syntheticSave", acct1, { url });
    assert.equal(syn.ok, false);
    assert.equal(syn.error, PUBLIC_URL_BLOCKED);
    assertFetchNeverSaw(url);
  });

  it("a stored private target is probed as not reachable / down, and the permissive fetch is not used", async () => {
    const proj = await project();
    const conn = (await appCall("connectorSave", acct1, {
      projectId: proj.id,
      connector: { name: "pub", kind: "rest", endpoint: PUBLIC_IP, method: "GET" },
    })).result.connector;
    const chk = (await obsCall("syntheticSave", acct1, { url: PUBLIC_IP, expectStatus: 200 })).result.check;

    for (const url of ["http://127.0.0.1:5050/api/health", "http://169.254.169.254/", "http://[::1]/", "http://localhost/"]) {
      fetchCalls.length = 0;
      conn.endpoint = url;
      const tested = await appCall("connectorTest", acct1, { projectId: proj.id, connectorId: conn.id });
      assert.equal(tested.ok, true, JSON.stringify(tested));
      assert.equal(tested.result.reachable, false);
      assert.equal(tested.result.error, PUBLIC_URL_BLOCKED);
      assert.equal(tested.result.httpStatus, undefined);
      assertFetchNeverSaw(url);

      fetchCalls.length = 0;
      chk.url = url;
      const ran = await obsCall("syntheticRun", acct1, { id: chk.id });
      assert.equal(ran.ok, true, JSON.stringify(ran));
      assert.equal(ran.result.check.status, "down");
      assert.equal(ran.result.run.ok, false);
      assert.equal(ran.result.run.error, PUBLIC_URL_BLOCKED);
      assert.notEqual(ran.result.run.statusCode, 200);
      assertFetchNeverSaw(url);
    }
  });

  it("a public https address is fetched and its status is recorded", async () => {
    const proj = await project();
    const conn = (await appCall("connectorSave", acct1, {
      projectId: proj.id,
      connector: { name: "pub", kind: "rest", endpoint: PUBLIC_IP, method: "GET" },
    })).result.connector;
    fetchCalls.length = 0;
    const tested = await appCall("connectorTest", acct1, { projectId: proj.id, connectorId: conn.id });
    assert.equal(tested.ok, true, JSON.stringify(tested));
    assert.equal(tested.result.reachable, true);
    assert.equal(tested.result.httpStatus, 200);
    assert.equal(typeof tested.result.latencyMs, "number");
    assert.ok(fetchCalls.some((u) => u.includes("8.8.8.8")));

    const chk = (await obsCall("syntheticSave", acct1, { url: PUBLIC_IP, expectStatus: 200 })).result.check;
    fetchCalls.length = 0;
    const ran = await obsCall("syntheticRun", acct1, { id: chk.id });
    assert.equal(ran.ok, true, JSON.stringify(ran));
    assert.equal(ran.result.check.status, "up");
    assert.equal(ran.result.run.ok, true);
    assert.equal(ran.result.run.statusCode, 200);
    assert.ok(fetchCalls.some((u) => u.includes("8.8.8.8")));
  });

  it("a public hostname is fetched and its status is recorded", { skip: !examplePublic && "example.com did not resolve to a public address" }, async () => {
    const proj = await project();
    const conn = (await appCall("connectorSave", acct1, {
      projectId: proj.id,
      connector: { name: "host", kind: "rest", endpoint: PUBLIC_HOST, method: "GET" },
    })).result.connector;
    assert.equal(conn.endpoint, PUBLIC_HOST);
    fetchCalls.length = 0;
    const tested = await appCall("connectorTest", acct1, { projectId: proj.id, connectorId: conn.id });
    assert.equal(tested.result.reachable, true, JSON.stringify(tested));
    assert.equal(tested.result.httpStatus, 200);
    assert.ok(fetchCalls.some((u) => u.includes("example.com")));

    const chk = (await obsCall("syntheticSave", acct1, { url: PUBLIC_HOST, expectStatus: 200 })).result.check;
    fetchCalls.length = 0;
    const ran = await obsCall("syntheticRun", acct1, { id: chk.id });
    assert.equal(ran.result.check.status, "up", JSON.stringify(ran));
    assert.equal(ran.result.run.statusCode, 200);
    assert.ok(fetchCalls.some((u) => u.includes("example.com")));
  });

  it("rewriting a saved check to a private URL is refused and the stored URL stays", async () => {
    const chk = (await obsCall("syntheticSave", acct1, { url: PUBLIC_IP })).result.check;
    const again = await obsCall("syntheticSave", acct1, { id: chk.id, url: "http://127.0.0.1:5050/api/health" });
    assert.equal(again.ok, false);
    assert.equal(again.error, PUBLIC_URL_BLOCKED);
    const list = await obsCall("syntheticList", acct1);
    assert.equal(list.result.checks[0].url, PUBLIC_IP);
  });

  it("acct2 cannot test acct1's connector or run acct1's check", async () => {
    const proj = await project();
    const conn = (await appCall("connectorSave", acct1, {
      projectId: proj.id,
      connector: { name: "pub", kind: "rest", endpoint: PUBLIC_IP },
    })).result.connector;
    const chk = (await obsCall("syntheticSave", acct1, { url: PUBLIC_IP })).result.check;
    fetchCalls.length = 0;

    const tested = await appCall("connectorTest", acct2, { projectId: proj.id, connectorId: conn.id });
    assert.equal(tested.ok, false);
    assert.equal(tested.error, "project_not_found");
    assert.equal(tested.result, undefined);

    const ran = await obsCall("syntheticRun", acct2, { id: chk.id });
    assert.equal(ran.ok, false);
    assert.equal(ran.error, "check not found");
    assert.equal((await obsCall("syntheticList", acct2)).result.total, 0);
    assert.equal(fetchCalls.length, 0);
  });

  it("the probes call fetchPublicUrl and not a bare fetch of the stored URL", () => {
    const appSrc = readFileSync(fileURLToPath(new URL("../domains/appmaker.js", import.meta.url)), "utf8");
    const obsSrc = readFileSync(fileURLToPath(new URL("../domains/observe.js", import.meta.url)), "utf8");
    assert.match(appSrc, /fetchPublicUrl\(conn\.endpoint/);
    assert.doesNotMatch(appSrc, /await fetch\(conn\.endpoint/);
    assert.match(obsSrc, /fetchPublicUrl\(chk\.url/);
    assert.doesNotMatch(obsSrc, /await fetch\(chk\.url/);
  });
});

const UA = "Mozilla/5.0 (compatible; ConcordSsrfRegression/1.0)";

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(port, path, { method = "GET", token, body } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const headers = { "user-agent": UA, accept: "application/json" };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("INC-75 / INC-76 — HTTP auth and the live lens route", { timeout: 180000 }, () => {
  let server;
  let port;
  let token1;
  let token2;

  before(async () => {
    const t = await load();
    server = await listen(t.app);
    port = server.address().port;
    token1 = await register("acct1");
    token2 = await register("acct2");
    installPermissiveFetch();
  });

  after(async () => {
    globalThis.fetch = realFetch;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  async function register(label) {
    const uniq = `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const res = await request(port, "/api/auth/register", {
      method: "POST",
      body: {
        username: uniq,
        email: `${uniq}@example.com`,
        password: "CorrectHorseBattery9!",
        dateOfBirth: "1990-01-01",
        _t: Date.now() - 5000,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body?.token, "register did not return a token");
    return res.body.token;
  }

  async function lens(token, domain, action, input) {
    return request(port, "/api/lens/run", {
      method: "POST",
      token,
      body: { domain, action, input },
    });
  }

  it("anonymous and a garbage bearer get 401 on connector and synthetic writes", async () => {
    const bodies = [
      ["app-maker", "connectorSave", { projectId: "p", connector: { kind: "rest", endpoint: "http://127.0.0.1:5050/api/health" } }],
      ["app-maker", "connectorTest", { projectId: "p", connectorId: "c" }],
      ["observe", "syntheticSave", { url: "http://127.0.0.1:5050/api/health" }],
      ["observe", "syntheticRun", { id: "s" }],
    ];
    for (const [domain, action, input] of bodies) {
      const anon = await lens(undefined, domain, action, input);
      assert.equal(anon.status, 401, `${domain}.${action} anon ${JSON.stringify(anon.body)}`);
      assert.equal(JSON.stringify(anon.body).includes("\"reachable\":true"), false);
      assert.equal(JSON.stringify(anon.body).includes("\"status\":\"up\""), false);
      const garbage = await lens("not-a-token", domain, action, input);
      assert.equal(garbage.status, 401, `${domain}.${action} garbage ${JSON.stringify(garbage.body)}`);
    }
  });

  it("acct1 is blocked from saving private targets; a public https target records status; acct2 cannot use acct1's ids", async () => {
    const created = await lens(token1, "app-maker", "projectCreate", { name: "HTTP SSRF" });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const projectId = created.body?.result?.project?.id;
    assert.ok(projectId, JSON.stringify(created.body));

    for (const url of ["http://127.0.0.1:5050/api/health", "http://169.254.169.254/", "http://[::1]/", "http://localhost/api/health"]) {
      fetchCalls.length = 0;
      const saved = await lens(token1, "app-maker", "connectorSave", {
        projectId, connector: { name: "bad", kind: "rest", endpoint: url, method: "GET" },
      });
      assert.notEqual(saved.status, 200, url);
      assert.equal(saved.body?.ok, false, JSON.stringify(saved.body));
      assert.equal(saved.body?.error, PUBLIC_URL_BLOCKED);
      const syn = await lens(token1, "observe", "syntheticSave", { url, expectStatus: 200 });
      assert.equal(syn.body?.ok, false, JSON.stringify(syn.body));
      assert.equal(syn.body?.error, PUBLIC_URL_BLOCKED);
      assertFetchNeverSaw(url);
    }

    if (localtestPrivate) {
      const url = "http://localtest.me/";
      const saved = await lens(token1, "app-maker", "connectorSave", {
        projectId, connector: { name: "dns", kind: "rest", endpoint: url },
      });
      assert.equal(saved.body?.ok, false, JSON.stringify(saved.body));
      assert.equal(saved.body?.error, PUBLIC_URL_BLOCKED);
      const syn = await lens(token1, "observe", "syntheticSave", { url });
      assert.equal(syn.body?.ok, false);
    }

    fetchCalls.length = 0;
    const connSave = await lens(token1, "app-maker", "connectorSave", {
      projectId, connector: { name: "pub", kind: "rest", endpoint: PUBLIC_IP, method: "GET" },
    });
    assert.equal(connSave.status, 200, JSON.stringify(connSave.body));
    const connectorId = connSave.body?.result?.connector?.id;
    assert.ok(connectorId);
    const tested = await lens(token1, "app-maker", "connectorTest", { projectId, connectorId });
    assert.equal(tested.status, 200, JSON.stringify(tested.body));
    assert.equal(tested.body?.result?.reachable, true);
    assert.equal(tested.body?.result?.httpStatus, 200);

    const synSave = await lens(token1, "observe", "syntheticSave", { url: PUBLIC_IP, expectStatus: 200 });
    assert.equal(synSave.status, 200, JSON.stringify(synSave.body));
    const checkId = synSave.body?.result?.check?.id;
    assert.ok(checkId);
    const ran = await lens(token1, "observe", "syntheticRun", { id: checkId });
    assert.equal(ran.status, 200, JSON.stringify(ran.body));
    assert.equal(ran.body?.result?.check?.status, "up");
    assert.equal(ran.body?.result?.run?.statusCode, 200);
    assert.ok(fetchCalls.some((u) => u.includes("8.8.8.8")));

    const mark = fetchCalls.length;
    const otherConn = await lens(token2, "app-maker", "connectorTest", { projectId, connectorId });
    assert.equal(otherConn.body?.ok, false, JSON.stringify(otherConn.body));
    assert.equal(otherConn.body?.error, "project_not_found");
    assert.notEqual(otherConn.body?.result?.reachable, true);
    const otherRun = await lens(token2, "observe", "syntheticRun", { id: checkId });
    assert.equal(otherRun.body?.ok, false, JSON.stringify(otherRun.body));
    assert.equal(otherRun.body?.error, "check not found");
    assert.notEqual(otherRun.body?.result?.check?.status, "up");
    const during = fetchCalls.slice(mark);
    assert.equal(during.some((u) => /8\.8\.8\.8|127\.0\.0\.1|169\.254|localhost|\[::1\]/.test(u)), false, JSON.stringify(during));
  });
});
