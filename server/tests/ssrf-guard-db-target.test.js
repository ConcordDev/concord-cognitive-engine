// DBX-1 — validateDbTarget: the SSRF guard's database-target validator.
//
// Database connections (Database lens §8, allowed-with-safeguards) dial
// a raw host:port with credentials — not an http(s) URL — so the guard
// grows a target validator beside validateSafeFetchUrl: same range
// tables, same "reject if ANY resolution is private" rule, plus a
// database-port allowlist and a pinned IP for the caller to dial.
// Every DNS case injects its resolver; no test touches the network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { validateDbTarget, isPrivateIpAddress, DB_PORT_ALLOWLIST } = await import("../lib/ssrf-guard.js");

const resolving = (map) => async (host) => {
  const hit = map[host];
  if (!hit) { const e = new Error("getaddrinfo ENOTFOUND"); e.code = "ENOTFOUND"; throw e; }
  return hit;
};
const PUBLIC = [{ address: "93.184.216.34", family: 4 }];

describe("DBX-1: port discipline", () => {
  it("accepts the standard database ports", async () => {
    for (const port of DB_PORT_ALLOWLIST) {
      const r = await validateDbTarget("8.8.8.8", port);
      assert.equal(r.ok, true, `port ${port}: ${JSON.stringify(r)}`);
    }
  });

  it("refuses non-database ports before any DNS work", async () => {
    let called = false;
    const lookup = async () => { called = true; return PUBLIC; };
    for (const port of [22, 80, 443, 25, 8080]) {
      const r = await validateDbTarget("db.example.com", port, { lookup });
      assert.equal(r.ok, false, `port ${port}`);
      assert.equal(r.code, "port_not_allowed");
    }
    assert.equal(called, false);
  });

  it("refuses malformed ports", async () => {
    for (const port of [0, 65536, -1, "abc", "", null, undefined, 5432.5]) {
      const r = await validateDbTarget("8.8.8.8", port);
      assert.equal(r.ok, false, `port ${JSON.stringify(port)}`);
      assert.equal(r.code, "invalid_port");
    }
  });

  it("accepts a numeric-string port and honours an allowlist override", async () => {
    const r = await validateDbTarget("8.8.8.8", "5432");
    assert.equal(r.ok, true);
    assert.equal(r.port, 5432);
    const custom = await validateDbTarget("8.8.8.8", 15432, { allowPorts: [15432] });
    assert.equal(custom.ok, true);
  });
});

describe("DBX-1: IP-literal targets", () => {
  it("refuses loopback, RFC1918, link-local, CGNAT and reserved IPv4", async () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.10", "100.64.0.1", "0.0.0.0", "224.0.0.1", "192.0.2.1", "255.255.255.255"]) {
      const r = await validateDbTarget(ip, 5432);
      assert.equal(r.ok, false, ip);
      assert.equal(r.code, "private_address", ip);
    }
    // The IMDS literal gets the guard's more specific metadata refusal
    // (the same precedence validateSafeFetchUrl uses).
    const imds = await validateDbTarget("169.254.169.254", 5432);
    assert.equal(imds.ok, false);
    assert.equal(imds.code, "metadata_blocked");
  });

  it("accepts a public IPv4 literal and pins it", async () => {
    const r = await validateDbTarget("8.8.8.8", 5432);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.resolvedIp, "8.8.8.8");
    assert.equal(r.family, 4);
  });

  it("refuses private IPv6 forms incl. IPv4-mapped loopback", async () => {
    for (const ip of ["::1", "::", "fe80::1", "fd00::1", "fc00::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      const r = await validateDbTarget(ip, 5432);
      assert.equal(r.ok, false, ip);
      assert.equal(r.code, "private_address", ip);
    }
    const imds6 = await validateDbTarget("fd00:ec2::254", 5432);
    assert.equal(imds6.ok, false);
    assert.equal(imds6.code, "metadata_blocked");
  });

  it("accepts a public IPv6 literal", async () => {
    const r = await validateDbTarget("2001:4860:4860::8888", 5432);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.family, 6);
  });
});

