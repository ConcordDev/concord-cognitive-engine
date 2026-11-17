/**
 * SXE-41 reference-data store tests.
 *
 * Provenance discipline, literal re-find, the disk budget, and the SSRF
 * guard (exercised with injected DNS + fetch, so no network is touched:
 * a private resolution must be refused BEFORE the fetch function runs).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRefdataStore, isPublicIp } from "../../lib/conkay/refdata/store.js";

function freshStore(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sxe41-test-"));
  return createRefdataStore({ dir, now: () => "2026-11-17T00:00:00.000Z", ...extra });
}

test("put/get round-trip carries the full provenance record", () => {
  const store = freshStore();
  const content = "Young's modulus of steel: 200 GPa (ASTM A36 datasheet)";
  const r = store.put({ sourceUrl: "https://example.org/a36", licence: "public domain", content });
  assert.equal(r.ok, true);
  assert.equal(r.record.licence, "public domain");
  assert.equal(r.record.sourceUrl, "https://example.org/a36");
  assert.equal(r.record.retrievedAt, "2026-11-17T00:00:00.000Z");
  assert.equal(r.record.sha256, createHash("sha256").update(content).digest("hex"));
  assert.equal(r.record.bytes, Buffer.byteLength(content));
  const got = store.get(r.record.id);
  assert.equal(got.content.toString(), content);
  // content-addressed: same URL + same bytes deduplicates
  const again = store.put({ sourceUrl: "https://example.org/a36", licence: "public domain", content });
  assert.equal(again.record.id, r.record.id);
  assert.equal(again.deduplicated, true);
  assert.equal(store.stats().records, 1);
});

test("provenance is mandatory: no source URL or no licence, no storage", () => {
  const store = freshStore();
  assert.equal(store.put({ licence: "MIT", content: "x" }).reason, "refdata_provenance_missing:sourceUrl");
  assert.equal(store.put({ sourceUrl: "https://example.org", content: "x" }).reason, "refdata_provenance_missing:licence");
  assert.equal(store.stats().records, 0);
});

test("literal re-find: the cited value must literally be in the source", () => {
  const store = freshStore();
  const { record } = store.put({
    sourceUrl: "https://example.org/data",
    licence: "CC0",
    content: "E = 200 GPa; nu = 0.3; E = 200 GPa",
  });
  const hit = store.refind(record.id, "200 GPa");
  assert.equal(hit.found, true);
  assert.equal(hit.occurrences, 2);
  const miss = store.refind(record.id, "210 GPa");
  assert.equal(miss.found, false);
  assert.equal(miss.occurrences, 0);
  assert.equal(store.refind("missing-id", "x").reason, "refdata_not_found");
});

test("disk budget: a write past the budget is refused, nothing evicted", () => {
  const store = freshStore({ budgetBytes: 10 });
  const a = store.put({ sourceUrl: "https://example.org/a", licence: "CC0", content: "12345" });
  assert.equal(a.ok, true);
  const b = store.put({ sourceUrl: "https://example.org/b", licence: "CC0", content: "123456" });
  assert.equal(b.ok, false);
  assert.equal(b.reason, "refdata_budget_exceeded");
  assert.equal(store.stats().records, 1);
  assert.equal(store.stats().bytesUsed, 5);
});

test("isPublicIp: private, loopback, link-local and documentation ranges refused", () => {
  for (const ip of ["10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1",
    "169.254.1.1", "0.0.0.0", "198.51.100.7", "203.0.113.9", "224.0.0.1", "240.0.0.1",
    "::1", "::", "fe80::1", "fd00::1", "ff02::1", "2001:db8::1", "::ffff:10.0.0.5"]) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.15.0.1", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicIp(ip), true, ip);
  }
});

test("fetchAndStore: SSRF refusals happen before any fetch", async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => { fetchCalls += 1; throw new Error("must not be called"); };
  const store = freshStore({ fetchImpl, lookupImpl: async () => ["10.0.0.5"] });
  const scheme = await store.fetchAndStore("file:///etc/passwd", { licence: "CC0" });
  assert.equal(scheme.reason, "ssrf_blocked:scheme:file:");
  const creds = await store.fetchAndStore("https://user:pass@example.org/x", { licence: "CC0" });
  assert.equal(creds.reason, "ssrf_blocked:credentials_in_url");
  const priv = await store.fetchAndStore("http://internal.example/x", { licence: "CC0" });
  assert.equal(priv.reason, "ssrf_blocked:non_public_address:10.0.0.5");
  assert.equal(fetchCalls, 0);
});

test("fetchAndStore: public fetch stores with provenance; redirect to private is refused", async () => {
  const publicLookup = async () => ["93.184.216.34"];
  const okFetch = async () => new Response("density of water: 1000 kg/m3", { status: 200 });
  const store = freshStore({ fetchImpl: okFetch, lookupImpl: publicLookup });
  const r = await store.fetchAndStore("https://example.org/water", { licence: "CC0" });
  assert.equal(r.ok, true);
  assert.equal(r.record.retrievedVia, "fetch");
  assert.equal(store.refind(r.record.id, "1000 kg/m3").found, true);

  const redirectFetch = async () => new Response("", {
    status: 302,
    headers: { location: "http://169.254.169.254/latest/meta-data" },
  });
  const store2 = freshStore({
    fetchImpl: redirectFetch,
    lookupImpl: async (host) => (host.includes("169.254") ? ["169.254.169.254"] : ["93.184.216.34"]),
  });
  const blocked = await store2.fetchAndStore("https://example.org/redir", { licence: "CC0" });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.reason.startsWith("ssrf_blocked"));
  assert.equal(store2.stats().records, 0);
});
