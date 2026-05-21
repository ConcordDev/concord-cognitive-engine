# music — Competitive Teardown vs Spotify (2026)

**This is NOT a completeness checklist.** It is an honest gap analysis of the
`music` lens against the real category leader. It replaces the earlier
self-graded "Feature Completeness Spec," which listed only features the lens
already had and checked every box.

Category leader: **Spotify** (~675M users, ~100M tracks, ~$16B/yr revenue as of
early 2026). Apple Music is #2; the teardown uses Spotify because it sets the
feature bar. The DAW/production side is the separate `studio` lens; long-form
audio is `podcast`. This lens is the **streaming + library + discovery** app.

Legend for unchecked items:
- `[BUILDABLE]` — a solo developer could realistically build this.
- `[INFRA]` — needs real streaming infrastructure or scale to matter.
- `[LICENSED]` — needs content-licensing deals; structurally out of reach.

---

## Scorecard

The lens genuinely matches **~11 of ~52** of Spotify's surface features. The
single largest one — a licensed catalog — is structurally unreachable, which
means the lens **cannot compete with Spotify as a streaming service at all.**
Read the verdict before treating any of the unchecked items as a roadmap.

---

## 1. Catalog & content — the moat

- [ ] ~100M licensed tracks (Universal / Sony / Warner + distributors) — `[LICENSED]` **the fatal gap**
- [ ] ~6M podcast titles — `[LICENSED]` / partly the separate `podcast` lens
- [ ] ~350k+ audiobooks (Findaway) — `[LICENSED]`
- [ ] Music videos — `[LICENSED]`
- [ ] Thousands of human-curated editorial playlists (RapCaviar etc.) + an editorial team — `[INFRA]`
- [x] Track records with title / artist / album / genre / ISRC — but the catalog is **user-uploaded only**
- [x] Real open metadata via MusicBrainz (artist search, releases, ISRC lookup) — *Spotify does not expose this; lens extra*

**Spotify's moat is ~$10B/yr in licensing. There is no solo-dev path to it.**

## 2. Playback & audio

- [x] Play / pause, now-playing state, scrub / progress, play-count + history
- [x] Queue — add, play-next, list, clear
- [x] Audio settings persisted — crossfade, gapless, normalize, mono, quality tier
- [ ] Streaming CDN with adaptive bitrate (Ogg Vorbis 96/160/320, AAC) — `[INFRA]`
- [ ] Offline downloads with DRM — `[INFRA]` + `[LICENSED]`
- [ ] Lossless / HiFi tier (Spotify "Music Pro") — `[INFRA]` + `[LICENSED]`
- [ ] Real gapless + automix + crossfade *applied to the audio stream* (settings persist but the engine is minimal) — `[BUILDABLE]`
- [ ] Spotify Connect — hand off playback across phone / desktop / speaker / TV / console — `[INFRA]`
- [ ] Car (CarPlay / Android Auto), wearOS, smart-speaker, TV, console apps — `[INFRA]`

## 3. Discovery & personalization

- [x] Daily Mix — genre-affinity, excludes recently played
- [x] Radio — seed a station by track / artist / genre
- [x] Smart Shuffle — weighted liked / familiar / fresh mix
- [x] Blend — merges taste sources into a shared playlist
- [x] Recommendations — seed / taste-profile ranking
- [x] Genre hub browse
- [ ] Discover Weekly / Release Radar / Daylist / On Repeat — scheduled algorithmic playlists — `[BUILDABLE]` but shallow without scale
- [ ] A recommendation engine trained on billions of listening events (collaborative filtering + audio analysis) — `[INFRA]` — lens uses heuristics over a tiny local catalog
- [ ] AI DJ with **voice** narration, personalized, multi-language — `[BUILDABLE]` (substrate has TTS + LLM) — lens has only a text "DJ intro line"
- [ ] AI Playlist — prompt-to-playlist generation — `[BUILDABLE]` (substrate has an LLM; not wired)
- [ ] Search across a 100M-track catalog + lyrics + podcasts — `[LICENSED]` (lens search works, but only over the local library)

