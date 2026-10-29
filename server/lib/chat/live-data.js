// server/lib/chat/live-data.js
//
// Read-only live data for chat: a small, fixed set of public sources that are
// already integrated and allow this use. Every value comes back with where it
// came from, when it was retrieved, and the licence/attribution that goes with
// it, so an answer can cite it. Nothing here is scraped from a site that forbids
// it, and no paid API is used.
//
//   kind "compound"  PubChem (NCBI/NLM): identity, formula, molar mass, CAS and,
//                    when asked, experimental density / boiling / melting point
//                    (lib/conkay/knowledge/connectors/pubchem.js).
//   kind "fx"        ECB euro reference rates via Frankfurter (no key).
//
// Caller must be a signed-in user, and each user is rate-limited. Results are
// cached (compound 24 h, fx 15 min). The getter and clock are injectable.

import { identify, experimental } from "../conkay/knowledge/connectors/pubchem.js";
import { liveGetter } from "../conkay/knowledge/connectors/fetcher.js";
import { viewerIdFromCtx } from "../dtu-read-access.js";

const FRANKFURTER = "https://api.frankfurter.dev/v1";
const PUBCHEM_LICENSE = "PubChem (NCBI/NLM) data is free to use; individual contributor records carry their own terms. Cite PubChem and the CID.";
const FX_LICENSE = "ECB euro foreign exchange reference rates, published by the European Central Bank; free to use with attribution (via Frankfurter).";
const HEADINGS = { density: "Density", boiling_point: "Boiling Point", melting_point: "Melting Point" };
const TTL = { compound: 24 * 3600e3, fx: 15 * 60e3 };
const RATE = { windowMs: 60e3, max: 20 };
const MAX_CACHE = 200;

const cache = new Map(); // key -> { at, value }
const buckets = new Map(); // viewer -> number[] (timestamps)

export function _resetLiveDataForTest() { cache.clear(); buckets.clear(); }

function rateLimited(viewer, now) {
  const hits = (buckets.get(viewer) || []).filter((t) => now - t < RATE.windowMs);
  if (hits.length >= RATE.max) { buckets.set(viewer, hits); return true; }
  hits.push(now); buckets.set(viewer, hits);
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value);
  return false;
}

function remember(key, value, now) {
  cache.delete(key); cache.set(key, { at: now, value });
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
}

function defaultGetter() {
  // chat cannot wait 30 s on a busy server: two attempts, short back-off
  return liveGetter({ maxAttempts: 2, retryDelayMs: 1500, minIntervalMs: 250, userAgent: "ConcordChat/1.0 (live-data; +https://concord-os.org)" });
}

async function compound(params, get, nowIso) {
  const name = String(params.name || params.compound || "").trim().slice(0, 120);
  if (!name) return { ok: false, error: 'compound needs a name, e.g. {"kind":"compound","name":"ethanol"}' };
  const prop = params.property ? String(params.property).toLowerCase().replace(/[\s-]+/g, "_") : null;
  if (prop && !HEADINGS[prop]) return { ok: false, error: `property must be one of ${Object.keys(HEADINGS).join(", ")}` };
  const id = await identify(name, get);
  if (!id.ok) return { ok: false, error: id.reason || "PubChem did not identify that name", reviews: id.reviews || [] };
  const out = {
    ok: true, kind: "compound", query: name,
    value: {
      name: id.identity.name, cid: id.cid, molecularFormula: id.identity.identifiers.molecularFormula, cas: id.identity.identifiers.cas,
      molarMassGPerMol: id.molarMass.value, smiles: id.identity.identifiers.smiles || null,
    },
    source: { name: "PubChem", url: `https://pubchem.ncbi.nlm.nih.gov/compound/${id.cid}` },
    retrievedAt: id.documents?.[0]?.retrieved || nowIso, license: PUBCHEM_LICENSE,
  };
  if (prop) {
    const ex = await experimental(id.cid, HEADINGS[prop], id.identity.name, get);
    if (!ex.ok) out.experimental = { property: prop, error: ex.error };
    else {
      out.experimental = {
        property: prop,
        values: ex.claims.filter((c) => c.kind === "quantitative").slice(0, 8).map((c) => ({
          value: c.value ?? null, range: c.range ?? null, unit: c.unit, conditions: c.conditions || {}, contributor: c.attributedTo || null,
        })),
        note: ex.note || "Experimental values are contributor-reported and may disagree; cite the contributor.",
      };
    }
  }
  return out;
}

