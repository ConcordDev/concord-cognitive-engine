# DATA-SOURCING feed research — free/open source per backlog row

> Research pass 2026-07-18 (read-only; no code changed). Input: the DATA-SOURCING-tagged
> rows in `docs/WAVE4_INVENTORY.md` (the "closing the hard 20%" backlog, CLAUDE.md's sixth
> hard invariant). Goal per invariant: for each row that needs a real external data feed
> before it can be honestly wired, find the **best genuinely-free, honest-quality** source —
> or state honestly that none exists. This is a companion to `docs/FUNDING_GATED_FEEDS.md`
> (the paid/no-source ledger); this doc is the "here is a real free feed" half.
>
> Honest-by-construction rules followed: real sources only, every base URL verified this pass,
> explicit "no free source" where true, and **no paid feed dressed as free**. A free source that
> would misrepresent the surface (dishonest-by-substitution) is called out as such, not
> recommended.
>
> **Wire chokepoint** (all "wire note" columns assume this): the SSRF-guarded
> `server/lib/external-fetch.js` — `cachedFetchJson(url, { ttlMs })` + `registerLiveFeed(register,
> domain, name, fetchFn)` which returns the standard `{ ok, source, fetchedAt, result }` shape and
> degrades to `{ ok:false, reason:"api_unreachable" }`. Keyed connectors go through
> `server/lib/connector-client.js`'s `connectorFetch`. Concord already wires several of the sources
> below through exactly this path: CoinGecko, USGS, NOAA Tides, NASA APOD, data.gov, GDELT,
> OSV.dev, Nominatim, USPTO PatentsView, CourtListener, FDA SPL.

---

## Summary counts

**25 distinct open DATA-SOURCING rows** researched (already-CLOSED rows — `repos`→OSV.dev,
`grounding`→GDELT, `materials`→periodic-table, `poetry`, `insurance`-producer — are excluded).

| Disposition | Count | Rows |
|---|---:|---|
| ✅ **Clean free source** (keyless or trivial) | **5** | pharmacy locator, space satellite catalog, astronomy seeing-forecast, urban-planning basemap (parcels partial), command-center push (SMS paid) |
| 🔑 **Free but needs a free key/registration** | **4** | law patent legal-status + prosecution, law patent full claims text, hr federal-job ingestion, aviation NOTAM (approval-gated) |
| 📚 **Free reference material exists, no API → CURATION** | **2** | inheritance intestacy/probate, legal state court rules |
| 🚫 **No honest free source** (paid, none, or dishonest-by-substitution) | **12** | animation social-post, atlas InSAR-tomography, atlas business-reviews, emergency-services CAD tiles, emergency-services 911 audio, fashion catalog, insurance carrier quotes, logistics inventory, marketing ad-spend, travel terminal maps, travel bookable flights, hr syndication-out half |
| 🔌 **Connector plumbing, not a public feed** (ENGINEERING) | **2** | ingest live-connector, integrations/message OAuth catalog |

Headline: **5 clean free wires + 4 free-with-key + 2 curation** = **11 of 25 rows have a real
honest free path** that were previously parked as "deferred / no source." Two of those (space,
astronomy) directly **overturn a "no free source" claim** in the capability-map docs — CelesTrak
and 7Timer! are both genuinely free and keyless. The remaining 14 are honestly blocked (paid feed,
no dataset at any price, dishonest-by-substitution, or per-tenant connector work).

---

## The table

