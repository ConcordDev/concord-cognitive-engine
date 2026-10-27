/**
 * Public external feeds (Ramaj, 2026-10-27 3:07 PM ET).
 *
 * Items a lens `feed` action imports from a public, unauthenticated external
 * API (Crossref, PoetryDB, Stack Exchange, ZenQuotes, USGS, NWS, ...) are
 * public content and are saved public, so megas and hypers built from them
 * can be public (lib/consolidated-visibility.js).
 *
 * Only the exact `source` strings below count. Anything a user connected or
 * owns (email, uploads, DMs, private connectors, a user's own sensor or QA
 * readings such as manufacturing's "wired-feed") is not listed and stays
 * private. tests/public-feed-sources.test.js fails when a new `*-feed`
 * source appears in server/domains without being classified here.
 *
 * Provenance (security follow-up): source + "feed" tag are caller-controlled,
 * so the backfill and the consolidation member rule also require the
 * server-only meta.feedIngest marker (lib/feed-ingest-provenance.js) and
 * never open a quarantine:* row.
 */
import { isQuarantined } from "./dtu-quarantine.js";

export const PUBLIC_FEED_SOURCES = Object.freeze(new Set([
  "apple-music-rss-feed",   // rss.applemarketing.com charts
  "artic-feed",             // Art Institute of Chicago open API
  "carbonintensity-feed",   // api.carbonintensity.org.uk
  "census-feed",            // api.census.gov
  "circl-cve-feed",         // cve.circl.lu
  "coingecko-trending-feed",// api.coingecko.com
  "courtlistener-feed",     // courtlistener.com public opinions
  "cpsc-feed",              // saferproducts.gov recalls
  "cpsc-parenting-feed",    // saferproducts.gov recalls
  "crossref-feed",          // api.crossref.org works
  "frankfurter-feed",       // api.frankfurter.app ECB rates
  "gbif-feed",              // api.gbif.org occurrences
  "github-events-feed",     // public events of a public repo, unauthenticated
  "inciweb-feed",           // InciWeb public incidents
  "launch-library-feed",    // Launch Library 2 upcoming launches
  "metmuseum-feed",         // Met Museum open access
  "nager-date-feed",        // date.nager.at public holidays
  "nasa-apod-feed",         // api.nasa.gov APOD
  "nhtsa-recalls-feed",     // api.nhtsa.gov recalls
  "nws-alerts-feed",        // api.weather.gov alerts
  "nws-marine-alerts-feed", // api.weather.gov marine alerts
  "openbeautyfacts-feed",   // world.openbeautyfacts.org
  "openfda-feed",           // api.fda.gov
  "openfda-vet-feed",       // api.fda.gov animal events
  "openfoodfacts-feed",     // world.openfoodfacts.org
  "opensky-feed",           // opensky-network.org states
  "opentdb-feed",           // opentdb.com trivia
  "poetrydb-feed",          // poetrydb.org
  "restcountries-feed",     // restcountries.com
  "stack-exchange-feed",    // api.stackexchange.com
  "thedogapi-feed",         // api.thedogapi.com
  "themealdb-feed",         // themealdb.com
  "thesportsdb-feed",       // thesportsdb.com
  "usgs-earthquake-feed",   // earthquake.usgs.gov
  "usgs.earthquake-feed",   // earthquake.usgs.gov (geology lens spelling)
  "usgs-feed",              // earthquake.usgs.gov
  "wger-feed",              // wger.de exercises
  "worldbank-feed",         // api.worldbank.org
  "zenquotes-feed",         // zenquotes.io
]));

/** `*-feed` labels that are NOT public: they carry the user's own data. */
export const PRIVATE_FEED_LABELS = Object.freeze(new Set([
  "wired-feed", // manufacturing: the user's own SPC/IoT readings (not a DTU source)
]));

export function isPublicFeedSource(source) {
  return typeof source === "string" && PUBLIC_FEED_SOURCES.has(source);
}

/**
 * Fields a public feed action passes to dtu.create: public, and federation
 * tier global ("local" is owner-only in both the JS list filter and the Rust
 * sidecar, which would hide a public row from everyone else).
 */
export const PUBLIC_FEED_DTU_FIELDS = Object.freeze({ visibility: "public", visibilityScope: "global" });

const CLOSED_PRIVACY = new Set(["private", "followers-only", "followers_only"]);

/**
 * meta.feedIngest set by dtu.create inside a lens feed action for this
 * row's own source. Same check as hasFeedIngestProvenance in
 * lib/feed-ingest-provenance.js (kept here to avoid an import cycle).
 */
export function hasIngestMarker(d) {
  const fi = d?.meta?.feedIngest;
  return !!fi && typeof fi === "object" && fi.action === "feed" && !!fi.domain
    && isPublicFeedSource(d.source) && fi.source === d.source;
}

/**
 * A stored row that a public feed imported and that is still closed:
 * allowlisted source, the "feed" tag every feed action sets, the server-only
 * meta.feedIngest marker, not quarantined, a regular DTU,
 * visibility private (internal is a system decision and is left alone), and
 * nothing that marks it personal (privacy private/followers-only, scope
 * user/personal/private).
 */
export function isClosedPublicFeedItem(d) {
  if (!d || typeof d !== "object") return false;
  if (!isPublicFeedSource(d.source)) return false;
  if (!Array.isArray(d.tags) || !d.tags.includes("feed")) return false;
  if (isQuarantined(d)) return false;
  if (!hasIngestMarker(d)) return false;
  if ((d.tier || "regular") !== "regular") return false;
  if (d.visibility !== "private") return false;
  if (CLOSED_PRIVACY.has(String(d.privacy || "").toLowerCase())) return false;
  if (["user", "personal", "private"].includes(String(d.scope || "").toLowerCase())) return false;
  return true;
}

/** Open one feed row in place. Returns the row. */
export function openPublicFeedItem(d, now = () => new Date().toISOString()) {
  d.visibility = "public";
  d.federation_tier = "global";
  if (d.federationTier) d.federationTier = "global";
  d.meta = { ...(d.meta || {}), publicFeed: { source: d.source, openedAt: now(), from: "private" } };
  return d;
}

/**
 * Backfill: every closed public-feed row in `nodes` becomes public. With no
 * `persist` it is a dry run. Idempotent (an opened row is no longer closed).
 * @returns {{ opened: number, bySource: Record<string, number>, dryRun: boolean }}
 */
export function backfillPublicFeedItems({ nodes, persist = null }) {
  const out = { opened: 0, bySource: {}, dryRun: !persist };
  for (const d of nodes || []) {
    if (!isClosedPublicFeedItem(d)) continue;
    out.opened++;
    out.bySource[d.source] = (out.bySource[d.source] || 0) + 1;
    if (persist) { openPublicFeedItem(d); persist(d); }
  }
  return out;
}

/**
 * The visibility a consolidation member would have under the feed rule:
 * a closed public-feed row (e.g. one archived before the backfill ran)
 * counts as public. Everything else is returned unchanged.
 */
export function asPublicFeedMember(d) {
  if (!isClosedPublicFeedItem(d)) return d;
  return { ...d, visibility: "public", federation_tier: "global" };
}
