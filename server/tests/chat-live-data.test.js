// Brief E §2: get_live_data — read-only, signed-in, cached, rate-limited, with source/timestamp/licence.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getLiveData, _resetLiveDataForTest } from "../lib/chat/live-data.js";
import { pubchemUrls } from "../lib/conkay/knowledge/connectors/pubchem.js";
import { replayGetter } from "../lib/conkay/knowledge/connectors/fetcher.js";

const ctx = { actor: { id: "u1" } };
beforeEach(() => _resetLiveDataForTest());

const rec = {
  [pubchemUrls.name("ethanol")]: { body: JSON.stringify({ IdentifierList: { CID: [702] } }), retrieved: "2026-10-29" },
  [pubchemUrls.props(702)]: { body: JSON.stringify({ PropertyTable: { Properties: [{ CID: 702, MolecularFormula: "C2H6O", MolecularWeight: "46.07", IUPACName: "ethanol", InChI: "InChI=1S/C2H6O", InChIKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N", ConnectivitySMILES: "CCO" }] } }), retrieved: "2026-10-29" },
  [pubchemUrls.heading(702, "CAS")]: { body: JSON.stringify({ Record: { Reference: [{ ReferenceNumber: 1, SourceName: "A" }, { ReferenceNumber: 2, SourceName: "B" }], Section: [{ TOCHeading: "CAS", Information: [{ ReferenceNumber: 1, Value: { StringWithMarkup: [{ String: "64-17-5" }] } }, { ReferenceNumber: 2, Value: { StringWithMarkup: [{ String: "64-17-5" }] } }] }] } }), retrieved: "2026-10-29" },
};
const get = replayGetter(rec);

test("a signed-in user gets a compound with source, timestamp and licence", async () => {
  const r = await getLiveData(ctx, { kind: "compound", name: "ethanol" }, { get });
  assert.equal(r.ok, true);
  assert.equal(r.value.molecularFormula, "C2H6O");
  assert.equal(r.value.molarMassGPerMol, 46.07);
  assert.equal(r.value.cas, "64-17-5");
  assert.equal(r.source.name, "PubChem");
  assert.match(r.source.url, /compound\/702/);
  assert.ok(r.retrievedAt);
  assert.match(r.license, /PubChem/);
  assert.equal(r.cached, false);
});

test("anonymous callers are refused", async () => {
  const r = await getLiveData({}, { kind: "compound", name: "ethanol" }, { get });
  assert.deepEqual([r.ok, r.error], [false, "sign in to use live data"]);
  assert.equal((await getLiveData({ actor: { userId: "anon" } }, { kind: "fx" }, { fetchImpl: async () => { throw new Error("must not call"); } })).ok, false);
});

test("a repeat is served from cache without touching the network", async () => {
  let calls = 0;
  const counting = async (u) => { calls++; return get(u); };
  await getLiveData(ctx, { kind: "compound", name: "ethanol" }, { get: counting });
  const n = calls;
  const again = await getLiveData(ctx, { kind: "compound", name: "ethanol" }, { get: counting });
  assert.equal(again.cached, true);
  assert.equal(calls, n);
});

test("fx returns ECB rates with attribution", async () => {
  const fetchImpl = async (url) => { assert.match(url, /frankfurter\.dev\/v1\/latest\?base=EUR&symbols=USD,GBP/); return { ok: true, json: async () => ({ base: "EUR", date: "2026-10-29", rates: { USD: 1.08, GBP: 0.85 } }) }; };
  const r = await getLiveData(ctx, { kind: "fx", base: "eur", symbols: ["usd", "gbp"] }, { fetchImpl, now: () => 1000 });
  assert.equal(r.ok, true);
  assert.equal(r.value.rates.USD, 1.08);
  assert.match(r.source.name, /European Central Bank/);
  assert.match(r.license, /attribution/);
});

test("upstream failure and bad input are honest errors, never fabricated values", async () => {
  const down = await getLiveData(ctx, { kind: "fx", base: "EUR", symbols: ["USD"] }, { fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(down.ok, false);
  assert.match(down.error, /unreachable/);
  assert.equal((await getLiveData(ctx, { kind: "fx", base: "EUR", symbols: ["dollars"] }, { fetchImpl: async () => ({}) })).ok, false);
  assert.equal((await getLiveData(ctx, { kind: "stocks" })).ok, false);
  assert.equal((await getLiveData(ctx, { kind: "compound", name: "nonesuchium" }, { get })).ok, false);
});

test("each user is rate-limited per minute", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ base: "EUR", rates: { USD: 1 } }) });
  let limited = null;
  for (let i = 0; i < 25 && !limited; i++) {
    const r = await getLiveData(ctx, { kind: "fx", base: "EUR", symbols: ["USD"], n: i }, { fetchImpl, now: () => 5000 });
    if (!r.ok && /rate limit/.test(r.error)) limited = i;
  }
  assert.equal(limited, 20);
  const other = await getLiveData({ actor: { id: "u2" } }, { kind: "fx", base: "EUR", symbols: ["USD"], n: 99 }, { fetchImpl, now: () => 5000 });
  assert.equal(other.ok, true);
});

import { executeToolCall } from "../lib/chat-agent.js";
test("the chat tool reaches get_live_data and refuses anonymous callers", async () => {
  const r = await executeToolCall({}, () => null, new Map(), { tool: "get_live_data", params: { kind: "fx" } });
  assert.equal(r.ok, false);
  assert.match(r.error, /sign in/);
});

test("a hung exchange-rate server times out instead of holding the chat turn", async () => {
  process.env.CONCORD_LIVE_DATA_FX_TIMEOUT_MS = "500";
  try {
    const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const t0 = Date.now();
    const r = await getLiveData(ctx, { kind: "fx", base: "EUR", symbols: ["USD"] }, { fetchImpl: hang });
    assert.equal(r.ok, false);
    assert.match(r.error, /timed out after 500 ms/);
    assert.ok(Date.now() - t0 < 3000);
    // a stalled body read is cut too
    const stall = async (url, init) => ({ ok: true, json: () => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))) });
    const r2 = await getLiveData(ctx, { kind: "fx", base: "EUR", symbols: ["GBP"] }, { fetchImpl: stall });
    assert.match(r2.error, /timed out/);
  } finally { delete process.env.CONCORD_LIVE_DATA_FX_TIMEOUT_MS; }
});
