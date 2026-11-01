// Calendar ICS feeds are user-supplied URLs; they must go through the SSRF guard (lib/public-fetch) at connect
// and at sync (security finding GB-0332). Hostile targets are refused with no outbound request.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { icsUrlProblem, fetchIcsText } from "../lib/ics-fetch.js";
import registerCalendarActions from "../domains/calendar.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ACTIONS = new Map();
before(() => registerCalendarActions((d, n, fn) => ACTIONS.set(`${d}.${n}`, fn)));
const call = (name, ctx, params = {}) => ACTIONS.get(`calendar.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
const ctx = { actor: { userId: "ics_u" }, userId: "ics_u" };
const FEED = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a@x\r\nDTSTART:20260601T090000Z\r\nDTEND:20260601T100000Z\r\nSUMMARY:Ok\r\nEND:VEVENT\r\nEND:VCALENDAR";

beforeEach(() => { globalThis._concordSTATE = { dtus: new Map() }; globalThis._concordSaveStateDebounced = () => {}; });
afterEach(() => __setPublicFetchTestTransport(null));

const HOSTILE = [
  "http://127.0.0.1/c.ics", "http://localhost/c.ics", "http://sub.localhost/c.ics", "http://10.0.0.5/c.ics",
  "http://192.168.1.10/c.ics", "http://172.16.0.1/c.ics", "http://169.254.169.254/latest/meta-data/", "http://0.0.0.0/c.ics",
  "http://100.64.0.1/c.ics", "http://[::1]/c.ics", "http://[fd00::1]/c.ics", "http://[::ffff:10.0.0.1]/c.ics",
  "http://printer.local/c.ics", "http://svc.internal/c.ics", "https://user:pass@93.184.216.34/c.ics", "ftp://93.184.216.34/c.ics", "file:///etc/passwd",
];

describe("icsUrlProblem (save-time check)", () => {
  it("refuses loopback/private/link-local/metadata/credentialed/non-http(s) URLs", () => {
    for (const u of HOSTILE) assert.ok(icsUrlProblem(u), `should refuse ${u}`);
  });
  it("accepts ordinary public feed URLs", () => {
    for (const u of ["https://calendar.google.com/calendar/ical/x/basic.ics", "https://93.184.216.34/c.ics", "http://example.com/c.ics"]) assert.equal(icsUrlProblem(u), null, u);
  });
});

describe("accounts-connect", () => {
  // accounts-connect is async since F14: it fetches + parse-checks the feed (through the same SSRF-guarded
  // transport) before the account exists, so a bogus URL can never become a "connected" account.
  it("refuses hostile feed URLs with no account stored and makes no request", async () => {
    let requests = 0;
    __setPublicFetchTestTransport(async () => { requests++; return { ok: true, status: 200, text: async () => FEED }; });
    for (const u of HOSTILE.filter((x) => /^https?:/i.test(x))) {
      const r = await call("accounts-connect", ctx, { label: "x", icsUrl: u });
      assert.equal(r.ok, false, u);
      assert.match(r.error, /icsUrl/, u);
    }
    assert.equal(requests, 0, "hostile URLs are refused before any outbound request");
    assert.equal(call("accounts-list", ctx).result.accounts.length, 0);
  });
  it("still connects a public feed URL (its feed validates)", async () => {
    __setPublicFetchTestTransport(async () => ({ ok: true, status: 200, text: async () => FEED }));
    assert.equal((await call("accounts-connect", ctx, { label: "ok", icsUrl: "https://calendar.google.com/x.ics" })).ok, true);
  });
});

describe("accounts-sync", () => {
  it("refuses a hostile URL already stored on an account (legacy rows) and makes NO outbound request", async () => {
    let requests = 0;
    __setPublicFetchTestTransport(async () => { requests++; return { ok: true, status: 200, text: async () => FEED }; });
    const a = (await call("accounts-connect", ctx, { label: "legacy", icsUrl: "https://calendar.google.com/x.ics" })).result.account;
    requests = 0; // connect validated the feed once; the sync below must make none
    a.icsUrl = "http://169.254.169.254/latest/meta-data/";
    const r = await call("accounts-sync", ctx, { id: a.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /blocked/);
    assert.equal(requests, 0);
  });
  it("a public URL passes through the guarded transport and imports", async () => {
    let seen = null;
    __setPublicFetchTestTransport(async (url, init) => { seen = { url, redirect: init.redirect }; return { ok: true, status: 200, text: async () => FEED }; });
    const a = (await call("accounts-connect", ctx, { label: "pub", icsUrl: "https://93.184.216.34/c.ics" })).result.account;
    const r = await call("accounts-sync", ctx, { id: a.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.imported, 1);
    assert.equal(seen.url, "https://93.184.216.34/c.ics");
    assert.equal(seen.redirect, "manual", "redirects are not followed automatically");
  });
});

describe("fetchIcsText", () => {
  const hdr = (h) => ({ get: (k) => h[k.toLowerCase()] ?? null });
  // opts.pinnedFetchImpl keeps the REAL guard (validateSafeFetchUrl) running; IP-literal hosts need no DNS.
  const mk = (responses, log = []) => ({ pinnedFetchImpl: async (check) => { log.push(check.url || check.hostname || "?"); return responses.shift(); } });

  it("re-validates every redirect hop: a redirect to a private address is refused after exactly one request", async () => {
    const log = [];
    const r = await fetchIcsText("https://93.184.216.34/a.ics", { fetchOpts: mk([{ ok: false, status: 302, headers: hdr({ location: "http://10.0.0.5/secret" }) }], log) });
    assert.equal(r.ok, false);
    assert.match(r.error, /blocked/);
    assert.equal(log.length, 1, "the private hop was never requested");
  });
  it("follows a public redirect and returns the final feed", async () => {
    const r = await fetchIcsText("https://93.184.216.34/a.ics", { fetchOpts: mk([
      { ok: false, status: 301, headers: hdr({ location: "https://93.184.216.35/b.ics" }) },
      { ok: true, status: 200, headers: hdr({}), text: async () => FEED },
    ]) });
    assert.equal(r.ok, true);
    assert.equal(r.finalUrl, "https://93.184.216.35/b.ics");
  });
  it("gives up after too many redirects", async () => {
    const loop = Array.from({ length: 6 }, (_, i) => ({ ok: false, status: 302, headers: hdr({ location: `https://93.184.216.${40 + i}/x.ics` }) }));
    const r = await fetchIcsText("https://93.184.216.34/a.ics", { fetchOpts: mk(loop) });
    assert.equal(r.ok, false);
    assert.match(r.error, /too many/);
  });
  it("caps the body size (content-length and streamed/unknown length)", async () => {
    const big = "x".repeat(2000);
    const a = await fetchIcsText("https://93.184.216.34/a.ics", { maxBytes: 1000, fetchOpts: mk([{ ok: true, status: 200, headers: hdr({ "content-length": "5000" }), text: async () => big }]) });
    assert.deepEqual([a.ok, a.error], [false, "feed too large"]);
    const b = await fetchIcsText("https://93.184.216.34/a.ics", { maxBytes: 1000, fetchOpts: mk([{ ok: true, status: 200, headers: hdr({}), text: async () => big }]) });
    assert.deepEqual([b.ok, b.error], [false, "feed too large"]);
  });
  it("reports non-OK statuses and transport failures without throwing", async () => {
    const a = await fetchIcsText("https://93.184.216.34/a.ics", { fetchOpts: mk([{ ok: false, status: 404, headers: hdr({}) }]) });
    assert.deepEqual([a.ok, a.status], [false, 404]);
    const b = await fetchIcsText("https://93.184.216.34/a.ics", { fetchOpts: { pinnedFetchImpl: async () => { throw new Error("ECONNREFUSED"); } } });
    assert.equal(b.ok, false);
    assert.match(b.error, /unreachable/);
  });
  it("times out a hung feed", async () => {
    const r = await fetchIcsText("https://93.184.216.34/a.ics", { timeoutMs: 40, fetchOpts: { pinnedFetchImpl: (check, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))) } });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
  });
});

describe("wiring", () => {
  it("calendar.js has no bare fetch(icsUrl)/fetch(account.icsUrl)", () => {
    const src = fs.readFileSync(path.join(here, "..", "domains", "calendar.js"), "utf8");
    assert.ok(!/fetch\((account\.)?icsUrl\)/.test(src));
    assert.match(src, /fetchIcsText\(account\.icsUrl\)/);
    assert.match(src, /icsUrlProblem\(icsUrl\)/);
  });
});
