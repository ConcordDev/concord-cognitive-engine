/**
 * server/tests/ssrf-classifier-edges.test.js
 *
 * Private-address edge fixtures for the SSRF guard's IPv4/IPv6
 * classifiers (Mega Plan v2, SB-03): IPv4-mapped IPv6 in dotted and
 * canonical hex forms, the unspecified addresses, CGNAT, benchmarking,
 * NAT64 translation forms, link-local with a zone id, and the
 * integer / octal / hex / shorthand URL forms of 127.0.0.1.
 *
 * Every case must be REFUSED. The NAT64 cases are the discriminating
 * pins: on the pristine guard the embedded IPv4 was never extracted,
 * so a NAT64 form of a private address classified as public and the
 * validator accepted it. The remaining cases were already refused on
 * the pristine guard and stand here as regression pins. A NAT64 form
 * of a PUBLIC address stays reachable — translation to a public
 * address is the prefix's designed function — pinned both ways.
 *
 * Run: node --test server/tests/ssrf-classifier-edges.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIpAddress, validateSafeFetchUrl } from "../lib/ssrf-guard.js";

describe("classifier level — every private edge form classifies private", () => {
  const privateForms = [
    "::ffff:127.0.0.1",   // IPv4-mapped, dotted form
    "::ffff:7f00:1",      // IPv4-mapped, canonical hex form of 127.0.0.1
    "0.0.0.0",            // "this network" / unspecified v4
    "::",                 // unspecified v6
    "[::]",               // unspecified v6, bracketed as in a URL
    "100.64.0.1",         // CGNAT (RFC 6598)
    "198.18.0.1",         // benchmarking (RFC 2544)
    "64:ff9b::7f00:1",    // NAT64 well-known prefix, embedded 127.0.0.1
    "64:ff9b::a9fe:a9fe", // NAT64 well-known prefix, embedded 169.254.169.254
    "64:ff9b:1::7f00:1",  // NAT64 local-use prefix, embedded 127.0.0.1
    "fd00::1",            // unique-local
    "fe80::1%en0",        // link-local with a zone id
  ];
  for (const form of privateForms) {
    it(`${form} is private`, () => {
      assert.equal(isPrivateIpAddress(form), true);
    });
  }

  it("a NAT64 form of a public address stays public", () => {
    assert.equal(isPrivateIpAddress("64:ff9b::808:808"), false); // embedded 8.8.8.8
  });
});

describe("URL level — the validator refuses every private edge form", () => {
  const refusedUrls = [
    "http://2130706433/",              // integer form of 127.0.0.1
    "http://0177.0.0.1/",               // octal form
    "http://0x7f.1/",                   // hex form
    "http://127.1/",                    // shorthand form
    "http://0.0.0.0/",
    "http://100.64.0.1/",
    "http://198.18.0.1/",
    "http://[::]/",
    "http://[fd00::1]/",
    "http://[64:ff9b::7f00:1]/",        // NAT64 form of 127.0.0.1
    "http://169.254.169.254/latest/meta-data/",
  ];
  for (const url of refusedUrls) {
    it(`${url} is refused`, async () => {
      const check = await validateSafeFetchUrl(url);
      assert.equal(check.ok, false, `expected refusal, got ${JSON.stringify(check)}`);
    });
  }

  it("a NAT64 form of a public address is accepted", async () => {
    const check = await validateSafeFetchUrl("http://[64:ff9b::808:808]/");
    assert.equal(check.ok, true, `expected acceptance, got ${JSON.stringify(check)}`);
  });
});