describe("DBX-1: host-shape and name refusals (pre-DNS)", () => {
  it("refuses URLs, paths and credential-bearing hosts", async () => {
    let called = false;
    const lookup = async () => { called = true; return PUBLIC; };
    for (const host of ["https://db.example.com", "db.example.com:5432", "user:pass@db.example.com", "db.example.com/path", "db .example.com", "db..example.com", "-db.example.com"]) {
      const r = await validateDbTarget(host, 5432, { lookup });
      assert.equal(r.ok, false, host);
      assert.equal(r.code, "invalid_host", host);
    }
    assert.equal(called, false);
  });

  it("refuses localhost and cloud-metadata names before DNS", async () => {
    let called = false;
    const lookup = async () => { called = true; return PUBLIC; };
    for (const [host, code] of [["localhost", "local_blocked"], ["db.localhost", "local_blocked"], ["metadata.google.internal", "metadata_blocked"], ["169.254.169.254", "metadata_blocked"]]) {
      const r = await validateDbTarget(host, 5432, { lookup });
      assert.equal(r.ok, false, host);
      assert.equal(r.code, code, host);
    }
    assert.equal(called, false);
  });

  it("refuses a missing host", async () => {
    for (const host of ["", "   ", null, undefined, 42]) {
      const r = await validateDbTarget(host, 5432);
      assert.equal(r.ok, false, JSON.stringify(host));
      assert.equal(r.code, "invalid_host");
    }
  });
});

describe("DBX-1: DNS-name targets (injected resolver)", () => {
  it("accepts a public resolution and pins the first address", async () => {
    const r = await validateDbTarget("db.example.com", 5432, { lookup: resolving({ "db.example.com": PUBLIC }) });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.resolvedIp, "93.184.216.34");
    assert.equal(r.hostname, "db.example.com");
    assert.equal(r.addresses.length, 1);
  });

  it("refuses a name resolving to a private address", async () => {
    const lookup = resolving({ "db.example.com": [{ address: "10.1.2.3", family: 4 }] });
    const r = await validateDbTarget("db.example.com", 5432, { lookup });
    assert.equal(r.ok, false);
    assert.equal(r.code, "private_address");
    assert.match(r.error, /10\.1\.2\.3/);
  });

  it("refuses a MIXED resolution — any private address blocks (anti-rebinding)", async () => {
    const lookup = resolving({ "db.example.com": [...PUBLIC, { address: "192.168.0.9", family: 4 }] });
    const r = await validateDbTarget("db.example.com", 5432, { lookup });
    assert.equal(r.ok, false);
    assert.equal(r.code, "private_address");
  });

  it("refuses a name resolving to a private IPv6", async () => {
    const lookup = resolving({ "db.example.com": [{ address: "fd00::5", family: 6 }] });
    const r = await validateDbTarget("db.example.com", 5432, { lookup });
    assert.equal(r.ok, false);
    assert.equal(r.code, "private_address");
  });

  it("reports an unresolvable name as its own refusal", async () => {
    const r = await validateDbTarget("nope.example.com", 5432, { lookup: resolving({}) });
    assert.equal(r.ok, false);
    assert.equal(r.code, "unresolvable");
    const empty = await validateDbTarget("db.example.com", 5432, { lookup: async () => [] });
    assert.equal(empty.code, "unresolvable");
  });

  it("is case-insensitive and trims the host", async () => {
    const r = await validateDbTarget("  DB.Example.COM ", 5432, { lookup: resolving({ "db.example.com": PUBLIC }) });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.hostname, "db.example.com");
  });
});

describe("DBX-1: isPrivateIpAddress", () => {
  it("classifies literals across families and treats non-IPs as private", () => {
    assert.equal(isPrivateIpAddress("8.8.8.8"), false);
    assert.equal(isPrivateIpAddress("127.0.0.1"), true);
    assert.equal(isPrivateIpAddress("::ffff:8.8.8.8"), false);
    assert.equal(isPrivateIpAddress("::ffff:127.0.0.1"), true);
    assert.equal(isPrivateIpAddress("2001:4860:4860::8888"), false);
    assert.equal(isPrivateIpAddress("not-an-ip"), true);
    assert.equal(isPrivateIpAddress(undefined), true);
  });
});
