# Data Provenance — what Concordia ingests, stores, and redistributes

A grounded audit of every path by which external or user data enters the platform,
how it is stored, whether it is redistributed, and the legal/ethical posture of each.
Reproducible by re-reading the cited files. **Verdict: overwhelmingly clean** — user
data is locked down, ingested content is excerpt-only + attributed, training is
RAG/in-context (not weight-modifying), and the one real commercial flag (the vision
model lineage) is resolved (see `LICENSING.md`).

> ⚠️ Engineering-informed, **not legal advice.** A lawyer should confirm the commercial
> posture before scale. This doc records the code facts a review would start from.

## 1. User data — clean

- **Personal DTUs are user-scoped + encrypted.** Reads filter `WHERE user_id = ?`; the
  personal locker stores `encrypted_content` (AES-256-GCM, session-derived key) with
  `iv`/`auth_tag` (`server/lib/personal-locker/pipeline.js`, `routes/personal-locker.js`).
  No cross-user read surface (round-5 audit). Default DTU `scope='personal'`; the
  `personal_dtus_never_leak` invariant holds.
- **Consent for any model use is tracked** (`server/lib/training-consent.js`):
  user-authored content defaults `train_consented=0` (explicit opt-in); platform-generated
  simulation rows default `1` but are per-row redactable. The corpus extractor only reads
  `WHERE train_consented = 1`.
- **GDPR-style export** exists (account/corpus export). We are not the class of platform
  that gets sued for hoarding user data.

## 2. Training — RAG/in-context, NOT weight modification

`server/lib/brain-training/runner.js` (header `:5-21`) is explicit: this is **not**
gradient fine-tuning. The daily refresh for the small brains reads consented
`brain_interactions` rows, bakes the top examples into a new Ollama **Modelfile SYSTEM
block** as plain text, `ollama create`s a new tag, evals it, and atomically swaps the
`brain_active_models.active` flag if it passes. No backprop, no weight files, no adapters.
User content reaches **prompt context only**, never model parameters. (A real LoRA/QLoRA
worker could swap in later — at which point the consent gate becomes load-bearing for
weights too.)

## 3. Content ingestion (RSS → DTUs) — strong posture, hygiene to maintain

`server/lib/feed-manager.js` + `feed-sources.js` (60+ public RSS/Atom feeds across ~19
domains) + `source-attribution.js`:

- **Excerpt only.** Stores the RSS `description`/`summary` + title + link — it does **not**
  fetch or store full article HTML (no scraping).
- **Attribution on every item.** Each feed DTU carries `source:{name,url,license,
  attribution,fetchedAt}`, `epistemologicalStance:'reported'`, `meta.via:'feed-manager'`.
- **Default Fair-Use license blocks resale.** `source-attribution.js:195` — Fair-Use /
  CC-BY-NC / All-Rights-Reserved content **cannot be marketplace-listed**. Feed DTUs also
  bypass the royalty cascade (no creator attribution → no royalties accrue).
- **Honest UA** (`ConcordOS/2.0 FeedManager`), dedup window, 10s timeout, auto-disable
  after 5 fails.
- **Hygiene gaps closed in Track G2:** a global `CONCORD_FEED_MANAGER_ENABLED` kill-switch,
  reuse of the entity-path `checkRobotsTxt` + `429`/`Retry-After` backoff in the feed
  fetcher, and a `purgeBySource()` takedown helper + per-source denylist.

Litigation climate note: news orgs are litigious about AI ingestion. The defensible
posture — excerpt + link-back + attribution + responsive-to-takedown — is met; keep it
there (don't start storing full text or reselling ingested content).

## 4. Web / external-API ingestion — code-enforced ToS

- **Entity web exploration** (`server/emergent/entity-web-exploration.js`) enforces
  `checkRobotsTxt()` on every domain, honest UA (`ConcordEntity/1.0 (+…/entity-policy)`),
  rate limits (3/domain, 5s spacing, 10/window), and a `WEB_POLICY` that **never** bypasses
  auth / paywalls / CAPTCHAs and **never** scrapes personal-data URLs.
- **URL ingest** (`ingest.url`, `server.js`) is SSRF-guarded (`ssrf-guard.js` — DNS resolve,
  private-range reject), text-only, 12k-char cap, persisted with `source:'ingest.url'`.
- **External free APIs** all attributed: AIC artworks (`art.aic-search`, IIIF URLs, not
  downloaded), NASA APOD (`astronomy.apod`, respects copyright field), iTunes search +
  LRCLIB (music, preview URLs, not resold), HuggingFace metadata only (no auto-download).
  Non-commercial licenses are marketplace-blocked at the DTU level.
- **Vision is local + private.** Images go to the local Ollama vision model only (never an
  external vision API); user uploads are encrypted at rest; SSRF-guarded URL fetch.

## 5. Federation egress — gated, no PII

`GET /api/world/social-shadows` exports only public `social_awareness` DTU summaries
(`id, summary, authorHandle, targetWorldId, createdAt`) — no prompts, responses, email,
wallet, or identifiers. Production requires `CONCORD_FEDERATION_TOKEN` (timing-safe), else
503. Opt-in by publishing a public social DTU.

## 6. PII handling — scrubbed

`server/logger.js:14-48` auto-redacts sensitive keys/values (password/token/jwt/secret/
apiKey/…) before any log output. NPC `narrative_context.secret` is structurally omitted
from LLM prompts + canary-scanned (`narrative-bridge.js:184,220`). User email lives only in
auth + Stripe billing — never in DTUs, prompts, federation, or unscrubbed logs.

## 7. Takedown SOP

A publisher / rights-holder request is one operation, because every ingested DTU is
source-tagged:
1. Add the source to the feed denylist (skips future ingestion).
2. `purgeBySource(sourceNameOrFeedId)` removes its existing DTUs (Track G2 helper).
3. Confirm with a `SELECT … WHERE source.name = ?` count of 0.

## Reproduce
`server/lib/{feed-manager,feed-sources,source-attribution,training-consent}.js`,
`server/lib/brain-training/runner.js`, `server/emergent/entity-web-exploration.js`,
`server/lib/personal-locker/*`, `server/logger.js`, `server/lib/narrative-bridge.js`.
