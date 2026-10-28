// server/domains/public-lookup.js
//
// Read-only lookups against Wikipedia / Wikidata / Commons / StackExchange / HN Algolia for the
// lens widgets that used to call those hosts straight from the browser. Everything goes through
// lib/public-lookup-sources.js (feed-cache: one upstream call per key per TTL, polite UA,
// per-source budgets). NOT a proxy: fixed URL templates, validated scalar params only; a URL
// or host from the client is never read. Bad params => { ok:false, status:400 } and NO fetch.
//
// Result shape: { ok:true, result:{ data, fetchedAt, stale, source } } on fresh/stale data;
// { ok:false, status:"unavailable", reason, lastOkAt, error } when nothing truthful can be served.

import {
  getWikiSummary, getWikiSearch, getWikiOnThisDay, getWikidataEntity, getWikidataSearch,
  getCommonsSearch, getSeSearch, getHnSearch,
  wikiSummaryKey, wikiSearchKey, wikiOnThisDayKey, wikidataEntityKey, wikidataSearchKey,
  commonsSearchKey, seSearchKey, hnSearchKey, LOOKUP_ATTRIBUTION,
} from "../lib/public-lookup-sources.js";
import {
  getNvdCves, getEonetEvents, getGutendexBooks, getSketchfabSearch, getUsgsQuakes,
  getFemaDisasters, getRestCountriesRegion, getSunriseSunset, getImgflipMemes,
  getOnionooSummary, getNpmSearch, getOpenRouterModels,
  nvdCvesKey, eonetEventsKey, gutendexBooksKey, sketchfabSearchKey, usgsQuakesKey,
  femaDisastersKey, restCountriesKey, sunriseSunsetKey, npmSearchKey,
} from "../lib/public-data-sources.js";

const bad = (error) => ({ ok: false, status: 400, error });

function out(r, attribution) {
  if (!r.ok) return r;
  return { ok: true, result: { data: r.data, fetchedAt: r.fetchedAt, stale: r.stale, attribution } };
}

export default function registerPublicLookupActions(registerLensAction) {
  // Each action: validate (key builder returns null => 400, no fetch), then read through the cache.
  const def = (name, validate, read, attribution) => {
    registerLensAction("public-lookup", name, async (_ctx, _artifact, params = {}) => {
      const p = params && typeof params === "object" ? params : {};
      if (!validate(p)) return bad(`invalid_${name.replace(/-/g, "_")}_params`);
      return out(await read(p), attribution);
    });
  };

  def("wiki-summary", (p) => !!wikiSummaryKey(p.lang, p.title), (p) => getWikiSummary(p.lang, p.title), LOOKUP_ATTRIBUTION.wikipedia);
  def("wiki-search", (p) => !!wikiSearchKey(p.lang, p.q), (p) => getWikiSearch(p.lang, p.q), LOOKUP_ATTRIBUTION.wikipedia);
  def("wiki-onthisday", (p) => !!wikiOnThisDayKey(p.kind, p.month, p.day), (p) => getWikiOnThisDay(p.kind, p.month, p.day), LOOKUP_ATTRIBUTION.wikipedia);
  def("wikidata-entity", (p) => !!wikidataEntityKey(p.id), (p) => getWikidataEntity(p.id), LOOKUP_ATTRIBUTION.wikidata);
  def("wikidata-search", (p) => !!wikidataSearchKey(p.q), (p) => getWikidataSearch(p.q), LOOKUP_ATTRIBUTION.wikidata);
  def("commons-search", (p) => !!commonsSearchKey(p.q), (p) => getCommonsSearch(p.q), LOOKUP_ATTRIBUTION.commons);
  def("se-search", (p) => !!seSearchKey(p.site, p), (p) => getSeSearch(p.site, p), LOOKUP_ATTRIBUTION.stackexchange);
  def("hn-search", (p) => !!hnSearchKey(p.q, p.tags, p.byDate === true), (p) => getHnSearch(p.q, p.tags, p.byDate === true), null);

  // Phase 8d: the remaining public data reads (lib/public-data-sources.js) — same
  // contract: fixed templates, validated scalar params, no client URL or host.
  def("nvd-cves", (p) => !!nvdCvesKey(p), (p) => getNvdCves(p), null);
  def("eonet-events", (p) => !!eonetEventsKey(p), (p) => getEonetEvents(p), null);
  def("gutendex-books", (p) => !!gutendexBooksKey(p), (p) => getGutendexBooks(p), null);
  def("sketchfab-search", (p) => !!sketchfabSearchKey(p), (p) => getSketchfabSearch(p), null);
  def("usgs-quakes", (p) => !!usgsQuakesKey(p), (p) => getUsgsQuakes(p), null);
  def("fema-disasters", (p) => !!femaDisastersKey(p), (p) => getFemaDisasters(p), null);
  def("restcountries-region", (p) => !!restCountriesKey(p), (p) => getRestCountriesRegion(p), null);
  def("sunrise-sunset", (p) => !!sunriseSunsetKey(p), (p) => getSunriseSunset(p), null);
  def("imgflip-memes", () => true, () => getImgflipMemes(), null);
  def("onionoo-summary", () => true, () => getOnionooSummary(), null);
  def("npm-search", (p) => !!npmSearchKey(p), (p) => getNpmSearch(p), null);
  def("openrouter-models", () => true, () => getOpenRouterModels(), null);
}