| # | Lens / capability | Data needed | Recommended free source (verified URL) | Key? | License / terms | Rate limit | Wire note | Tractability |
|---|---|---|---|---|---|---|---|---|
| 1 | **pharmacy** — geocoded physical pharmacy locator | Provider name + address + specialty for real pharmacies, searchable by ZIP/state | **NPPES NPI Registry API** (CMS) `https://npiregistry.cms.hhs.gov/api/?version=2.1&taxonomy_description=pharmacy&state=..&city=..` | ❌ none | US Gov public domain; CMS updates weekly | No published hard limit; be polite (public gov API) | `cachedFetchJson` the URL; filter `taxonomy_description=Pharmacy`; map `results[].addresses` to locator pins. Same shape as existing FDA/NASA live feeds. | ✅ **Clean, same-day** |
| 2 | **space** — live satellite catalog beyond ISS | Full-catalog orbital elements (TLE/GP) by name/catalog#/group | **CelesTrak GP API** `https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json` (also `?CATNR=`, `?NAME=`, `?INTDES=`) | ❌ none | CelesTrak non-profit usage policy — free, attribution + no hammering | Politeness-based; cache 2–6h (GP updates a few×/day) | `registerLiveFeed("space","catalog", …cachedFetchJson(url,{ttlMs:6h}))`. **Overturns the doc's "not free/keyless" claim** — that was true of Space-Track.org, false of CelesTrak. | ✅ **Clean, same-day** |
| 3 | **astronomy** — live seeing / observing-condition feed | Astronomical seeing + transparency + cloud forecast for a lat/lon | **7Timer! ASTRO API** `https://www.7timer.info/bin/api.pl?lon=..&lat=..&product=astro&output=json` | ❌ none | Free public service (based on NOAA GFS) | Politeness-based | Reshapes the feature from "weather-webcam" (no free source) to a real **seeing/transparency forecast** — honest and arguably more useful. `cachedFetchJson`, cache ~1h. Webcam *imagery* itself still has no free feed. | ✅ **Clean (reshaped)** |
| 4 | **urban-planning** — live parcel / GIS basemap tiles | Basemap raster/vector tiles + admin boundaries; parcel polygons | **Basemap:** OSM US Tileservice `https://tiles.openstreetmap.us/` + **Census TIGER/Line** `https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html`. **Parcels nationwide:** Regrid (paid). | ❌ basemap / n/a parcels | OSM = ODbL (attribution); TIGER = US Gov public domain | OSM tile usage policy (rate-limited anon) | Basemap + boundaries wire cleanly (tile URL template / shapefile ingest). **Nationwide parcel cadastre is paid (Regrid 156M records)** — county-by-county open GIS exists but isn't one feed. | ⚠️ **Partial** (basemap free, parcels paid) |
| 5 | **command-center** — on-call paging | Deliver a page to a human (push / SMS / phone) | **Push:** ntfy.sh `https://ntfy.sh/<topic>` (POST) — Apache-2.0, self-hostable. **SMS/phone:** Twilio (paid). | ❌ push / n/a SMS | ntfy Apache-2.0; public instance free, self-host free | Public instance fair-use; self-host unlimited | Push paging wires as a single `connectorFetch` POST (keyless topic). **SMS/voice paging remains paid** (Twilio, per `FUNDING_GATED_FEEDS.md`). | ⚠️ **Partial** (push free, telephony paid) |
| 6 | **law** — patent legal status (active/expired/litigated) | Grant/maintenance/expiry status + litigation signal | **USPTO Open Data Portal** file-wrapper/status API `https://data.uspto.gov/` (status-codes catalog `https://data.uspto.gov/apis/patent-file-wrapper/status-codes`). Litigation signal already wired via **CourtListener**. | 🔑 free ODP key | US Gov public domain | ODP per-key limits (generous) | `connectorFetch` with the free ODP key on the existing `connectorFetch` chokepoint (same pattern as PatentsView). Replaces the current honest `legalStatus:"not_available"`. **Overturns "no free source"** — ODP is free, was gated behind a now-decommissioned Developer Hub (retired 2026-06-05). | 🔑 **Free-with-key** |
| 7 | **law** — patent full claims text / prosecution history | Full claims text + file-wrapper prosecution events | **USPTO PatentsView** `g_claims` field (key already in repo) + **USPTO ODP** file-wrapper docs `https://data.uspto.gov/` | 🔑 PatentsView key (have) + ODP key | US Gov public domain | PatentsView 45 req/min/key | Claims text: extend the existing PatentsView query field set (`server/domains/law.js` already wires PatentsView). Prosecution history: ODP file-wrapper API. | 🔑 **Free-with-key** (claims: same-day) |
| 8 | **hr** — external job listings (ingestion half) | Real job postings to ingest/search | **USAJOBS API** `https://data.usajobs.gov/api/search` (federal) — free key; **Adzuna** free-tier (broader, key) | 🔑 free key (email signup) | USAJOBS US Gov public domain; Adzuna free-tier ToS | USAJOBS rate-limited per User-Agent | Two headers (`User-Agent`, `Authorization-Key`) via `connectorFetch`. **NB:** this covers *ingesting* listings; the doc's row is *syndication OUT* (posting → boards) which needs an ATS/paid placement — no free path (Indeed retired free XML feeds 2026-03-31). | 🔑 **Free-with-key** (ingest only) |
| 9 | **aviation** — NOTAM fetch | Live NOTAM data by location | **FAA NMS API** `https://api.faa.gov/` (GeoJSON/AIXM) — credentials **free by request** (email `NOTAMS@faa.gov`) | 🔑 free but approval-gated | US Gov data; FAA API portal ToS | OAuth2 client-credentials; per-key limits | `connectorFetch` with OAuth2 client-credentials token. **Corrects the doc's "paywalled tier" framing** — the credential is free, but manual FAA approval gates it (not instant, not a same-day wire). | 🔑 **Free-with-gated-key** |
| 10 | **inheritance** — probate/intestacy reference (statutory shares, per-state timelines) | Intestacy share tables + probate timelines by jurisdiction | **No API.** Public-domain source material: **Uniform Probate Code** + per-state statutes via **Cornell LII** `https://www.law.cornell.edu/` / state code sites | ❌ | Statutes = public domain | n/a (curate, not fetch) | Not a live feed — **CURATION**: author a cited intestacy-share/timeline dataset from public statutes (like the periodic-table close). Honest to ship as authored reference, not faked precision. | 📚 **Curation** |
| 11 | **legal** — cross-jurisdiction state court procedural rules | State rules of civil/criminal procedure | **No clean API.** Public-domain rules published per-judiciary; hosted on **Justia** / **CourtListener** / state court sites | ❌ | Court rules = public domain | n/a | **CURATION**: ingest per-state rule text (public domain). No structured free API exists to normalize across 50 states — an honest scope limit, closeable by authoring. | 📚 **Curation** |
| 12 | **animation** — social-platform posting (TikTok/YouTube/IG/Discord) for exported clips | Publish a rendered clip to a user's social account | **None (unified).** Each platform = its own OAuth app + upload API (engineering connector, per-platform, most gated/reviewed). | — | per-platform ToS | — | Not a data *feed* — a fan-out of per-platform posting connectors (like Gmail/Calendar work), each needing app review + operator credentials. No single free source. | 🚫 **No free feed** (per-platform connector) |
| 13 | **atlas** — 3D-volume viewer + subsurface classification for signal tomography | Volumetric subsurface/deformation data | **None honest.** Real InSAR IS free (ESA **Copernicus/Sentinel-1** `https://dataspace.copernicus.eu/`) but the substrate is Concord's *fictional mesh-sensor* data — wiring Sentinel-1 would be **dishonest-by-substitution**. | — | (Sentinel-1 is free/open) | — | Product-shape mismatch, not a sourcing gap. Keep the honest-empty state. Do **not** wire a real-but-different feed to "fill" it. | 🚫 **No honest source** (substitution) |
| 14 | **atlas** — business reviews/ratings on place pages | Ratings/reviews per POI | **None free.** OSM/Nominatim carry no ratings; Foursquare Places (Premium ~$18.75/1k) and Google Places are paid. | — | — | — | No OSM-sourced review data to surface; not fabricated. Honest gap. | 🚫 **No free source** (paid only) |
| 15 | **emergency-services** — licensed CAD-grade map tiles / AVL hardware | CAD basemap + automatic vehicle location | **None honest at grade.** OSM tiles are free but not CAD-grade; AVL is radio/GPS hardware, not a data feed. | — | — | — | Structural — needs paid CAD vendor + hardware. Honest failure state stays. | 🚫 **No free source** |
| 16 | **emergency-services** — recorded 911 audio / CAD-to-RMS handoff | 911 call audio + CAD→RMS records | **None.** Proprietary PSAP vendor systems (Tyler, CentralSquare); sensitive-data + enterprise contract by design. | — | — | — | No public feed exists at any tier. Honest gap. | 🚫 **No source** |
| 17 | **fashion** — retailer product-catalog integration (100M+ items) | Nationwide retail SKU catalog | **None free at scale.** Google Shopping Content API / Rakuten / partner catalogs are paid/partner-licensed. | — | — | — | No free source at the claimed scale. Honest deferral. | 🚫 **No free source** (paid only) |
| 18 | **insurance** — real carrier quote comparison | Per-state carrier quotes | **None free.** Applied Epic / EZLynx-class broker APIs are paid **and** per-state producer-licensed (regulatory-gated). | — | — | — | Documented honest-failure in code (`legalStatus`/quote = not_available). | 🚫 **No free source** (paid + licensed) |
| 19 | **logistics** — `inventoryAudit` real inventory data source | Live warehouse/store inventory | **None public.** WMS/Shopify/NetSuite feeds are per-tenant, credentialed — an OAuth connector per customer, not a public dataset. | — | per-tenant | — | Not a free public feed; it's a per-tenant connector (like the connector suite). No open source exists. | 🚫 **No public feed** (per-tenant) |
| 20 | **marketing** — external ad-platform spend integration | Ad spend/performance | **None as public data.** Google Ads / Meta Marketing APIs are free-to-*use* but require the user's own ad account + OAuth — per-user connector, not a public feed. | — | per-account OAuth | — | Engineering connector per platform; no public aggregate feed. Spend stays manually entered until connectors built. | 🚫 **No public feed** (per-account connector) |
| 21 | **travel** — airport terminal maps | Structured terminal/gate maps | **None.** No structured dataset at any tier; airports publish PDFs / proprietary apps only. | — | — | — | Genuinely doesn't exist as a feed. Honest gap, low value. | 🚫 **No source** |
| 22 | **travel** — live bookable flight/hotel search + pricing | Bookable inventory + prices | **None free for booking.** Amadeus free self-service tier decommissioned 2026-07-17; only paid Enterprise. Flight *tracking* IS free (**OpenSky** `https://opensky-network.org/api/states/all`, OAuth2, non-commercial) but that's status, not booking. | — | OpenSky non-commercial only | OpenSky: 429 + 10s floor (free) | Booking: no free source. If a *flight-status* (not booking) surface is acceptable, OpenSky wires via `connectorFetch` (OAuth2 client-creds, free registration) — but it does not fulfill "bookable." | 🚫 **No free source** for booking (tracking free) |
| 23 | **ingest** — live connector execution (`runSync`) | Records from arbitrary sources | **n/a — ENGINEERING.** Each concrete source needs its own real credential/egress path on `connectorFetch`. | — | — | — | Not a single feed — the connectorFetch/OAuth plumbing already exists; each connector is its own credential+egress build. | 🔌 **Connector work** |
| 24 | **integrations / message** — real OAuth connect flow for catalog connectors (Slack/Sheets/GitHub/Notion) | Per-user OAuth tokens | **n/a — ENGINEERING + operator secrets.** Code is complete (`server/domains/{slack,sheets,github,notion}.js`); go-live gated only on operator-supplied OAuth client credentials. | — | per-provider OAuth | — | Same operational gate as Gmail/Calendar — not a data-sourcing gap, an operator-credential gate. | 🔌 **Operator credentials** |
| 25 | **hr** — job-board syndication (posting OUT) | Push postings to external boards | **None free.** Indeed retired free organic XML feeds 2026-03-31; syndication now needs an ATS integration + likely paid placement. (Ingestion half = row 8, free.) | — | — | — | The outbound-syndication direction has no free path; the inbound-ingestion direction does (row 8). | 🚫 **No free source** (out-half) |