async function fx(params, fetchImpl, nowIso) {
  const base = String(params.base || "EUR").toUpperCase();
  const symbols = (Array.isArray(params.symbols) ? params.symbols : String(params.symbols || params.to || "USD").split(","))
    .map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s)).slice(0, 10);
  if (!/^[A-Z]{3}$/.test(base) || !symbols.length) return { ok: false, error: 'fx needs 3-letter currency codes, e.g. {"kind":"fx","base":"EUR","symbols":["USD"]}' };
  const url = `${FRANKFURTER}/latest?base=${base}&symbols=${symbols.join(",")}`;
  let res; let json;
  // A hung rate server must not hold a chat turn: abort the request and the body read after the timeout.
  const timeoutMs = Math.max(500, Number(process.env.CONCORD_LIVE_DATA_FX_TIMEOUT_MS) || 8000);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: ac.signal });
    if (!res.ok) return { ok: false, error: `Frankfurter HTTP ${res.status}` };
    json = await res.json();
  } catch (e) {
    return { ok: false, error: ac.signal.aborted ? `Frankfurter timed out after ${timeoutMs} ms` : `Frankfurter unreachable: ${String(e?.message || e)}` };
  } finally { clearTimeout(timer); }
  if (!json?.rates || typeof json.rates !== "object") return { ok: false, error: "Frankfurter returned no rates" };
  return {
    ok: true, kind: "fx", query: `${base}->${symbols.join(",")}`,
    value: { base: json.base || base, date: json.date || null, rates: json.rates },
    source: { name: "European Central Bank via Frankfurter", url: "https://frankfurter.dev" },
    retrievedAt: nowIso, license: FX_LICENSE,
  };
}

/**
 * @param {object} ctx macro ctx (viewer must be a signed-in user)
 * @param {object} params { kind, ... }
 * @param {{get?:Function, fetchImpl?:Function, now?:()=>number}} [deps]
 */
export async function getLiveData(ctx, params = {}, deps = {}) {
  const viewer = viewerIdFromCtx(ctx);
  if (!viewer) return { tool: "get_live_data", ok: false, error: "sign in to use live data" };
  const now = (deps.now || Date.now)();
  const kind = String(params.kind || "").toLowerCase();
  if (kind !== "compound" && kind !== "fx") return { tool: "get_live_data", ok: false, error: 'kind must be "compound" (PubChem) or "fx" (ECB rates)', kinds: { compound: "name, optional property: density|boiling_point|melting_point", fx: "base, symbols" } };

  const key = `${kind}:${JSON.stringify({ ...params, kind: undefined })}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL[kind]) return { tool: "get_live_data", ...hit.value, cached: true };

  if (rateLimited(viewer, now)) return { tool: "get_live_data", ok: false, error: `rate limit: at most ${RATE.max} live-data calls per minute` };

  const nowIso = new Date(now).toISOString();
  let out;
  try {
    out = kind === "compound"
      ? await compound(params, deps.get || defaultGetter(), nowIso)
      : await fx(params, deps.fetchImpl || globalThis.fetch, nowIso);
  } catch (e) { out = { ok: false, error: `live data failed: ${String(e?.message || e)}` }; }
  if (out.ok) remember(key, out, now);
  return { tool: "get_live_data", ...out, ...(out.ok ? { cached: false, note: "Cite the source and retrievedAt with any number taken from this." } : {}) };
}