## 4. Social

- [x] Wrapped — per-year recap (top tracks / artists / minutes)
- [x] Listening insights — recently played, top tracks / artists, by-genre stats
- [ ] Friend Activity feed — `[BUILDABLE]` (substrate already has a social graph)
- [ ] Collaborative playlists (multi-user, live) — `[BUILDABLE]`
- [ ] Jam — real-time synchronized group listening — `[BUILDABLE]` (substrate has realtime sockets)
- [ ] Share to Instagram / stories / link cards — `[BUILDABLE]`

## 5. Lyrics

- [x] Plain + timed lyrics — set / get, active-line highlight
- [ ] Real-time **licensed** synced lyrics (Musixmatch), translation, sing-along — `[LICENSED]` — lens lyrics are manually entered

## 6. Account & business

- [x] Per-user library / playlists / playback ledger
- [x] Creator royalties — **perpetual royalty cascade** (the substrate pays creators on every downstream citation, not a pro-rata per-stream pool) — *structurally different from, and arguably fairer than, Spotify's ~$0.003/stream model*
- [ ] Free ad-supported tier + an ad network — `[INFRA]`
- [ ] Premium Individual / Duo / Family / Student tiers + billing — `[BUILDABLE]` (substrate has an economy)
- [ ] Spotify Kids, explicit filter, parental controls — `[BUILDABLE]`

## 7. Artist side (Spotify for Artists)

- [x] Upload tracks; revenue / listening-stats view
- [ ] Streaming analytics — audience demographics, geography, source-of-stream — `[BUILDABLE]`
- [ ] Canvas (looping cover visuals), Clips — `[BUILDABLE]`
- [ ] Playlist pitching, Marquee / Showcase paid promo, Discovery Mode — `[BUILDABLE]`
- [ ] Artist profile, bio, artist pick, merch (Shopify), concert listings (Bandsintown) — `[BUILDABLE]`

## 8. Concord-native extras (Spotify has none of these)

- [x] BPM analysis from beat timestamps
- [x] Krumhansl-Schmuckler key detection
- [x] Chord-progression matching
- [x] Energy-curve setlist planner
- [x] Music DTUs feed the world simulation (district soundscapes, cross-world XP)

---

## Verdict

**The `music` lens cannot compete with Spotify, and no amount of build effort
changes that.** Spotify's defining feature — instant on-demand access to ~100M
licensed recordings — requires licensing deals with the three major labels that
cost billions per year. That is `[LICENSED]`: not a backlog item, a structural
wall. Every "streaming service" competitor (Apple, Amazon, YouTube, Tidal,
Deezer) is a company that pays those licenses. A lens cannot.

What the lens actually has is the **mechanics** of a streaming app — library,
playlists, queue, playback ledger, heuristic discovery, Wrapped, stats — over a
catalog it cannot fill.

## The category it *can* compete in

Re-aim the lens at **creator-owned music platforms** — Bandcamp, Audius,
SoundCloud — where the catalog is *user-uploaded by design*. That single
reframe deletes the `[LICENSED]` wall, because there is nothing to license.

Against that category the lens already has the hard part (upload, library,
playback, royalties) and a genuine edge (perpetual royalty cascade vs Bandcamp's
one-time sale / Spotify's per-stream pool; substrate integration; music-theory
tools). The realistic, **buildable** gap to a credible Bandcamp/Audius rival:

1. Artist storefront / public profile page with an embeddable player.
2. Real audio hosting with adaptive playback + a waveform scrubber.
3. Pay-what-you-want / name-your-price purchase + high-res download.
4. Follower feed + "supported by" social proof.
5. A discovery surface (genre/tag browse, staff picks, trending) that works at small catalog scale.
6. Native mobile playback (extend `concord-mobile`).

That is a real roadmap with no structural walls. "Compete with Spotify" is not.