---

## Ranked by value × tractability (worst-blocked last)

**Tier 1 — clean same-day free wire (do first):**
1. **pharmacy → NPPES NPI Registry** (keyless, public-domain, weekly-fresh) — highest value, zero friction.
2. **space → CelesTrak GP** (keyless) — overturns a false "no free source"; full satellite catalog.
3. **astronomy → 7Timer! ASTRO** (keyless) — real seeing/transparency forecast (reshaped feature).

**Tier 2 — free but needs a free key/registration:**
4. **law patent claims text → PatentsView `g_claims`** (key already in repo — nearly same-day).
5. **hr federal-job ingestion → USAJOBS** (free email key).
6. **law patent legal-status → USPTO ODP** (free key; overturns "no free source").
7. **command-center push → ntfy.sh** (keyless push; SMS stays paid).
8. **aviation NOTAM → FAA NMS** (free but manual FAA approval — slowest of the free set).

**Tier 3 — partial (free basemap, paid detail):**
9. **urban-planning → OSM US tiles + Census TIGER** (basemap free; nationwide parcels paid).

**Tier 4 — curation, not a feed (bounded authoring):**
10. **inheritance → Uniform Probate Code / Cornell LII** (author cited intestacy dataset).
11. **legal → public-domain state court rules** (ingest per-state rule text).

