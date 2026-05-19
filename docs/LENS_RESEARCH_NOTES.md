# Lens Research Notes

**Purpose**: capture the industry research that grounds each lens rebuild. When a sprint claims "QuickBooks parity" or "Spotify parity", the research that backs the claim lives here. Future sessions can audit gaps and add references.

**Process going forward**: before any new lens sprint, do at least 4 parallel WebSearch queries hitting (a) the dominant commercial product's current API, (b) the second-most-popular alternative, (c) the open-source / indie precedent, (d) the academic SOTA. Findings go here.

---

## Music lens (Sprint A: `55c395b` · Sprint B: pending)

**Research date**: 2026-05-18

### Spotify (deprecation finding)
- **Audio Features API was DEPRECATED November 2024.** The 13-field feature vector (energy / valence / danceability / acousticness / instrumentalness / liveness / loudness / speechiness / key / mode / tempo / time_signature / duration) is no longer accessible via the official API.
- Audio Analysis API also deprecated.
- Implication for Concord: the CONCEPTS are still useful for content-based classification but we do NOT claim Spotify parity. Our axes are content-derived from bpm/key/duration/genre metadata + optional LLM enhancement.
- Source: [Spotify Web API reference](https://developer.spotify.com/documentation/web-api/reference/get-audio-features), [Musicae alternative writeup](https://medium.com/@musicae.io/spotify-audio-analysis-was-deprecated-heres-the-best-spotify-api-alternative-for-developers-585750724f48)

### Apple Music (2026 algorithm)
- **7 primary signals** drive discovery rank:
  1. Shazam tag volume
  2. Library add rate
  3. Replay completion rate
  4. Apple Music for Artists "discovered listeners" metric
  5. "Now Playing" auto-radio session length (sessions that produce 30+ min radio = high-quality seed)
  6. Geographic listening pattern
  7. Apple Music Classical's separate ranking signals
- **Key insight**: library adds + "Love" hearts are weighted MUCH stronger than passive streams. Apple's revenue model isn't ad-driven, so they can structurally favor intent signals over engagement.
- **Implementation in Concord** (Sprint B): added `library_add_ratio` weight (+1.8) > `avg_listen_pct` weight (+1.2). Likes are the closest current analog to "library add"; future sprint could add explicit "save to library" distinct from "like".
- Source: [Apple Music Algorithm Guide 2026](https://beatstorapon.com/blog/the-apple-music-algorithm-in-2026-a-comprehensive-guide-for-artists-labels-and-data-scientists/), [Chartlex: Apple Music Discovery Algorithm 2026](https://www.chartlex.com/blog/streaming/apple-music-discovery-algorithm-2026)

### SoundCloud (Musiio)
- **Musiio explicitly trains on SOUND not popularity** — direct precedent for Concord's depth-over-engagement positioning.
- "Liked By" playlists drive 3x more engagement than other discovery methods. Social-graph signal.
- First Fans predictive algorithm rewards scene participation (reposts / comments / collaboration) over algorithmic discovery.
- Only 12% of SoundCloud users discover via SoundCloud itself (vs 22% Spotify, 25% TikTok) — discoverability gap they're working to close.
- **Implementation in Concord**: `independence` weight (+0.8) explicitly boosts small artists (followers <100 → 0.9 score; >100k → 0.2 score). Mirrors SoundCloud's positioning.
- Source: [SoundCloud Music Intelligence Report 2026](https://soundcloud.com/company/music-intelligence-report-2026), [Chartlex: SoundCloud vs Spotify for Artists 2026](https://www.chartlex.com/blog/streaming/soundcloud-vs-spotify-independent-artists-2026)

### Bandcamp (creator-economy precedent)
- Default split: 15% digital / 10% physical (artists keep ~82%)
- **Bandcamp Fridays = 0% take, 8 days/year scheduled for 2026** (Feb 6, Mar 6, May 1, Aug 7, Sep 4, Oct 2, Nov 6, Dec 4)
- $19M paid in 2025 alone; $154M cumulative since 2020
- Migrating to Stripe in 2026 with **no payout fees**
- **Implementation in Concord** (Sprint C — pending): adopt the "Concord Fridays" pattern. 8 days/year where the music marketplace fee waives to 0. Strong precedent, direct competitive moat.
- Source: [Bandcamp Fridays $154m payouts](https://www.musicbusinessworldwide.com/bandcamp-fridays-hit-154m-in-payouts-since-2020-with-19m-paid-in-2025-alone/), [Bandcamp Help: payment system](https://get.bandcamp.help/hc/en-us/articles/23020694353047-How-do-I-get-paid-on-Bandcamp-and-how-often)

### Academic state of the art (2024-2025)
- Shift from collaborative filtering → content-aware (audio + lyrics + emotion + demographics)
- LLMs + hybrid multi-modal systems
- GNN (graph neural networks) emerging as cutting edge for hybrid recommendations
- Underexplored: demographic-based, reciprocal-based, popularity-based, non-personalized
- **Implication for Concord**: our hybrid deterministic + LLM + behavioral scorer is on-trend. GNN edge for a future sprint when we have enough scene/social-graph density to train on.
- Source: [arXiv: Content filtering methods for music recommendation (July 2025)](https://arxiv.org/html/2507.02282v1), [Springer: Hybrid music recommendation with GNN](https://link.springer.com/article/10.1007/s11257-024-09410-4)

### What's NOT in scope yet (Sprint C+ candidates)
- Real audio fingerprint analysis (Musiio-equivalent — would need actual audio processing)
- Shazam-tag-equivalent external recognition signal (Concord's cross-lens cite cascade could play this role)
- "First Fans" early-adopter mechanic
- Genre-specific surfaces (Apple Music Classical is its own product — Concord could do same for classical / jazz / experimental)
- GNN social-graph recommender layer
- Real-time radio session quality computation (currently approximated via opts.sessionSeedScore)

---

## Accounting lens (Sprint A: `4f2e034` · Sprint B: `822385b` · Sprint C: `2bed35e`)

**Research date**: 2026-05-18 (RETROACTIVE — shipped without research grounding; documented after the fact)

### QuickBooks Online API (2026)
- 10 req/sec/realm rate limit; 120/min batch
- **CloudEvents format migration required by May 15, 2026** — our webhook format isn't CloudEvents-shaped. Follow-up gap noted.
- AI-enhanced API predictions, anomaly flagging, auto-reconciliation are part of QuickBooks' 2026 roadmap
- Source: [Knit: QuickBooks Online API Integration Guide 2026](https://www.getknit.dev/blog/quickbooks-online-api-integration-guide-in-depth), [Zuplo: QuickBooks API Complete Guide 2026](https://zuplo.com/learning-center/quickbooks-api)

### Xero (2026)
- **Bank rules** automate categorization on payee/description/amount/range
- **AI anomaly detection** for missing fees + duplicate entries (built-in dup detection misses non-exact dupes — date/description variance breaks it)
- **Predictive cash flow forecasting** is a core Xero AI feature
- Tracking categories for multi-dim analysis
- Source: [Xero Developer: Bank Feeds API](https://developer.xero.com/documentation/api/bankfeeds/overview), [Webgility: Xero Bank Reconciliation Automation 2026](https://www.webgility.com/blog/xero-bank-reconciliation-automation)

### Wave (freemium model)
- Starter plan free forever (unlimited invoicing + expense tracking + basic reports)
- Pro plan $19/mo for bank auto-import
- Payroll: $25/mo + $6/employee
- Payment processing: 2.9% + $0.60 (matching Stripe/PayPal)
- Source: [Wave Pricing](https://www.waveapps.com/pricing), [Business.org: Wave Accounting Review 2026](https://www.business.org/finance/accounting/wave-accounting-review/)

### Plaid (bank-feed aggregator)
- Industry-standard. QuickBooks / Xero / FreshBooks all use Plaid (or MX as alternative).
- **Concord has ZERO bank-feed integration today** — this is the biggest accounting parity gap.
- Direct API connections (e.g. Puzzle's Mercury integration) are emerging as alternatives to screen-scraping aggregators.
- Source: [Open Banking Tracker: Plaid](https://www.openbankingtracker.com/api-aggregators/plaid), [Puzzle.io: Accounting Software Banking Integrations Jan 2026](https://puzzle.io/blog/accounting-software-banking-integrations)

### Accounting follow-up gaps documented for future sprints
1. **Bank-feed integration (Plaid + MX + direct API)** — biggest parity gap
2. **Predictive cash flow forecasting** — Xero has it, we have P&L narrative but no forward-looking
3. **CloudEvents webhook migration** — QuickBooks requires by May 2026; ours doesn't conform
4. **Multi-dimensional tracking categories** — Xero pattern, not in our schema
5. **Mileage tracking + receipt auto-pull from email** — Wave / FreshBooks have it

---

## Process notes

- Research happens BEFORE coding, not after. The accounting retroactive section is a one-time exception; future lenses get research-first.
- Each lens gets ≥4 parallel WebSearch queries hitting: dominant API, alternative, open-source/indie precedent, academic SOTA.
- Each lens claim ("X parity" / "Y moat") should map to a source link in this file.
- When an API or signal is deprecated/renamed, document it — saves future sessions the same surprise.
- When the research reveals a moat (Bandcamp Fridays, Apple library-add weighting), incorporate it into the next sprint's plan.
