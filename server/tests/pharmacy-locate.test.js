// Behavioral tests for pharmacy.locate — the real, keyless physical-pharmacy
// locator wired into the pharmacy lens (CMS NPPES NPI Registry).
//
// Mirrors the harness pattern in pharmacy-lens-macros.test.js: a local
// register() shim mirrors POST /api/lens/run's dispatch (handler(ctx,
// virtualArtifact, input)), so the test exercises the EXACT macro the
// frontend calls via lensRun('pharmacy', 'locate', {...}).
//
// Hermetic — no live network. global.fetch is stubbed per-test with a
// real NPPES-shaped fixture (trimmed from the real v2.1 API response
// shape) for the success path, and made to throw/AbortError for the
// unreachable path. cachedFetchJson caches by URL, so the module-level
// cache is cleared before/after every test to keep cases independent.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerPharmacyActions from "../domains/pharmacy.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "pharmacy", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

async function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`pharmacy.${name} not registered`);
  const virtualArtifact = { id: null, domain: "pharmacy", type: "domain_action", data: input, meta: {} };
  return await fn(ctx, virtualArtifact, input);
}

before(() => {
  registerPharmacyActions(register);
});

const realFetch = global.fetch;
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  clearExternalFetchCache();
});
afterEach(() => {
  global.fetch = realFetch;
  clearExternalFetchCache();
});

const ctxA = { actor: { userId: "user_a", id: "user_a" }, userId: "user_a" };

// A trimmed, real-shaped NPPES v2.1 response fixture — two organization
// (NPI-2) pharmacy records, one with a LOCATION address and one with only
// a MAILING address (exercises the LOCATION-preferred / fallback logic).
function nppesFixture() {
  return {
    result_count: 2,
    results: [
      {
        number: "1234567890",
        enumeration_type: "NPI-2",
        basic: { organization_name: "MAIN STREET PHARMACY", status: "A" },
        addresses: [
          {
            address_purpose: "MAILING",
            address_1: "PO BOX 99",
            city: "SPRINGFIELD",
            state: "IL",
            postal_code: "627010099",
            telephone_number: "217-555-0100",
          },
          {
            address_purpose: "LOCATION",
            address_1: "100 MAIN ST",
            address_2: "STE 2",
            city: "SPRINGFIELD",
            state: "IL",
            postal_code: "62701",
            telephone_number: "217-555-0101",
          },
        ],
        taxonomies: [{ code: "3336C0003X", desc: "Pharmacy", primary: true }],
      },
      {
        number: "9876543210",
        enumeration_type: "NPI-2",
        basic: { organization_name: "CORNER DRUG CO", status: "A" },
        addresses: [
          {
            address_purpose: "LOCATION",
            address_1: "42 ELM AVE",
            city: "SPRINGFIELD",
            state: "IL",
            postal_code: "62702",
            telephone_number: "217-555-0202",
          },
        ],
        taxonomies: [{ code: "3336C0003X", desc: "Pharmacy", primary: true }],
      },
    ],
  };
}

describe("pharmacy.locate — registration", () => {
  it("is registered on the pharmacy domain", () => {
    assert.equal(typeof ACTIONS.get("locate"), "function");
  });
});