**Tier 5 — no honest free source (keep honest-failure state):**
animation social-post, atlas InSAR-tomography (dishonest-by-substitution), atlas business-reviews,
emergency-services CAD tiles, emergency-services 911 audio, fashion catalog, insurance carrier
quotes, logistics inventory, marketing ad-spend, travel terminal maps, travel bookable flights,
hr syndication-out. Plus **ingest / integrations / message** which are connector-credential
ENGINEERING, not data-sourcing.

---

## Sources verified this pass

- NPPES NPI Registry API — https://npiregistry.cms.hhs.gov/api-page , https://npiregistry.cms.hhs.gov/registry/help-api
- CelesTrak GP data — https://celestrak.org/NORAD/elements/ , https://www.celestrak.org/NORAD/documentation/gp-data-formats.php
- 7Timer! ASTRO — https://www.7timer.info/ (product=astro), https://publicapis.io/7-timer-api
- USPTO Open Data Portal — https://data.uspto.gov/ , https://data.uspto.gov/apis/patent-file-wrapper/status-codes , https://data.uspto.gov/support/transition-guide/peds
- USAJOBS API — https://developer.usajobs.gov/api-reference/get-api-search
- FAA NMS / NOTAM API — https://api.faa.gov/s/ , https://notams.aim.faa.gov/
- OpenSky Network API — https://openskynetwork.github.io/opensky-api/rest.html
- ntfy.sh — https://ntfy.sh/ , https://github.com/binwiederhier/ntfy (Apache-2.0)
- OSM US Tileservice — https://tiles.openstreetmap.us/ ; Census TIGER/Line — https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
- Regrid (paid parcels, for contrast) — https://regrid.com/api
- Cornell LII (public-domain statutes) — https://www.law.cornell.edu/
