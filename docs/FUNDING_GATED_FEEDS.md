# Funding-gated & no-honest-source data feeds

> Captured 2026-07-18 at the owner's direction. These are the DATA-SOURCING
> backlog rows that **cannot be wired honestly right now** — either because the
> only real source is paid/licensed (usable once funded) or because no honest
> source exists at any price. Honest-by-construction (CLAUDE.md): a surface with
> no real source stays an explicit honest-failure / "not available" state — it is
> never faked. This ledger is the standing record of *why* each is deferred, so
> it isn't mistaken for a buildable gap. Findings come from the 2026-07-18
> DATA-SOURCING research pass.

## Class A — REQUIRES FUNDING (a real paid/licensed feed exists; usable once funded)

These can be wired the day a budget line covers the feed. Until then the surface
must show an honest "requires a paid data source — not available" state, never a
fabricated value.

| Lens / feature | Real source (paid) | Note |
|---|---|---|
| **emergency-services** — recorded 911 audio / CAD-to-RMS handoff | Proprietary vendor systems (Tyler, CentralSquare) | Enterprise contract + sensitive-data agreements; no public feed by design. |
| **command-center** — on-call SMS/phone paging | Twilio Programmable Messaging | ~$0.0083/segment + carrier fees; free trial credit only, no ongoing free tier. Buildable connector, inherently metered. |
| **fashion** — retailer product catalog (100M+ items) | Google Shopping Content API / Rakuten / partner catalogs | Paid/partner licensing; no free source at the claimed scale. |
| **insurance** — real carrier quote comparison | Applied Epic / EZLynx-class broker APIs | Paid **and** per-state producer-licensed; regulatory-gated. |
| **travel** — live bookable flight/hotel search + pricing | Amadeus for Developers (Enterprise tier) | The free self-service tier was decommissioned 2026-07-17; only paid Enterprise survives. |
| **atlas** — business reviews / ratings on place pages | Foursquare Places API (Premium) | Premium-only, ~$18.75/1k calls; OSM/Nominatim carry no ratings. |
| **hr** — external job-board syndication | Supported-ATS + Indeed Apply integration | Indeed retired free organic XML feeds 2026-03-31; syndication now needs an ATS integration (and likely paid placement). |
| **law** — patent legal status (active/expired/litigated) | Commercial patent-status services | No *clean* free source; quality varies across paid providers. A **partial** signal (litigation presence) is already wired via CourtListener, and `law.patent-claims` explicitly discloses `legalStatus: "not_available"` rather than infer one. |

## Class B — NO HONEST SOURCE AT ANY PRICE (funding does not fix it)

Money won't help — the honest thing genuinely doesn't exist, or wiring a real
feed would misrepresent what the surface claims to be.

| Lens / feature | Why funding doesn't fix it |
|---|---|
| **travel** — airport terminal maps | No structured dataset exists at any tier; individual airports publish PDFs / proprietary apps only. |
| **atlas** — 3D-volume viewer / subsurface signal-tomography | The substrate is Concord's own *fictional* mesh-network sensor data, which is structurally empty. A real feed (e.g. Sentinel-1 InSAR, which IS free) would be **dishonest-by-substitution** — claiming mesh-network tomography from a wholly different real dataset. This is a product-shape mismatch, not a sourcing gap. |
| **dx-platform** — GitLab PR-check | No GitLab connector exists; this is an ENGINEERING build (clone the GitHub connector), not a data-funding item. The GitHub half already shipped. |

## How to treat these

- **Do not** wire a Class-B item to a real-but-different feed to "fill" it — that
  violates honest-by-construction. Keep the honest-failure / "not available" state.
- **Class-A** items are unblocked the moment their feed is funded; wire them
  through the existing SSRF-guarded `connectorFetch` / `cachedFetchJson` chokepoint
  and remove the "requires funding" state.
- When a new DATA-SOURCING item is researched and lands here, record which class
  it is and the exact reason, so the deferral is auditable — same discipline as
  the name/IP-collision baseline.