describe("pharmacy.locate — mapping shape (real NPPES fixture, no live network)", () => {
  it("maps NPPES results to clean { name, npi, address, city, state, postalCode, phone } rows", async () => {
    let requestedUrl = null;
    global.fetch = async (url) => {
      requestedUrl = String(url);
      return { ok: true, status: 200, json: async () => nppesFixture() };
    };
    const r = await call("locate", ctxA, { city: "Springfield", state: "IL" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "nppes-npi-registry");
    assert.equal(r.result.count, 2);
    assert.equal(r.result.results.length, 2);

    // Request actually hit NPPES with the right query shape.
    assert.match(requestedUrl, /npiregistry\.cms\.hhs\.gov/);
    assert.match(requestedUrl, /taxonomy_description=Pharmacy/);
    assert.match(requestedUrl, /city=Springfield/);
    assert.match(requestedUrl, /state=IL/);

    // LOCATION address preferred over MAILING when both exist.
    const main = r.result.results.find((x) => x.npi === "1234567890");
    assert.ok(main, "expected the Main Street Pharmacy row");
    assert.equal(main.name, "MAIN STREET PHARMACY");
    assert.equal(main.address, "100 MAIN ST STE 2");
    assert.equal(main.city, "SPRINGFIELD");
    assert.equal(main.state, "IL");
    assert.equal(main.postalCode, "62701");
    assert.equal(main.phone, "217-555-0101");

    // Single-address (LOCATION-only) record maps straightforwardly.
    const corner = r.result.results.find((x) => x.npi === "9876543210");
    assert.ok(corner);
    assert.equal(corner.name, "CORNER DRUG CO");
    assert.equal(corner.address, "42 ELM AVE");
    assert.equal(corner.phone, "217-555-0202");

    // Only real NPPES fields are surfaced — no fabricated rating/hours/distance.
    for (const row of r.result.results) {
      const keys = Object.keys(row).sort();
      assert.deepEqual(keys, ["address", "city", "name", "npi", "phone", "postalCode", "state"]);
    }
    assert.equal(typeof r.result.disclaimer, "string");
    assert.ok(r.result.disclaimer.length > 0);
  });

  it("optional name param narrows the query (organization_name set)", async () => {
    let requestedUrl = null;
    global.fetch = async (url) => {
      requestedUrl = String(url);
      return { ok: true, status: 200, json: async () => ({ result_count: 0, results: [] }) };
    };
    await call("locate", ctxA, { city: "Springfield", state: "IL", name: "Walgreens" });
    assert.match(requestedUrl, /organization_name=Walgreens/);
  });

  it("limit param is clamped into [1,50] and forwarded to NPPES", async () => {
    let requestedUrl = null;
    global.fetch = async (url) => {
      requestedUrl = String(url);
      return { ok: true, status: 200, json: async () => ({ result_count: 0, results: [] }) };
    };
    await call("locate", ctxA, { city: "Springfield", state: "IL", limit: 9999 });
    assert.match(requestedUrl, /limit=50/);
  });
});

describe("pharmacy.locate — honest empty result (real query, zero matches)", () => {
  it("returns ok:true with an empty results[] — never a fabricated pharmacy", async () => {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ result_count: 0, results: [] }) });
    const r = await call("locate", ctxA, { city: "Nowhereville", state: "WY" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.results, []);
    assert.equal(r.result.count, 0);
    assert.equal(r.result.source, "nppes-npi-registry");
  });
});

describe("pharmacy.locate — honest failure paths", () => {
  it("VALIDATION: missing city/state is rejected before any network call", async () => {
    let fetchCalled = false;
    global.fetch = async () => { fetchCalled = true; return { ok: true, status: 200, json: async () => ({}) }; };
    const r1 = await call("locate", ctxA, { state: "IL" });
    assert.equal(r1.ok, false);
    assert.match(String(r1.error), /city and state/i);
    const r2 = await call("locate", ctxA, { city: "Springfield" });
    assert.equal(r2.ok, false);
    assert.match(String(r2.error), /city and state/i);
    assert.equal(fetchCalled, false, "must not hit the network on a validation failure");
  });

  it("VALIDATION: malformed state code is rejected before any network call", async () => {
    let fetchCalled = false;
    global.fetch = async () => { fetchCalled = true; return { ok: true, status: 200, json: async () => ({}) }; };
    const r = await call("locate", ctxA, { city: "Springfield", state: "Illinois" });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /2-letter USPS code/i);
    assert.equal(fetchCalled, false);
  });

  it("DEGRADE-GRACEFUL: NPPES unreachable (network throw) returns honest {ok:false, reason:'nppes_unreachable'}, never fabricated results", async () => {
    global.fetch = async () => { throw new Error("network down"); };
    let r;
    await assert.doesNotReject(async () => { r = await call("locate", ctxA, { city: "Springfield", state: "IL" }); });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "nppes_unreachable");
    assert.match(String(r.error), /unreachable/i);
    assert.equal(r.result, undefined, "no fabricated result payload on failure");
  });

  it("DEGRADE-GRACEFUL: NPPES non-2xx response is treated as unreachable, not a fake empty success", async () => {
    global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const r = await call("locate", ctxA, { city: "Springfield", state: "IL" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "nppes_unreachable");
  });

  it("HONEST QUERY-ERROR: an NPPES Errors[] payload surfaces as an honest failure, not a silently-empty list", async () => {
    global.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ Errors: [{ field: "state", description: "Invalid state abbreviation" }] }),
    });
    const r = await call("locate", ctxA, { city: "Springfield", state: "IL" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "nppes_invalid_query");
    assert.match(String(r.error), /Invalid state abbreviation/);
  });
});
