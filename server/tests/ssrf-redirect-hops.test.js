/**
 * server/tests/ssrf-redirect-hops.test.js
 *
 * Acceptance pins for the guarded fetch's redirect discipline
 * (Mega Plan v2, SB-01 + SB-02):
 *
 *   - Redirects are followed manually: every hop's Location is
 *     re-validated before it is fetched, so a public URL that redirects
 *     to a private / metadata target is refused AT THE HOP
 *     (SSRF_BLOCKED) and the target is never contacted.
 *   - A chain longer than 5 hops is refused (SSRF_TOO_MANY_REDIRECTS).
 *   - A public -> public redirect still works, and credentials
 *     (authorization / cookie) do not cross an origin boundary.
 *   - If the pinned dispatcher cannot be constructed, the fetch fails
 *     closed (SSRF_PIN_FAILED) — there is no unpinned fallback, and the
 *     transport is never invoked.
 *
 * The real-socket leg uses two loopback servers and a fabricated check
 * pinned to the first (the ssrf-guard-pinned-ip.test.js precedent).
 * The remaining legs stub globalThis.fetch with a transport that models
 * the real one's redirect behaviour (follows unless redirect:"manual"),
 * the codebase's standing fetch-mock precedent — the validator and the
 * hop loop under test are the real code in both cases.
 *
 * Run: node --test server/tests/ssrf-redirect-hops.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchWithPinnedIp } from "../lib/ssrf-guard.js";

const realFetch = globalThis.fetch;

function redirectTo(location, status = 302) {
  return new Response(null, { status, headers: { location } });
}
function textBody(text) {
  return new Response(text, { status: 200, headers: { "content-type": "text/plain" } });
}

// A fetch stub modelling the real transport: it follows redirects
// internally unless the caller asked for redirect:"manual". Records
// every guard-level call and every handler actually invoked.
function stubTransport(routes) {
  const calls = [];
  const reached = new Set();
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), redirect: init.redirect, headers: init.headers });
    let current = String(url);
    for (let internal = 0; ; internal++) {
      const handler = routes.get(current);
      if (!handler) throw new Error(`stub transport: no route for ${current}`);
      reached.add(current);
      const res = handler();
      const loc = res.headers.get("location");
      const isRedirect = [301, 302, 303, 307, 308].includes(res.status) && !!loc;
      if (!isRedirect || init.redirect === "manual") return res;
      if (internal > 20) throw new Error("stub transport: redirect loop");
      current = new URL(loc, current).toString();
    }
  };
  return { fn, calls, reached };
}

function fabricatedCheck(url, ip) {
  return { ok: true, url, hostname: new URL(url).hostname, resolvedIp: ip, family: 4 };
}

describe("guarded fetch — redirect hops are re-validated (SB-01)", () => {
  let serverA;
  let serverB;
  let portA;
  let portB;
  let hitsB = 0;

  before(async () => {
    serverB = http.createServer((req, res) => {
      hitsB++;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("admin-reached");
    });
    await new Promise((r) => serverB.listen(0, "127.0.0.1", r));
    portB = serverB.address().port;
    serverA = http.createServer((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${portB}/admin` });
      res.end();
    });
    await new Promise((r) => serverA.listen(0, "127.0.0.1", r));
    portA = serverA.address().port;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise((r) => serverA.close(r));
    await new Promise((r) => serverB.close(r));
  });

  it("real sockets: a redirect to a private target is refused at the hop and never contacted", async () => {
    hitsB = 0;
    const check = fabricatedCheck(`http://127.0.0.1:${portA}/start`, "127.0.0.1");
    await assert.rejects(
      () => fetchWithPinnedIp(check),
      (err) => err.code === "SSRF_BLOCKED"
    );
    assert.equal(hitsB, 0, "the redirect target must never be contacted");
  });

  it("a redirect to the cloud metadata address is refused at the hop", async () => {
    const start = "http://93.184.216.34/start";
    const metadata = "http://169.254.169.254/latest/meta-data/";
    const routes = new Map([
      [start, () => redirectTo(metadata)],
      [metadata, () => textBody("metadata-body")],
    ]);
    const stub = stubTransport(routes);
    globalThis.fetch = stub.fn;
    try {
      await assert.rejects(
        () => fetchWithPinnedIp(fabricatedCheck(start, "93.184.216.34")),
        (err) => err.code === "SSRF_BLOCKED"
      );
      assert.equal(stub.reached.has(metadata), false, "the metadata handler must never run");
      assert.equal(stub.calls.length, 1, "only the first hop is fetched");
      assert.equal(stub.calls[0].redirect, "manual", "the guard forces manual redirects");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("a 6-hop redirect chain is refused", async () => {
    const ips = ["93.184.216.34", "8.8.8.8", "1.1.1.1", "208.67.222.222", "9.9.9.9", "94.140.14.14", "76.76.2.0"];
    const urls = ips.map((ip, i) => `http://${ip}/hop-${i}`);
    const routes = new Map();
    for (let i = 0; i < urls.length - 1; i++) {
      routes.set(urls[i], () => redirectTo(urls[i + 1]));
    }
    routes.set(urls[urls.length - 1], () => textBody("end-of-chain"));
    const stub = stubTransport(routes);
    globalThis.fetch = stub.fn;
    try {
      await assert.rejects(
        () => fetchWithPinnedIp(fabricatedCheck(urls[0], ips[0])),
        (err) => err.code === "SSRF_TOO_MANY_REDIRECTS"
      );
      assert.equal(stub.calls.length, 6, "initial fetch plus 5 followed hops, then refusal");
      assert.equal(stub.reached.has(urls[urls.length - 1]), false, "the 7th URL is never fetched");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("a public -> public redirect still works, and credentials do not cross the origin", async () => {
    const start = "http://93.184.216.34/start";
    const final = "http://8.8.8.8/final";
    const routes = new Map([
      [start, () => redirectTo(final)],
      [final, () => textBody("public-ok")],
    ]);
    const stub = stubTransport(routes);
    globalThis.fetch = stub.fn;
    try {
      const res = await fetchWithPinnedIp(fabricatedCheck(start, "93.184.216.34"), {
        headers: { authorization: "Bearer test-token", cookie: "sid=1" },
      });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "public-ok");
      assert.equal(stub.calls.length, 2, "both hops are fetched by the guard");
      const hop2Headers = new Headers(stub.calls[1].headers);
      assert.equal(hop2Headers.get("authorization"), null, "authorization is stripped cross-origin");
      assert.equal(hop2Headers.get("cookie"), null, "cookie is stripped cross-origin");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("guarded fetch — no unpinned fallback (SB-02)", () => {
  after(() => {
    globalThis.fetch = realFetch;
  });

  it("a dispatcher construction failure throws SSRF_PIN_FAILED and the transport is never invoked", async () => {
    const guard = await import("../lib/ssrf-guard.js");
    let transportCalls = 0;
    globalThis.fetch = async () => {
      transportCalls++;
      return textBody("unpinned-response");
    };
    // The seam exists only on the fixed guard; on the pristine guard the
    // optional call is a no-op and the fetch proceeds unpinned — which
    // is exactly the behaviour this pin refuses.
    guard.__setPinnedDispatcherFactory?.(() => {
      throw new Error("synthetic construction failure");
    });
    try {
      await assert.rejects(
        () => guard.fetchWithPinnedIp(fabricatedCheck("http://93.184.216.34/", "93.184.216.34")),
        (err) => err.code === "SSRF_PIN_FAILED"
      );
      assert.equal(transportCalls, 0, "no fetch — pinned or unpinned — may be attempted");
    } finally {
      guard.__setPinnedDispatcherFactory?.(null);
      globalThis.fetch = realFetch;
    }
  });
});
