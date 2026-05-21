# music — Feature Gap vs Spotify (2026)

**Framing.** The catalog is not the scoring bar. The lens fills its catalog two
ways by design — free public-API ingestion and creator uploads — so "Spotify
licenses 100M tracks" is irrelevant. This doc scores **feature / functionality
parity**: does the lens *do* what Spotify does. The DAW side is the `studio`
lens; long-form audio is `podcast`.

Effort tags on gaps: `[S]` small, `[M]` medium, `[L]` large. **None are
`[LICENSED]`** — every gap below is buildable.

---

## What the lens has (verified by reading the code)

- Real audio engine — `lib/music/player.ts` (251 LOC): `HTMLAudioElement` +
  `AudioContext`, play / pause / seek / volume / mute, auto-advance on track end.
- Library CRUD; search (client-side over the user's tracks).
- Playlists — create / reorder / delete, collaborative flag, detail with duration.
- Queue — add / play-next / list / clear.
- Now-playing bar — scrub, shuffle, repeat, prev / next, volume.
- Liked Songs; artist follow; MusicBrainz artist / release / ISRC lookup.
- Discovery — Radio (seeded), Smart Shuffle ("AI DJ" text line), Daily Mix,
  Blend, genre hub, recommendations.
- Insights — recently played, top tracks / artists, listening stats, Wrapped.
- Lyrics panel — renders synced lyrics with active-line highlight.
- Sleep timer; audio-settings store; track upload flow; revenue view.
- Concord extras — BPM / key / chord / setlist tools; music DTUs feed the world.

That is a real, working streaming-app core.

## Feature gaps vs Spotify — all buildable

### Catalog auto-fill — the plan's keystone, and it is NOT wired
- [ ] `[M]` Free-API music ingestion — **nothing is wired.** `music.js` calls
  MusicBrainz, which is metadata-only (no audio). There is no Jamendo, Audius,
  or iTunes-preview ingestion. Today the catalog fills *only* from creator
  uploads. The "fills itself with free APIs" assumption is currently a gap, not
  a feature.
- [ ] `[S]` Auto-fetched **synced lyrics** via LRCLIB (free, no key) — lens
  lyrics are entered manually via `track-lyrics-set`.

### Playback engine
- [ ] `[M]` Crossfade / gapless / normalize / equalizer — `audio-settings`
  *stores* these prefs, but `player.ts` has no crossfade, gapless, or `GainNode`
  code. The settings currently do nothing.
- [ ] `[M]` Offline / downloaded playback (cache + service worker).
- [ ] `[L]` Cross-device handoff ("Connect" — control playback on another device).
- [ ] `[M]` Karaoke / vocal-reduction mode.

### Discovery & AI
- [ ] `[M]` AI DJ with **voice** narration — substrate has TTS; lens DJ is text.
- [ ] `[S]` AI Playlist — prompt → playlist — substrate has an LLM; not wired.
- [ ] `[M]` Scheduled algorithmic playlists — Discover Weekly / Release Radar /
  Daylist (cadence-refreshed); lens has on-demand Daily Mix only.
- [ ] `[M]` A recommendation model that improves with play history beyond the
  current genre-affinity heuristic.

### Social
- [ ] `[M]` Jam — real-time synchronized group listening (substrate has sockets).
- [ ] `[S]` Friend Activity feed (substrate has the social graph).
- [ ] `[M]` Collaborative playlists — multi-user live editing (flag exists, edit
  path not wired).
- [ ] `[S]` Share to social / story cards.

### Artist side
- [ ] `[M]` Streaming analytics — listener demographics, geography, source-of-stream.
- [ ] `[M]` Canvas (looping cover visuals) + artist profile / bio / pick.
- [ ] `[S]` Concert / live-event listings (free API — Bandsintown / Songkick).

---

## Verdict

Scored on **features** (not catalog), the music lens is **not** "structurally
can't compete." It has a genuine streaming-app core and is missing **~15
concrete features — every one buildable, none requiring a license.**

Two honest catches the code review surfaced:
1. The free-API catalog ingestion the whole "fills itself" plan depends on **is
   not implemented** — only creator uploads populate the catalog today.
2. Several already-"shipped" toggles (crossfade, gapless, EQ) are stored but
   inert — the player engine never reads them.

The earlier teardown's "cannot compete with Spotify" conclusion was scoring the
licensed catalog — the wrong bar for this product. On the right bar, music-lens
feature parity is a finite, buildable backlog. The list above is that backlog.
