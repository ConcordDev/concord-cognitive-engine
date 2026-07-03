// S5 / P-A — consumer end-to-end test for the provenance-stamped open-data
// ingest path (government.js `open-data-ingest` lens action).
//
// Exercises the FULL chain with NO real network egress:
//   fetch (mocked via the public-fetch module seam)
//     → stampIngestedRecord (createIngest + stampProvenance)
//       → DTUProtocol.validate()  (provenance shape ok)
//         → DTUProtocol.verify()  (metadata + provenance content hashes match)
//
// The mocked fetch returns a realistic data.gov CKAN `package_show` payload.
// We then confirm the resulting DTU carries a REAL, CORRECT
// metadata.provenance whose contentSha256 is the canonical hash of the DTU's
// OWN content (recomputed independently here — not fabricated) and whose
// sourceUrl is the URL the macro fetched.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./depth/_harness.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { DTUProtocol, computeContentHash } from "../lib/dtu-protocol.js";

const protocol = new DTUProtocol();

// A realistic CKAN package_show response (?id=...) → { result: {...record...} }.
const FAKE_CKAN_RECORD = {
  id: "ussteel-bridge-loads",
  name: "us-steel-bridge-loads",
  title: "US Steel Bridge Load Dataset",
  organization: { title: "Department of Transportation" },
  notes: "Measured load capacities for interstate steel bridges, 2019-2024.",
  resources: [
    { url: "https://example-cdn.data.gov/bridge-loads.csv", format: "CSV" },
    { url: "https://example-cdn.data.gov/bridge-loads.json", format: "JSON" },
  ],
  metadata_modified: "2026-01-15T09:30:00.000000",
};

before(() => {
  // Install the module-scope transport so government.js#fetchJsonGov's
  // fetchPublicUrl(url, {...}, {}) call (no per-call opts) returns our mock.
  // NOTE: the seam skips the SSRF guard by design (caller owns egress) — the
  // guard orchestration is proven separately in public-fetch.test.js. No real
  // network is touched here.
  __setPublicFetchTestTransport(async (url) => {
    // Mirror the two CKAN shapes the macro consumes:
    //   package_show   → { result: <record> }
    //   package_search → { result: { results: [<record>, ...] } }
    const body = /package_search/.test(url)
      ? { result: { results: [FAKE_CKAN_RECORD] } }
      : { result: FAKE_CKAN_RECORD };
    return { ok: true, status: 200, json: async () => body };
  });
});

after(() => {
  __setPublicFetchTestTransport(null); // restore the real guarded path
});

test("open-data-ingest: fetch → stamp → validate → verify, provenance is real + correct", async () => {
  const r = await lensRun("government", "open-data-ingest", {
    params: { id: "ussteel-bridge-loads" },
  });

  assert.strictEqual(r.ok, true, `ingest must succeed, got: ${JSON.stringify(r)}`);
  const dtu = r.result?.dtu;
  assert.ok(dtu, "result must carry a DTU");
  assert.strictEqual(dtu.type, "ingest", "DTU type must be 'ingest'");

  // 1) The DTU validates (provenance shape ok).
  const v = protocol.validate(dtu);
  assert.strictEqual(v.valid, true, `DTU must validate: ${JSON.stringify(v.errors || [])}`);

  // 2) The DTU verifies (metadata content hash AND provenance content hash match).
  const ver = protocol.verify(dtu);
  assert.strictEqual(ver.verified, true, "DTU must verify end-to-end");
  assert.ok(ver.provenance, "verify() must include the provenance sub-report");
  assert.strictEqual(ver.provenance.match, true, "provenance content-hash must match");

  // 3) The provenance is REAL: contentSha256 is the canonical hash of the DTU's
  //    OWN content, recomputed independently here (not trusting the stamp).
  const prov = dtu.metadata.provenance;
  assert.ok(prov, "metadata.provenance must be present");
  assert.strictEqual(
    prov.contentSha256,
    computeContentHash(dtu.content),
    "provenance contentSha256 must equal the canonical hash of dtu.content",
  );
  assert.match(prov.contentSha256, /^[a-f0-9]{64}$/, "contentSha256 must be 64-hex");

  // 4) sourceUrl is the URL the macro actually fetched (the CKAN package_show URL).
  assert.strictEqual(
    prov.sourceUrl,
    "https://catalog.data.gov/api/3/action/package_show?id=ussteel-bridge-loads",
    "provenance sourceUrl must be the fetched CKAN URL",
  );
  assert.strictEqual(prov.sourceId, "ussteel-bridge-loads", "sourceId must be the upstream record id");
  assert.ok(prov.fetchedAt, "fetchedAt must be stamped");

  // 5) The content carries the shaped-but-REAL upstream fields (not fabricated).
  assert.strictEqual(dtu.content.record.title, "US Steel Bridge Load Dataset");
  assert.strictEqual(dtu.content.record.organization, "Department of Transportation");
  assert.strictEqual(dtu.content.record.resourceCount, 2);
  assert.strictEqual(dtu.content.ingestKind, "open-data");

  // 6) The macro advertises the DTU is ready for dtu.create.
  assert.strictEqual(r.result.readyForDtuCreate, true);
});

test("open-data-ingest: tampering with the ingested content is detectable post-hoc", async () => {
  const r = await lensRun("government", "open-data-ingest", {
    params: { query: "bridge loads" }, // search path → result.results[0]
  });
  assert.strictEqual(r.ok, true, `ingest must succeed, got: ${JSON.stringify(r)}`);
  const dtu = r.result.dtu;

  // Baseline verify passes.
  assert.strictEqual(protocol.verify(dtu).verified, true);

  // Tamper with the record after ingest — verify must flag the provenance check.
  dtu.content.record.resourceCount = 99;
  const ver = protocol.verify(dtu);
  assert.strictEqual(ver.verified, false, "tampered ingest DTU must not verify");
  assert.strictEqual(ver.provenance.match, false, "provenance sub-check must catch the tamper");
});

test("open-data-ingest: missing id AND query is an honest failure (no fabrication)", async () => {
  // NB: the lens.run dispatcher unwraps a handler's `{ok:true,result}` but wraps
  // a handler failure object under `result`, so the honest failure surfaces as
  // r.result = { ok:false, error }.
  const r = await lensRun("government", "open-data-ingest", { params: {} });
  const inner = r.result ?? r;
  assert.strictEqual(inner.ok, false, "no id/query must fail honestly (no fabricated DTU)");
  assert.match(String(inner.error), /id or query required/);
  assert.strictEqual(inner.dtu, undefined, "a failed ingest must not carry a DTU");
});
