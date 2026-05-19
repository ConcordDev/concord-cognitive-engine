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

### Sprint C research additions (2026-05-18 — done before building)

**Sound.xyz / Audius (on-chain royalty precedent)**
- Sound.xyz uses **EIP-2981** smart-contract royalty standard. Default 10% on secondary market sales. Splits configurable across multiple wallet addresses.
- Audius = decentralized music streaming on open-source audio protocol across multiple blockchains.
- Both demonstrate the artists-retain-most-primary-and-earn-on-secondary model. Concord's royalty-cascade engine is the equivalent (without the blockchain — built on DTU lineage instead).
- Source: [Sound.xyz Explained](https://nftplazas.com/sound-xyz-music-nft-marketplace/), [Chainlink: How Music NFTs Can Reshape the Music Industry](https://chain.link/education-hub/music-nfts)

**ClearBeats — industry's biggest unsolved problem**
- Quote: "Derivative works clearance with accurate rights attribution at scale" — explicitly called out as the music industry's biggest challenge.
- **Concord already has the substrate to solve this**: every cover/sample/interpolation is a derivative DTU that cites the parent DTU. Royalty cascade automatically routes a share of every derivative's revenue back through the lineage chain.
- **Sprint C will expose this as the load-bearing music moat** — track DTU mints with auto-derivative-attribution.
- Source: [ClearBeats: Derivative Works Clearance announcement](https://www.recordoftheday.com/news-and-press/clearbeats-solves-music-industrys-biggest-challenge-derivative-works-clearance-with-accurate-rights-attribution-at-scale)

**ISRC per derivative**
- Every cover / sample / interpolation gets its own ISRC. Required for any sample-license activation.
- Concord's DTU id natively serves this role (every derivative is its own DTU; lineage preserved via dtu_citations).
- Source: [Tracklib: Do I need an ISRC for sample license](https://support.tracklib.com/hc/en-us/articles/14949819945244-Do-I-need-to-have-an-ISRC-in-order-to-get-my-sample-license), [Usemogul: ISRC Codes for Music 2026 Essential Guide](https://www.usemogul.com/post/isrc-codes-for-music)

**Funkwhale + Soundstorm (ActivityPub federation precedent)**
- Funkwhale = self-hosted music server speaking ActivityPub. Already exists, already federated.
- Soundstorm = audio-oriented federated social network on ActivityPub.
- **Sprint C plan**: Concord music exports as ActivityPub Note objects with audio_url enclosure → compatible with Funkwhale subscribers out of the box.
- Source: [Funkwhale (etke.cc)](https://etke.cc/help/extras/funkwhale/), [Fediverse.Party](https://fediverse.party/en/miscellaneous/)

**Subvert + market shift away from corporate-extractive platforms**
- Subvert = cooperative-owned Bandcamp successor founded by Austin Robey post-Songtradr-acquisition. Worker + artist owned.
- Bandcamp BANNED AI music in 2025-2026. Subvert is consent-based AI.
- Musical AI = attribution layer for generative AI; verifies which copyrights trained a model + splits payments.
- **Implication for Concord**: position concord music as cooperative-aligned + AI-consent-aware natively. When a track is AI-generated, lineage cites training-source DTUs automatically (Musical AI parity built in).
- Source: [EDM: Bandcamp Successor Subvert](https://edm.com/industry/collectively-owned-bandcamp-successor-subvert/), [Vinyl Culture: Bandcamp's AI Music Ban](https://vinylculture.substack.com/p/the-battle-for-musics-soul-from-bandcamps)

**Royalty corrections from prior search**
- Bandcamp actually gives 85-90% to artists (not 82%). Even more artist-friendly than first-pass research suggested.
- Source: [Bandcamp Review & Best Alternatives in 2026](https://www.creatoreconomytools.com/tool/bandcamp)

### Sprint C plan (research-grounded)
1. **Track DTU mints** — every track gets a DTU on publish. Royalty rate default 10% (matches Sound.xyz / EIP-2981), capped 30% (matches our marketplace ceiling). Cover/sample/remix = derivative DTU citing parent → cite cascade routes payments automatically. ClearBeats problem solved natively.
2. **Playlist curator DTU mints** — playlist as DTU, curator earns derived royalty on track plays from that playlist (Bandcamp doesn't have this; Concord moat).
3. **Concord Fridays** — 8 days/year (Feb 6, Mar 6, May 1, Aug 7, Sep 4, Oct 2, Nov 6, Dec 4 in 2026 — match Bandcamp's exact schedule for fan-familiar UX) where music marketplace platform fee waives to 0. Heartbeat checks date + flips a flag.
4. **ActivityPub federation export** — tracks emit ActivityPub Note objects with audio_url enclosure. Compatible with Funkwhale subscribers.
5. **AI-music attribution** — when a track has source='generative', lineage MUST cite training-data DTUs (Musical AI parity).
6. **Cross-lens cite** — track cites referenced from chat / doc / calendar / world events fire royalty cascade.

## Healthcare lens (May 2026 research)

### Source landscape
- **Epic MyChart** leads patient portals: 90.2 KLAS score, 150M+ users, cross-system record sharing, AI message drafts, Apple Health integration. [Epic vs Cerner 2026](https://www.tactionsoft.com/blog/cerner-vs-epic/)
- **FHIR R4 → R5** transition. HTI-1 final rule effective **Jan 15, 2025**. USCDI v3 baseline **Jan 1, 2026**. SMART App Launch v2 replaced v1 as required authz standard. FHIR R6 expected late 2026. [FHIR R4 vs R5 vs R6 Comparison](https://www.health-samurai.io/articles/fhir-r4-vs-fhir-r5-choosing-the-right-version-for-your-implementation), [FHIR Implementation Guide 2025](https://www.sprypt.com/blog/fhir-guide)
- **CommonHealth** (Android answer to Apple Health Records) — SDK supports allergies, conditions, immunizations, lab results, medications, procedures, vitals (the 7 core resource types). PIN/biometric encryption, explicit consent for every access. [CommonHealth Developers](https://www.commonhealth.org/developers)
- **Apple Health Records** — uses FHIR as underlying standard, SMART for one-time auth. 500+ hospitals support it. [Apple Health Records via FHIR R4](https://www.healthcare.digital/single-post/apple-health-fhir-r4-and-the-future-of-medical-records)
- **21st Century Cures Act** mandates open FHIR APIs for certified EHRs → patient-facing apps CAN pull records from any portal. [Cures Act compliance](https://topflightapps.com/ideas/get-patient-health-records/)

### Compliance reality (load-bearing)
- **HIPAA AI rules update (Jan 2025)** — AI tools interacting with ePHI MUST log:
  - Prompt content
  - Model versions
  - Automated workflows
  - **6+ year retention** required
  - [HIPAA Audit Log Requirements 2025](https://www.kiteworks.com/hipaa-compliance/hipaa-audit-log-requirements/), [HIPAA Audit Checklist 2026](https://www.hipaajournal.com/hipaa-audit-checklist/)
- **HIPAA Security Rule** — audit logs must track: who accessed PHI, when, what actions, what specific data viewed. Revocation must be actionable without delay.
- **FDA stance on LLM clinical decision support** (CRITICAL):
  - "LLMs are not intended for clinical decision-making but providers are adopting them anyway"
  - "Generative AI can hallucinate, so rigorous guardrails will be needed"
  - January 2026 FDA CDS guidance + August 2025 AI change-control plans
  - 1000+ AI/ML-enabled medical devices cleared as of early 2025
  - [FDA AI healthcare risks PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12140231/), [FDA Digital Health Guidance 2026](https://intuitionlabs.ai/articles/fda-digital-health-technology-guidance-requirements)

### Disruption pattern: Direct Primary Care (DPC)
- 2,800+ DPC practices in US as of early 2026. $50-150/mo per member. No insurance billing.
- **Healthie + SimplePractice** are the dominant DPC software platforms.
- DPC model = subscription billing + secure messaging + appointment scheduling + telehealth — Concord can match natively without insurance complexity.
- [DPC software comparison](https://zipdo.co/best/direct-primary-care-software/), [SimplePractice vs Healthie](https://www.gethealthie.com/healthie-vs-simple-practice)

### Concord-moat opportunities (research-grounded)
1. **Patient-owned portable record** — every health resource is a DTU. Cures-Act-compliant by design. Patient revokes consent → DTU access blocked; lineage preserved.
2. **HIPAA-compliant AI audit log natively** — our existing AI-run ledger pattern (proven on social/accounting/music) already records prompt+model+source. Just retain 6+ years per HIPAA. Use enforced.
3. **FDA-compliant guardrails** — every clinical-content macro returns mandatory "Not for diagnosis. Consult a licensed provider" disclaimer. Citation of sources required. Repair Brain pre-flight on every LLM clinical output to flag potential hallucinations.
4. **SMART on FHIR app surface** — import records from Epic/Cerner/Athena via patient OAuth consent. Export back out as FHIR Bundle. Apple Health Records + CommonHealth compatible.
5. **DPC subscription billing layer** — recurring concord-coin subscription on top of provider relationship. Telehealth video room + secure messaging + appointment scheduling.
6. **Cross-lens cite** — medication ↔ task (refill reminder), encounter ↔ calendar (follow-up), symptom ↔ chat (telehealth conversation), lab result ↔ doc (specialist letter).
7. **AI training consent for health DTUs** — opt-in only (default OFF). Per HIPAA + research-ethics norms.

### Sprint plan
- **Sprint A (substrate)**: Migration 240 — FHIR-aligned 7-resource substrate (patients/conditions/medications/allergies/immunizations/observations/procedures + encounters/providers/appointments/audit_log/consent_grants). 25+ macros.
- **Sprint B (AI surface)**: Migration 241 — symptom triage (FDA-disclaimer-mandated), drug interaction check via RxNorm-style IDs, clinical summary composer, lab anomaly detection. ALL invocations logged to health_ai_runs with HIPAA-compliant fields.
- **Sprint C (moats)**: Migration 242 — health DTU mints + cross-lens cite + SMART on FHIR import/export + DPC subscription billing.

### Out of scope (would warrant separate audit)
- ICD-10 / SNOMED CT code lookup (would require subscription to UMLS or third-party API)
- Pharmacy fulfillment integration (Surescripts is the network; requires contract)
- Insurance claims (837 EDI format; outside Concord's value prop)
- DICOM imaging (separate stack from FHIR)

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
